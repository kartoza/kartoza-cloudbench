"""Portolan metadata for a TIFF mosaic: one collection, one STAC item per tile.

Portolan (core.md, Raster Collections) requires a collection holding several
rasters to model each as an item carrying its COG as an item-level asset,
never as collection-level assets. The collection itself carries what
describes or renders the whole: the merged EPSG:3857 COG (a `visual`
derivative, which the "scene COGs belong on items" rule leaves alone since
it isn't `data`), the thumbnail, the default style, and a GDAL VRT of every
tile - not a Portolan format, so an alternate asset (role `metadata`)
beside the cloud-native tiles, never the primary data.

    <folder>/
      collection.json  README.md  AGENTS.md
      <id>_3857.tif    visual: merged web mosaic (small enough mosaics)
      <id>.vrt         metadata: every tile, paths relative to the VRT
      thumbnail.png    styles/default.json
      <tile>/<tile>.json   STAC item (footprint, datetime)
      <tile>/<tile>.tif    item-level data asset (COG, original CRS)
      <tile>/<tile>_3857.tif  visual, only when there's no merged mosaic
      items.parquet    collection-mirror: every item as a STAC-GeoParquet row
"""

import json
import struct
from datetime import datetime
from pathlib import Path
from typing import Any

import duckdb

from . import portolan

VRT_MEDIA_TYPE = "application/xml"
MIRROR_FILENAME = "items.parquet"
MIRROR_ROLE = "collection-mirror"
STAC_GEOPARQUET_VERSION = "1.1.0"
ITEM_MEDIA_TYPE = "application/geo+json"


def _bbox_polygon(bbox: list[float]) -> dict[str, Any]:
    west, south, east, north = bbox
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


def union_bbox(bboxes: list[list[float]]) -> list[float] | None:
    bboxes = [bbox for bbox in bboxes if bbox]
    if not bboxes:
        return None
    return [
        min(bbox[0] for bbox in bboxes),
        min(bbox[1] for bbox in bboxes),
        max(bbox[2] for bbox in bboxes),
        max(bbox[3] for bbox in bboxes),
    ]


def _asset(href: str, media_type: str, role: str, title: str, file: dict | None) -> dict:
    return {
        "href": href,
        "type": media_type,
        "title": title,
        "roles": [role],
        **portolan._file_fields({"file": file}),
    }


def _root_href(depth: int) -> str:
    """The root catalog.json from `depth` folders below the bucket root."""
    return "../" * depth + portolan.CATALOG_KEY


def build_item_json(
    *,
    folder: str,
    tile: dict[str, Any],
) -> dict[str, Any]:
    """A tile's STAC item, at `<folder>/<tile id>/<tile id>.json`.

    `tile` is {'id', 'title', 'bbox' (WGS84), 'datetime', 'data': {'filename',
    'file'}, 'visual'?: {'filename', 'file'}}.
    """
    bbox = portolan.wgs84_bbox(tile["bbox"]) or [-180.0, -90.0, 180.0, 90.0]
    assets = {
        "data": _asset(
            f"./{tile['data']['filename']}",
            portolan.COG_MEDIA_TYPE,
            "data",
            tile["title"],
            tile["data"].get("file"),
        )
    }
    if tile.get("visual"):
        assets["visual"] = _asset(
            f"./{tile['visual']['filename']}",
            portolan.COG_MEDIA_TYPE,
            "visual",
            f"{tile['title']} (web map)",
            tile["visual"].get("file"),
        )
    item: dict[str, Any] = {
        "type": "Feature",
        "stac_version": "1.1.0",
        "stac_extensions": [],
        "id": tile["id"],
        "geometry": _bbox_polygon(bbox),
        "bbox": bbox,
        "properties": {"title": tile["title"], "datetime": tile["datetime"]},
        "assets": assets,
        "links": [
            # The item sits one folder below its collection's.
            {"rel": "root", "href": _root_href(folder.count("/") + 2), "type": "application/json"},
            {"rel": "parent", "href": "../collection.json", "type": "application/json"},
            {"rel": "collection", "href": "../collection.json", "type": "application/json"},
        ],
        "collection": folder,
    }
    if any("file:checksum" in asset for asset in assets.values()):
        item["stac_extensions"].append(portolan.FILE_SCHEMA)
    return item


def _polygon_wkb(polygon: dict[str, Any]) -> bytes:
    """A GeoJSON polygon as little-endian WKB, vertex for vertex."""
    rings = polygon["coordinates"]
    parts = [struct.pack("<BII", 1, 3, len(rings))]
    for ring in rings:
        parts.append(struct.pack("<I", len(ring)))
        parts.extend(struct.pack("<dd", x, y) for x, y in ring)
    return b"".join(parts)


def _hilbert_index(x: float, y: float, bounds: list[float], order: int = 16) -> int:
    """Position along a Hilbert curve over `bounds` - what sorts rows spatially."""
    side = 1 << order
    west, south, east, north = bounds
    xi = int((x - west) / ((east - west) or 1) * (side - 1))
    yi = int((y - south) / ((north - south) or 1) * (side - 1))
    index = 0
    step = side // 2
    while step:
        rx = 1 if xi & step else 0
        ry = 1 if yi & step else 0
        index += step * step * ((3 * rx) ^ ry)
        if not ry:
            if rx:
                xi, yi = step - 1 - xi, step - 1 - yi
            xi, yi = yi, xi
        step //= 2
    return index


def _rebase_href(href: str, tile_id: str) -> str:
    """An item-relative href, relative to the collection folder the mirror sits in."""
    if href.startswith("./"):
        return f"./{tile_id}/{href[2:]}"
    if href.startswith("../"):
        return f"./{href[3:]}"
    return href


def write_item_mirror(items: list[dict[str, Any]], destination: Path) -> None:
    """Write the collection's items as STAC-GeoParquet: its item mirror.

    Portolan (formats.md, Raster § Item mirror) asks a raster collection
    with scene items for `items.parquet`: one row per item reproducing its
    id, geometry, datetime and bbox, as GeoParquet 1.1 - rows spatially
    ordered, a `bbox` covering column for per-row-group statistics, row
    groups of at most 150,000 rows. Properties are top-level columns, as
    stac-geoparquet specifies; hrefs are made relative to the mirror.
    """
    bounds = union_bbox([item["bbox"] for item in items]) or [-180.0, -90.0, 180.0, 90.0]
    asset_keys = list(items[0]["assets"])
    asset_type = (
        "STRUCT(href VARCHAR, type VARCHAR, title VARCHAR, roles VARCHAR[], "
        '"file:size" BIGINT, "file:checksum" VARCHAR)'
    )
    assets_type = ", ".join(f'"{key}" {asset_type}' for key in asset_keys)
    con = duckdb.connect()
    try:
        con.execute(f"""
            CREATE TABLE items (
                sort_key UBIGINT,
                type VARCHAR,
                stac_version VARCHAR,
                stac_extensions VARCHAR[],
                id VARCHAR,
                geometry BLOB,
                bbox STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE),
                title VARCHAR,
                datetime TIMESTAMPTZ,
                links STRUCT(rel VARCHAR, href VARCHAR, type VARCHAR, title VARCHAR)[],
                assets STRUCT({assets_type}),
                collection VARCHAR
            )
            """)
        rows = []
        for item in items:
            west, south, east, north = item["bbox"]
            rows.append(
                [
                    _hilbert_index((west + east) / 2, (south + north) / 2, bounds),
                    item["type"],
                    item["stac_version"],
                    item["stac_extensions"],
                    item["id"],
                    _polygon_wkb(item["geometry"]),
                    {"xmin": west, "ymin": south, "xmax": east, "ymax": north},
                    item["properties"].get("title"),
                    datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00")),
                    [
                        {
                            "rel": link["rel"],
                            "href": _rebase_href(link["href"], item["id"]),
                            "type": link.get("type"),
                            "title": link.get("title"),
                        }
                        for link in item["links"]
                    ],
                    {
                        key: {
                            "href": _rebase_href(asset["href"], item["id"]),
                            "type": asset.get("type"),
                            "title": asset.get("title"),
                            "roles": asset.get("roles", []),
                            "file:size": asset.get("file:size"),
                            "file:checksum": asset.get("file:checksum"),
                        }
                        for key, asset in item["assets"].items()
                    },
                    item["collection"],
                ]
            )
        con.executemany(f"INSERT INTO items VALUES ({', '.join('?' * 12)})", rows)
        geo = {
            "version": "1.1.0",
            "primary_column": "geometry",
            "columns": {
                "geometry": {
                    "encoding": "WKB",
                    "geometry_types": ["Polygon"],
                    "bbox": bounds,
                    "covering": {
                        "bbox": {
                            corner: ["bbox", corner] for corner in ("xmin", "ymin", "xmax", "ymax")
                        }
                    },
                }
            },
        }
        stac_geoparquet = {"version": STAC_GEOPARQUET_VERSION}

        def literal(document: dict) -> str:
            return "'" + json.dumps(document).replace("'", "''") + "'"

        con.execute(f"""
            COPY (SELECT * EXCLUDE (sort_key) FROM items ORDER BY sort_key)
            TO '{str(destination).replace("'", "''")}' (
                FORMAT parquet,
                COMPRESSION zstd,
                ROW_GROUP_SIZE 100000,
                KV_METADATA {{geo: {literal(geo)}, "stac-geoparquet": {literal(stac_geoparquet)}}}
            )
            """)
    finally:
        con.close()


def build_collection_json(
    *,
    folder: str,
    title: str,
    license_id: str,
    license_url: str,
    provider_name: str,
    host: dict | None,
    tiles: list[dict[str, Any]],
    vrt: dict[str, Any],
    visual: dict[str, Any] | None,
    thumbnail: dict[str, Any] | None,
    mirror: dict[str, Any] | None = None,
    style_file: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The mosaic's collection.json: whole-mosaic assets, and an item link per tile.

    `vrt`, `visual` (the merged web mosaic, None when tiles render on their
    own) and `thumbnail` are {'filename', 'file'}; `style_file` is the
    style's {'size', 'checksum'} (see portolan.file_of).
    """
    datetimes = sorted(tile["datetime"] for tile in tiles)
    assets: dict[str, Any] = {}
    if visual:
        assets["visual"] = _asset(
            f"./{visual['filename']}",
            portolan.COG_MEDIA_TYPE,
            "visual",
            f"{title} (web map mosaic)",
            visual.get("file"),
        )
    if thumbnail:
        assets["thumbnail"] = _asset(
            f"./{thumbnail['filename']}",
            portolan.THUMBNAIL_MEDIA_TYPE,
            "thumbnail",
            f"{title} thumbnail",
            thumbnail.get("file"),
        )
    assets["style-default"] = {
        "href": f"./{portolan.STYLE_KEY}",
        "type": portolan.STYLE_MEDIA_TYPE,
        "title": f"{title} default style",
        "roles": ["style", "default"],
        **portolan._file_fields({"file": style_file}),
    }
    assets["mosaic-vrt"] = _asset(
        f"./{vrt['filename']}",
        VRT_MEDIA_TYPE,
        "metadata",
        f"{title} (GDAL VRT of every tile)",
        vrt.get("file"),
    )
    if mirror:
        assets["items"] = _asset(
            f"./{mirror['filename']}",
            portolan.PARQUET_MEDIA_TYPE,
            MIRROR_ROLE,
            f"{title} items (STAC-GeoParquet)",
            mirror.get("file"),
        )

    root = _root_href(folder.count("/") + 1)
    links: list[dict[str, Any]] = [
        {"rel": "root", "href": root, "type": "application/json"},
        {"rel": "parent", "href": root, "type": "application/json"},
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
    link = portolan.license_link(license_id, license_url)
    if link:
        links.append(link)
    links += [
        {
            "rel": "item",
            "href": f"./{tile['id']}/{tile['id']}.json",
            "type": ITEM_MEDIA_TYPE,
            "title": tile["title"],
        }
        for tile in tiles
    ]

    collection: dict[str, Any] = {
        "type": "Collection",
        "stac_version": "1.1.0",
        "stac_extensions": [portolan.PORTOLAN_SCHEMA],
        "id": folder,
        "title": title,
        "description": f"{title}: a mosaic of {len(tiles)} GeoTIFFs, uploaded via CloudBench.",
        "license": license_id,
        "providers": portolan.providers(host, provider_name),
        "extent": {
            "spatial": {
                "bbox": [
                    portolan.wgs84_bbox(union_bbox([tile["bbox"] for tile in tiles]))
                    or [-180.0, -90.0, 180.0, 90.0]
                ]
            },
            "temporal": {"interval": [[datetimes[0], datetimes[-1]]]},
        },
        "assets": assets,
        "links": links,
        "updated": portolan._now_iso(),
    }
    if any("file:checksum" in asset for asset in assets.values()):
        collection["stac_extensions"].append(portolan.FILE_SCHEMA)
    return collection


def build_readme(
    *,
    title: str,
    vrt_filename: str,
    visual_filename: str | None,
    tiles: list[dict[str, Any]],
    license_id: str,
    license_url: str,
    bbox: list[float] | None,
    thumbnail: bool,
    mirror_filename: str | None = None,
) -> str:
    lines = [f"# {title}", ""]
    if thumbnail:
        lines += [f"![{title}](./{portolan.THUMBNAIL_FILENAME})", ""]
    lines += [
        f"A mosaic of {len(tiles)} GeoTIFF tiles, each a Cloud Optimized GeoTIFF, "
        f"uploaded via CloudBench on {portolan._now_iso()[:10]}.",
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
    lines.append("**Source:** the uploaded GeoTIFFs listed below, converted to COG.")
    lines += ["", "## Quick start", ""]
    lines += [
        f"Open [`{vrt_filename}`](./{vrt_filename}) to use every tile as one raster. Its tile "
        "paths are relative to it, so it works straight from the bucket, e.g. in QGIS "
        "(*Layer › Add Raster Layer*, protocol HTTP(S)) or with GDAL:",
        "",
        "```",
        f"gdalinfo /vsicurl/<this folder's URL>/{vrt_filename}",
        "```",
        "",
        "Only the parts of the tiles you view are read.",
        "",
    ]
    if visual_filename:
        lines += [
            f"[`{visual_filename}`](./{visual_filename}) is the whole mosaic merged and "
            "reprojected to Web Mercator (EPSG:3857), for web maps.",
            "",
        ]
    if mirror_filename:
        lines += [
            f"[`{mirror_filename}`](./{mirror_filename}) lists every tile (id, footprint, "
            "date, files) as STAC-GeoParquet, so the tiles covering an area take one query "
            "instead of a request per tile, e.g. with DuckDB:",
            "",
            "```sql",
            f"SELECT id, assets.data.href FROM '<this folder's URL>/{mirror_filename}'",
            "WHERE bbox.xmin < 30 AND bbox.xmax > 29 AND bbox.ymin < -25 AND bbox.ymax > -26;",
            "```",
            "",
        ]
    lines += ["## Tiles", "", "| Tile | Date | Bounding box (WGS84) |", "|---|---|---|"]
    for tile in tiles:
        tile_bbox = ", ".join(f"{v:.4f}" for v in tile["bbox"]) if tile["bbox"] else ""
        lines.append(
            f"| [{tile['title']}](./{tile['id']}/{tile['id']}.json) "
            f"| {tile['datetime'][:10]} | {tile_bbox} |"
        )
    if bbox:
        lines += ["", f"Mosaic extent (WGS84): [{', '.join(f'{v:.6f}' for v in bbox)}]"]
    lines.append("")
    return "\n".join(lines)


def build_agents_md(
    *,
    title: str,
    vrt_filename: str,
    visual_filename: str | None,
    tile_count: int,
    mirror_filename: str | None = None,
) -> str:
    visual = (
        f"- `./{visual_filename}`: the whole mosaic merged into one EPSG:3857 COG. "
        "A display rendering: use the tiles for analysis.\n"
        if visual_filename
        else ""
    )
    return (
        f"# {title}: guidance for AI agents\n\n"
        f"A STAC collection of {tile_count} raster tiles. Each tile is a STAC item in "
        "its own folder (`<tile>/<tile>.json`) with its Cloud Optimized GeoTIFF as the "
        "item's `data` asset, in the source CRS.\n\n"
        "## Files\n\n"
        f"- `./{vrt_filename}`: a GDAL VRT listing every tile, with paths relative to it. "
        "Open it to read the tiles as one raster; GDAL fetches only what a read needs. "
        "It is an alternate: the tiles are the data.\n"
        f"{visual}"
        + (
            f"- `./{mirror_filename}`: every item as a STAC-GeoParquet row (GeoParquet 1.1, "
            "`bbox` covering column); hrefs are relative to this folder.\n"
            if mirror_filename
            else ""
        )
        + "- `./collection.json`: the collection, with an `item` link per tile.\n"
        "- `./styles/default.json`: a MapLibre style (MapLibre GL style v8).\n\n"
        "## How to use\n\n"
        f"- Whole mosaic: `rasterio.open('/vsicurl/<url>/{vrt_filename}')` or "
        f"`gdal.Open('/vsicurl/<url>/{vrt_filename}')`.\n"
        + (
            f"- One area: filter `{mirror_filename}` on its `bbox` columns, then open only "
            "those tiles.\n"
            if mirror_filename
            else "- One area: read the items' `bbox`, then open only the tiles that intersect it.\n"
        )
        + "- Don't download every tile: COGs support HTTP range reads.\n"
    )


def dumps(document: dict[str, Any]) -> bytes:
    return json.dumps(document, indent=2).encode("utf-8")
