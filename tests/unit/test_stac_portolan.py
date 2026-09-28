"""The STAC API serving buckets from their Portolan catalog.json."""

import hashlib
import json
from unittest.mock import Mock, patch

import pytest
from botocore.exceptions import ClientError
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.s3.models import S3Connection

CHECKSUM = f"1220{'ab' * 32}"


class FakeBucket:
    """Just enough of S3Client for the STAC API: an in-memory bucket."""

    def __init__(self, objects):
        self.objects = {
            key: value.encode() if isinstance(value, str) else value
            for key, value in objects.items()
        }
        self.reads = []

    def get_object_info(self, key):
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"etag": hashlib.md5(self.objects[key]).hexdigest()}

    def get_object(self, key):
        self.reads.append(key)
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return self.objects[key]

    def generate_presigned_url(self, key, expiration=3600):
        return f"https://signed.example/{key}"

    def list_objects(self, prefix="", delimiter="", max_keys=1000, continuation_token=None):
        return {
            "objects": [
                {"key": key, "size": len(body), "lastModified": "2026-09-28T00:00:00Z"}
                for key, body in self.objects.items()
            ],
            "isTruncated": False,
        }


def layer_collection(layer_id, title, bbox, license_id="CC-BY-4.0", license_href=None):
    links = [
        {"rel": "root", "href": "../catalog.json"},
        {"rel": "describedby", "href": "./README.md", "type": "text/markdown"},
        {
            "rel": "pmtiles",
            "href": f"./{layer_id}.pmtiles",
            "type": "application/vnd.pmtiles",
            "pmtiles:layers": ["default"],
            "file:checksum": CHECKSUM,
            "file:size": 42,
        },
    ]
    if license_href:
        links.append({"rel": "license", "href": license_href, "type": "text/markdown"})
    return json.dumps(
        {
            "type": "Collection",
            "stac_version": "1.1.0",
            "stac_extensions": [
                "https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json",
                "https://stac-extensions.github.io/file/v2.1.0/schema.json",
            ],
            "id": layer_id,
            "title": title,
            "description": f"{title}, uploaded via CloudBench.",
            "license": license_id,
            "providers": [
                {"name": "admin", "roles": ["producer"]},
                {"name": "minio", "roles": ["host"], "url": "http://minio:9000/data"},
            ],
            "extent": {
                "spatial": {"bbox": [bbox]},
                "temporal": {"interval": [["2026-09-28T00:00:00Z", None]]},
            },
            "assets": {
                "data": {
                    "href": f"./{layer_id}.parquet",
                    "type": "application/vnd.apache.parquet",
                    "roles": ["data"],
                    "file:checksum": CHECKSUM,
                    "file:size": 7,
                },
                "thumbnail": {
                    "href": "./thumbnail.png",
                    "type": "image/png",
                    "roles": ["thumbnail"],
                },
                "style-default": {
                    "href": "./styles/default.json",
                    "type": "application/vnd.mapbox.style+json",
                    "roles": ["style", "default"],
                },
            },
            "links": links,
            "table:columns": [{"name": "name", "type": "string"}],
        }
    )


def portolan_bucket():
    catalog = {
        "type": "Catalog",
        "id": "catalog",
        "links": [
            {"rel": "root", "href": "./catalog.json"},
            {"rel": "child", "href": "./roads/collection.json", "title": "Roads"},
            {"rel": "child", "href": "./imports/rivers/collection.json", "title": "Rivers"},
            # A layer deleted without its link being pruned: skipped, not an error.
            {"rel": "child", "href": "./gone/collection.json", "title": "Gone"},
            {"rel": "describedby", "href": "./README.md"},
        ],
    }
    return FakeBucket(
        {
            "catalog.json": json.dumps(catalog),
            "roads/collection.json": layer_collection("roads", "Roads", [1, 2, 3, 4]),
            "imports/rivers/collection.json": layer_collection(
                "rivers", "Rivers", [5, 6, 7, 8], license_id="other", license_href="./LICENSE.md"
            ),
        }
    )


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="stac-owner")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="data"
    )


@pytest.fixture
def api(owner):
    client = APIClient(SERVER_NAME="testserver")
    client.force_authenticate(user=owner)
    return client


@pytest.fixture
def serve(connection):
    """Serve `bucket` as the connection's S3 bucket, with no GeoServer connections."""
    cache.clear()

    def start(bucket):
        patchers = [
            patch("apps.stac.catalog.get_s3_client", return_value=bucket),
            patch("apps.stac.catalog.get_config", return_value=Mock(list_connections=lambda: [])),
        ]
        for patcher in patchers:
            patcher.start()
        return patchers

    started = []
    yield lambda bucket: started.extend(start(bucket))
    for patcher in started:
        patcher.stop()
    cache.clear()


@pytest.mark.django_db
def test_each_portolan_layer_is_its_own_collection(api, serve, connection):
    serve(portolan_bucket())

    collections = api.get("/api/stac/collections").json()["collections"]

    by_id = {c["id"]: c for c in collections}
    roads = by_id[f"s3:{connection.id}:roads"]
    assert set(by_id) == {f"s3:{connection.id}:roads", f"s3:{connection.id}:imports~rivers"}
    # Real metadata instead of the old placeholders (world bbox, "proprietary").
    assert roads["title"] == "Roads"
    assert roads["license"] == "CC-BY-4.0"
    assert roads["extent"]["spatial"]["bbox"] == [[1, 2, 3, 4]]
    assert [p["roles"] for p in roads["providers"]] == [["producer"], ["host"]]
    assert roads["table:columns"] == [{"name": "name", "type": "string"}]
    # Relative hrefs become presigned URLs; checksums still describe those bytes.
    assert roads["assets"]["thumbnail"]["href"] == "https://signed.example/roads/thumbnail.png"
    assert roads["assets"]["data"]["file:checksum"] == CHECKSUM
    # The API rewrites the bucket layout, so Portolan's own schema no longer applies.
    assert roads["stac_extensions"] == ["https://stac-extensions.github.io/file/v2.1.0/schema.json"]
    rels = {link["rel"]: link["href"] for link in roads["links"]}
    assert rels["items"].endswith(f"/api/stac/collections/s3:{connection.id}:roads/items")
    assert rels["describedby"] == "https://signed.example/roads/README.md"


@pytest.mark.django_db
def test_other_license_link_is_presigned(api, serve, connection):
    serve(portolan_bucket())

    rivers = api.get(f"/api/stac/collections/s3:{connection.id}:imports~rivers").json()

    assert rivers["license"] == "other"
    license_link = next(link for link in rivers["links"] if link["rel"] == "license")
    assert license_link["href"] == "https://signed.example/imports/rivers/LICENSE.md"


@pytest.mark.django_db
def test_layer_item_carries_its_files_and_footprint(api, serve, connection):
    serve(portolan_bucket())
    collection_id = f"s3:{connection.id}:imports~rivers"

    [item] = api.get(f"/api/stac/collections/{collection_id}/items").json()["features"]

    assert item["id"] == "rivers"
    assert item["collection"] == collection_id
    assert item["bbox"] == [5, 6, 7, 8]
    assert item["geometry"]["coordinates"][0][0] == [5, 6]
    assert item["properties"]["datetime"] == "2026-09-28T00:00:00Z"
    assets = item["assets"]
    assert assets["data"]["href"] == "https://signed.example/imports/rivers/rivers.parquet"
    assert assets["thumbnail"]["roles"] == ["thumbnail"]
    # The rel=pmtiles link becomes a renderable asset, checksum and all.
    assert assets["pmtiles"]["href"] == "https://signed.example/imports/rivers/rivers.pmtiles"
    assert assets["pmtiles"]["roles"] == ["visual"]
    assert assets["pmtiles"]["file:checksum"] == CHECKSUM
    assert "rel" not in assets["pmtiles"]

    detail = api.get(f"/api/stac/collections/{collection_id}/items/rivers")
    assert detail.status_code == 200 and detail.json()["id"] == "rivers"
    assert api.get(f"/api/stac/collections/{collection_id}/items/roads").status_code == 404


@pytest.mark.django_db
def test_unknown_layer_collection_is_not_found(api, serve, connection):
    serve(portolan_bucket())
    assert api.get(f"/api/stac/collections/s3:{connection.id}:gone").status_code == 404
    assert api.get(f"/api/stac/collections/s3:{connection.id}:gone/items").status_code == 404


@pytest.mark.django_db
def test_layers_are_cached_until_catalog_json_changes(api, serve, connection):
    bucket = portolan_bucket()
    serve(bucket)

    api.get("/api/stac/collections")
    api.get("/api/stac/")
    assert bucket.reads.count("roads/collection.json") == 1  # second request: cache hit

    # A publish rewrites catalog.json (new ETag): the next request re-reads.
    bucket.objects["catalog.json"] += b" "
    api.get("/api/stac/collections")
    assert bucket.reads.count("roads/collection.json") == 2


@pytest.mark.django_db
def test_bucket_without_catalog_falls_back_to_pmtiles_scan(api, serve, connection):
    serve(FakeBucket({"maps/roads.pmtiles": b"PMTiles", "notes.txt": b"x"}))

    collections = api.get("/api/stac/collections").json()["collections"]

    [collection] = collections
    assert collection["id"] == f"s3:{connection.id}"
    items = api.get(f"/api/stac/collections/s3:{connection.id}/items").json()["features"]
    assert [item["id"] for item in items] == ["maps/roads.pmtiles"]


@pytest.mark.django_db
def test_geopackage_sub_catalog_layers_are_collections(api, serve, connection):
    bucket = portolan_bucket()
    root = json.loads(bucket.objects["catalog.json"])
    root["links"].append(
        {"rel": "child", "href": "./castelo-branco/catalog.json", "title": "Castelo Branco"}
    )
    bucket.objects["catalog.json"] = json.dumps(root).encode()
    bucket.objects["castelo-branco/catalog.json"] = json.dumps(
        {
            "type": "Catalog",
            "id": "castelo-branco",
            "links": [
                {"rel": "root", "href": "../catalog.json"},
                {"rel": "parent", "href": "../catalog.json"},
                {"rel": "child", "href": "./highway/collection.json", "title": "Highway"},
            ],
        }
    ).encode()
    bucket.objects["castelo-branco/highway/collection.json"] = layer_collection(
        "castelo-branco/highway", "Highway", [9, 9, 10, 10]
    ).encode()
    serve(bucket)

    ids = {c["id"] for c in api.get("/api/stac/collections").json()["collections"]}
    highway_id = f"s3:{connection.id}:castelo-branco~highway"
    assert highway_id in ids

    [item] = api.get(f"/api/stac/collections/{highway_id}/items").json()["features"]
    assert item["bbox"] == [9, 9, 10, 10]
    assert item["assets"]["thumbnail"]["href"] == (
        "https://signed.example/castelo-branco/highway/thumbnail.png"
    )
