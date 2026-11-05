"""apps.s3.bulk_servers: the on-demand servers a bulk upload's batch uses."""

import uuid
from unittest.mock import patch

import pytest

from apps.core.geohosting import GeoHostingClient
from apps.s3 import bulk_servers
from apps.s3.models import CngLiteBatch, CngLiteJob, CngLiteServer, S3Connection

pytestmark = pytest.mark.django_db


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


def make_batch(owner, connection, **fields):
    fields.setdefault("hetzner_server_id", 1)
    fields.setdefault("source_prefix", "incoming/")
    return CngLiteBatch.objects.create(owner=owner, connection=connection, **fields)


def running_answer(instance_id, type_id=1, status="ready"):
    """What GeoHosting's list_servers answers about a server it's running."""
    return {
        "server_id": str(instance_id),
        "status": status,
        "url": "http://10.0.0.5:8000",
        "token": "tok",
        "created": "2026-01-01T00:00:00Z",
        "server": {"id": type_id, "location": "fsn1", "specifications": {}, "label": "fsn1"},
    }


def test_reuses_a_kept_running_server_of_the_same_type(owner, connection):
    kept = CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=owner,
        status=CngLiteServer.Status.READY,
        type_id=1,
        auto_destroy=False,
    )
    batch = make_batch(owner, connection, auto_destroy=True)

    with patch.object(
        GeoHostingClient, "list_servers", return_value=[running_answer(kept.instance_id)]
    ):
        bulk_servers.start_missing(batch, 1)

    kept.refresh_from_db()
    assert kept.batch_id == batch.id
    # This batch's choice (destroy) takes over, not the one it was kept with.
    assert kept.auto_destroy is True
    assert batch.servers.count() == 1


def test_wont_reuse_a_different_server_type(owner, connection):
    other_type = CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=owner,
        status=CngLiteServer.Status.READY,
        type_id=2,
        auto_destroy=False,
    )
    batch = make_batch(owner, connection, hetzner_server_id=1)

    with (
        patch.object(
            GeoHostingClient,
            "list_servers",
            return_value=[running_answer(other_type.instance_id, type_id=2)],
        ),
        patch.object(bulk_servers, "_start") as start,
    ):
        bulk_servers.start_missing(batch, 1)

    start.assert_called_once_with(batch)
    other_type.refresh_from_db()
    assert other_type.batch_id is None


def test_wont_reuse_a_server_another_active_job_is_using(owner, connection):
    kept = CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=owner,
        status=CngLiteServer.Status.READY,
        type_id=1,
        auto_destroy=False,
    )
    CngLiteJob.objects.create(
        kind="cog",
        owner=owner,
        connection=connection,
        bucket="bucket",
        source_name="a.tif",
        output_key="a.tif",
        input_size=1,
        status="pushing",
        instance_server=kept,
    )
    batch = make_batch(owner, connection, hetzner_server_id=1)

    with (
        patch.object(
            GeoHostingClient, "list_servers", return_value=[running_answer(kept.instance_id)]
        ),
        patch.object(bulk_servers, "_start") as start,
    ):
        bulk_servers.start_missing(batch, 1)

    start.assert_called_once_with(batch)
    kept.refresh_from_db()
    assert kept.batch_id is None


def test_doesnt_ask_geohosting_when_nothing_is_needed(owner, connection):
    batch = make_batch(owner, connection)
    CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=owner,
        batch=batch,
        status=CngLiteServer.Status.READY,
        type_id=1,
    )

    with patch.object(GeoHostingClient, "list_servers") as list_servers:
        bulk_servers.start_missing(batch, 1)

    list_servers.assert_not_called()


def test_an_idle_server_of_another_active_batch_isnt_taken_either(owner, connection):
    # Nothing is running on it right now (between two of that batch's
    # layers), but it's still that batch's to give its own next one.
    other_batch = make_batch(owner, connection, hetzner_server_id=1)
    kept = CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=owner,
        batch=other_batch,
        status=CngLiteServer.Status.READY,
        type_id=1,
        auto_destroy=False,
    )
    batch = make_batch(owner, connection, hetzner_server_id=1)

    with (
        patch.object(
            GeoHostingClient, "list_servers", return_value=[running_answer(kept.instance_id)]
        ),
        patch.object(bulk_servers, "_start") as start,
    ):
        bulk_servers.start_missing(batch, 1)

    start.assert_called_once_with(batch)
    kept.refresh_from_db()
    assert kept.batch_id == other_batch.id


def test_a_kept_server_of_a_finished_batch_is_reused(owner, connection):
    finished_batch = make_batch(owner, connection, hetzner_server_id=1, status="completed")
    kept = CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=owner,
        batch=finished_batch,
        status=CngLiteServer.Status.READY,
        type_id=1,
        auto_destroy=False,
    )
    batch = make_batch(owner, connection, hetzner_server_id=1, auto_destroy=True)

    with patch.object(
        GeoHostingClient, "list_servers", return_value=[running_answer(kept.instance_id)]
    ):
        bulk_servers.start_missing(batch, 1)

    kept.refresh_from_db()
    assert (kept.batch_id, kept.auto_destroy) == (batch.id, True)
