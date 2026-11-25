"""Giving up on a GeoPackage left awaiting layer selection too long."""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.s3.cng_lite import (
    _finish_idle_inspection_in_background,
    cancel_inspection,
    expire_stalled_inspection,
)
from apps.s3.models import CngLiteJob, CngLiteJobStatus, CngLiteServer, S3Connection


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


@pytest.fixture
def awaiting(settings, tmp_path, owner):
    """A GeoPackage job inspected and sitting idle, waiting for layers to be picked."""
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_LAYER_SELECTION_TIMEOUT = 60
    connection = S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )
    return CngLiteJob.objects.create(
        kind="pmtiles",
        owner=owner,
        connection=connection,
        bucket="bucket",
        source_name="parcels.gpkg",
        source_key="folder/sources/job/parcels.gpkg",
        output_key="folder/parcels.pmtiles",
        input_size=1,
        inspection={"layers": [{"name": "parcels"}], "rasterTables": []},
        message="Waiting for layer selection",
    )


def age(job, **fields):
    CngLiteJob.objects.filter(pk=job.pk).update(
        updated_at=timezone.now() - timedelta(hours=1), **fields
    )
    job.refresh_from_db()


@pytest.mark.django_db
def test_a_fresh_inspection_isnt_expired(awaiting):
    expire_stalled_inspection(awaiting)
    awaiting.refresh_from_db()
    assert awaiting.status == CngLiteJobStatus.PENDING


@pytest.mark.django_db
def test_a_stale_inspection_is_cancelled(settings, awaiting):
    age(awaiting)

    expire_stalled_inspection(awaiting)

    awaiting.refresh_from_db()
    assert awaiting.status == CngLiteJobStatus.CANCELLED
    assert awaiting.message == "Gave up waiting for layers to be picked"
    assert awaiting.completed_at is not None


@pytest.mark.django_db
def test_a_stale_inspection_with_a_server_deletes_it_in_the_background(settings, awaiting):
    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    server = CngLiteServer.objects.create(
        instance_id="11111111-2222-3333-4444-555555555555",
        owner=awaiting.owner,
        status="ready",
        api_token="server-token",
    )
    age(awaiting, instance_server=server, hetzner_server_id=72)

    with patch("apps.s3.cng_lite.threading.Thread") as thread:
        expire_stalled_inspection(awaiting)
    thread.assert_called_once_with(
        target=_finish_idle_inspection_in_background,
        args=(awaiting.id, CngLiteJobStatus.CANCELLED, "Gave up waiting for layers to be picked"),
        daemon=True,
    )

    with (
        patch.object(CngLiteJob, "deprovision") as deprovision,
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        _finish_idle_inspection_in_background(
            awaiting.id, CngLiteJobStatus.CANCELLED, "Gave up waiting for layers to be picked"
        )
    deprovision.assert_called_once()
    awaiting.refresh_from_db()
    assert awaiting.status == CngLiteJobStatus.CANCELLED


@pytest.mark.django_db
def test_a_stale_inspection_is_expired_by_one_request_only(settings, awaiting):
    age(awaiting)
    stale_copy = CngLiteJob.objects.get(pk=awaiting.pk)

    expire_stalled_inspection(awaiting)
    expire_stalled_inspection(stale_copy)

    awaiting.refresh_from_db()
    assert awaiting.status == CngLiteJobStatus.CANCELLED
    assert awaiting.message == "Gave up waiting for layers to be picked"


@pytest.mark.django_db
def test_cancelling_while_awaiting_selection_still_works(awaiting, owner):
    cancel_inspection(awaiting)
    awaiting.refresh_from_db()
    assert awaiting.status == CngLiteJobStatus.CANCELLED
    assert awaiting.message == "Conversion cancelled"


@pytest.mark.django_db
def test_cancelling_while_inspecting_defers_to_cancel_job(awaiting):
    CngLiteJob.objects.filter(pk=awaiting.pk).update(status=CngLiteJobStatus.INSPECTING)
    awaiting.refresh_from_db()

    cancel_inspection(awaiting)

    awaiting.refresh_from_db()
    # Nothing is actually running in this unit test to carry CANCELLING on
    # to CANCELLED (see cng_lite.cancel_job) - the transition itself is
    # what's being checked here.
    assert awaiting.status == CngLiteJobStatus.CANCELLING
