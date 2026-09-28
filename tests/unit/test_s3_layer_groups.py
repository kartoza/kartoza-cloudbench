"""Map Explorer's layer groups, read from the bucket's Portolan catalog."""

import hashlib
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.s3 import layer_groups, portolan
from apps.s3.models import S3Connection


class FakeBucket:
    """Just enough of S3Client for the catalog: an in-memory bucket."""

    bucket_url = "http://minio:9000/data"

    def __init__(self):
        self.objects = {}

    def get_object(self, key):
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return self.objects[key]

    def get_object_info(self, key):
        return {"etag": hashlib.md5(self.get_object(key)).hexdigest()}

    def put_object(self, key, body, content_type=None):
        self.objects[key] = body

    def delete_object(self, key):
        self.objects.pop(key, None)


def publish(
    bucket, folder, title, data_assets, catalog_folder="", catalog_title="", kind="pmtiles"
):
    """Publish a layer's catalog entries as the pipeline would."""
    portolan.finalize_layer(
        bucket,
        folder=folder,
        layer_id=folder.rsplit("/", 1)[-1],
        title=title,
        kind=kind,
        data_assets=data_assets,
        license_id="CC-BY-4.0",
        provider_name="admin",
        source_name="x",
        info={"bbox": [1, 2, 3, 4], "layers": ["default"]},
        catalog_folder=catalog_folder,
        catalog_title=catalog_title,
    )


SOURCE = {
    "filename": "../source/CasteloBranco.gpkg",
    "role": "source",
    "media_type": portolan.GEOPACKAGE_MEDIA_TYPE,
}


def castelo_bucket():
    bucket = FakeBucket()
    # A standalone shapefile layer: top-level, not a group.
    publish(bucket, "roads", "Roads", [{"filename": "roads.pmtiles", "role": "visual"}])
    # A GeoPackage, nested under maps/: a vector layer and a raster table.
    publish(
        bucket,
        "maps/castelo/highway",
        "Highway",
        [
            {
                "filename": "highway.parquet",
                "role": "data",
                "media_type": portolan.PARQUET_MEDIA_TYPE,
            },
            {
                "filename": "highway.pmtiles",
                "role": "visual",
                "media_type": portolan.PMTILES_MEDIA_TYPE,
            },
            SOURCE,
        ],
        catalog_folder="maps/castelo",
        catalog_title="Castelo Branco",
    )
    publish(
        bucket,
        "maps/castelo/dem",
        "DEM",
        [
            {"filename": "dem.tif", "role": "data"},
            {"filename": "dem_3857.tif", "role": "visual"},
            SOURCE,
        ],
        catalog_folder="maps/castelo",
        catalog_title="Castelo Branco",
        kind="cog",
    )
    return bucket


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="groups-owner")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="data"
    )


@pytest.fixture
def api(owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    return client


@pytest.fixture
def serve():
    cache.clear()  # layers are cached per catalog.json ETag
    patchers = []

    def start(bucket):
        patcher = patch("apps.s3.layer_groups.get_s3_client", return_value=bucket)
        patcher.start()
        patchers.append(patcher)

    yield start
    for patcher in patchers:
        patcher.stop()
    cache.clear()


@pytest.mark.django_db
def test_each_geopackage_sub_catalog_is_a_group(api, serve, connection):
    serve(castelo_bucket())

    [group] = api.get("/api/s3/collections").json()

    assert group["id"] == f"{connection.id}:maps~castelo"
    assert group["name"] == "Castelo Branco"
    assert group["sourceName"] == "CasteloBranco.gpkg"
    assert group["itemCount"] == 2
    assert (group["connectionId"], group["bucket"]) == (str(connection.id), "data")
    assert "items" not in group  # the list is summaries; items come with the detail


@pytest.mark.django_db
def test_group_items_are_the_files_map_explorer_opens(api, serve, connection):
    serve(castelo_bucket())

    group = api.get(f"/api/s3/collections/{connection.id}:maps~castelo").json()

    assert sorted(group["items"], key=lambda item: item["name"]) == [
        # A raster's EPSG:3857 COG (Map Explorer renders only those)...
        {"name": "DEM", "key": "maps/castelo/dem/dem_3857.tif", "format": "cog"},
        # ...a vector layer's PMTiles (its rel=pmtiles link), not its GeoParquet.
        {"name": "Highway", "key": "maps/castelo/highway/highway.pmtiles", "format": "pmtiles"},
    ]


@pytest.mark.django_db
def test_unknown_or_foreign_groups_are_not_found(api, serve, connection, django_user_model):
    serve(castelo_bucket())
    assert api.get(f"/api/s3/collections/{connection.id}:elsewhere").status_code == 404
    assert api.get("/api/s3/collections/not-a-group-id").status_code == 404
    assert api.get("/api/s3/collections/not-a-uuid:maps~castelo").status_code == 404

    stranger = APIClient()
    stranger.force_authenticate(user=django_user_model.objects.create(username="stranger"))
    assert stranger.get(f"/api/s3/collections/{connection.id}:maps~castelo").status_code == 404
    assert stranger.get("/api/s3/collections").json() == []


@pytest.mark.django_db
def test_bucket_without_a_catalog_has_no_groups(api, serve, connection):
    serve(FakeBucket())
    assert api.get("/api/s3/collections").json() == []


@pytest.mark.django_db
def test_groups_follow_deletes_with_no_upkeep(api, serve, connection):
    bucket = castelo_bucket()
    serve(bucket)
    assert api.get("/api/s3/collections").json()[0]["itemCount"] == 2

    # Deleting one GeoPackage layer: the catalog is pruned, and the group follows.
    portolan.prune_root_catalog(bucket, "maps/castelo/dem/")
    assert api.get("/api/s3/collections").json()[0]["itemCount"] == 1

    # Deleting the whole GeoPackage folder: its group is gone.
    portolan.prune_root_catalog(bucket, "maps/castelo/")
    assert api.get("/api/s3/collections").json() == []


def test_group_id_round_trips_nested_folders():
    value = layer_groups.group_id("conn-1", "maps/castelo")
    assert value == "conn-1:maps~castelo"
    assert layer_groups.parse_group_id(value) == ("conn-1", "maps/castelo")
    assert layer_groups.parse_group_id("no-separator") is None


# -- The catalogue page ---------------------------------------------------------


class ListingBucket(FakeBucket):
    """A FakeBucket that can also be listed, for buckets without a catalog."""

    def list_objects(self, prefix="", delimiter="/", max_keys=1000, continuation_token=None):
        keys = sorted(self.objects)
        start = int(continuation_token or 0)
        page = keys[start : start + max_keys]
        more = start + max_keys < len(keys)
        return {
            "objects": [
                {"key": key, "size": len(self.objects[key]), "lastModified": "2026-09-28"}
                for key in page
            ],
            "isTruncated": more,
            "nextContinuationToken": str(start + max_keys) if more else None,
        }


@pytest.mark.django_db
def test_catalogue_follows_the_catalog_hierarchy(api, serve, connection):
    bucket = castelo_bucket()
    publish(
        bucket,
        "rivers",
        "Rivers",
        [
            {"filename": "rivers.pmtiles", "role": "visual", "file": {"size": 42}},
            {"filename": "thumbnail.png", "role": "thumbnail"},
        ],
    )
    serve(bucket)

    [section] = api.get("/api/s3/catalogue").json()

    assert section["connectionId"] == str(connection.id)
    assert (section["connectionName"], section["bucket"]) == ("MinIO", "data")
    assert section["fromCatalog"] is True
    by_name = {entry["name"]: entry for entry in section["entries"]}
    assert set(by_name) == {"Roads", "Castelo Branco", "Rivers"}

    # Standalone layers are top-level cards, with their thumbnail and size.
    rivers = by_name["Rivers"]
    assert rivers["kind"] == "layer"
    assert (rivers["key"], rivers["format"]) == ("rivers/rivers.pmtiles", "pmtiles")
    assert rivers["thumbnailKey"] == "rivers/thumbnail.png"
    assert rivers["size"] == 42
    assert by_name["Roads"]["thumbnailKey"] is None

    # A GeoPackage is one card holding its layers - vector and raster.
    group = by_name["Castelo Branco"]
    assert group["kind"] == "group"
    assert group["id"] == f"{connection.id}:maps~castelo"
    assert (group["sourceName"], group["itemCount"]) == ("CasteloBranco.gpkg", 2)
    assert group["sourceKey"] == "maps/castelo/source/CasteloBranco.gpkg"
    assert sorted((layer["name"], layer["key"], layer["format"]) for layer in group["layers"]) == [
        ("DEM", "maps/castelo/dem/dem_3857.tif", "cog"),
        ("Highway", "maps/castelo/highway/highway.pmtiles", "pmtiles"),
    ]


@pytest.mark.django_db
def test_catalogue_without_a_catalog_scans_for_map_ready_files(api, serve, connection):
    bucket = ListingBucket()
    for key in (
        "old/roads.pmtiles",
        "old/thumbnail.png",
        "dem/dem.tif",  # original CRS: Map Explorer can't render it
        "dem/dem_3857.tif",
        "maps/sources/11111111-2222-3333-4444-555555555555/roads.pmtiles",  # a staged upload
        "notes.txt",
    ):
        bucket.objects[key] = b"x" * 3
    serve(bucket)

    [section] = api.get("/api/s3/catalogue").json()

    assert section["fromCatalog"] is False
    assert [
        (entry["kind"], entry["name"], entry["key"], entry["format"], entry["thumbnailKey"])
        for entry in section["entries"]
    ] == [
        ("layer", "dem_3857", "dem/dem_3857.tif", "cog", None),
        ("layer", "roads", "old/roads.pmtiles", "pmtiles", "old/thumbnail.png"),
    ]


@pytest.mark.django_db
def test_catalogue_leaves_out_empty_and_unreachable_buckets(api, serve, owner, connection):
    serve(ListingBucket())
    assert api.get("/api/s3/catalogue").json() == []

    with patch("apps.s3.layer_groups.get_s3_client", side_effect=RuntimeError("down")):
        assert api.get("/api/s3/catalogue").json() == []
