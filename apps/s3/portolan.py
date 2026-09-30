"""Generates a Portolan-shaped catalog for every uploaded layer.

See https://github.com/portolan-sdi/portolan-spec. Each converted layer
becomes a Portolan "single-file collection": its own folder holding
collection.json, README.md, AGENTS.md, a default MapLibre style, and the
data file(s) themselves. This is a deliberately trimmed subset of the
full spec — no checksums, thumbnails, or multi-language support yet.
"""

import contextlib
import json
import logging
import posixpath
import re
from datetime import UTC, datetime
from typing import Any, cast
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

PORTOLAN_SCHEMA = "https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json"
WEB_MAP_LINKS_SCHEMA = "https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json"
TABLE_SCHEMA = "https://stac-extensions.github.io/table/v1.2.0/schema.json"
FILE_SCHEMA = "https://stac-extensions.github.io/file/v2.1.0/schema.json"
# Multihash prefix for SHA-256: function code 0x12, digest length 0x20 (32 bytes).
_SHA256_MULTIHASH_PREFIX = "1220"
CATALOG_KEY = "catalog.json"

# SPDX ids offered in the upload dialog; "other" is the safe default when
# the uploader doesn't know (or the source data doesn't specify) a license,
# and also covers any license outside this list, given by URL.
LICENSE_CHOICES = [
    {"id": "other", "label": "Other / not specified"},
    {"id": "CC0-1.0", "label": "CC0 1.0 (Public Domain)"},
    {"id": "CC-BY-4.0", "label": "CC BY 4.0"},
    {"id": "CC-BY-SA-4.0", "label": "CC BY-SA 4.0"},
    {"id": "ODbL-1.0", "label": "ODbL 1.0"},
]
DEFAULT_LICENSE = "other"
# STAC 1.1's deprecated "proprietary", which Portolan forbids — older jobs
# (and clients) may still carry it, so it's published as "other" instead.
_FORBIDDEN_LICENSES = {"proprietary"}
# Where a layer licensed "other" without a URL points its license link.
UNSPECIFIED_LICENSE_FILE = "LICENSE.md"

PMTILES_MEDIA_TYPE = "application/vnd.pmtiles"
COG_MEDIA_TYPE = "image/tiff; application=geotiff; profile=cloud-optimized"
PARQUET_MEDIA_TYPE = "application/vnd.apache.parquet"
THUMBNAIL_MEDIA_TYPE = "image/png"
GEOPACKAGE_MEDIA_TYPE = "application/geopackage+sqlite3"
SOURCE_FOLDER = "source"
THUMBNAIL_FILENAME = "thumbnail.png"
_THUMBNAIL_SUFFIX = "_thumbnail.png"

_MEDIA_TYPES = {
    "pmtiles": PMTILES_MEDIA_TYPE,
    "cog": COG_MEDIA_TYPE,
}


def sha256_multihash(digest: bytes) -> str:
    """A SHA-256 digest as the hex multihash Portolan's file:checksum requires."""
    return _SHA256_MULTIHASH_PREFIX + digest.hex()


def _file_fields(asset: dict) -> dict:
    """An asset's file:checksum/file:size (File extension), if it has them.

    Only data files written once per publish carry them (see
    run_conversion); the style — which the style editor rewrites in place —
    and regenerated docs never do, since Portolan counts a stale checksum
    as a conformance failure.
    """
    file = asset.get("file") or {}
    fields = {}
    if file.get("checksum"):
        fields["file:checksum"] = file["checksum"]
    if file.get("size") is not None:
        fields["file:size"] = file["size"]
    return fields


def is_thumbnail_result(name: str) -> bool:
    """Whether a cng-lite result file is a layer's rendered thumbnail."""
    return name.lower().endswith(_THUMBNAIL_SUFFIX)


def thumbnail_stem(name: str) -> str:
    """The stem of the layer a "<stem>_thumbnail.png" result belongs to."""
    return name[: -len(_THUMBNAIL_SUFFIX)]


def thumbnail_asset(item: dict) -> dict:
    """A group_results asset entry for a layer's rendered thumbnail."""
    return {
        "item": item,
        "filename": THUMBNAIL_FILENAME,
        "role": "thumbnail",
        "media_type": THUMBNAIL_MEDIA_TYPE,
    }


def _asset_href(filename: str) -> str:
    """An asset's href relative to its collection folder.

    Assets normally sit in the layer's own folder ("./roads.parquet"); a
    GeoPackage's shared source is given as a path already ("../source/x.gpkg").
    """
    return filename if filename.startswith(("./", "../")) else f"./{filename}"


def _asset_media_type(asset: dict, kind: str) -> str:
    """An asset's own media type (e.g. GeoParquet), else its layer kind's default."""
    return asset.get("media_type") or _MEDIA_TYPES[kind]


def wgs84_bbox(bbox) -> list[float] | None:
    """A bbox clamped to WGS84's range, as Portolan requires of every bbox.

    A raster's extent is its pixels' outer edges, so a global grid
    reaches just past the poles and the antimeridian (e.g. -180.125).
    """
    if not bbox or len(bbox) != 4:
        return None
    west, south, east, north = (float(v) for v in bbox)
    return [max(west, -180.0), max(south, -90.0), min(east, 180.0), min(north, 90.0)]


def sanitize_layer_id(name: str) -> str:
    """Lowercase, hyphenated id — Portolan collection ids must start with a letter."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    if not slug or not slug[0].isalpha():
        slug = f"layer-{slug}" if slug else "layer"
    return slug


def unique_layer_id(layer_id: str, taken: set) -> str:
    """`layer_id`, or "<id>-2", "<id>-3", ... if already `taken` (then taken too).

    Layer names that differ only in case or punctuation ("Roads", "roads")
    sanitize to the same id; without this they'd share - and overwrite -
    one folder.
    """
    candidate, n = layer_id, 2
    while candidate in taken:
        candidate, n = f"{layer_id}-{n}", n + 1
    taken.add(candidate)
    return candidate


def prettify(name: str) -> str:
    """Turn a filename stem/table name into a human-readable title."""
    words = [word for word in re.split(r"[-_\s]+", name or "") if word]
    if not words:
        return name or "Untitled layer"
    return " ".join(
        word if not word.islower() and not word.isupper() else word.capitalize() for word in words
    )


def normalize_license(license_id: str | None) -> str:
    """A license id Portolan accepts: blank or forbidden ones become "other"."""
    license_id = (license_id or "").strip()
    if not license_id or license_id in _FORBIDDEN_LICENSES:
        return DEFAULT_LICENSE
    return license_id


def license_link(license_id: str, license_url: str = "") -> dict | None:
    """The `rel: license` link Portolan requires when the license is "other".

    Points at `license_url` when the uploader gave one, else at a generated
    LICENSE.md in the layer folder saying the terms aren't specified. An
    SPDX id needs no link — the id itself identifies the license text.
    """
    if license_id != "other":
        return None
    if license_url:
        return {"rel": "license", "href": license_url, "type": "text/html", "title": "License"}
    return {
        "rel": "license",
        "href": f"./{UNSPECIFIED_LICENSE_FILE}",
        "type": "text/markdown",
        "title": "License (not specified)",
    }


def build_unspecified_license_md(title: str) -> str:
    return (
        f"# License for {title}\n\n"
        "The license for this data was not specified when it was uploaded to "
        "CloudBench. Contact the data's producer or host (see `collection.json`) "
        "before reusing it.\n"
    )


def host_provider(bucket_url: str, name: str = "", email: str = "") -> dict:
    """The collection's `host` provider: where its data is served from.

    Portolan requires exactly one, with a `url` or `email` to reach it —
    the bucket URL always gives it a url. `name` defaults to the
    endpoint's hostname; `email` is an optional contact (see settings
    PORTOLAN_HOST_NAME / PORTOLAN_HOST_EMAIL).
    """
    provider = {
        "name": name or urlparse(bucket_url).hostname or bucket_url,
        "roles": ["host"],
        "url": bucket_url,
    }
    if email:
        provider["email"] = email
    return provider


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_iso_ms() -> str:
    """Now, to the millisecond - for a catalog's `updated`.

    Anything reading the catalog is cached on its root catalog.json's ETag
    (the STAC API, Map Explorer's layer groups), and a sub-catalog change
    only reaches it by rewriting the root with a new `updated`. At
    one-second resolution, two changes within a second (deleting two of a
    GeoPackage's layers in a row) left the root byte-identical - same ETag,
    stale layers served from the cache.
    """
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_style_for_pmtiles(source_layer: str, data_filename: str) -> dict:
    """`source_layer` must match the PMTiles file's own internal vector
    layer name (from its tippecanoe-written metadata), not the collection
    id — MapLibre requires an exact match or nothing renders."""
    return {
        "version": 8,
        "name": "Default style",
        "sources": {"data": {"type": "vector", "url": f"pmtiles://../{data_filename}"}},
        "layers": [
            {"id": "background", "type": "background", "paint": {"background-color": "#f8f9fa"}},
            {
                "id": "fill",
                "type": "fill",
                "source": "data",
                "source-layer": source_layer,
                "paint": {"fill-color": "#2d7d9b", "fill-opacity": 0.5},
            },
            {
                "id": "line",
                "type": "line",
                "source": "data",
                "source-layer": source_layer,
                "paint": {"line-color": "#2d7d9b", "line-width": 1},
            },
            {
                # Fill/line layers draw nothing for points; without this a
                # point layer would render (and thumbnail) as empty.
                "id": "circle",
                "type": "circle",
                "source": "data",
                "source-layer": source_layer,
                "filter": ["==", ["geometry-type"], "Point"],
                "paint": {"circle-color": "#2d7d9b", "circle-radius": 3},
            },
        ],
    }


def default_style_for_cog(data_filename: str) -> dict:
    return {
        "version": 8,
        "name": "COG default",
        "sources": {
            "data": {"type": "raster", "url": f"cog://../{data_filename}", "tileSize": 256}
        },
        "layers": [{"id": "raster", "type": "raster", "source": "data"}],
    }


def build_collection_json(
    *,
    layer_id: str,
    title: str,
    description: str,
    license_id: str,
    provider_name: str,
    kind: str,
    data_assets: list,
    bbox: list | None,
    root_relative_path: str,
    parent_relative_path: str | None = None,
    collection_id: str | None = None,
    host: dict | None = None,
    license_url: str = "",
    style_filename: str = "default.json",
    pmtiles_layers: list | None = None,
    table_info: dict | None = None,
) -> dict:
    """`data_assets` is [{'filename', 'role', 'media_type'?}, ...] — every
    asset the layer's folder holds. A vector layer has two: its GeoParquet
    ("data") and PMTiles ("visual") files — older conversions only the
    PMTiles. A COG layer has two: the original-CRS file and its "_3857"
    rendering derivative.

    `table_info` ({'columns', 'rowCount'}) describes the GeoParquet file's
    schema, as the STAC table extension's `table:columns`. `host` is the
    `host` provider (see host_provider), alongside the uploader as
    `producer`. `license_url` is where an "other" license's terms live
    (see license_link)."""
    bbox = wgs84_bbox(bbox) or [-180.0, -90.0, 180.0, 90.0]
    # The renderable one drives the style/pmtiles link — "visual" if there
    # is one (PMTiles, or COG's "_3857" file), else the only asset there is.
    visual = next((a for a in data_assets if a["role"] == "visual"), data_assets[0])
    has_geoparquet = any(
        _asset_media_type(asset, kind) == PARQUET_MEDIA_TYPE for asset in data_assets
    )

    assets = {}
    for asset in data_assets:
        media_type = _asset_media_type(asset, kind)
        # Portolan registers a vector layer's PMTiles through the
        # `rel: pmtiles` link rather than as an asset, the GeoParquet being
        # the data — unless there is no GeoParquet (an older conversion),
        # in which case the PMTiles is the only data there is.
        if media_type == PMTILES_MEDIA_TYPE and has_geoparquet:
            continue
        assets[asset["role"]] = {
            "href": _asset_href(asset["filename"]),
            "type": media_type,
            "title": {
                PARQUET_MEDIA_TYPE: f"{title} (GeoParquet)",
                THUMBNAIL_MEDIA_TYPE: f"{title} thumbnail",
                GEOPACKAGE_MEDIA_TYPE: f"Original GeoPackage ({posixpath.basename(asset['filename'])})",
            }.get(media_type, title),
            "roles": [asset["role"]],
            **_file_fields(asset),
        }
    assets["style-default"] = {
        "href": f"./styles/{style_filename}",
        "type": "application/vnd.mapbox.style+json",
        "title": f"{title} default style",
        "roles": ["style", "default"],
    }

    links: list[dict[str, Any]] = [
        {"rel": "root", "href": root_relative_path, "type": "application/json"},
        {
            "rel": "parent",
            "href": parent_relative_path or root_relative_path,
            "type": "application/json",
        },
        {
            "rel": "agents",
            "href": "./AGENTS.md",
            "type": "text/markdown",
            "title": "Guidance for AI agents",
        },
        {
            "rel": "describedby",
            "href": "./README.md",
            "type": "text/markdown",
            "title": "Human-readable documentation",
        },
    ]
    link = license_link(license_id, license_url)
    if link:
        links.append(link)
    if kind == "pmtiles":
        links.append(
            {
                "rel": "pmtiles",
                "href": f"./{visual['filename']}",
                "type": "application/vnd.pmtiles",
                "title": "Web map tiles",
                "pmtiles:layers": pmtiles_layers or [layer_id],
                **_file_fields(visual),
            }
        )

    collection: dict[str, Any] = {
        "type": "Collection",
        "stac_version": "1.1.0",
        # Web Map Links only when there's a link it covers (a raster has none).
        "stac_extensions": [
            PORTOLAN_SCHEMA,
            *([WEB_MAP_LINKS_SCHEMA] if kind == "pmtiles" else []),
        ],
        "id": collection_id or layer_id,
        "title": title,
        "description": description,
        "license": license_id,
        "providers": [
            {"name": provider_name, "roles": ["producer"]},
            *([host] if host else []),
        ],
        "extent": {
            "spatial": {"bbox": [bbox]},
            "temporal": {"interval": [[_now_iso(), None]]},
        },
        "assets": assets,
        "links": links,
        "updated": _now_iso(),
    }
    if any("file:checksum" in obj for obj in [*assets.values(), *links]):
        collection["stac_extensions"].append(FILE_SCHEMA)
    if table_info and table_info.get("columns"):
        collection["stac_extensions"].append(TABLE_SCHEMA)
        collection["table:columns"] = table_info["columns"]
        if table_info.get("rowCount") is not None:
            collection["table:row_count"] = table_info["rowCount"]
    return collection


def build_readme(
    *,
    title: str,
    license_id: str,
    source_name: str,
    kind: str,
    layer_names: list | None = None,
    bbox: list | None = None,
    table_info: dict | None = None,
    license_url: str = "",
    thumbnail: bool = False,
    source_href: str = "",
) -> str:
    lines = [f"# {title}", ""]
    if thumbnail:
        lines += [f"![{title}](./{THUMBNAIL_FILENAME})", ""]
    lines += [f"Uploaded via CloudBench on {_now_iso()[:10]}.", ""]
    if license_id != "other":
        lines.append(f"**License:** {license_id}")
    elif license_url:
        lines.append(f"**License:** {license_url}")
    else:
        lines.append(
            f"**License:** not specified (see [{UNSPECIFIED_LICENSE_FILE}]"
            f"(./{UNSPECIFIED_LICENSE_FILE}))"
        )
    lines.append(
        f"**Source file:** [{source_name}]({source_href})"
        if source_href
        else f"**Source file:** {source_name}"
    )
    lines.append("")
    lines.append("## Contents")
    if kind == "pmtiles":
        if table_info:
            lines.append("- Data: GeoParquet (full attributes and geometry, source CRS)")
            if table_info.get("rowCount") is not None:
                lines.append(f"- Features: {table_info['rowCount']}")
        lines.append("- Web map: PMTiles (vector tiles)")
        if layer_names:
            lines.append(f"- Layer(s): {', '.join(layer_names)}")
    else:
        lines.append("- Format: Cloud Optimized GeoTIFF (raster)")
    if bbox:
        lines.append(f"- Bounding box (WGS84): [{', '.join(f'{v:.6f}' for v in bbox)}]")
    lines.append("")
    return "\n".join(lines)


def build_agents_md(*, title: str, layer_id: str, kind: str, data_assets: list) -> str:
    file_lines = "\n".join(
        (
            f"- Thumbnail: `./{asset['filename']}` (PNG preview of the default style)"
            if asset["role"] == "thumbnail"
            else (
                f"- Source: `{_asset_href(asset['filename'])}` (the original upload this "
                "layer was converted from; not cloud-native - query the data file instead)"
                if asset["role"] == "source"
                else f"- Data file: `./{asset['filename']}` "
                f"({_asset_media_type(asset, kind)}, {asset['role']})"
            )
        )
        for asset in data_assets
    )
    geoparquet = next(
        (a for a in data_assets if _asset_media_type(a, kind) == PARQUET_MEDIA_TYPE), None
    )
    query_hint = (
        f"- Query the data (not the tiles) from `./{geoparquet['filename']}`, e.g. with "
        f"DuckDB: `SELECT * FROM read_parquet('{geoparquet['filename']}') LIMIT 10`; "
        "the PMTiles file is a display-only derivative.\n"
        if geoparquet
        else ""
    )
    return (
        f"# Agent notes for {title}\n\n"
        f"{file_lines}\n"
        f"{query_hint}"
        "- Default style: `./styles/default.json` (MapLibre GL style v8)\n"
        "- This collection was generated automatically by CloudBench on upload; "
        "no manual curation has been applied.\n"
        f"- Collection id: `{layer_id}`\n"
    )


def _load_json(s3_client, key: str) -> dict | None:
    try:
        return cast(dict, json.loads(s3_client.get_object(key)))
    except Exception:
        return None


ROOT_README_KEY = "README.md"
ROOT_AGENTS_KEY = "AGENTS.md"
# The root catalog's links to its own docs, like each collection's.
_ROOT_DOC_LINKS = [
    {
        "rel": "describedby",
        "href": f"./{ROOT_README_KEY}",
        "type": "text/markdown",
        "title": "Human-readable documentation",
    },
    {
        "rel": "agents",
        "href": f"./{ROOT_AGENTS_KEY}",
        "type": "text/markdown",
        "title": "Guidance for AI agents",
    },
]


def _catalog_key(folder: str) -> str:
    """The catalog.json key for a catalog folder ("" is the bucket root)."""
    return f"{folder}/{CATALOG_KEY}" if folder else CATALOG_KEY


def _catalog_children(catalog: dict) -> list:
    """[(title, folder, is_catalog), ...] for each child the catalog links to.

    `folder` is relative to the catalog; `is_catalog` marks a sub-catalog
    (a GeoPackage's group of layers) rather than a layer collection.
    """
    children = []
    for link in catalog.get("links", []):
        if link.get("rel") != "child":
            continue
        href = str(link.get("href", "")).removeprefix("./")
        is_catalog = href.endswith(f"/{CATALOG_KEY}")
        folder = href.removesuffix(f"/{CATALOG_KEY}").removesuffix("/collection.json")
        children.append((link.get("title") or folder, folder, is_catalog))
    return children


def build_catalog_readme(catalog: dict, *, is_root: bool = True) -> str:
    """A catalog's README.md: a table of the layers (and layer groups) it holds."""
    children = _catalog_children(catalog)
    lines = [f"# {catalog.get('title') or 'Catalog'}", ""]
    if catalog.get("description"):
        lines += [catalog["description"], ""]
    if is_root:
        lines += [
            "This bucket is a [Portolan](https://github.com/portolan-sdi/portolan-spec) "
            "catalog: `catalog.json` is its STAC root, and each layer below lives in its "
            "own folder with the data, a `collection.json`, a default map style and its "
            "own README. A layer group (e.g. a GeoPackage's layers) is a sub-catalog "
            "folder holding its layers.",
            "",
        ]
    else:
        lines += [
            "A sub-catalog of this bucket's [catalog](../catalog.json): each layer below "
            "lives in its own folder with the data, a `collection.json`, a default map "
            "style and its own README.",
            "",
        ]
    lines += ["## Layers", ""]
    if not children:
        lines.append("No layers are published yet.")
    else:
        lines += ["| Layer | Folder | Metadata |", "| --- | --- | --- |"]
        for title, folder, is_catalog in children:
            label = f"[{title}](./{folder}/README.md)" + (" (layer group)" if is_catalog else "")
            metadata = CATALOG_KEY if is_catalog else "collection.json"
            lines.append(f"| {label} | `{folder}/` | [{metadata}](./{folder}/{metadata}) |")
    lines += ["", f"Last updated {_now_iso()} by CloudBench.", ""]
    return "\n".join(lines)


def build_catalog_agents_md(catalog: dict, *, is_root: bool = True) -> str:
    """A catalog's AGENTS.md: a map of where each layer's files are."""
    layer_lines = (
        "\n".join(
            (
                f"- `{title}`: sub-catalog `./{folder}/{CATALOG_KEY}` (its layers are listed there)"
                if is_catalog
                else f"- `{title}`: `./{folder}/collection.json` (notes: `./{folder}/AGENTS.md`)"
            )
            for title, folder, is_catalog in _catalog_children(catalog)
        )
        or "- (none published yet)"
    )
    where = (
        "- Root: `./catalog.json` (STAC Catalog, Portolan)."
        if is_root
        else "- This is a sub-catalog (`./catalog.json`) of the bucket's root catalog "
        "(its `root`/`parent` links)."
    )
    return (
        f"# Agent notes for {catalog.get('title') or 'this catalog'}\n\n"
        f"{where} Follow `child` links to each layer's `collection.json` - a child "
        "`catalog.json` is a sub-catalog (a layer group) to follow in turn; don't list "
        "the bucket to discover layers.\n"
        "- In a collection, the `data` asset is the file to query (GeoParquet for "
        "vector layers, a COG for rasters); `rel: pmtiles` links and `visual` assets "
        "are display-only renderings; `styles/default.json` is a MapLibre style.\n"
        "- Each layer folder has its own `AGENTS.md` with file-level details.\n"
        "- This file is regenerated by CloudBench whenever a layer is published or "
        "deleted; don't edit it by hand.\n\n"
        f"## Layers\n\n{layer_lines}\n"
    )


def build_root_readme(catalog: dict) -> str:
    """The bucket root's README.md (see build_catalog_readme)."""
    return build_catalog_readme(catalog, is_root=True)


def build_root_agents_md(catalog: dict) -> str:
    """The bucket root's AGENTS.md (see build_catalog_agents_md)."""
    return build_catalog_agents_md(catalog, is_root=True)


def _write_catalog(s3_client, catalog: dict, folder: str = "") -> None:
    """Write a catalog.json and regenerate its README.md/AGENTS.md from it.

    Portolan requires every catalog and sub-catalog to have both docs, so
    they're rebuilt from the child links on every change rather than
    maintained by hand. `folder` is "" for the bucket root.
    """
    links = catalog.setdefault("links", [])
    for doc_link in _ROOT_DOC_LINKS:
        if not any(link.get("href") == doc_link["href"] for link in links):
            links.append(dict(doc_link))
    catalog["updated"] = _now_iso_ms()
    prefix = f"{folder}/" if folder else ""
    is_root = not folder
    for key, body, content_type in (
        (_catalog_key(folder), json.dumps(catalog, indent=2), "application/json"),
        (
            f"{prefix}{ROOT_README_KEY}",
            build_catalog_readme(catalog, is_root=is_root),
            "text/markdown",
        ),
        (
            f"{prefix}{ROOT_AGENTS_KEY}",
            build_catalog_agents_md(catalog, is_root=is_root),
            "text/markdown",
        ),
    ):
        s3_client.put_object(key=key, body=body.encode("utf-8"), content_type=content_type)


def _write_root_catalog(s3_client, catalog: dict) -> None:
    _write_catalog(s3_client, catalog, "")


def _new_catalog(folder: str, title: str, description: str) -> dict:
    """A fresh catalog.json: the bucket root ("" folder), or a sub-catalog.

    Sub-catalogs (a GeoPackage's layer group) always sit directly under the
    root catalog, so their `root` and `parent` are both the root.
    """
    if not folder:
        return {
            "type": "Catalog",
            "stac_version": "1.1.0",
            "stac_extensions": [PORTOLAN_SCHEMA],
            "id": "catalog",
            "title": "CloudBench Catalog",
            "description": "Layers uploaded via CloudBench.",
            "links": [{"rel": "root", "href": "./catalog.json", "type": "application/json"}],
        }
    root_href = "../" * (folder.count("/") + 1) + CATALOG_KEY
    return {
        "type": "Catalog",
        "stac_version": "1.1.0",
        "stac_extensions": [PORTOLAN_SCHEMA],
        "id": folder,
        "title": title,
        "description": description,
        "links": [
            {"rel": "root", "href": root_href, "type": "application/json"},
            {"rel": "parent", "href": root_href, "type": "application/json"},
        ],
    }


def _add_child(
    s3_client, catalog_folder: str, child_href: str, title: str, *, new_catalog: dict
) -> None:
    """Link a child from a catalog (created from `new_catalog` if missing)."""
    catalog = _load_json(s3_client, _catalog_key(catalog_folder)) or new_catalog
    links = catalog.setdefault("links", [])
    if not any(link.get("href") == child_href for link in links):
        links.append(
            {"rel": "child", "href": child_href, "type": "application/json", "title": title}
        )
    _write_catalog(s3_client, catalog, catalog_folder)


def touch_root_catalog(s3_client) -> None:
    """Rewrite catalog.json (and its docs) with a new `updated` time.

    For changes to a layer's collection.json made outside a publish - so
    anything keyed on catalog.json's ETag (the STAC API's cache) notices.
    Best-effort: a failure is only logged.
    """
    try:
        catalog = _load_json(s3_client, CATALOG_KEY)
        if catalog:
            _write_root_catalog(s3_client, catalog)
    except Exception:
        logger.exception("Failed to touch root catalog.json")


def ensure_root_catalog(s3_client, *, folder: str, title: str) -> None:
    """Create (or extend) the bucket-root catalog.json with a child link.

    Also regenerates the root README.md/AGENTS.md (see _write_catalog).

    `folder` is the collection's key prefix relative to the bucket root
    (may be nested, e.g. "imports/roads"). Best-effort: a failure here
    shouldn't undo a conversion that already succeeded and already
    landed in S3.
    """
    try:
        _add_child(
            s3_client,
            "",
            f"./{folder}/collection.json",
            title,
            new_catalog=_new_catalog("", "", ""),
        )
    except Exception:
        logger.exception("Failed to update root catalog.json (layer was still uploaded)")


def ensure_sub_catalog(
    s3_client,
    *,
    catalog_folder: str,
    catalog_title: str,
    catalog_description: str,
    folder: str,
    title: str,
) -> None:
    """Link a layer from its sub-catalog, and the sub-catalog from the root.

    For a GeoPackage's layers: `catalog_folder` ("castelo-branco") holds a
    catalog.json listing each layer folder inside it (`folder`,
    "castelo-branco/highway"), and the root catalog links that catalog.json.
    The root is rewritten even when it already links the sub-catalog, so
    anything keyed on its ETag (the STAC API's cache) notices the new layer.
    Best-effort, like ensure_root_catalog.
    """
    try:
        relative = folder.removeprefix(f"{catalog_folder}/")
        _add_child(
            s3_client,
            catalog_folder,
            f"./{relative}/collection.json",
            title,
            new_catalog=_new_catalog(catalog_folder, catalog_title, catalog_description),
        )
        _add_child(
            s3_client,
            "",
            f"./{catalog_folder}/{CATALOG_KEY}",
            catalog_title,
            new_catalog=_new_catalog("", "", ""),
        )
    except Exception:
        logger.exception("Failed to update %s's catalog.json (layer was still uploaded)", folder)


def _prune_catalog(
    s3_client, catalog_folder: str, deleted_key: str, depth: int = 0
) -> tuple[bool, bool]:
    """Drop a catalog's child links to deleted data, recursing into sub-catalogs.

    Returns (changed here - and so rewritten, changed in a sub-catalog).
    """
    catalog = _load_json(s3_client, _catalog_key(catalog_folder))
    if not catalog:
        return False, False
    prefix = f"{catalog_folder}/" if catalog_folder else ""

    def is_deleted(path: str) -> bool:
        return path.startswith(deleted_key) if deleted_key.endswith("/") else path == deleted_key

    kept = []
    removed = nested = False
    for link in catalog.get("links", []):
        if link.get("rel") != "child":
            kept.append(link)
            continue
        path = prefix + str(link.get("href", "")).removeprefix("./")
        if is_deleted(path):
            removed = True
            continue
        kept.append(link)
        sub_folder = path.removesuffix(f"/{CATALOG_KEY}")
        if (
            path.endswith(f"/{CATALOG_KEY}")
            and deleted_key.startswith(f"{sub_folder}/")
            and depth < 4
        ):
            nested = any(_prune_catalog(s3_client, sub_folder, deleted_key, depth + 1)) or nested
    if removed:
        catalog["links"] = kept
        _write_catalog(s3_client, catalog, catalog_folder)
    return removed, nested


def prune_root_catalog(s3_client, deleted_key: str) -> None:
    """Drop catalog child links pointing at deleted data.

    `deleted_key` is either a folder prefix (ending in "/"), which removes
    every child under it (a whole GeoPackage's sub-catalog included), or a
    single object key, which removes the link only if that object was a
    child's collection.json/catalog.json. Sub-catalogs are pruned too (one
    GeoPackage layer deleted from its group); when only a sub-catalog
    changed, the root is rewritten anyway so its ETag changes. Regenerates
    each changed catalog's README.md/AGENTS.md. Best-effort: the delete
    itself already happened, so a failure here is only logged.
    """
    try:
        root_changed, nested_changed = _prune_catalog(s3_client, "", deleted_key)
        if nested_changed and not root_changed:
            touch_root_catalog(s3_client)  # only a sub-catalog changed
    except Exception:
        logger.exception("Failed to prune catalog.json after deleting %s", deleted_key)


def catalog_collections(s3_client) -> list[dict[str, str]] | None:
    """[{'folder', 'title', 'catalog', 'catalog_title'}, ...] for every layer collection.

    Follows child links from the root catalog.json into sub-catalogs (a
    GeoPackage's layer group). `folder` is relative to the bucket root;
    `catalog` is the folder of the catalog linking it - "" for the root, or
    its sub-catalog's - and `catalog_title` that catalog's title. None if
    the bucket has no (readable) root catalog.json.
    """
    root = _load_json(s3_client, CATALOG_KEY)
    if root is None:
        return None
    found: list[dict[str, str]] = []
    seen = {""}

    def walk(catalog: dict, catalog_folder: str, depth: int) -> None:
        prefix = f"{catalog_folder}/" if catalog_folder else ""
        catalog_title = catalog.get("title") or catalog_folder
        for link in catalog.get("links", []):
            if link.get("rel") != "child":
                continue
            path = posixpath.normpath(prefix + str(link.get("href", "")).removeprefix("./"))
            if path.endswith("/collection.json"):
                folder = path.removesuffix("/collection.json")
                found.append(
                    {
                        "folder": folder,
                        "title": link.get("title") or folder,
                        "catalog": catalog_folder,
                        "catalog_title": catalog_title if catalog_folder else "",
                    }
                )
            elif path.endswith(f"/{CATALOG_KEY}") and depth < 4:
                sub_folder = path.removesuffix(f"/{CATALOG_KEY}")
                sub_catalog = _load_json(s3_client, path) if sub_folder not in seen else None
                seen.add(sub_folder)
                if sub_catalog:
                    walk(sub_catalog, sub_folder, depth + 1)

    walk(root, "", 0)
    return found


def finalize_layer(
    s3_client,
    *,
    folder: str,
    layer_id: str,
    title: str,
    kind: str,
    data_assets: list,
    license_id: str,
    provider_name: str,
    source_name: str,
    info: dict | None,
    table_info: dict | None = None,
    host_name: str = "",
    host_email: str = "",
    license_url: str = "",
    catalog_folder: str = "",
    catalog_title: str = "",
    catalog_description: str = "",
) -> None:
    """Upload collection.json, README.md, AGENTS.md and a default style for one layer.

    `catalog_folder`, if given, is the sub-catalog the layer belongs to (a
    GeoPackage's layer group, holding `folder`): the layer is linked from
    that catalog.json - created with `catalog_title`/`catalog_description`
    if need be - which is linked from the root; otherwise the layer is
    linked from the root catalog directly.

    `data_assets` is [{'filename', 'role', 'media_type'?}, ...] for every
    asset the layer's data file(s) already uploaded under `folder`.
    `info` is the PMTiles/COG's (WGS84 bbox, vector layer names);
    `table_info` the GeoParquet's schema, if the layer has one.
    `host_name`/`host_email` customise the `host` provider, whose url is
    the bucket's (see host_provider). `license_url` is where an "other"
    license's terms live; without one, a LICENSE.md saying the terms
    aren't specified is written instead (see license_link). Best-effort: a
    failure here shouldn't undo the conversion that already succeeded and
    already landed in S3.
    """
    info = info or {}
    license_id = normalize_license(license_id)
    license_url = license_url if license_id == "other" else ""
    bbox = wgs84_bbox(info.get("bbox"))
    layer_names = info.get("layers") or [layer_id]
    visual = next((a for a in data_assets if a["role"] == "visual"), data_assets[0])
    # "folder/sub/folder" -> "../../catalog.json": one "../" per path segment
    # plus the collection's own folder, back up to the bucket root.
    root_relative_path = "../" * (folder.count("/") + 1) + "catalog.json"
    parent_relative_path = "../catalog.json" if catalog_folder else root_relative_path

    try:
        style = (
            default_style_for_pmtiles(layer_names[0], visual["filename"])
            if kind == "pmtiles"
            else default_style_for_cog(visual["filename"])
        )
        collection = build_collection_json(
            layer_id=layer_id,
            title=title,
            description=f"{title}, uploaded via CloudBench.",
            license_id=license_id,
            provider_name=provider_name,
            kind=kind,
            data_assets=data_assets,
            bbox=bbox,
            root_relative_path=root_relative_path,
            parent_relative_path=parent_relative_path,
            collection_id=folder,
            host=host_provider(s3_client.bucket_url, name=host_name, email=host_email),
            pmtiles_layers=layer_names if kind == "pmtiles" else None,
            table_info=table_info,
            license_url=license_url,
        )
        readme = build_readme(
            title=title,
            license_id=license_id,
            source_name=source_name,
            kind=kind,
            layer_names=layer_names if kind == "pmtiles" else None,
            bbox=bbox,
            table_info=table_info,
            license_url=license_url,
            thumbnail=any(asset["role"] == "thumbnail" for asset in data_assets),
            source_href=next(
                (_asset_href(a["filename"]) for a in data_assets if a["role"] == "source"), ""
            ),
        )
        agents = build_agents_md(title=title, layer_id=layer_id, kind=kind, data_assets=data_assets)

        files = [
            ("collection.json", json.dumps(collection, indent=2), "application/json"),
            ("README.md", readme, "text/markdown"),
            ("AGENTS.md", agents, "text/markdown"),
            (
                "styles/default.json",
                json.dumps(style, indent=2),
                "application/vnd.mapbox.style+json",
            ),
        ]
        needs_license_file = license_id == "other" and not license_url
        if needs_license_file:
            files.append(
                (UNSPECIFIED_LICENSE_FILE, build_unspecified_license_md(title), "text/markdown")
            )
        for suffix, body, content_type in files:
            s3_client.put_object(
                key=f"{folder}/{suffix}",
                body=body.encode("utf-8"),
                content_type=content_type,
            )

        if catalog_folder:
            ensure_sub_catalog(
                s3_client,
                catalog_folder=catalog_folder,
                catalog_title=catalog_title or catalog_folder,
                catalog_description=catalog_description or catalog_title or catalog_folder,
                folder=folder,
                title=title,
            )
        else:
            ensure_root_catalog(s3_client, folder=folder, title=title)
        if not needs_license_file:
            # A re-publish into a folder that used to need one: don't leave a
            # stale "not specified" notice next to a now-known license.
            with contextlib.suppress(Exception):
                s3_client.delete_object(f"{folder}/{UNSPECIFIED_LICENSE_FILE}")
    except Exception:
        logger.exception(
            "Failed to finalize Portolan layer %r (data file was still uploaded)", layer_id
        )
