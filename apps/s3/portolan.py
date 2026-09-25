"""Generates a Portolan-shaped catalog for every uploaded layer.

See https://github.com/portolan-sdi/portolan-spec. Each converted layer
becomes a Portolan "single-file collection": its own folder holding
collection.json, README.md, AGENTS.md, a default MapLibre style, and the
data file(s) themselves. This is a deliberately trimmed subset of the
full spec — no checksums, thumbnails, or multi-language support yet.
"""

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any, cast

logger = logging.getLogger(__name__)

PORTOLAN_SCHEMA = "https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json"
WEB_MAP_LINKS_SCHEMA = "https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json"
TABLE_SCHEMA = "https://stac-extensions.github.io/table/v1.2.0/schema.json"
CATALOG_KEY = "catalog.json"

# SPDX ids offered in the upload dialog; "other" is the safe default when
# the uploader doesn't know (or the source data doesn't specify) a license.
LICENSE_CHOICES = [
    {"id": "other", "label": "Not specified"},
    {"id": "CC0-1.0", "label": "CC0 1.0 (Public Domain)"},
    {"id": "CC-BY-4.0", "label": "CC BY 4.0"},
    {"id": "CC-BY-SA-4.0", "label": "CC BY-SA 4.0"},
    {"id": "ODbL-1.0", "label": "ODbL 1.0"},
    {"id": "proprietary", "label": "Proprietary / All rights reserved"},
]
DEFAULT_LICENSE = "other"

PMTILES_MEDIA_TYPE = "application/vnd.pmtiles"
PARQUET_MEDIA_TYPE = "application/vnd.apache.parquet"

_MEDIA_TYPES = {
    "pmtiles": PMTILES_MEDIA_TYPE,
    "cog": "image/tiff; application=geotiff; profile=cloud-optimized",
}


def _asset_media_type(asset: dict, kind: str) -> str:
    """An asset's own media type (e.g. GeoParquet), else its layer kind's default."""
    return asset.get("media_type") or _MEDIA_TYPES[kind]


def sanitize_layer_id(name: str) -> str:
    """Lowercase, hyphenated id — Portolan collection ids must start with a letter."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    if not slug or not slug[0].isalpha():
        slug = f"layer-{slug}" if slug else "layer"
    return slug


def prettify(name: str) -> str:
    """Turn a filename stem/table name into a human-readable title."""
    words = [word for word in re.split(r"[-_\s]+", name or "") if word]
    if not words:
        return name or "Untitled layer"
    return " ".join(
        word if not word.islower() and not word.isupper() else word.capitalize() for word in words
    )


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


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
    schema, as the STAC table extension's `table:columns`."""
    bbox = list(bbox) if bbox else [-180.0, -90.0, 180.0, 90.0]
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
            "href": f"./{asset['filename']}",
            "type": media_type,
            "title": f"{title} (GeoParquet)" if media_type == PARQUET_MEDIA_TYPE else title,
            "roles": [asset["role"]],
        }
    assets["style-default"] = {
        "href": f"./styles/{style_filename}",
        "type": "application/vnd.mapbox.style+json",
        "title": f"{title} default style",
        "roles": ["style", "default"],
    }

    links: list[dict[str, Any]] = [
        {"rel": "root", "href": root_relative_path, "type": "application/json"},
        {"rel": "parent", "href": root_relative_path, "type": "application/json"},
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
    if kind == "pmtiles":
        links.append(
            {
                "rel": "pmtiles",
                "href": f"./{visual['filename']}",
                "type": "application/vnd.pmtiles",
                "title": "Web map tiles",
                "pmtiles:layers": pmtiles_layers or [layer_id],
            }
        )

    collection: dict[str, Any] = {
        "type": "Collection",
        "stac_version": "1.1.0",
        "stac_extensions": [PORTOLAN_SCHEMA, WEB_MAP_LINKS_SCHEMA],
        "id": layer_id,
        "title": title,
        "description": description,
        "license": license_id,
        "providers": [{"name": provider_name, "roles": ["producer"]}],
        "extent": {
            "spatial": {"bbox": [bbox]},
            "temporal": {"interval": [[_now_iso(), None]]},
        },
        "assets": assets,
        "links": links,
        "updated": _now_iso(),
    }
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
) -> str:
    lines = [f"# {title}", "", f"Uploaded via CloudBench on {_now_iso()[:10]}.", ""]
    lines.append(f"**License:** {license_id}")
    lines.append(f"**Source file:** {source_name}")
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
        f"- Data file: `./{asset['filename']}` ({_asset_media_type(asset, kind)}, {asset['role']})"
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


def ensure_root_catalog(s3_client, *, folder: str, title: str) -> None:
    """Create (or extend) the bucket-root catalog.json with a child link.

    `folder` is the collection's key prefix relative to the bucket root
    (may be nested, e.g. "imports/roads"). Best-effort: a failure here
    shouldn't undo a conversion that already succeeded and already
    landed in S3.
    """
    try:
        catalog = _load_json(s3_client, CATALOG_KEY)
        if not catalog:
            catalog = {
                "type": "Catalog",
                "stac_version": "1.1.0",
                "stac_extensions": [PORTOLAN_SCHEMA],
                "id": "catalog",
                "title": "CloudBench Catalog",
                "description": "Layers uploaded via CloudBench.",
                "links": [{"rel": "root", "href": "./catalog.json", "type": "application/json"}],
            }

        child_href = f"./{folder}/collection.json"
        links = catalog.setdefault("links", [])
        if not any(link.get("href") == child_href for link in links):
            links.append(
                {"rel": "child", "href": child_href, "type": "application/json", "title": title}
            )
        catalog["updated"] = _now_iso()

        s3_client.put_object(
            key=CATALOG_KEY,
            body=json.dumps(catalog, indent=2).encode("utf-8"),
            content_type="application/json",
        )
    except Exception:
        logger.exception("Failed to update root catalog.json (layer was still uploaded)")


def prune_root_catalog(s3_client, deleted_key: str) -> None:
    """Drop bucket-root catalog.json child links pointing at deleted data.

    `deleted_key` is either a folder prefix (ending in "/"), which removes
    every child collection under it, or a single object key, which removes
    the link only if that object was a child's collection.json. Best-effort:
    the delete itself already happened, so a failure here is only logged.
    """
    try:
        catalog = _load_json(s3_client, CATALOG_KEY)
        if not catalog:
            return

        def is_deleted(link: dict) -> bool:
            if link.get("rel") != "child":
                return False
            path = str(link.get("href", "")).removeprefix("./")
            return (
                path.startswith(deleted_key) if deleted_key.endswith("/") else path == deleted_key
            )

        links = catalog.get("links", [])
        kept = [link for link in links if not is_deleted(link)]
        if len(kept) == len(links):
            return

        catalog["links"] = kept
        catalog["updated"] = _now_iso()
        s3_client.put_object(
            key=CATALOG_KEY,
            body=json.dumps(catalog, indent=2).encode("utf-8"),
            content_type="application/json",
        )
    except Exception:
        logger.exception("Failed to prune root catalog.json after deleting %s", deleted_key)


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
) -> None:
    """Upload collection.json, README.md, AGENTS.md and a default style for one layer.

    `data_assets` is [{'filename', 'role', 'media_type'?}, ...] for every
    asset the layer's data file(s) already uploaded under `folder`.
    `info` is the PMTiles/COG's (WGS84 bbox, vector layer names);
    `table_info` the GeoParquet's schema, if the layer has one. Best-effort: a
    failure here shouldn't undo the conversion that already succeeded and
    already landed in S3.
    """
    info = info or {}
    bbox = info.get("bbox")
    layer_names = info.get("layers") or [layer_id]
    visual = next((a for a in data_assets if a["role"] == "visual"), data_assets[0])
    # "folder/sub/folder" -> "../../catalog.json": one "../" per path segment
    # plus the collection's own folder, back up to the bucket root.
    root_relative_path = "../" * (folder.count("/") + 1) + "catalog.json"

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
            pmtiles_layers=layer_names if kind == "pmtiles" else None,
            table_info=table_info,
        )
        readme = build_readme(
            title=title,
            license_id=license_id,
            source_name=source_name,
            kind=kind,
            layer_names=layer_names if kind == "pmtiles" else None,
            bbox=bbox,
            table_info=table_info,
        )
        agents = build_agents_md(title=title, layer_id=layer_id, kind=kind, data_assets=data_assets)

        for suffix, body, content_type in (
            ("collection.json", json.dumps(collection, indent=2), "application/json"),
            ("README.md", readme, "text/markdown"),
            ("AGENTS.md", agents, "text/markdown"),
            (
                "styles/default.json",
                json.dumps(style, indent=2),
                "application/vnd.mapbox.style+json",
            ),
        ):
            s3_client.put_object(
                key=f"{folder}/{suffix}",
                body=body.encode("utf-8"),
                content_type=content_type,
            )

        ensure_root_catalog(s3_client, folder=folder, title=title)
    except Exception:
        logger.exception(
            "Failed to finalize Portolan layer %r (data file was still uploaded)", layer_id
        )
