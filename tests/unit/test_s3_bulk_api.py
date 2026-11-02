"""The bulk upload API (apps.s3.bulk_views)."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.s3 import bulk
from apps.s3.models import CngLiteBatch, CngLiteJob, CngLiteJobStatus, S3Connection
from tests.unit.fake_s3 import FakeS3

URL = "/api/s3/bulk"


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


@pytest.fixture
def api(owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    return client


@pytest.fixture
def s3(settings, connection):
    """A bucket with a folder of layers; no threads, so nothing runs by itself."""
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.CLOUDNATIVEGIS_BULK_MAX_CONCURRENCY = 3
    bucket = FakeS3()
    for name in ("a.zip", "b.tif", "c.laz", "notes.txt"):
        bucket.objects[f"incoming/{name}"] = b"x" * 10
    with (
        patch("apps.s3.bulk.get_s3_client", return_value=bucket),
        patch("apps.s3.cng_lite.get_s3_client", return_value=bucket),
        patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Mock())),
    ):
        yield bucket


def body(**overrides):
    return {
        "prefix": "incoming/",
        "files": ["incoming/a.zip", "incoming/b.tif"],
        "concurrency": 2,
        "license": "CC-BY-4.0",
        **overrides,
    }


def start(api, connection, **overrides):
    return api.post(f"{URL}/start/{connection.id}", body(**overrides), format="json")


@pytest.mark.django_db
def test_folders_are_the_ones_bulk_upload_can_convert(api, connection, s3):
    s3.objects["roads/roads.parquet"] = b"x"
    s3.objects["catalog.json"] = b'{"links": [{"rel": "child", "href": "./roads/collection.json"}]}'
    s3.objects["sources/11111111-2222-3333-4444-555555555555/a.zip"] = b"x"

    response = api.get(f"{URL}/folders/{connection.id}")

    assert response.status_code == 200
    assert response.json() == {"folders": [{"prefix": "incoming/", "name": "incoming"}]}
    assert api.get(f"{URL}/folders/{connection.id}?prefix=incoming/").json() == {"folders": []}


@pytest.mark.django_db
def test_folders_of_a_connection_that_is_not_the_users_are_not_found(api, s3, django_user_model):
    other = django_user_model.objects.create(username="8")
    foreign = S3Connection.objects.create(
        owner=other, name="Theirs", endpoint="minio:9000", bucket="bucket"
    )

    assert api.get(f"{URL}/folders/{foreign.id}").status_code == 404


@pytest.mark.django_db
def test_preview_lists_the_folder(api, connection, s3):
    response = api.post(f"{URL}/preview/{connection.id}", {"prefix": "incoming/"}, format="json")

    assert response.status_code == 200
    files = {f["name"]: f for f in response.json()["files"]}
    assert files["a.zip"]["kind"] == "pmtiles"
    assert files["notes.txt"]["skipReason"] == bulk.UNSUPPORTED_REASON
    assert response.json()["limits"] == {"maxConcurrency": 3, "onDemand": False}


@pytest.mark.django_db
def test_preview_takes_a_destination_folder(api, connection, s3):
    response = api.post(
        f"{URL}/preview/{connection.id}",
        {"prefix": "incoming/", "destination": "folder", "destinationPrefix": "published"},
        format="json",
    )

    files = {f["name"]: f for f in response.json()["files"]}
    assert files["a.zip"]["target"] == "published/a"


@pytest.mark.django_db
def test_layers_can_be_published_at_the_top_level(api, connection, s3):
    preview = api.post(
        f"{URL}/preview/{connection.id}",
        {"prefix": "incoming/", "destination": "root"},
        format="json",
    )
    started = start(api, connection, destination="root")

    assert {f["name"]: f["target"] for f in preview.json()["files"] if f["kind"]} == {
        "a.zip": "a",
        "b.tif": "b",
        "c.laz": "c",
    }
    assert started.status_code == 202
    assert {j.output_key for j in CngLiteJob.objects.all()} == {"a.pmtiles", "b.tif"}


@pytest.mark.django_db
@pytest.mark.parametrize(
    "destination, error",
    [({"destination": "somewhere"}, "top level"), ({"destination": "folder"}, "Name the folder")],
)
def test_a_bad_destination_is_a_400(api, connection, s3, destination, error):
    for response in (
        api.post(
            f"{URL}/preview/{connection.id}", {"prefix": "incoming/", **destination}, format="json"
        ),
        start(api, connection, **destination),
    ):
        assert response.status_code == 400
        assert error in response.json()["error"]
    assert not CngLiteBatch.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload, error",
    [({"prefix": ""}, "Pick a folder"), ({}, "Pick a folder")],
)
def test_preview_refuses_the_whole_bucket(api, connection, s3, payload, error):
    response = api.post(f"{URL}/preview/{connection.id}", payload, format="json")

    assert response.status_code == 400
    assert error in response.json()["error"]


@pytest.mark.django_db
def test_connections_are_the_users_own(api, connection, s3, django_user_model):
    other = django_user_model.objects.create(username="8")
    foreign = S3Connection.objects.create(
        owner=other, name="Theirs", endpoint="minio:9000", bucket="bucket"
    )

    for url, payload in (
        (f"{URL}/preview/{foreign.id}", {"prefix": "incoming/"}),
        (f"{URL}/start/{foreign.id}", body()),
        (f"{URL}/preview/not-a-uuid", {"prefix": "incoming/"}),
    ):
        assert api.post(url, payload, format="json").status_code == 404
    assert not CngLiteBatch.objects.exists()


@pytest.mark.django_db
def test_start_answers_202_with_the_batch(api, connection, s3):
    response = start(api, connection, destination="folder", destinationPrefix="published")

    assert response.status_code == 202
    data = response.json()
    assert (data["status"], data["concurrency"], data["prefix"]) == ("running", 2, "incoming/")
    assert data["connectionId"] == str(connection.id)
    assert {(j["name"], j["kind"], j["status"]) for j in data["jobs"]} == {
        ("a.zip", "pmtiles", "queued"),
        ("b.tif", "cog", "queued"),
    }
    batch = CngLiteBatch.objects.get()
    assert (batch.license, batch.destination_prefix) == ("CC-BY-4.0", "published/")


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides, error",
    [
        ({"files": "a.zip"}, "list"),
        ({"files": [1, 2]}, "list"),
        ({"concurrency": "many"}, "number"),
        ({"concurrency": None}, "number"),
        ({"concurrency": 9}, "between 1 and 3"),
        ({"files": []}, "at least one layer"),
        ({"files": ["incoming/notes.txt"]}, "can't be converted"),
        ({"onExists": "overwrite"}, "skip, replace or stop"),
    ],
)
def test_start_refuses_what_cant_run(api, connection, s3, overrides, error):
    response = start(api, connection, **overrides)

    assert response.status_code == 400
    assert error in response.json()["error"]
    assert not CngLiteBatch.objects.exists()


@pytest.mark.django_db
def test_a_second_bulk_upload_waits_for_the_first(api, connection, s3):
    assert start(api, connection).status_code == 202

    response = start(api, connection, files=["incoming/c.laz"])

    assert response.status_code == 400
    assert "already running" in response.json()["error"]


@pytest.mark.django_db
def test_detail_shows_progress_and_is_the_users_own(api, connection, s3, django_user_model):
    batch_id = start(api, connection).json()["id"]
    CngLiteJob.objects.filter(source_name="a.zip").update(
        status=CngLiteJobStatus.POLLING, progress=40, message="Converting"
    )

    data = api.get(f"{URL}/{batch_id}").json()

    jobs = {job["name"]: job for job in data["jobs"]}
    assert (jobs["a.zip"]["status"], jobs["a.zip"]["progress"]) == ("running", 40)
    assert jobs["b.tif"]["status"] == "queued"

    other = APIClient()
    other.force_authenticate(user=django_user_model.objects.create(username="8"))
    assert other.get(f"{URL}/{batch_id}").status_code == 404
    assert other.delete(f"{URL}/{batch_id}").status_code == 404
    assert other.post(f"{URL}/{batch_id}/retry").status_code == 404
    assert api.get(f"{URL}/not-a-uuid").status_code == 404


@pytest.mark.django_db
def test_list_has_running_and_recent_batches_only(api, connection, owner, s3):
    running = start(api, connection).json()["id"]
    recent = CngLiteBatch.objects.create(
        owner=owner,
        connection=connection,
        source_prefix="old/",
        status="completed",
        completed_at=timezone.now() - timedelta(hours=2),
    )
    CngLiteBatch.objects.create(
        owner=owner,
        connection=connection,
        source_prefix="older/",
        status="completed",
        completed_at=timezone.now() - timedelta(days=3),
    )

    ids = [batch["id"] for batch in api.get(URL).json()]

    assert set(ids) == {running, str(recent.id)}


@pytest.mark.django_db
def test_cancel(api, connection, s3):
    batch_id = start(api, connection).json()["id"]

    response = api.delete(f"{URL}/{batch_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert {job["status"] for job in response.json()["jobs"]} == {"cancelled"}
    # Over: nothing to cancel any more.
    assert api.delete(f"{URL}/{batch_id}").status_code == 409


@pytest.mark.django_db
def test_retry(api, connection, s3):
    batch_id = start(api, connection).json()["id"]
    assert api.post(f"{URL}/{batch_id}/retry").status_code == 409  # still running

    bulk.step_batch(batch_id)
    CngLiteJob.objects.filter(source_name="a.zip").update(status=CngLiteJobStatus.FAILED)
    CngLiteJob.objects.filter(source_name="b.tif").update(status=CngLiteJobStatus.COMPLETED)
    bulk.step_batch(batch_id)
    assert api.get(f"{URL}/{batch_id}").json()["status"] == "partial"

    response = api.post(f"{URL}/{batch_id}/retry")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "running"
    assert {j["name"]: j["status"] for j in data["jobs"]} == {
        "a.zip": "queued",
        "b.tif": "completed",
    }


@pytest.mark.django_db
def test_a_bulk_uploads_layers_are_not_listed_as_jobs(api, connection, s3):
    start(api, connection)
    bulk.step_batch(CngLiteBatch.objects.get().pk)  # both running now

    assert CngLiteJob.objects.filter(status=CngLiteJobStatus.PENDING).count() == 2
    assert api.get("/api/s3/conversion/jobs").json() == []
