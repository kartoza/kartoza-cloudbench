"""A VRT of the rasters a bulk upload converted, published as a collection of its own.

The layers stay what they are - one COG collection each. Beside them goes one
more collection, `<vrt name>/`, that links the layers it covers and has, as its
only asset, a GDAL VRT of every one of their COGs. It is linked from the root
catalog like any layer, so it can be browsed; having no renderable asset, it
isn't a Map Explorer layer.

    <parent>/                        the folder the layers' folders share
      <layer>/<layer>.tif ...        the bulk upload's own layers
      <vrt name>.vrt                 metadata: every COG, by paths relative to it
      <vrt name>/
        collection.json  README.md  AGENTS.md  LICENSE.md?

The VRT is beside the layers' folders, not in its own, so that its paths run
down into them ("<layer>/<layer>.tif"). A path through ".." ("../<layer>/...")
doesn't open with GDAL's /vsis3/, which doesn't resolve it, the S3 request for
it being signed as written.

Nothing is converted and no pixels are read: the VRT is built (by GDAL's
`gdalbuildvrt`) from the start of each COG, where its header is, fetched with a
range request into a scratch folder laid out like the bucket.
"""

import contextlib
import json
import logging
import posixpath
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from django.conf import settings

from . import mosaic, portolan, portolan_mosaic
from .client import get_s3_client
from .cng_lite import _provider_name, host_contact_email
from .models import CngLiteJob, CngLiteJobStatus

logger = logging.getLogger(__name__)

KIND = "cog"
ASSET_KEY = "vrt"
MIN_RASTERS = 2
# How much of the start of a COG is read for its header: its IFDs come first, but
# a very large raster has long tile-offset arrays, so what failed is read again, bigger.
HEADER_READS = (1 << 20, 16 << 20, 256 << 20)
HEADER_WORKERS = 8

# The batch's `vrt` states: waiting for the layers, being built, and how it ended.
PENDING = "pending"
BUILDING = "building"
DONE = "done"
SKIPPED = "skipped"
FAILED = "failed"


def vrt_id(name):
    """The VRT collection's folder name for `name`; raises ValueError if nothing is left of it."""
    if not (name or "").strip():
        raise ValueError("Name the VRT.")
    return portolan.sanitize_layer_id(name)


def _layer(name, key):
    return {
        "title": portolan.prettify(posixpath.splitext(name)[0]),
        "folder": posixpath.dirname(key),
        "key": key,
    }


def raster_layers(batch, s3_client):
    """The batch's GeoTIFFs as layers: [{title, folder, key}] - each layer's folder and data COG.

    Those it converted, and those it skipped for being published already (if
    their COG is still there), by name.
    """
    layers = []
    jobs = batch.jobs.filter(kind=KIND, status=CngLiteJobStatus.COMPLETED)
    for job in jobs:
        key = _data_key(job)
        if key:
            layers.append(_layer(job.source_name, key))
    for item in batch.skipped:
        target = item.get("target")
        if item.get("kind") != KIND or not target:
            continue
        key = f"{target}/{posixpath.basename(target)}.tif"
        try:
            s3_client.get_object_info(key)
        except Exception:
            continue
        layers.append(_layer(item["name"], key))
    return sorted(layers, key=lambda layer: layer["key"])


def _data_key(job: CngLiteJob):
    """The key of a completed COG job's original-CRS COG (not its _3857 one, nor the thumbnail)."""
    for output in job.output_keys or []:
        name = output.get("name", "")
        if name.lower().endswith(".tif") and not name.lower().endswith("_3857.tif"):
            return output.get("key")
    return None


def vrt_folder(layers, name):
    """Where the VRT collection goes: `name` in the folder the layers' folders share."""
    parents = [posixpath.dirname(layer["folder"]) for layer in layers]
    shared = _common_folder(parents)
    return f"{shared}/{vrt_id(name)}" if shared else vrt_id(name)


def vrt_key(folder, filename):
    """The VRT file's key: beside the layers' folders, in the VRT collection folder's parent."""
    return posixpath.join(posixpath.dirname(folder), filename)


def _common_folder(folders):
    parts = [folder.split("/") if folder else [] for folder in folders]
    common = []
    for level in zip(*parts, strict=False):
        if len(set(level)) != 1:
            break
        common.append(level[0])
    return "/".join(common)


def _fetch_header(s3_client, key, path):
    """Write the start of `key` to `path` (as much as GDAL needs); returns its `gdalinfo`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    error = None
    for limit in HEADER_READS:
        body = s3_client.get_object_stream(key, f"bytes=0-{limit - 1}")
        try:
            data = body.read()
        finally:
            body.close()
        path.write_bytes(data)
        try:
            return mosaic.read_header(path)
        except ValueError as exc:
            error = exc
        if len(data) < limit:
            break  # the whole file: a bigger read wouldn't help
    raise error


def _bbox(header):
    """A raster's WGS84 bounding box, from its `gdalinfo`."""
    try:
        ring = header["wgs84Extent"]["coordinates"][0]
    except (KeyError, IndexError, TypeError):
        return None
    lons, lats = [point[0] for point in ring], [point[1] for point in ring]
    return [min(lons), min(lats), max(lons), max(lats)]


def _signature(header):
    """What rasters must share to be in one VRT: CRS, band count and data types.

    Not nodata, as a mosaic's tiles must: each source keeps its own in a VRT.
    """
    signature = mosaic._signature(header)
    return {key: signature[key] for key in ("crs", "bands", "types")}


def _group_alike(layers, headers):
    """The layers whose rasters can share one VRT, and why the others can't.

    The largest set with one CRS, band count and data type (the first wins a
    tie); returns (alike, [(layer, reason)] left out).
    """
    groups = {}
    for layer in layers:
        signature = _signature(headers[layer["key"]])
        groups.setdefault(repr(sorted(signature.items(), key=str)), []).append(layer)
    best = max(groups.values(), key=len)
    reference = headers[best[0]["key"]]
    left_out = []
    for group in groups.values():
        if group is best:
            continue
        for layer in group:
            left_out.append((layer, _why_unlike(headers[layer["key"]], reference)))
    return best, left_out


def _why_unlike(header, reference):
    found, expected = _signature(header), _signature(reference)
    if not found["crs"]:
        return "no coordinate reference system"
    if found["crs"] != expected["crs"]:
        return f"in {mosaic._crs_label(header)}, not {mosaic._crs_label(reference)}"
    if found["bands"] != expected["bands"]:
        return f"{found['bands']} band(s), not {expected['bands']}"
    return (
        f"data type {', '.join(map(str, found['types']))}, "
        f"not {', '.join(map(str, expected['types']))}"
    )


def build_vrt(s3_client, layers, folder, filename):
    """Build the VRT of `layers`' COGs, to be put beside `folder` (see vrt_key).

    Returns (the VRT's bytes, the layers it covers, [(layer, why)] left out, the
    covered rasters' WGS84 bounding boxes). The layers whose rasters differ from
    most (CRS, bands, data type) are left out. Raises ValueError if GDAL
    can't build it.
    """
    with tempfile.TemporaryDirectory(dir=settings.UPLOAD_TEMP_DIR) as scratch:
        root = Path(scratch)

        def header(layer):
            return layer["key"], _fetch_header(s3_client, layer["key"], root / layer["key"])

        with ThreadPoolExecutor(max_workers=HEADER_WORKERS) as pool:
            headers = dict(pool.map(header, layers))
        covered, left_out = _group_alike(layers, headers)
        base = posixpath.dirname(folder)
        workdir = root / base
        workdir.mkdir(parents=True, exist_ok=True)
        mosaic._gdal(
            "gdalbuildvrt",
            "-resolution",
            "highest",
            filename,
            *(posixpath.relpath(layer["key"], base or ".") for layer in covered),
            cwd=workdir,
        )
        extents = [_bbox(headers[layer["key"]]) for layer in covered]
        return (workdir / filename).read_bytes(), covered, left_out, extents


def build_collection_json(
    *,
    folder,
    title,
    license_id,
    license_url,
    provider_name,
    host,
    layers,
    vrt,
    bbox,
    parent_folder="",
) -> dict[str, Any]:
    """The VRT collection's collection.json: the VRT asset, a `related` link per layer.

    `parent_folder` is the batch's shared sub-catalog the VRT nests in
    ("" - the bucket's top level - when there isn't one): the layer links
    up to it, not necessarily straight to the root.
    """
    parent_depth = (
        folder.count("/") - parent_folder.count("/") if parent_folder else folder.count("/") + 1
    )
    links: list[dict[str, Any]] = [
        {"rel": "root", "href": portolan_mosaic._root_href(folder.count("/") + 1)},
        {"rel": "parent", "href": portolan_mosaic._root_href(parent_depth)},
        {"rel": "agents", "href": "./AGENTS.md", "title": "Guidance for AI agents"},
        {"rel": "describedby", "href": "./README.md", "title": "Human-readable documentation"},
    ]
    for link, media_type in zip(
        links, ["application/json"] * 2 + ["text/markdown"] * 2, strict=True
    ):
        link["type"] = media_type
    license_link = portolan.license_link(license_id, license_url)
    if license_link:
        links.append(license_link)
    links += [
        {
            "rel": "related",
            "href": f"{posixpath.relpath(layer['folder'], folder)}/collection.json",
            "type": "application/json",
            "title": layer["title"],
        }
        for layer in layers
    ]
    assets = {
        ASSET_KEY: portolan_mosaic._asset(
            f"../{vrt['filename']}",
            portolan_mosaic.VRT_MEDIA_TYPE,
            "metadata",
            f"{title} (GDAL VRT of {len(layers)} rasters)",
            vrt["file"],
        )
    }
    return {
        "type": "Collection",
        "stac_version": "1.1.0",
        "stac_extensions": [portolan.PORTOLAN_SCHEMA, portolan.FILE_SCHEMA],
        "id": folder,
        "title": title,
        "description": f"{title}: a GDAL VRT of {len(layers)} Cloud Optimized GeoTIFFs, "
        "converted by a CloudBench bulk upload.",
        "license": license_id,
        "providers": portolan.providers(host, provider_name),
        "extent": {
            "spatial": {"bbox": [portolan.wgs84_bbox(bbox) or [-180.0, -90.0, 180.0, 90.0]]},
            "temporal": {"interval": [[portolan._now_iso(), None]]},
        },
        "assets": assets,
        "links": links,
        "updated": portolan._now_iso(),
    }


def build_readme(*, title, filename, layers, license_id, license_url, folder):
    lines = [
        f"# {title}",
        "",
        f"A GDAL VRT of {len(layers)} Cloud Optimized GeoTIFFs, made by a CloudBench bulk "
        f"upload on {portolan._now_iso()[:10]}. Each is also a layer of its own.",
        "",
        "> AI agents: see [AGENTS.md](./AGENTS.md).",
        "",
    ]
    if license_id != "other":
        lines.append(f"**License:** {license_id}")
    elif license_url:
        lines.append(f"**License:** {license_url}")
    else:
        lines.append(
            f"**License:** not specified (see [{portolan.UNSPECIFIED_LICENSE_FILE}]"
            f"(./{portolan.UNSPECIFIED_LICENSE_FILE}))"
        )
    lines += [
        "",
        "## Quick start",
        "",
        f"Open [`{filename}`](../{filename}) (beside this folder) to use every raster below as one. Its paths are "
        "relative to it, so it works straight from the bucket, e.g. in QGIS (*Layer › Add "
        "Raster Layer*, protocol HTTP(S)) or with GDAL:",
        "",
        "```",
        f"gdalinfo /vsicurl/<URL of the folder above this one>/{filename}",
        "```",
        "",
        "Only the parts you view are read.",
        "",
        "## Rasters",
        "",
    ]
    for layer in layers:
        lines.append(
            f"- [{layer['title']}]({posixpath.relpath(layer['folder'], folder)}/collection.json)"
        )
    lines.append("")
    return "\n".join(lines)


def build_agents_md(*, title, filename, count):
    return (
        f"# {title}: guidance for AI agents\n\n"
        f"A STAC collection holding a GDAL VRT of {count} raster layers. The rasters are "
        "collections of their own (see its `related` links); this one adds the VRT only.\n\n"
        "## Files\n\n"
        f"- `../{filename}`: a GDAL VRT listing every raster's COG, with paths relative to it. "
        "Open it to read them as one raster; GDAL fetches only what a read needs. It is an "
        "alternate: each raster's own COG is the data.\n"
        "- `./collection.json`: the collection, with a `related` link per raster.\n\n"
        "## How to use\n\n"
        f"- `rasterio.open('/vsicurl/<url>/{filename}')` or "
        f"`gdal.Open('/vsicurl/<url>/{filename}')`.\n"
        "- Don't download the rasters: COGs support HTTP range reads.\n"
    )


def _holds_anything(s3_client, folder):
    return bool(s3_client.list_objects(prefix=f"{folder}/", delimiter="", max_keys=1)["objects"])


def _exists(s3_client, key):
    try:
        s3_client.get_object_info(key)
    except Exception:
        return False
    return True


def _is_ours(s3_client, folder):
    """Whether `folder` holds nothing, or only a VRT collection a bulk upload made before."""
    if not _holds_anything(s3_client, folder):
        return True
    try:
        collection = json.loads(s3_client.get_object(f"{folder}/collection.json"))
    except Exception:
        return False
    return ASSET_KEY in collection.get("assets", {}) and not any(
        link.get("rel") == "item" for link in collection.get("links", [])
    )


def publish(batch):
    """Build and publish the batch's VRT collection; returns the batch's new `vrt` state.

    {state: done, folder, key, count, leftOut} - or `skipped`, with why (fewer
    than two converted rasters, or nothing alike), or `failed`.
    """
    if batch.connection_id is None:
        return {"state": FAILED, "message": "The S3 connection was deleted."}
    owner = batch.owner
    s3_client = get_s3_client(str(batch.connection_id), owner)
    layers = raster_layers(batch, s3_client)
    if len(layers) < MIN_RASTERS:
        return {
            "state": SKIPPED,
            "message": "No VRT: fewer than two GeoTIFFs were converted or already published.",
        }
    folder = vrt_folder(layers, batch.vrt_name)
    filename = f"{posixpath.basename(folder)}.vrt"
    key = vrt_key(folder, filename)
    # The layers' shared folder (empty at the bucket's top level): the VRT
    # nests in its batch's sub-catalog too, so it doesn't surface outside it.
    batch_folder = posixpath.dirname(folder)
    if not _is_ours(s3_client, folder) or (
        not _holds_anything(s3_client, folder) and _exists(s3_client, key)
    ):
        return {
            "state": FAILED,
            "message": f'"{folder}" or "{key}" already holds something else: pick another VRT name.',
        }
    body, covered, left_out, extents = build_vrt(s3_client, layers, folder, filename)
    if len(covered) < MIN_RASTERS:
        why = "; ".join(f"{layer['title']} is {reason}" for layer, reason in left_out[:3])
        return {"state": SKIPPED, "message": f"No VRT: the rasters aren't alike ({why})."}

    title = portolan.prettify(posixpath.basename(folder))
    license_id = portolan.normalize_license(batch.license)
    license_url = batch.license_url if license_id == "other" else ""
    vrt = {"filename": filename, "file": portolan.file_of(body)}
    collection = build_collection_json(
        folder=folder,
        parent_folder=batch_folder,
        title=title,
        license_id=license_id,
        license_url=license_url,
        provider_name=_provider_name(owner),
        host=portolan.host_provider(
            s3_client.bucket_url,
            name=settings.PORTOLAN_HOST_NAME,
            email=host_contact_email(batch.connection_id),
        ),
        layers=covered,
        vrt=vrt,
        bbox=portolan_mosaic.union_bbox([extent for extent in extents if extent]),
    )
    files = [
        ("collection.json", portolan_mosaic.dumps(collection), "application/json"),
        (
            "README.md",
            build_readme(
                title=title,
                filename=filename,
                layers=covered,
                license_id=license_id,
                license_url=license_url,
                folder=folder,
            ).encode("utf-8"),
            "text/markdown",
        ),
        (
            "AGENTS.md",
            build_agents_md(title=title, filename=filename, count=len(covered)).encode("utf-8"),
            "text/markdown",
        ),
    ]
    if license_id == "other" and not license_url:
        files.append(
            (
                portolan.UNSPECIFIED_LICENSE_FILE,
                portolan.build_unspecified_license_md(title).encode("utf-8"),
                "text/markdown",
            )
        )
    s3_client.put_object(key=key, body=body, content_type=portolan_mosaic.VRT_MEDIA_TYPE)
    for relative, content, content_type in files:
        s3_client.put_object(key=f"{folder}/{relative}", body=content, content_type=content_type)
    # Where the first version kept it: inside the folder, with paths that didn't open from S3.
    with contextlib.suppress(Exception):
        s3_client.delete_object(f"{folder}/{filename}")
    if batch_folder:
        portolan.ensure_sub_catalog(
            s3_client,
            catalog_folder=batch_folder,
            catalog_title=portolan.prettify(posixpath.basename(batch_folder)),
            catalog_description=f"Layers from {batch.source_prefix}, uploaded via CloudBench.",
            folder=folder,
            title=title,
        )
    else:
        portolan.ensure_root_catalog(s3_client, folder=folder, title=title)
    state = {
        "state": DONE,
        "folder": folder,
        "key": vrt_key(folder, filename),
        "count": len(covered),
        "leftOut": [{"name": layer["title"], "reason": reason} for layer, reason in left_out],
    }
    state["message"] = f"VRT of {len(covered)} rasters: {state['key']}"
    if left_out:
        state["message"] += f" ({len(left_out)} left out: not alike)"
    return state
