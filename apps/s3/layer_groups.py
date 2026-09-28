"""Map Explorer's layer groups and the catalogue page, read from the bucket's catalog.

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
import re
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


def _source_key(layers: list[dict[str, Any]]) -> str | None:
    """The bucket key of the group's original upload, if its layers keep one."""
    for layer in layers:
        source = layer["collection"].get("assets", {}).get("source")
        if source and source.get("href"):
            return str(posixpath.normpath(posixpath.join(layer["folder"], source["href"])))
    return None


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


# -- The catalogue page ---------------------------------------------------------

# A job's staged upload ("<parent>/sources/<job uuid>/<file>"), not a layer.
_SOURCE_ARTIFACT = re.compile(
    r"(^|/)sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
)


def _layer_entry(layer: dict[str, Any]) -> dict[str, Any] | None:
    """A published layer as a catalogue card: its renderable file, thumbnail, size."""
    item = _layer_item(layer)
    if item is None:
        return None
    collection = layer["collection"]
    folder = layer["folder"]
    thumbnail = collection.get("assets", {}).get("thumbnail")
    renderable = (
        next((link for link in collection.get("links", []) if link.get("rel") == "pmtiles"), None)
        or collection.get("assets", {}).get("visual")
        or {}
    )
    return {
        "kind": "layer",
        **item,
        "folder": folder,
        "thumbnailKey": (
            posixpath.normpath(posixpath.join(folder, thumbnail["href"]))
            if thumbnail and thumbnail.get("href")
            else None
        ),
        "size": renderable.get("file:size"),
        "updated": collection.get("updated"),
    }


def _catalog_entries(conn, layers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Top-level layers and GeoPackage groups, in the catalog's order."""
    entries: list[dict[str, Any]] = []
    groups: dict[str, dict[str, Any]] = {}
    for layer in layers:
        entry = _layer_entry(layer)
        if entry is None:
            continue
        folder = layer.get("catalog")
        if not folder:
            entries.append(entry)
            continue
        if folder not in groups:
            groups[folder] = {
                "kind": "group",
                "id": group_id(str(conn.id), folder),
                "name": layer.get("catalog_title") or posixpath.basename(folder),
                "folder": folder,
                "layers": [],
                "_members": [],
            }
            entries.append(groups[folder])
        groups[folder]["layers"].append(entry)
        groups[folder]["_members"].append(layer)
    for group in groups.values():
        members = group.pop("_members")
        group["sourceName"] = _source_name(members, group["name"])
        group["sourceKey"] = _source_key(members)
        group["itemCount"] = len(group["layers"])
        group["thumbnailKey"] = next(
            (entry["thumbnailKey"] for entry in group["layers"] if entry["thumbnailKey"]), None
        )
        group["updated"] = max((entry["updated"] or "" for entry in group["layers"]), default="")
    return entries


def _scanned_entries(client) -> list[dict[str, Any]]:
    """For a bucket without a catalog: its map-ready files, as standalone layers.

    PMTiles and EPSG:3857 COGs (what Map Explorer renders), skipping jobs'
    staged uploads; a sibling thumbnail.png is used when there is one.
    """
    objects: list[dict[str, Any]] = []
    token = None
    while True:
        result = client.list_objects(
            prefix="", delimiter="", max_keys=1000, continuation_token=token
        )
        objects.extend(result["objects"])
        if not result.get("isTruncated"):
            break
        token = result.get("nextContinuationToken")
    keys = {obj["key"] for obj in objects}
    entries = []
    for obj in objects:
        key = obj["key"]
        lower = key.lower()
        if _SOURCE_ARTIFACT.search(key):
            continue
        if lower.endswith(".pmtiles"):
            fmt = "pmtiles"
        elif re.search(r"_3857\.tiff?$", lower):
            fmt = "cog"
        else:
            continue
        folder = posixpath.dirname(key)
        thumbnail = f"{folder}/thumbnail.png" if folder else "thumbnail.png"
        entries.append(
            {
                "kind": "layer",
                "name": posixpath.splitext(posixpath.basename(key))[0],
                "key": key,
                "format": fmt,
                "folder": folder,
                "thumbnailKey": thumbnail if thumbnail in keys else None,
                "size": obj.get("size"),
                "updated": obj.get("lastModified"),
            }
        )
    return entries


def catalogue(user) -> list[dict[str, Any]]:
    """Every S3 connection's layers for the catalogue page.

    Per connection, its catalog's top-level layers and GeoPackage groups
    (each with its layers), in catalog order - the same hierarchy the STAC
    API serves - or, for a bucket without a catalog, its map-ready files.
    Connections with nothing to show are left out.
    """
    sections = []
    for conn in S3Connection.objects.filter(owner=user):
        try:
            client = get_s3_client(str(conn.id), user)
            layers = portolan_layers.list_layers(client, str(conn.id))
            from_catalog = layers is not None
            entries = (
                _catalog_entries(conn, layers) if layers is not None else _scanned_entries(client)
            )
        except Exception:
            logger.warning("Couldn't read the catalogue of connection %s", conn.id, exc_info=True)
            continue
        if entries:
            sections.append(
                {
                    "connectionId": str(conn.id),
                    "connectionName": conn.name,
                    "bucket": conn.bucket,
                    "fromCatalog": from_catalog,
                    "entries": entries,
                }
            )
    return sections
