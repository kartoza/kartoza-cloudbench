"""CngLiteJob.provision with CLOUDNATIVEGIS_ON_DEMAND: a server from GeoHosting."""

from unittest.mock import patch

import httpx
import pytest
from cryptography.fernet import Fernet

from apps.core.geohosting import GeoHostingClient
from apps.s3.models import CngLiteJob, CngLiteJobStatus

SERVERS = "http://geohosting/api/v1/cloudnative-gis-processing/servers/"


@pytest.fixture
def job(settings, django_user_model):
    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    settings.GEOHOSTING_URL = "http://geohosting"
    settings.GEOHOSTING_CLIENT_ID = "cloudbench"
    settings.GEOHOSTING_CLIENT_SECRET = "secret"
    settings.CLOUDBENCH_ENCRYPTION_KEY = Fernet.generate_key().decode()
    GeoHostingClient.clear_token_cache()
    yield CngLiteJob.objects.create(
        owner=django_user_model.objects.create(username="tim"),
        bucket="bucket",
        source_name="roads.zip",
        output_key="roads.pmtiles",
        input_size=1,
        status=CngLiteJobStatus.PROVISIONING,
        hetzner_server_id=7,
    )
    GeoHostingClient.clear_token_cache()


def server(job, status, **fields):
    return {"job_id": str(job.id), "status": status, "url": "", "token": "", **fields}


READY = {"url": "http://10.0.0.5:8000", "token": "server-token"}


def provision(job, *answers):
    """Run job.provision with GeoHosting answering `answers` in turn; returns its requests."""
    with (
        patch(
            "apps.core.geohosting.httpx.post",
            return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 300}),
        ),
        patch("apps.core.geohosting.httpx.request", side_effect=list(answers)) as request,
        # The server's own /health, once GeoHosting says it's ready.
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.models.cng_lite_job.time.sleep"),
    ):
        try:
            job.provision()
        finally:
            job.refresh_from_db()
    return [(call.args[0], call.args[1]) for call in request.call_args_list]


def logged(job):
    return [
        (log.method, log.status_code, (log.response_payload or {}).get("status"))
        for log in job.logs.all()
    ]


@pytest.mark.django_db
def test_asks_geohosting_and_waits_until_its_ready(job):
    requests = provision(
        job,
        httpx.Response(202, json=server(job, "provisioning")),
        httpx.Response(200, json=server(job, "provisioning")),
        httpx.Response(200, json=server(job, "ready", **READY)),
    )

    assert requests == [
        ("POST", SERVERS),
        ("GET", f"{SERVERS}{job.id}/"),
        ("GET", f"{SERVERS}{job.id}/"),
    ]
    assert job.cloudnativegis_url == "http://10.0.0.5:8000"
    assert job.cloudnativegis_api_token == "server-token"
    # The request, and the poll that said it's ready - not the one in between.
    assert logged(job) == [("POST", 202, "provisioning"), ("GET", 200, "ready")]
    ready = job.logs.last()
    assert ready.target == "geohosting"
    assert ready.step == "provisioning"
    assert ready.response_payload["token"] == "***"


@pytest.mark.django_db
def test_posts_the_jobs_owner_and_its_server_type(job):
    with (
        patch.object(
            GeoHostingClient, "create_server", return_value=server(job, "ready", **READY)
        ) as create,
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
    ):
        job.provision()
    assert create.call_args.args == (job.id, "tim")
    assert create.call_args.kwargs["hetzner_server_id"] == 7


@pytest.mark.django_db
def test_needs_a_server_type_picked(job):
    job.hetzner_server_id = None
    with (
        patch.object(GeoHostingClient, "create_server") as create,
        pytest.raises(ValueError, match="No server was picked"),
    ):
        job.provision()
    create.assert_not_called()


@pytest.mark.django_db
def test_keeps_its_server_types_specification(job):
    specification = {"cores": 2, "memory": 4.0, "disk": 40}
    picked = {"id": 7, "type": "cx23", "location": "fsn1", "specifications": specification}
    provision(
        job,
        httpx.Response(202, json={**server(job, "provisioning"), "server": picked}),
        httpx.Response(200, json={**server(job, "ready", **READY), "server": picked}),
    )
    assert job.hetzner_server_specification == specification


@pytest.mark.django_db
def test_a_server_type_geohosting_hasnt_enabled(job):
    with pytest.raises(ValueError, match="isn't enabled") as raised:
        provision(job, httpx.Response(400, json={"detail": "Server type 7 isn't enabled."}))
    assert "isn't linked" not in str(raised.value)


@pytest.mark.django_db
def test_a_server_that_failed_to_start_fails_the_job(job):
    with pytest.raises(ValueError, match="couldn't start a CloudNativeGIS server: no stock"):
        provision(
            job,
            httpx.Response(202, json=server(job, "provisioning")),
            httpx.Response(200, json=server(job, "failed", error="no stock")),
        )
    assert job.cloudnativegis_url == ""
    assert logged(job) == [("POST", 202, "provisioning"), ("GET", 200, "failed")]


@pytest.mark.django_db
def test_an_owner_geohosting_doesnt_know(job):
    with pytest.raises(ValueError, match="isn't linked to GeoHosting"):
        provision(job, httpx.Response(400, json={"detail": "No GeoHosting user 'tim'."}))


@pytest.mark.django_db
def test_waits_out_a_server_still_being_deleted(job):
    requests = provision(
        job,
        httpx.Response(409, json={"detail": "That job's server is still being deleted."}),
        httpx.Response(202, json=server(job, "ready", **READY)),
    )
    assert [method for method, _ in requests] == ["POST", "POST"]
    assert job.cloudnativegis_url == "http://10.0.0.5:8000"


@pytest.mark.django_db
def test_another_users_job_fails_it(job):
    with pytest.raises(ValueError, match="belongs to another user"):
        provision(
            job,
            httpx.Response(409, json={"detail": "That job's server belongs to another user."}),
        )


@pytest.mark.django_db
def test_asks_again_for_a_server_gone_meanwhile(job):
    requests = provision(
        job,
        httpx.Response(202, json=server(job, "provisioning")),
        httpx.Response(404, json={"detail": "No server for that job."}),
        httpx.Response(202, json=server(job, "ready", **READY)),
    )
    assert [method for method, _ in requests] == ["POST", "GET", "POST"]
    assert job.cloudnativegis_api_token == "server-token"


@pytest.mark.django_db
def test_waits_for_as_long_as_geohosting_is_starting_it(job):
    # No deadline of its own: GeoHosting says when starting it has failed.
    still_starting = [httpx.Response(200, json=server(job, "provisioning"))] * 50
    requests = provision(
        job,
        httpx.Response(202, json=server(job, "provisioning")),
        *still_starting,
        httpx.Response(200, json=server(job, "ready", **READY)),
    )
    assert len(requests) == 52
    assert job.cloudnativegis_url == "http://10.0.0.5:8000"
    assert logged(job) == [("POST", 202, "provisioning"), ("GET", 200, "ready")]
