"""Combine several GeoTIFFs into one Portolan raster collection - a mosaic.

CloudBench only does the light parts: checking the tiles agree (CRS, band
count, data types, nodata - read from their headers before anything is
converted), staging them, and writing the catalog metadata. CloudNativeGIS
does the heavy work in one job (`/api/v1/mosaic`): it converts every tile
to COG, merges the tiles' EPSG:3857 COGs into one web mosaic - the
collection's `visual` derivative - when the upload is at most
settings.MOSAIC_MERGE_MAX_BYTES (a larger one renders from each tile's own
EPSG:3857 COG instead), builds a VRT of the tiles with paths relative to
it, and renders the thumbnail. It uploads each output straight to the
bucket through a presigned URL, reporting its size and SHA-256.

Every tile is published as a STAC item (see portolan_mosaic for the
layout).
"""

import hashlib
import json
import logging
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path, PurePosixPath

import httpx
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from . import direct_upload, portolan, portolan_mosaic
from .client import get_s3_client
from .cng_lite import (
    _provider_name,
    check_target,
    host_contact_email,
    job_directory,
    request_json,
    sources_directory_key,
    update_job,
    wait_for_job,
)
from .cog import prepare_tiff
from .models import CngLiteJob, CngLiteJobStatus

logger = logging.getLogger(__name__)

KIND = "mosaic"
MOSAIC_ENDPOINT = "api/v1/mosaic"
MIN_TILES = 2
GDAL_TIMEOUT = 300


class MosaicMismatch(ValueError):
    """The tiles can't form one mosaic (different CRS, bands, types or nodata)."""


def _gdal(*args: str, cwd: Path | None = None) -> str:
    """Run a GDAL command-line tool, returning its stdout; raise with its stderr."""
    try:
        result = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, timeout=GDAL_TIMEOUT, check=False
        )
    except FileNotFoundError as exc:
        raise ValueError(f"{args[0]} isn't installed on the CloudBench server.") from exc
    if result.returncode != 0:
        raise ValueError(f"{args[0]} failed: {result.stderr.strip()[-500:]}")
    return result.stdout


def read_header(path: Path) -> dict:
    """A GeoTIFF's header (`gdalinfo -json`): CRS, bands, metadata. No pixels are read."""
    header: dict = json.loads(_gdal("gdalinfo", "-json", str(path)))
    return header


def _crs_label(info: dict) -> str:
    wkt = info.get("coordinateSystem", {}).get("wkt", "")
    match = re.search(r'ID\["EPSG",(\d+)\]\]\s*$', wkt)
    return f"EPSG:{match.group(1)}" if match else "a different CRS"


def _signature(info: dict) -> dict:
    bands = info.get("bands", [])
    return {
        "crs": info.get("coordinateSystem", {}).get("wkt", ""),
        "bands": len(bands),
        "types": [band.get("type") for band in bands],
        "nodata": [band.get("noDataValue") for band in bands],
    }


def check_tiles(headers: list[tuple[str, dict]]) -> None:
    """Refuse tiles that can't form one mosaic, naming the odd one out."""
    first_name, first = headers[0]
    expected = _signature(first)
    if not expected["crs"]:
        raise MosaicMismatch(f"{first_name} has no coordinate reference system.")
    for name, info in headers[1:]:
        found = _signature(info)
        if not found["crs"]:
            raise MosaicMismatch(f"{name} has no coordinate reference system.")
        if found["crs"] != expected["crs"]:
            raise MosaicMismatch(
                f"{name} is in {_crs_label(info)}, but {first_name} is in "
                f"{_crs_label(first)}. Every tile of a mosaic must share one CRS."
            )
        if found["bands"] != expected["bands"]:
            raise MosaicMismatch(
                f"{name} has {found['bands']} band(s), but {first_name} has "
                f"{expected['bands']}. Every tile must have the same bands."
            )
        if found["types"] != expected["types"]:
            raise MosaicMismatch(
                f"{name}'s data type ({', '.join(map(str, found['types']))}) differs from "
                f"{first_name}'s ({', '.join(map(str, expected['types']))})."
            )
        if found["nodata"] != expected["nodata"]:
            raise MosaicMismatch(
                f"{name}'s nodata value ({found['nodata'][0]}) differs from "
                f"{first_name}'s ({expected['nodata'][0]})."
            )


def tiff_datetime(info: dict) -> str | None:
    """The TIFF's own date tag (TIFFTAG_DATETIME, "YYYY:MM:DD HH:MM:SS") as RFC 3339."""
    value = info.get("metadata", {}).get("", {}).get("TIFFTAG_DATETIME", "")
    match = re.fullmatch(r"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})", value.strip())
    if not match:
        return None
    year, month, day, hour, minute, second = match.groups()
    return f"{year}-{month}-{day}T{hour}:{minute}:{second}Z"


def _staged_tiles(job_id) -> Path:
    return Path(job_directory(KIND, job_id)) / "tiles"


def start_mosaic(
    uploaded_files,
    name,
    prefix,
    connection_id,
    user,
    license_id=portolan.DEFAULT_LICENSE,
    license_url="",
    replace=False,
):
    """Check and stage an upload of several TIFFs, and start converting them as one mosaic.

    Raises TargetExists unless `replace` (see check_target), MosaicMismatch
    if the tiles don't agree, or ValueError for anything else wrong with
    the upload.
    """
    if not CngLiteJob.is_valid():
        raise ValueError("CloudNativeGIS is not configured.")
    if len(uploaded_files) < MIN_TILES:
        raise ValueError("A mosaic needs at least two GeoTIFFs.")
    names = [PurePosixPath(f.name).name for f in uploaded_files]
    if len(set(names)) != len(names):
        raise ValueError("Two of the files have the same name.")
    name = (name or "").strip() or PurePosixPath(names[0]).stem
    prefix = (prefix or "").strip("/")
    output_key = f"{prefix}/{name}.tif" if prefix else f"{name}.tif"

    s3_client = get_s3_client(connection_id, user)
    folder = check_target(s3_client, output_key, f"{name}.tif", replace)
    job = CngLiteJob(
        kind=KIND,
        owner=user,
        connection_id=connection_id,
        bucket=s3_client.bucket,
        source_name=name,
        output_key=folder,
        input_size=sum(f.size for f in uploaded_files),
        layers=names,
        license=license_id,
        license_url=license_url,
        replace_existing=replace,
        message=f"Waiting to convert {len(names)} tiles",
    )
    job.source_key = sources_directory_key(output_key, job.id)
    tiles = _staged_tiles(job.id)
    tiles.mkdir(parents=True, mode=0o700)
    try:
        headers = []
        for uploaded, tile_name in zip(uploaded_files, names, strict=True):
            path = tiles / tile_name
            prepare_tiff(uploaded, path)
            headers.append((tile_name, read_header(path)))
        check_tiles(headers)
        job.save()
        threading.Thread(target=run_mosaic, args=(job.id,), daemon=True).start()
    except Exception:
        shutil.rmtree(job_directory(KIND, job.id), ignore_errors=True)
        raise
    return job


def job_timeout(input_size: int) -> int:
    """Seconds to allow a mosaic's CloudNativeGIS job, scaled to its size.

    The conversion timeout, plus settings.MOSAIC_TIMEOUT_PER_GB for every
    GB uploaded, capped at settings.MOSAIC_MAX_TIMEOUT (never below the
    conversion timeout). CloudBench waits this long, and the presigned
    URLs it hands out last only a little longer (see direct_upload.URL_MARGIN): a small
    mosaic's URLs stay short-lived, a big one's last as long as it needs.
    """
    base = settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT
    scaled = base + round(settings.MOSAIC_TIMEOUT_PER_GB * input_size / 1024**3)
    return max(base, min(scaled, settings.MOSAIC_MAX_TIMEOUT))


def _hash_file(path: Path) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"checksum": portolan.sha256_multihash(digest.digest()), "size": path.stat().st_size}


def _upload(s3_client, bucket, path: Path, key: str, content_type: str) -> None:
    with path.open("rb") as source:
        s3_client.client.upload_fileobj(
            source, bucket, key, ExtraArgs={"ContentType": content_type}
        )


def run_mosaic(job_id):
    """Have CloudNativeGIS build the mosaic, then publish its catalog metadata.

    CloudBench stages the tiles in the bucket and hands CloudNativeGIS a
    presigned URL to read each one and to write each output, so the heavy
    work - converting the tiles, merging the web mosaic, building the VRT,
    rendering the thumbnail - and the large files never touch CloudBench.
    It then writes only the small files: the STAC items, items.parquet, the
    collection and its docs.
    """
    close_old_connections()
    directory = job_directory(KIND, job_id)
    try:
        job = CngLiteJob.objects.get(pk=job_id)
        owner = job.owner
        if job.connection_id is None:
            raise ValueError("The S3 connection this mosaic was uploading to has been deleted.")
        s3_client = get_s3_client(job.connection_id, owner)
        # The CloudNativeGIS it runs on (see CngLiteJob.provision).
        update_job(
            job.id,
            status=CngLiteJobStatus.PROVISIONING,
            progress=2,
            message="Preparing CloudNativeGIS",
        )
        job.provision()
        names = list(job.layers or [])
        tiles_dir = _staged_tiles(job.id)
        folder = job.output_key
        mosaic_id = portolan.sanitize_layer_id(PurePosixPath(folder).name)
        merge = job.input_size <= settings.MOSAIC_MERGE_MAX_BYTES
        fallback_datetime = job.created_at.strftime("%Y-%m-%dT%H:%M:%SZ")

        taken: set[str] = set()
        tiles = []
        for index, name in enumerate(names):
            # Also shows the job is alive while a big upload is staged.
            update_job(
                job.id,
                status=CngLiteJobStatus.PUSHING,
                progress=5 + round(15 * index / len(names)),
                message=f"Staging tile {index + 1} of {len(names)}: {name}",
            )
            header = read_header(tiles_dir / name)
            source_key = f"{job.source_key}/{name}"
            _upload(s3_client, job.bucket, tiles_dir / name, source_key, "image/tiff")
            (tiles_dir / name).unlink()
            stem = PurePosixPath(name).stem
            tile_id = portolan.unique_layer_id(portolan.sanitize_layer_id(stem), taken)
            tiles.append(
                {
                    "id": tile_id,
                    "title": portolan.prettify(stem),
                    "datetime": tiff_datetime(header) or fallback_datetime,
                    "source_key": source_key,
                }
            )

        # CloudBench stops waiting after the job's timeout, so the URLs
        # needn't outlive it: past that they'd only be a risk. (S3 checks a
        # URL's expiry as a request starts, so an upload under way finishes.)
        timeout = job_timeout(job.input_size)
        expiry = timeout + direct_upload.URL_MARGIN

        def put(relative: str, content_type: str = portolan.COG_MEDIA_TYPE) -> str:
            # Signed with the only content type the upload may carry.
            return direct_upload.presign_put(
                s3_client, f"{folder}/{relative}", expiry, content_type
            )

        vrt_name = f"{mosaic_id}.vrt"
        merged_name = f"{mosaic_id}_3857.tif"
        payload = {
            "tiles": [
                {
                    "id": tile["id"],
                    "source": s3_client.generate_presigned_url(
                        tile["source_key"], expiration=expiry
                    ),
                    "data_upload": put(f"{tile['id']}/{tile['id']}.tif"),
                    **({} if merge else {"web_upload": put(f"{tile['id']}/{tile['id']}_3857.tif")}),
                }
                for tile in tiles
            ],
            "vrt": {"name": vrt_name, "upload": put(vrt_name, portolan_mosaic.VRT_MEDIA_TYPE)},
            "merged": {"name": merged_name, "upload": put(merged_name)} if merge else None,
            "thumbnail": {
                "upload": put(portolan.THUMBNAIL_FILENAME, portolan.THUMBNAIL_MEDIA_TYPE)
            },
        }
        with httpx.Client(
            base_url=f"{job.cloudnativegis_url}/",
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
            headers=job.cloudnativegis_headers(),
        ) as client:
            cng_job_id = request_json(client, "POST", MOSAIC_ENDPOINT, json=payload)["job_id"]
            update_job(
                job.id,
                status=CngLiteJobStatus.POLLING,
                cng_job_id=cng_job_id,
                progress=20,
                message="Waiting for CloudNativeGIS",
            )
            deadline = time.monotonic() + timeout
            outputs = wait_for_job(client, job.id, cng_job_id, deadline)["outputs"]

        update_job(
            job.id,
            status=CngLiteJobStatus.PUBLISHING,
            progress=85,
            message="Publishing to catalog",
        )
        output_keys = []
        for tile, output in zip(tiles, outputs["tiles"], strict=True):
            tile["bbox"] = portolan.wgs84_bbox(output.get("bbox"))
            tile["data"] = {
                "filename": f"{tile['id']}.tif",
                "file": direct_upload.file_fields(output["data"]),
            }
            output_keys.append(f"{tile['id']}/{tile['data']['filename']}")
            if "web" in output:
                tile["visual"] = {
                    "filename": f"{tile['id']}_3857.tif",
                    "file": direct_upload.file_fields(output["web"]),
                }
                output_keys.append(f"{tile['id']}/{tile['visual']['filename']}")
        vrt = {"filename": vrt_name, "file": direct_upload.file_fields(outputs["vrt"])}
        visual = (
            {"filename": merged_name, "file": direct_upload.file_fields(outputs["merged"])}
            if "merged" in outputs
            else None
        )
        thumbnail = (
            {
                "filename": portolan.THUMBNAIL_FILENAME,
                "file": direct_upload.file_fields(outputs["thumbnail"]),
            }
            if "thumbnail" in outputs
            else None
        )
        output_keys += [a["filename"] for a in (vrt, visual, thumbnail) if a]
        outputs_written = [
            *((f"{t['id']}/{t['data']['filename']}", t["data"]) for t in tiles),
            *(
                (f"{t['id']}/{t['visual']['filename']}", t["visual"])
                for t in tiles
                if t.get("visual")
            ),
            (vrt_name, vrt),
            *([(merged_name, visual)] if visual else []),
            *([(portolan.THUMBNAIL_FILENAME, thumbnail)] if thumbnail else []),
        ]
        types = {
            ".tif": portolan.COG_MEDIA_TYPE,
            ".vrt": portolan_mosaic.VRT_MEDIA_TYPE,
            ".png": portolan.THUMBNAIL_MEDIA_TYPE,
        }
        try:
            direct_upload.verify_uploads(
                s3_client,
                [
                    (
                        f"{folder}/{relative}",
                        asset["file"]["size"],
                        types[PurePosixPath(relative).suffix],
                    )
                    for relative, asset in outputs_written
                ],
            )
        except ValueError:
            # A new mosaic's folder was empty before: don't leave orphaned
            # files there. A replaced one's is left as it is, to look into.
            if not job.replace_existing:
                s3_client.delete_prefix(f"{folder}/")
            raise
        total_size = sum(
            a["file"]["size"]
            for a in [
                vrt,
                visual,
                thumbnail,
                *(t["data"] for t in tiles),
                *(t.get("visual") for t in tiles),
            ]
            if a
        )

        publish = directory / "publish"
        publish.mkdir(parents=True, exist_ok=True)
        mirror = _publish_items(s3_client, job, folder, tiles, publish)
        if mirror:
            total_size += mirror["file"]["size"]
            output_keys.append(mirror["filename"])
        if job.replace_existing:
            written = {f"{folder}/{key}" for key in output_keys}
            written |= {f"{folder}/{t['id']}/{t['id']}.json" for t in tiles}
            direct_upload.delete_leftovers(s3_client, folder, written)
        _publish_metadata(
            s3_client,
            job=job,
            owner=owner,
            folder=folder,
            mirror=mirror,
            tiles=tiles,
            vrt=vrt,
            visual=visual,
            thumbnail=thumbnail,
        )
        update_job(
            job.id,
            status=CngLiteJobStatus.COMPLETED,
            progress=100,
            output_size=total_size,
            output_keys=[
                {"name": PurePosixPath(key).name, "key": f"{folder}/{key}"} for key in output_keys
            ],
            message=f"Published a mosaic of {len(tiles)} tiles to the catalog",
            completed_at=timezone.now(),
        )
    except Exception as exc:
        logger.exception("Mosaic %s failed", job_id)
        error = str(exc)
        if isinstance(exc, httpx.HTTPStatusError):
            error = f"CloudNativeGIS returned HTTP {exc.response.status_code}. Check its logs."
        elif isinstance(exc, httpx.RequestError):
            error = "Could not contact CloudNativeGIS. Check the service URL and connectivity."
        update_job(
            job_id,
            status=CngLiteJobStatus.FAILED,
            message="Mosaic conversion failed",
            error=error,
            completed_at=timezone.now(),
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)
        close_old_connections()


def _publish_items(s3_client, job, folder, tiles, publish: Path) -> dict | None:
    """Write each tile's STAC item, and all of them as the item mirror (items.parquet).

    Returns the mirror's asset ({'filename', 'path', 'file'}), or None if it
    couldn't be written: Portolan asks for one (a SHOULD), so the mosaic is
    still published without it.
    """
    items = [portolan_mosaic.build_item_json(folder=folder, tile=tile) for tile in tiles]
    for item in items:
        s3_client.put_object(
            key=f"{folder}/{item['id']}/{item['id']}.json",
            body=portolan_mosaic.dumps(item),
            content_type=portolan_mosaic.ITEM_MEDIA_TYPE,
        )
    path = publish / portolan_mosaic.MIRROR_FILENAME
    try:
        portolan_mosaic.write_item_mirror(items, path)
    except Exception:
        logger.warning("Mosaic %s: couldn't write its item mirror", job.id, exc_info=True)
        return None
    mirror = {"filename": path.name, "path": path, "file": _hash_file(path)}
    _upload(s3_client, job.bucket, path, f"{folder}/{path.name}", portolan.PARQUET_MEDIA_TYPE)
    return mirror


def _publish_metadata(s3_client, *, job, owner, folder, tiles, vrt, visual, thumbnail, mirror=None):
    """Write the collection, its docs and style; link it from the root catalog."""
    title = portolan.prettify(job.source_name)
    license_id = portolan.normalize_license(job.license)
    license_url = job.license_url if license_id == "other" else ""
    style_target = visual["filename"] if visual else f"{tiles[0]['id']}/{tiles[0]['id']}.tif"
    style = portolan_mosaic.dumps(portolan.default_style_for_cog(style_target))
    collection = portolan_mosaic.build_collection_json(
        folder=folder,
        title=title,
        license_id=license_id,
        license_url=license_url,
        provider_name=_provider_name(owner),
        host=portolan.host_provider(
            s3_client.bucket_url,
            name=settings.PORTOLAN_HOST_NAME,
            email=host_contact_email(job.connection_id),
        ),
        tiles=tiles,
        vrt=vrt,
        visual=visual,
        thumbnail=thumbnail,
        mirror=mirror,
        style_file=portolan.file_of(style),
    )
    readme = portolan_mosaic.build_readme(
        title=title,
        vrt_filename=vrt["filename"],
        visual_filename=visual["filename"] if visual else None,
        tiles=tiles,
        license_id=license_id,
        license_url=license_url,
        bbox=collection["extent"]["spatial"]["bbox"][0],
        thumbnail=thumbnail is not None,
        mirror_filename=mirror["filename"] if mirror else None,
    )
    agents = portolan_mosaic.build_agents_md(
        title=title,
        vrt_filename=vrt["filename"],
        visual_filename=visual["filename"] if visual else None,
        tile_count=len(tiles),
        mirror_filename=mirror["filename"] if mirror else None,
    )
    files = [
        ("collection.json", portolan_mosaic.dumps(collection), "application/json"),
        ("README.md", readme.encode("utf-8"), "text/markdown"),
        ("AGENTS.md", agents.encode("utf-8"), "text/markdown"),
        (portolan.STYLE_KEY, style, portolan.STYLE_MEDIA_TYPE),
    ]
    if license_id == "other" and not license_url:
        files.append(
            (
                portolan.UNSPECIFIED_LICENSE_FILE,
                portolan.build_unspecified_license_md(title).encode("utf-8"),
                "text/markdown",
            )
        )
    for relative, body, content_type in files:
        s3_client.put_object(key=f"{folder}/{relative}", body=body, content_type=content_type)
    portolan.ensure_root_catalog(s3_client, folder=folder, title=title)
