"""Map Explorer's layer groups, read from the bucket's Portolan catalog.

A GeoPackage is published as a Portolan sub-catalog holding a folder per
layer (see portolan.ensure_sub_catalog); each such sub-catalog is a layer
group, its child collections the group's layers. Reading groups from the
catalog - rather than keeping a copy in the database - means they always
match the bucket: deleting or replacing layers needs no separate upkeep.

Groups keep the shape the /api/s3/collections endpoints have always had
(id, connectionId, bucket, name, sourceName, itemCount, createdAt; items
of name/key/format).
"""

import logging
import posixpath
from typing import Any

from apps.stac import portolan_layers

from .client import get_s3_client
from .models import S3Connection

logger = logging.getLogger(__name__)

# "<connection id>:<sub-catalog folder>", with the folder's "/" as "~" so the
# id is one URL path segment (as the STAC API's collection ids).
_ID_SEPARATOR = ":"
_FOLDER_SEPARATOR = "~"


def group_id(connection_id: str, folder: str) -> str:
    return f"{connection_id}{_ID_SEPARATOR}{folder.replace('/', _FOLDER_SEPARATOR)}"


def parse_group_id(value: str) -> tuple[str, str] | None:
    connection_id, sep, folder = value.partition(_ID_SEPARATOR)
    if not sep or not folder:
        return None
    return connection_id, folder.replace(_FOLDER_SEPARATOR, "/")


def _layer_item(layer: dict[str, Any]) -> dict[str, str] | None:
    """A layer as a group item: its renderable file (what Map Explorer opens).

    A vector layer's PMTiles (its rel=pmtiles link, or a "visual" asset in
    older layers); a raster's EPSG:3857 COG ("visual" asset); else its data.
    """
    collection = layer["collection"]
    assets = collection.get("assets", {})
    pmtiles = next(
        (link for link in collection.get("links", []) if link.get("rel") == "pmtiles"), None
    )
    target = pmtiles or assets.get("visual") or assets.get("data")
    if not target or not target.get("href"):
        return None
    key = posixpath.normpath(posixpath.join(layer["folder"], target["href"]))
    return {
        "name": collection.get("title") or posixpath.basename(layer["folder"]),
        "key": key,
        "format": "pmtiles" if key.lower().endswith(".pmtiles") else "cog",
    }


def _source_name(layers: list[dict[str, Any]], fallback: str) -> str:
    """The group's original upload's filename, from a layer's `source` asset."""
    for layer in layers:
        source = layer["collection"].get("assets", {}).get("source")
        if source and source.get("href"):
            return str(posixpath.basename(source["href"]))
    return fallback


def _connection_groups(conn, client) -> list[dict[str, Any]]:
    layers = portolan_layers.list_layers(client, str(conn.id)) or []
    by_catalog: dict[str, list[dict[str, Any]]] = {}
    for layer in layers:
        if layer.get("catalog"):
            by_catalog.setdefault(layer["catalog"], []).append(layer)
    groups = []
    for folder, members in by_catalog.items():
        items = [item for item in (_layer_item(layer) for layer in members) if item]
        if not items:
            continue
        name = members[0].get("catalog_title") or posixpath.basename(folder)
        groups.append(
            {
                "id": group_id(str(conn.id), folder),
                "connectionId": str(conn.id),
                "bucket": conn.bucket,
                "name": name,
                "sourceName": _source_name(members, name),
                "itemCount": len(items),
                "createdAt": max(
                    (layer["collection"].get("updated") or "" for layer in members), default=""
                ),
                "items": items,
            }
        )
    return groups


def list_groups(user, connection_id: str | None = None, bucket: str | None = None) -> list:
    """Every layer group across the user's S3 connections, newest first."""
    connections = S3Connection.objects.filter(owner=user)
    if connection_id:
        connections = connections.filter(id=connection_id)
    if bucket:
        connections = connections.filter(bucket=bucket)
    groups = []
    for conn in connections:
        try:
            groups.extend(_connection_groups(conn, get_s3_client(str(conn.id), user)))
        except Exception:
            # One unreachable bucket shouldn't hide every other connection's groups.
            logger.warning("Couldn't read layer groups for connection %s", conn.id, exc_info=True)
    groups.sort(key=lambda group: group["createdAt"], reverse=True)
    return groups


def get_group(user, value: str) -> dict[str, Any] | None:
    """One layer group, with its items; None if unknown or not the user's."""
    parsed = parse_group_id(value)
    if parsed is None:
        return None
    connection_id, folder = parsed
    try:
        conn = S3Connection.objects.filter(owner=user, id=connection_id).first()
    except Exception:  # not a UUID
        return None
    if conn is None:
        return None
    client = get_s3_client(str(conn.id), user)
    return next((group for group in _connection_groups(conn, client) if group["id"] == value), None)
