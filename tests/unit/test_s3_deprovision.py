"""DEPROVISIONING: a finished job's on-demand server deleted before it ends."""

from unittest.mock import patch

import httpx
import pytest
from cryptography.fernet import Fernet

from apps.core.geohosting import GeoHostingClient, GeoHostingError
from apps.s3.cng_lite import CNGProcessingClient, finish_job, resume_interrupted_conversions
from apps.s3.models import CngLiteJob, CngLiteJobStatus

SERVERS = "http://geohosting/api/v1/cloudnative-gis-processing/servers/"


@pytest.fixture
def on_demand(settings):
    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    settings.GEOHOSTING_URL = "http://geohosting"
    settings.GEOHOSTING_CLIENT_ID = "cloudbench"
    settings.GEOHOSTING_CLIENT_SECRET = "secret"
    GeoHostingClient.clear_token_cache()
    yield
    GeoHostingClient.clear_token_cache()


@pytest.fixture
def job(settings, tmp_path, django_user_model):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDBENCH_ENCRYPTION_KEY = Fernet.generate_key().decode()
    return CngLiteJob.objects.create(
        owner=django_user_model.objects.create(username="tim"),
        bucket="bucket",
        source_name="roads.zip",
        output_key="roads.pmtiles",
        input_size=1,
        status=CngLiteJobStatus.DEPROVISIONING,
        outcome=CngLiteJobStatus.COMPLETED,
        cloudnativegis_url="http://10.0.0.5:8000",
        cloudnativegis_api_token="server-token",
    )


def server(job, status):
    return {"job_id": str(job.id), "status": status, "url": "", "token": ""}


def deprovision(job, *answers):
    """Run job.deprovision with GeoHosting answering `answers` in turn; returns its requests."""
    with (
        patch(
            "apps.core.geohosting.httpx.post",
            return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 300}),
        ),
        patch("apps.core.geohosting.httpx.request", side_effect=list(answers)) as request,
        patch("apps.s3.models.cng_lite_job.time.sleep"),
    ):
        job.deprovision()
    job.refresh_from_db()
    return [(call.args[0], call.args[1]) for call in request.call_args_list]


@pytest.mark.django_db
def test_deletes_the_server_and_waits_until_its_gone(on_demand, job):
    requests = deprovision(
        job,
        httpx.Response(202, json=server(job, "deleting")),
        httpx.Response(200, json=server(job, "deleting")),
        httpx.Response(200, json=server(job, "deleted")),
    )

    assert requests == [
        ("DELETE", f"{SERVERS}{job.id}/"),
        ("GET", f"{SERVERS}{job.id}/"),
        ("GET", f"{SERVERS}{job.id}/"),
    ]
    assert job.cloudnativegis_api_token == ""
    # The request, and the poll that said it's gone - not the one in between.
    assert [(log.method, log.status_code) for log in job.logs.all()] == [
        ("DELETE", 202),
        ("GET", 200),
    ]
    assert {log.step for log in job.logs.all()} == {"deprovisioning"}


@pytest.mark.django_db
def test_nothing_to_wait_for_without_a_server(on_demand, job):
    requests = deprovision(job, httpx.Response(204))
    assert [method for method, _ in requests] == ["DELETE"]


@pytest.mark.django_db
def test_a_server_gone_meanwhile_is_deleted(on_demand, job):
    requests = deprovision(
        job,
        httpx.Response(202, json=server(job, "deleting")),
        httpx.Response(404, json={"detail": "No server for that job."}),
    )
    assert [method for method, _ in requests] == ["DELETE", "GET"]


@pytest.mark.django_db
def test_no_server_to_delete_without_on_demand(job):
    with patch("apps.core.geohosting.httpx.request") as request:
        job.deprovision()
    request.assert_not_called()


@pytest.mark.django_db
def test_finish_deprovisions_then_ends_as_its_outcome(on_demand, job):
    seen = []

    def deprovision():
        saved = CngLiteJob.objects.get(pk=job.pk)
        seen.append((saved.status, saved.outcome, saved.message, saved.completed_at))

    with patch.object(job, "deprovision", side_effect=deprovision):
        finish_job(job, CngLiteJobStatus.FAILED, message="Conversion failed", error="boom")

    # Its outcome is saved first, so a restart can carry on deprovisioning.
    assert seen == [(CngLiteJobStatus.DEPROVISIONING, "failed", "Conversion failed", None)]
    job.refresh_from_db()
    assert job.status == CngLiteJobStatus.FAILED
    assert job.error == "boom"
    assert job.completed_at is not None


@pytest.mark.django_db
def test_a_server_that_cant_be_deleted_doesnt_change_the_outcome(on_demand, job):
    with patch.object(job, "deprovision", side_effect=GeoHostingError("down", status_code=502)):
        finish_job(job, CngLiteJobStatus.COMPLETED, progress=100)
    job.refresh_from_db()
    assert job.status == CngLiteJobStatus.COMPLETED
    assert job.progress == 100


@pytest.mark.django_db
def test_without_on_demand_it_ends_straight_away(job):
    with patch.object(job, "deprovision") as deprovision:
        finish_job(job, CngLiteJobStatus.COMPLETED, progress=100)
    deprovision.assert_not_called()
    job.refresh_from_db()
    assert job.status == CngLiteJobStatus.COMPLETED


@pytest.mark.django_db
def test_run_carries_on_deprovisioning(on_demand, job):
    with (
        patch.object(CngLiteJob, "deprovision") as deprovision,
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        CNGProcessingClient(job).run()
    deprovision.assert_called_once()
    job.refresh_from_db()
    assert job.status == CngLiteJobStatus.COMPLETED


@pytest.mark.django_db
def test_a_restart_carries_on_deprovisioning_even_a_mosaic(on_demand, job):
    # A mosaic can't be resumed, but its server can still be deleted.
    CngLiteJob.objects.filter(pk=job.pk).update(kind="mosaic")
    with patch.object(CngLiteJob, "deprovision") as deprovision:
        assert resume_interrupted_conversions() == 1
    deprovision.assert_called_once()
    job.refresh_from_db()
    assert job.status == CngLiteJobStatus.COMPLETED
    assert job.error == ""
