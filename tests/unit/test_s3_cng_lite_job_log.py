"""CngLiteJobLog: a conversion job's requests, with sensitive values redacted."""

from unittest.mock import patch

import pytest

from apps.s3.models import CngLiteJob, CngLiteJobLog, CngLiteJobStatus
from apps.s3.models.cng_lite_job_log import redact


@pytest.fixture
def job(django_user_model):
    return CngLiteJob.objects.create(
        owner=django_user_model.objects.create(username="7"),
        bucket="bucket",
        source_name="roads.zip",
        output_key="roads.pmtiles",
        input_size=1,
        status=CngLiteJobStatus.PROVISIONING,
    )


@pytest.mark.django_db
def test_records_a_request_at_the_jobs_step(job):
    log = CngLiteJobLog.record(
        job,
        target=CngLiteJobLog.Target.GEOHOSTING,
        method="post",
        url="https://geohosting/api/v1/cloudnative-gis-processing/servers/",
        request_payload={"job_id": str(job.id), "username": "7"},
        status_code=202,
        response_payload={"status": "provisioning", "token": ""},
        duration_ms=12.6,
    )

    log.refresh_from_db()
    assert log.job == job
    assert log.step == "provisioning"
    assert log.target == "geohosting"
    assert log.method == "POST"
    assert log.url == "https://geohosting/api/v1/cloudnative-gis-processing/servers/"
    assert log.request_payload == {"job_id": str(job.id), "username": "7"}
    assert log.status_code == 202
    assert log.response_payload == {"status": "provisioning", "token": "***"}
    assert log.duration_ms == 13
    assert list(job.logs.all()) == [log]


@pytest.mark.django_db
def test_records_a_request_that_got_no_answer(job):
    log = CngLiteJobLog.record(
        job,
        target=CngLiteJobLog.Target.CLOUDNATIVEGIS,
        method="POST",
        url="http://10.0.0.5:8000/api/v1/pmtiles",
        error="Could not reach CloudNativeGIS",
    )
    assert log.status_code is None
    assert log.error == "Could not reach CloudNativeGIS"


@pytest.mark.django_db
def test_never_keeps_a_urls_query(job):
    log = CngLiteJobLog.record(
        job,
        target=CngLiteJobLog.Target.CLOUDNATIVEGIS,
        method="GET",
        url="http://10.0.0.5:8000/api/v1/jobs/cng-1/result/roads.pmtiles?token=abc",
    )
    assert log.url == "http://10.0.0.5:8000/api/v1/jobs/cng-1/result/roads.pmtiles"


@pytest.mark.django_db
def test_a_failure_to_log_does_not_fail_the_job(job):
    with patch.object(CngLiteJobLog.objects, "create", side_effect=RuntimeError("db down")):
        log = CngLiteJobLog.record(job, target="geohosting", method="GET", url="https://x/")
    assert log is None


@pytest.mark.django_db
def test_logs_go_with_their_job(job):
    CngLiteJobLog.record(job, target="geohosting", method="GET", url="https://x/")
    job.delete()
    assert not CngLiteJobLog.objects.exists()


def test_redact_masks_sensitive_keys_at_any_depth():
    assert redact(
        {
            "url": "http://10.0.0.5:8000",
            "token": "abc",
            "server": {"api_token": "def", "name": "cng-1"},
            "items": [{"client_secret": "ghi"}],
        }
    ) == {
        "url": "http://10.0.0.5:8000",
        "token": "***",
        "server": {"api_token": "***", "name": "cng-1"},
        "items": [{"client_secret": "***"}],
    }


def test_redact_strips_a_presigned_urls_credentials():
    presigned = (
        "https://minio:9000/bucket/sources/job/roads.zip"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=key&X-Amz-Signature=abc"
    )
    assert redact({"source": presigned, "thumbnail": True}) == {
        "source": "https://minio:9000/bucket/sources/job/roads.zip?***",
        "thumbnail": True,
    }


def test_redact_leaves_plain_values():
    assert redact(None) is None
    assert redact({"layers": ["roads"], "url": "https://x/y?page=2"}) == {
        "layers": ["roads"],
        "url": "https://x/y?page=2",
    }
