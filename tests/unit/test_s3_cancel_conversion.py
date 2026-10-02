"""Cancelling a conversion: CANCELLING until it stops, then (deprovisioned) CANCELLED."""

from unittest.mock import patch

import httpx
import pytest
from rest_framework.test import APIClient

from apps.s3.cng_lite import (
    CNGProcessingClient,
    cancel_job,
    finish_job,
    resume_interrupted_conversions,
    update_job,
)
from apps.s3.models import CngLiteJob, CngLiteJobStatus, JobCancelled
from tests.unit.test_s3_cng_processing_client import run

Status = CngLiteJobStatus


@pytest.fixture
def job(settings, tmp_path, django_user_model):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_ON_DEMAND = False
    owner = django_user_model.objects.create_user(username="7")

    def make(**fields):
        return CngLiteJob.objects.create(
            **{
                "kind": "pmtiles",
                "owner": owner,
                "bucket": "bucket",
                "source_name": "roads.zip",
                "source_key": "folder/sources/job/roads.zip",
                "output_key": "folder/roads.pmtiles",
                "input_size": 1,
                "cloudnativegis_url": "http://cloudnativegis",
                "cng_job_id": "cng-job-1",
                **fields,
            }
        )

    return make


@pytest.mark.django_db
@pytest.mark.parametrize("status", [Status.PENDING, Status.PROVISIONING, Status.POLLING])
def test_cancelling_a_running_one(job, status):
    running = job(status=status, layers=["roads"])
    cancel_job(running)
    assert running.status == Status.CANCELLING
    assert running.message == "Cancelling the conversion"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "status",
    [Status.PUBLISHING, Status.DEPROVISIONING, Status.CANCELLING, Status.COMPLETED, Status.FAILED],
)
def test_too_late_to_cancel(job, status):
    finishing = job(status=status)
    with pytest.raises(ValueError, match="can't be cancelled"):
        cancel_job(finishing)
    finishing.refresh_from_db()
    assert finishing.status == status


@pytest.mark.django_db
def test_a_geopackage_waiting_for_its_layers_isnt_cancelled_here(job):
    # Nothing runs it yet: cancel_geopackage_inspection discards it instead.
    waiting = job(status=Status.PENDING, source_name="roads.gpkg", layers=None)
    with pytest.raises(ValueError):
        cancel_job(waiting)


@pytest.mark.django_db
def test_the_jobs_waiting_on_it_are_cancelled_too(job):
    vector = job(status=Status.POLLING)
    raster = job(kind="cog", status=Status.PENDING, depends_on=vector, layers=["dem"])
    cancel_job(vector)
    raster.refresh_from_db()
    assert raster.status == Status.CANCELLING


@pytest.mark.django_db
def test_updates_stop_a_cancelled_job(job):
    cancelling = job(status=Status.CANCELLING, message="Cancelling the conversion")
    with pytest.raises(JobCancelled):
        update_job(cancelling.id, status=Status.DOWNLOADING, message="Downloading")
    cancelling.refresh_from_db()
    assert (cancelling.status, cancelling.message) == (
        Status.CANCELLING,
        "Cancelling the conversion",
    )


@pytest.mark.django_db
def test_failing_while_cancelling_ends_cancelled(job):
    cancelling = job(status=Status.CANCELLING)
    finish_job(cancelling, Status.FAILED, message="failed", error="boom")
    cancelling.refresh_from_db()
    assert cancelling.status == Status.CANCELLED
    assert cancelling.error == ""
    assert cancelling.completed_at is not None


@pytest.mark.django_db
def test_a_job_cancelled_before_it_ran_just_ends(job):
    cancelling = job(status=Status.CANCELLING)
    requests, _, _ = run(cancelling, lambda _request: httpx.Response(500))
    assert requests == []
    assert cancelling.status == Status.CANCELLED
    assert cancelling.message == "Conversion cancelled"


@pytest.mark.django_db
def test_polling_stops_once_cancelled(job):
    polling = job(status=Status.POLLING)

    def cng_lite(request):
        # Cancelled while CloudNativeGIS is still at it.
        CngLiteJob.objects.filter(pk=polling.pk).update(status=Status.CANCELLING)
        return httpx.Response(200, json={"status": "processing"})

    requests, s3_client, _ = run(polling, cng_lite)

    assert requests == [("GET", "/api/v1/jobs/cng-job-1")]
    assert polling.status == Status.CANCELLED
    s3_client.client.upload_fileobj.assert_not_called()


@pytest.mark.django_db
def test_on_demand_its_server_is_deleted(job, settings):
    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    cancelling = job(status=Status.CANCELLING)
    seen = []

    def deprovision():
        seen.append(CngLiteJob.objects.get(pk=cancelling.pk).status)

    with (
        patch.object(CngLiteJob, "deprovision", autospec=True, side_effect=lambda _: deprovision()),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        CNGProcessingClient(cancelling).run()

    assert seen == [Status.DEPROVISIONING]
    cancelling.refresh_from_db()
    assert cancelling.status == Status.CANCELLED


@pytest.mark.django_db
def test_a_restart_finishes_cancelling(job):
    cancelling = job(status=Status.CANCELLING)
    assert resume_interrupted_conversions() == 1
    cancelling.refresh_from_db()
    assert cancelling.status == Status.CANCELLED


# -- DELETE /api/s3/conversion/jobs/<id> ------------------------------------------


def delete(user, job_id):
    api = APIClient()
    api.force_authenticate(user=user)
    return api.delete(f"/api/s3/conversion/jobs/{job_id}")


@pytest.mark.django_db
def test_delete_cancels_it(job):
    polling = job(status=Status.POLLING)
    response = delete(polling.owner, polling.id)
    assert response.status_code == 202
    assert response.json()["status"] == "cancelling"


@pytest.mark.django_db
def test_delete_too_late(job):
    publishing = job(status=Status.PUBLISHING)
    response = delete(publishing.owner, publishing.id)
    assert response.status_code == 409
    assert "can't be cancelled" in response.json()["error"]


@pytest.mark.django_db
def test_delete_someone_elses_job(job, django_user_model):
    polling = job(status=Status.POLLING)
    other = django_user_model.objects.create_user(username="8")
    assert delete(other, polling.id).status_code == 404
    assert delete(polling.owner, "not-a-uuid").status_code == 404
