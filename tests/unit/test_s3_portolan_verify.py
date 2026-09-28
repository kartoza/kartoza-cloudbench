"""Verifying published layers' files against their recorded checksums."""

import hashlib
import io
import json
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from django.core.management import CommandError, call_command
from rest_framework.test import APIClient

from apps.s3 import portolan, portolan_verify
from apps.s3.models import S3Connection

PARQUET = b"PAR1" + b"x" * 5000
PMTILES = b"PMTiles" + b"y" * 3000


def checksum(content):
    return portolan.sha256_multihash(hashlib.sha256(content).digest())


class FakeBucket:
    """Just enough of S3Client for verification: an in-memory bucket."""

    def __init__(self, objects):
        self.objects = dict(objects)

    def get_object(self, key):
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return self.objects[key]

    def get_object_stream(self, key):
        return io.BytesIO(self.get_object(key))

    def put_object(self, key, body, content_type=None):
        self.objects[key] = body


def published_bucket():
    """A bucket with one checksummed layer ("roads") and one from before checksums ("old")."""
    roads = {
        "id": "roads",
        "title": "Roads",
        "assets": {
            "data": {
                "href": "./roads.parquet",
                "file:checksum": checksum(PARQUET),
                "file:size": len(PARQUET),
            },
            "style-default": {"href": "./styles/default.json"},
        },
        "links": [
            {"rel": "root", "href": "../catalog.json"},
            {
                "rel": "pmtiles",
                "href": "./roads.pmtiles",
                "file:checksum": checksum(PMTILES),
                "file:size": len(PMTILES),
            },
        ],
    }
    # Like a layer published before checksums (e.g. an older PMTiles-only one).
    old = {
        "id": "old",
        "title": "Old",
        "stac_extensions": [],
        "assets": {
            "visual": {"href": "./old.pmtiles", "roles": ["visual"]},
            "style-default": {"href": "./styles/default.json", "roles": ["style", "default"]},
        },
        "links": [
            {"rel": "root", "href": "../catalog.json"},
            {"rel": "pmtiles", "href": "./old.pmtiles"},
        ],
    }
    catalog = {
        "links": [
            {"rel": "root", "href": "./catalog.json"},
            {"rel": "child", "href": "./roads/collection.json", "title": "Roads"},
            {"rel": "child", "href": "./old/collection.json", "title": "Old"},
        ]
    }
    return FakeBucket(
        {
            "catalog.json": json.dumps(catalog).encode(),
            "roads/collection.json": json.dumps(roads).encode(),
            "roads/roads.parquet": PARQUET,
            "roads/roads.pmtiles": PMTILES,
            "roads/styles/default.json": b"{}",
            "old/collection.json": json.dumps(old).encode(),
            "old/old.pmtiles": b"PMTiles",
            "old/styles/default.json": b"{}",
        }
    )


def test_catalog_layers_lists_every_child_folder():
    assert portolan_verify.catalog_layers(published_bucket()) == [
        {"folder": "roads", "title": "Roads"},
        {"folder": "old", "title": "Old"},
    ]
    assert portolan_verify.catalog_layers(FakeBucket({})) == []


def test_untouched_layer_verifies():
    result = portolan_verify.verify_layer(published_bucket(), "roads")

    assert result["status"] == "ok"
    assert result["title"] == "Roads"
    assert {file["key"]: file["status"] for file in result["files"]} == {
        "roads/roads.parquet": "ok",
        "roads/roads.pmtiles": "ok",
    }


def test_overwritten_file_is_a_mismatch():
    bucket = published_bucket()
    bucket.objects["roads/roads.parquet"] = b"PAR1 replaced directly in the bucket"

    result = portolan_verify.verify_layer(bucket, "roads")

    assert result["status"] == "mismatch"
    [changed] = [file for file in result["files"] if file["status"] != "ok"]
    assert changed["key"] == "roads/roads.parquet"
    assert changed["status"] == "mismatch"
    assert changed["expectedChecksum"] == checksum(PARQUET)
    assert changed["actualSize"] == len(b"PAR1 replaced directly in the bucket")


def test_deleted_file_is_missing():
    bucket = published_bucket()
    del bucket.objects["roads/roads.pmtiles"]

    result = portolan_verify.verify_layer(bucket, "roads")

    assert result["status"] == "mismatch"
    assert {file["key"]: file["status"] for file in result["files"]}["roads/roads.pmtiles"] == (
        "missing"
    )


def test_layers_without_checksums_or_collection():
    bucket = published_bucket()
    assert portolan_verify.verify_layer(bucket, "old")["status"] == "unverifiable"
    assert portolan_verify.verify_layer(bucket, "nowhere")["status"] == "unreadable"


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="verify-owner")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="data"
    )


@pytest.mark.django_db
def test_api_lists_layers_and_verifies_one_at_a_time(owner, connection):
    api = APIClient()
    api.force_authenticate(user=owner)
    bucket = published_bucket()
    bucket.objects["roads/roads.parquet"] = b"changed"

    with patch("apps.s3.views.get_s3_client", return_value=bucket):
        layers = api.get(f"/api/s3/portolan/layers/{connection.id}").json()["layers"]
        roads = api.post(
            f"/api/s3/portolan/verify/{connection.id}", {"folder": "roads"}, format="json"
        ).json()
        missing_folder = api.post(f"/api/s3/portolan/verify/{connection.id}", {}, format="json")

    assert [layer["folder"] for layer in layers] == ["roads", "old"]
    assert roads["status"] == "mismatch"
    assert missing_folder.status_code == 400


@pytest.mark.django_db
def test_api_rejects_another_users_connection(django_user_model, connection):
    api = APIClient()
    api.force_authenticate(user=django_user_model.objects.create(username="someone-else"))

    response = api.post(
        f"/api/s3/portolan/verify/{connection.id}", {"folder": "roads"}, format="json"
    )

    assert response.status_code == 404


@pytest.mark.django_db
def test_command_reports_and_fails_on_mismatch(connection, capsys):
    bucket = published_bucket()
    with patch("apps.s3.management.commands.portolan_verify.get_s3_client", return_value=bucket):
        call_command("portolan_verify", "--connection", "MinIO")
        assert "OK          MinIO/roads (2 files)" in capsys.readouterr().out

        bucket.objects["roads/roads.parquet"] = b"changed"
        with pytest.raises(CommandError, match="1 layer"):
            call_command("portolan_verify", "--connection", "MinIO", "--folder", "roads")
    assert "mismatch roads/roads.parquet" in capsys.readouterr().err


def test_record_checksums_for_a_layer_published_before_them():
    bucket = published_bucket()
    catalog_before = bucket.objects["catalog.json"]

    result = portolan_verify.record_checksums(bucket, "old")

    assert result["status"] == "ok"
    collection = json.loads(bucket.objects["old/collection.json"])
    assert collection["assets"]["visual"]["file:checksum"] == checksum(b"PMTiles")
    assert collection["assets"]["visual"]["file:size"] == len(b"PMTiles")
    [pmtiles_link] = [link for link in collection["links"] if link["rel"] == "pmtiles"]
    assert pmtiles_link["file:checksum"] == checksum(b"PMTiles")
    # The style editor rewrites the style in place: never checksummed.
    assert "file:checksum" not in collection["assets"]["style-default"]
    assert portolan.FILE_SCHEMA in collection["stac_extensions"]
    # catalog.json is rewritten, so anything keyed on its ETag (STAC cache) notices.
    assert bucket.objects["catalog.json"] != catalog_before

    # From here on, changes are caught.
    bucket.objects["old/old.pmtiles"] = b"PMTiles, changed later"
    assert portolan_verify.verify_layer(bucket, "old")["status"] == "mismatch"


def test_record_refuses_a_layer_that_already_has_checksums():
    bucket = published_bucket()
    bucket.objects["roads/roads.parquet"] = b"changed"  # re-recording would hide this
    collection_before = bucket.objects["roads/collection.json"]

    with pytest.raises(portolan_verify.AlreadyRecorded):
        portolan_verify.record_checksums(bucket, "roads")
    assert bucket.objects["roads/collection.json"] == collection_before


def test_record_writes_nothing_when_a_file_is_missing():
    bucket = published_bucket()
    del bucket.objects["old/old.pmtiles"]
    collection_before = bucket.objects["old/collection.json"]

    result = portolan_verify.record_checksums(bucket, "old")

    assert result["status"] == "mismatch"
    assert {file["key"] for file in result["files"]} == {"old/old.pmtiles"}
    assert bucket.objects["old/collection.json"] == collection_before


@pytest.mark.django_db
def test_api_records_checksums_once(owner, connection):
    api = APIClient()
    api.force_authenticate(user=owner)
    bucket = published_bucket()
    url = f"/api/s3/portolan/record/{connection.id}"

    with patch("apps.s3.views.get_s3_client", return_value=bucket):
        first = api.post(url, {"folder": "old"}, format="json")
        again = api.post(url, {"folder": "old"}, format="json")
        no_folder = api.post(url, {}, format="json")

    assert first.status_code == 200 and first.json()["status"] == "ok"
    assert again.status_code == 409
    assert no_folder.status_code == 400


@pytest.mark.django_db
def test_command_records_only_layers_without_checksums(connection, capsys):
    bucket = published_bucket()
    roads_before = bucket.objects["roads/collection.json"]

    with patch("apps.s3.management.commands.portolan_verify.get_s3_client", return_value=bucket):
        call_command("portolan_verify", "--connection", "MinIO", "--record")

    out = capsys.readouterr().out
    assert "RECORDED    MinIO/old" in out
    assert "OK          MinIO/roads" in out
    assert bucket.objects["roads/collection.json"] == roads_before
