"""Builds real STAC JSON (Catalog/Collection/Item) from CloudBench's own
S3 (PMTiles) and GeoServer (layers) connections.

Hierarchy: Catalog (this CloudBench instance) -> Collection (one per S3
connection whose bucket has .pmtiles objects, or per GeoServer workspace
that has layers) -> Item (one per PMTiles object / GeoServer layer).
"""

from typing import Any
from urllib.parse import urlencode

from django.core.exceptions import ValidationError

from apps.core.config import get_config
from apps.geoserver.client import get_geoserver_client
from apps.s3.client import get_s3_client
from apps.s3.models import S3Connection

STAC_VERSION = "1.0.0"


def s3_collection_id(conn_id: str) -> str:
    return f"s3:{conn_id}"


def gs_collection_id(conn_id: str, workspace: str) -> str:
    return f"gs:{conn_id}:{workspace}"


def parse_collection_id(collection_id: str) -> tuple[str, str, str | None]:
    """Returns (kind, conn_id, name).

    name is a GeoServer workspace, or None for S3 — an S3 connection is
    scoped to exactly one bucket, so there's no separate name to parse out.
    """
    parts = collection_id.split(":", 2)
    if parts[0] == "s3" and len(parts) == 2:
        return "s3", parts[1], None
    if parts[0] == "gs" and len(parts) == 3:
        return "gs", parts[1], parts[2]
    raise ValueError(f"Unknown collection id: {collection_id}")


def _get_owned_s3_connection(user_id: str, conn_id: str) -> "S3Connection | None":
    """conn_id is parsed out of a collection id and isn't guaranteed to be a well-formed UUID."""
    try:
        return S3Connection.objects.filter(owner_id=int(user_id), id=conn_id).first()
    except (ValueError, ValidationError):
        return None


def _link(
    rel: str, href: str, media_type: str = "application/json", title: str | None = None
) -> dict[str, Any]:
    link: dict[str, Any] = {"rel": rel, "href": href, "type": media_type}
    if title:
        link["title"] = title
    return link


def _list_pmtiles_objects(client) -> list[dict[str, Any]]:
    """Walk a connection's whole bucket and return every .pmtiles object."""
    found: list[dict[str, Any]] = []
    continuation_token = None
    while True:
        result = client.list_objects(
            prefix="", delimiter="", max_keys=1000, continuation_token=continuation_token
        )
        found.extend(obj for obj in result["objects"] if obj["key"].lower().endswith(".pmtiles"))
        if not result.get("isTruncated"):
            break
        continuation_token = result.get("nextContinuationToken")
    return found


def _list_s3_collections(user_id: str) -> list[dict[str, Any]]:
    results = []
    for conn in S3Connection.objects.filter(owner_id=int(user_id)):
        try:
            client = get_s3_client(str(conn.id), user_id)
            objects = _list_pmtiles_objects(client)
        except Exception:
            continue
        if not objects:
            continue
        results.append(
            {
                "id": s3_collection_id(str(conn.id)),
                "title": f"{conn.name} / {conn.bucket}",
                "item_count": len(objects),
            }
        )
    return results


def _list_geoserver_collections(user_id: str) -> list[dict[str, Any]]:
    config = get_config(user_id)
    results = []
    for conn in config.list_connections():
        try:
            client = get_geoserver_client(conn.id, user_id)
            workspaces = client.list_workspaces()
        except Exception:
            continue
        for workspace in workspaces:
            workspace_name = workspace.get("name")
            if not workspace_name:
                continue
            try:
                layers = client.list_layers(workspace_name)
            except Exception:
                continue
            if not layers:
                continue
            results.append(
                {
                    "id": gs_collection_id(conn.id, workspace_name),
                    "title": f"{conn.name} / {workspace_name}",
                    "item_count": len(layers),
                }
            )
    return results


def list_collections(user_id: str) -> list[dict[str, Any]]:
    """Every non-empty S3 bucket and GeoServer workspace, as STAC collection summaries."""
    return _list_s3_collections(user_id) + _list_geoserver_collections(user_id)


def build_root_catalog(request, user_id: str) -> dict[str, Any]:
    root_href = request.build_absolute_uri("/api/stac/")
    collections_href = request.build_absolute_uri("/api/stac/collections")

    links = [
        _link("self", root_href),
        _link("root", root_href),
        _link("data", collections_href),
    ]
    for collection in list_collections(user_id):
        collection_href = request.build_absolute_uri(f"/api/stac/collections/{collection['id']}")
        links.append(_link("child", collection_href, title=collection["title"]))

    return {
        "type": "Catalog",
        "stac_version": STAC_VERSION,
        "id": "cloudbench",
        "title": "CloudBench Catalogue",
        "description": "Datasets available across this CloudBench instance's S3 and GeoServer connections.",
        "conformsTo": [
            "https://api.stacspec.org/v1.0.0/core",
            "https://api.stacspec.org/v1.0.0/collections",
            "https://api.stacspec.org/v1.0.0/ogcapi-features",
        ],
        "links": links,
    }


def build_collection_json(request, user_id: str, collection_id: str) -> dict[str, Any] | None:
    match = next((c for c in list_collections(user_id) if c["id"] == collection_id), None)
    if match is None:
        return None

    self_href = request.build_absolute_uri(f"/api/stac/collections/{collection_id}")

    return {
        "type": "Collection",
        "stac_version": STAC_VERSION,
        "id": match["id"],
        "title": match["title"],
        "description": f"Datasets from {match['title']}.",
        "license": "proprietary",
        # Extent isn't computed from the actual data (that would mean opening
        # every PMTiles file / fetching every layer's bbox just to list
        # collections) — a world/open extent is a placeholder here.
        "extent": {
            "spatial": {"bbox": [[-180, -90, 180, 90]]},
            "temporal": {"interval": [[None, None]]},
        },
        "links": [
            _link("self", self_href),
            _link("root", request.build_absolute_uri("/api/stac/")),
            _link("parent", request.build_absolute_uri("/api/stac/")),
            _link(
                "items", request.build_absolute_uri(f"/api/stac/collections/{collection_id}/items")
            ),
        ],
    }


def _wms_preview_url(base_url: str, workspace: str, layer_name: str) -> str:
    params = {
        "service": "WMS",
        "version": "1.1.0",
        "request": "GetMap",
        "layers": f"{workspace}:{layer_name}",
        "bbox": "-180,-90,180,90",
        "width": "1024",
        "height": "512",
        "srs": "EPSG:4326",
        "format": "image/png",
    }
    return f"{base_url.rstrip('/')}/wms?{urlencode(params)}"


def _s3_item(
    request, collection_id: str, conn, obj: dict[str, Any], user_id: str
) -> dict[str, Any]:
    key = obj["key"]
    self_href = request.build_absolute_uri(f"/api/stac/collections/{collection_id}/items/{key}")

    try:
        asset_href = get_s3_client(conn.id, user_id).generate_presigned_url(
            key=key, expiration=3600
        )
    except Exception:
        asset_href = None

    return {
        "type": "Feature",
        "stac_version": STAC_VERSION,
        "id": key,
        "collection": collection_id,
        # Reading the real footprint would mean opening each PMTiles file's
        # header over the network just to list items — left null for now.
        "geometry": None,
        "bbox": None,
        "properties": {
            "datetime": obj.get("lastModified"),
            "title": key.split("/")[-1].removesuffix(".pmtiles"),
        },
        "links": [
            _link("self", self_href),
            _link(
                "collection", request.build_absolute_uri(f"/api/stac/collections/{collection_id}")
            ),
            _link("root", request.build_absolute_uri("/api/stac/")),
        ],
        "assets": (
            {
                "data": {
                    "href": asset_href,
                    "type": "application/vnd.pmtiles",
                    "title": "PMTiles archive",
                    "roles": ["data"],
                }
            }
            if asset_href
            else {}
        ),
    }


def _gs_item(
    request, collection_id: str, conn, workspace: str, layer: dict[str, Any], user_id: str
) -> dict[str, Any]:
    layer_name = layer.get("name", "")
    self_href = request.build_absolute_uri(
        f"/api/stac/collections/{collection_id}/items/{layer_name}"
    )

    bbox = None
    geometry = None
    try:
        metadata = get_geoserver_client(conn.id, user_id).get_layer_metadata(workspace, layer_name)
        raw_bbox = metadata.get("bbox")
        if raw_bbox:
            minx, miny = float(raw_bbox["minx"]), float(raw_bbox["miny"])
            maxx, maxy = float(raw_bbox["maxx"]), float(raw_bbox["maxy"])
            bbox = [minx, miny, maxx, maxy]
            geometry = {
                "type": "Polygon",
                "coordinates": [
                    [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]
                ],
            }
    except Exception:
        pass

    return {
        "type": "Feature",
        "stac_version": STAC_VERSION,
        "id": layer_name,
        "collection": collection_id,
        "geometry": geometry,
        "bbox": bbox,
        "properties": {
            # GeoServer doesn't expose a real "last updated" timestamp for a
            # layer over this API — left null rather than fabricating one.
            "datetime": None,
        },
        "links": [
            _link("self", self_href),
            _link(
                "collection", request.build_absolute_uri(f"/api/stac/collections/{collection_id}")
            ),
            _link("root", request.build_absolute_uri("/api/stac/")),
        ],
        "assets": {
            "preview": {
                "href": _wms_preview_url(conn.url, workspace, layer_name),
                "type": "image/png",
                "title": "WMS preview",
                "roles": ["overview"],
            }
        },
    }


def list_items(request, user_id: str, collection_id: str) -> list[dict[str, Any]] | None:
    """STAC Items for a collection, or None if the collection doesn't exist."""
    kind, conn_id, name = parse_collection_id(collection_id)

    if kind == "s3":
        conn = _get_owned_s3_connection(user_id, conn_id)
        if conn is None:
            return None
        client = get_s3_client(conn_id, user_id)
        objects = _list_pmtiles_objects(client)
        return [_s3_item(request, collection_id, conn, obj, user_id) for obj in objects]

    assert name is not None  # guaranteed by parse_collection_id for kind == "gs"
    config = get_config(user_id)
    gs_conn = config.get_connection(conn_id)
    if gs_conn is None:
        return None
    try:
        layers = get_geoserver_client(conn_id, user_id).list_layers(name)
    except Exception:
        layers = []
    return [
        _gs_item(request, collection_id, gs_conn, name, layer, user_id)
        for layer in layers
        if layer.get("name")
    ]


def get_item(request, user_id: str, collection_id: str, item_id: str) -> dict[str, Any] | None:
    kind, conn_id, name = parse_collection_id(collection_id)

    if kind == "s3":
        conn = _get_owned_s3_connection(user_id, conn_id)
        if conn is None:
            return None
        client = get_s3_client(conn_id, user_id)
        obj = next((o for o in _list_pmtiles_objects(client) if o["key"] == item_id), None)
        return _s3_item(request, collection_id, conn, obj, user_id) if obj else None

    assert name is not None  # guaranteed by parse_collection_id for kind == "gs"
    config = get_config(user_id)
    gs_conn = config.get_connection(conn_id)
    if gs_conn is None:
        return None
    try:
        layer = get_geoserver_client(conn_id, user_id).get_layer(name, item_id)
    except Exception:
        return None
    return _gs_item(request, collection_id, gs_conn, name, layer, user_id) if layer else None
