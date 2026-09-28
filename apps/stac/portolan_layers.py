"""Serves a bucket's Portolan catalog (apps.s3.portolan) through the STAC API.

When a bucket has a catalog.json, it's the source of truth: each child
collection (one published layer folder) becomes its own STAC API
Collection, carrying the layer's real extent, license, providers and
thumbnail, with one Item whose assets are the layer's files. The bucket's
files are private, so every relative href is turned into a presigned URL.
"""

import json
import logging
import posixpath
from typing import Any, cast
from urllib.parse import urlparse

from django.core.cache import cache

from apps.s3 import portolan

logger = logging.getLogger(__name__)

# Parsed collections are cached per catalog.json ETag: every publish and
# delete rewrites catalog.json (see portolan.ensure_root_catalog /
# prune_root_catalog), so a changed layer always means a new ETag.
CACHE_TTL = 300
PRESIGN_EXPIRY = 3600
# Layer folders may be nested ("imports/roads"), but a collection id is one
# URL path segment — so its "/" are written as "~".
FOLDER_SEPARATOR = "~"
# Extensions whose fields survive into the API's documents
_KEPT_EXTENSIONS = {portolan.FILE_SCHEMA, portolan.TABLE_SCHEMA}


def collection_id(conn_id: str, folder: str) -> str:
    return f"s3:{conn_id}:{folder.replace('/', FOLDER_SEPARATOR)}"


def folder_from_name(name: str) -> str:
    return name.replace(FOLDER_SEPARATOR, "/")


def list_layers(client, conn_id: str) -> list[dict[str, Any]] | None:
    """[{'folder', 'collection'}, ...] for each layer in the bucket's catalog.

    Follows sub-catalogs (a GeoPackage's layer group) from the root
    catalog.json.
    """
    try:
        etag = client.get_object_info(portolan.CATALOG_KEY)["etag"]
    except Exception:
        return None
    cache_key = f"stac:portolan:{conn_id}:{etag}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cast(list[dict[str, Any]], cached)

    refs = portolan.catalog_collections(client)
    if refs is None:
        logger.warning("Unreadable catalog.json in connection %s", conn_id)
        return None
    layers = []
    for ref in refs:
        try:
            collection = json.loads(client.get_object(f"{ref['folder']}/collection.json"))
        except Exception:
            continue
        layers.append({"folder": ref["folder"], "collection": collection})
    cache.set(cache_key, layers, CACHE_TTL)
    return layers


def find_layer(client, conn_id: str, folder: str) -> dict[str, Any] | None:
    return next(
        (layer for layer in list_layers(client, conn_id) or [] if layer["folder"] == folder),
        None,
    )


def summary(conn, layer: dict[str, Any]) -> dict[str, Any]:
    """The collection-list entry for one layer (see catalog.list_collections)."""
    return {
        "id": collection_id(str(conn.id), layer["folder"]),
        "title": layer["collection"].get("title") or layer["folder"],
        "item_count": 1,
        "portolan": layer,
    }


def _resolve(client, folder: str, href: str) -> str:
    """A collection-relative href as a URL a client can fetch."""
    if urlparse(href).scheme:
        return href
    key = posixpath.normpath(posixpath.join(folder, href))
    try:
        return str(client.generate_presigned_url(key=key, expiration=PRESIGN_EXPIRY))
    except Exception:
        return href


def _assets(client, folder: str, source_assets: dict[str, Any]) -> dict[str, Any]:
    return {
        name: {**asset, "href": _resolve(client, folder, asset.get("href", ""))}
        for name, asset in source_assets.items()
    }


def _bbox(collection: dict[str, Any]) -> list[float]:
    boxes = collection.get("extent", {}).get("spatial", {}).get("bbox") or []
    return boxes[0] if boxes else [-180.0, -90.0, 180.0, 90.0]


def collection_json(request, client, conn_id: str, layer: dict[str, Any]) -> dict[str, Any]:
    source = layer["collection"]
    folder = layer["folder"]
    cid = collection_id(conn_id, folder)
    self_href = request.build_absolute_uri(f"/api/stac/collections/{cid}")
    root_href = request.build_absolute_uri("/api/stac/")
    links = [
        {"rel": "self", "href": self_href, "type": "application/json"},
        {"rel": "root", "href": root_href, "type": "application/json"},
        {"rel": "parent", "href": root_href, "type": "application/json"},
        {
            "rel": "items",
            "href": request.build_absolute_uri(f"/api/stac/collections/{cid}/items"),
            "type": "application/geo+json",
        },
    ]
    # The license text (required for "other") and the human-readable README.
    for link in source.get("links", []):
        if link.get("rel") in ("license", "describedby"):
            links.append({**link, "href": _resolve(client, folder, link.get("href", ""))})

    result: dict[str, Any] = {
        "type": "Collection",
        "stac_version": source.get("stac_version", "1.1.0"),
        "stac_extensions": [
            ext for ext in source.get("stac_extensions", []) if ext in _KEPT_EXTENSIONS
        ],
        "id": cid,
        "title": source.get("title") or folder,
        "description": source.get("description") or source.get("title") or folder,
        "license": source.get("license", "other"),
        "providers": source.get("providers", []),
        "extent": source.get("extent")
        or {
            "spatial": {"bbox": [_bbox(source)]},
            "temporal": {"interval": [[None, None]]},
        },
        "assets": _assets(client, folder, source.get("assets", {})),
        "links": links,
    }
    for key in ("table:columns", "table:row_count", "updated"):
        if key in source:
            result[key] = source[key]
    return result


def item(request, client, conn_id: str, layer: dict[str, Any]) -> dict[str, Any]:
    """The layer as one STAC Item: its files as assets, its bbox as geometry."""
    source = layer["collection"]
    folder = layer["folder"]
    cid = collection_id(conn_id, folder)
    item_id = source.get("id") or folder.rsplit("/", 1)[-1]
    minx, miny, maxx, maxy = _bbox(source)[:4]
    interval = (source.get("extent", {}).get("temporal", {}).get("interval") or [[None]])[0]

    assets = _assets(client, folder, source.get("assets", {}))
    # A vector layer's PMTiles is a rel=pmtiles link in Portolan; STAC
    # clients look for renderable files among an Item's assets.
    for link in source.get("links", []):
        if link.get("rel") == "pmtiles":
            asset = {k: v for k, v in link.items() if k != "rel"}
            assets["pmtiles"] = {
                **asset,
                "href": _resolve(client, folder, link.get("href", "")),
                "roles": ["visual"],
            }

    collection_href = request.build_absolute_uri(f"/api/stac/collections/{cid}")
    extensions = [ext for ext in source.get("stac_extensions", []) if ext == portolan.FILE_SCHEMA]
    return {
        "type": "Feature",
        "stac_version": source.get("stac_version", "1.1.0"),
        "stac_extensions": extensions,
        "id": item_id,
        "collection": cid,
        "bbox": [minx, miny, maxx, maxy],
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]],
        },
        "properties": {
            "title": source.get("title") or item_id,
            "datetime": interval[0] if interval else source.get("updated"),
            "license": source.get("license", "other"),
        },
        "assets": assets,
        "links": [
            {
                "rel": "self",
                "href": f"{collection_href}/items/{item_id}",
                "type": "application/geo+json",
            },
            {"rel": "collection", "href": collection_href, "type": "application/json"},
            {"rel": "parent", "href": collection_href, "type": "application/json"},
            {
                "rel": "root",
                "href": request.build_absolute_uri("/api/stac/"),
                "type": "application/json",
            },
        ],
    }
