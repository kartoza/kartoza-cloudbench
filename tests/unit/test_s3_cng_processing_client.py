"""CNGProcessingClient picking a conversion up from whichever step its status says."""

from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import pytest

from apps.s3.cng_lite import CNGProcessingClient, job_directory, resume_interrupted_conversions
from apps.s3.models import CngLiteJob, CngLiteJobStatus, S3Connection

RESULT_URL = "/api/v1/jobs/cng-job-1/result/output.pmtiles"
PMTILES = b"PMTiles\x03fixture"


@pytest.fixture
def job(settings, tmp_path, django_user_model):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    owner = django_user_model.objects.create_user(username="7")
    connection = S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )

    def make(**fields):
        return CngLiteJob.objects.create(
            **{
                "kind": "pmtiles",
                "owner": owner,
                "connection": connection,
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


def run(job, respond, presigned="http://minio:9000/bucket/source.zip"):
    """Run `job` against a cng-lite answering with `respond`; returns its requests."""
    requests = []

    def record(request):
        requests.append((request.method, request.url.path))
        return respond(request)

    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(record))
    s3_client = Mock(bucket_url="http://minio:9000/bucket")
    # What a (re)submission hands cng-lite to read the source from.
    s3_client.generate_presigned_url.return_value = presigned
    with (
        # A resumed job first waits for its CloudNativeGIS to be healthy.
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3_client),
        patch("apps.s3.cng_lite.portolan.finalize_layer") as finalize_layer,
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        CNGProcessingClient(job).run()
    job.refresh_from_db()
    return requests, s3_client, finalize_layer


def cng_lite_that_lost(lost_paths):
    """A cng-lite that 404s `lost_paths` (e.g. after restarting), and takes resubmissions."""

    def respond(request):
        path = request.url.path
        if path in lost_paths:
            return httpx.Response(404, json={"detail": "Job not found"})
        if request.method == "POST" and path == "/api/v1/pmtiles":
            return httpx.Response(202, json={"job_id": "cng-job-2", "status": "processing"})
        if path in ("/api/v1/jobs/cng-job-1", "/api/v1/jobs/cng-job-2"):
            job_id = path.rsplit("/", 1)[1]
            return httpx.Response(
                200,
                json={
                    "status": "done",
                    "results": [
                        {
                            "name": "output.pmtiles",
                            "result_url": f"/api/v1/jobs/{job_id}/result/output.pmtiles",
                        }
                    ],
                },
            )
        if path.endswith("/result/output.pmtiles"):
            return httpx.Response(200, content=PMTILES)
        return httpx.Response(404)

    return respond


def cng_lite(request):
    if request.url.path == "/api/v1/jobs/cng-job-1":
        return httpx.Response(
            200,
            json={
                "status": "done",
                "results": [{"name": "output.pmtiles", "result_url": RESULT_URL}],
            },
        )
    if request.url.path == RESULT_URL:
        return httpx.Response(200, content=PMTILES)
    return httpx.Response(404)


def downloaded_result(job, content=PMTILES):
    """A cng_results entry for a result already downloaded to `job`'s directory."""
    directory = job_directory(job.kind, job.id)
    directory.mkdir(parents=True)
    (directory / "result-0").write_bytes(content)
    return {
        "name": "output.pmtiles",
        "result_url": RESULT_URL,
        "file": "result-0",
        "size": len(content),
        "checksum": "1220checksum",
    }


@pytest.mark.django_db
def test_resumes_polling_without_resubmitting(job):
    polling = job(status=CngLiteJobStatus.POLLING)

    requests, s3_client, _ = run(polling, cng_lite)

    assert requests == [("GET", "/api/v1/jobs/cng-job-1"), ("GET", RESULT_URL)]
    assert polling.status == CngLiteJobStatus.COMPLETED
    assert polling.cng_results[0]["file"] == "result-0"
    assert polling.cng_results[0]["size"] == len(PMTILES)
    s3_client.client.upload_fileobj.assert_called_once()
    assert not job_directory(polling.kind, polling.id).exists()


@pytest.mark.django_db
def test_resumed_publish_reuses_already_downloaded_files(job):
    publishing = job(status=CngLiteJobStatus.PUBLISHING)
    publishing.cng_results = [downloaded_result(publishing)]
    publishing.save(update_fields=["cng_results"])

    requests, s3_client, finalize_layer = run(publishing, cng_lite)

    assert requests == []
    assert publishing.status == CngLiteJobStatus.COMPLETED
    assert publishing.output_size == len(PMTILES)
    [data_asset] = finalize_layer.call_args.kwargs["data_assets"]
    assert data_asset["file"] == {"size": len(PMTILES), "checksum": "1220checksum"}
    uploaded = s3_client.client.upload_fileobj.call_args.args
    assert uploaded[1:] == ("bucket", "folder/roads/roads.pmtiles")


@pytest.mark.django_db
def test_resumed_publish_downloads_files_that_are_gone_or_incomplete(job):
    publishing = job(status=CngLiteJobStatus.PUBLISHING)
    result = downloaded_result(publishing, content=b"PMTiles\x03trunc")
    result["size"] += 10  # the file on disk is shorter than what was recorded
    publishing.cng_results = [result]
    publishing.save(update_fields=["cng_results"])

    requests, _, _ = run(publishing, cng_lite)

    assert requests == [("GET", RESULT_URL)]
    assert publishing.status == CngLiteJobStatus.COMPLETED
    assert publishing.cng_results[0]["size"] == len(PMTILES)


@pytest.mark.django_db
def test_legacy_running_job_cannot_be_resumed(job):
    legacy = job(status=CngLiteJobStatus.RUNNING)

    requests, _, _ = run(legacy, cng_lite)

    assert requests == []
    assert legacy.status == CngLiteJobStatus.FAILED
    assert "running" in legacy.error


@pytest.mark.django_db
def test_failure_keeps_nothing_on_disk(job):
    polling = job(status=CngLiteJobStatus.POLLING)
    directory = job_directory(polling.kind, polling.id)
    directory.mkdir(parents=True)
    Path(directory / "source.zip").write_bytes(b"zip")

    def broken(request):
        return httpx.Response(200, json={"status": "failed", "detail": "tippecanoe failed"})

    run(polling, broken)

    assert polling.status == CngLiteJobStatus.FAILED
    assert "tippecanoe failed" in polling.error
    assert not directory.exists()


@pytest.mark.django_db
def test_resubmits_when_cloudnativegis_lost_the_job(job):
    polling = job(status=CngLiteJobStatus.POLLING)

    requests, _, _ = run(polling, cng_lite_that_lost({"/api/v1/jobs/cng-job-1"}))

    assert requests == [
        ("GET", "/api/v1/jobs/cng-job-1"),
        ("POST", "/api/v1/pmtiles"),
        ("GET", "/api/v1/jobs/cng-job-2"),
        ("GET", "/api/v1/jobs/cng-job-2/result/output.pmtiles"),
    ]
    assert polling.status == CngLiteJobStatus.COMPLETED
    assert polling.cng_job_id == "cng-job-2"


@pytest.mark.django_db
def test_resubmits_when_cloudnativegis_dropped_the_results(job):
    downloading = job(status=CngLiteJobStatus.DOWNLOADING)
    downloading.cng_results = [{"name": "output.pmtiles", "result_url": RESULT_URL}]
    downloading.save(update_fields=["cng_results"])

    requests, _, _ = run(downloading, cng_lite_that_lost({RESULT_URL}))

    assert requests[:2] == [("GET", RESULT_URL), ("POST", "/api/v1/pmtiles")]
    assert downloading.status == CngLiteJobStatus.COMPLETED


@pytest.mark.django_db
def test_resubmits_only_once(job):
    polling = job(status=CngLiteJobStatus.POLLING)

    requests, _, _ = run(
        polling, cng_lite_that_lost({"/api/v1/jobs/cng-job-1", "/api/v1/jobs/cng-job-2"})
    )

    assert [method for method, _ in requests].count("POST") == 1
    assert polling.status == CngLiteJobStatus.FAILED
    assert "no job cng-job-2" in polling.error


@pytest.mark.django_db
def test_resumes_interrupted_jobs_oldest_first(job):
    job(status=CngLiteJobStatus.COMPLETED)
    job(status=CngLiteJobStatus.FAILED)
    # Waiting for its layers to be picked: the user's to carry on, not a restart's.
    job(source_name="parcels.gpkg")
    shapefile = job(status=CngLiteJobStatus.POLLING)
    vector = job(status=CngLiteJobStatus.PUBLISHING, source_name="both.gpkg", layers=["roads"])
    raster = job(
        kind="cog",
        source_name="both.gpkg",
        layers=["dem"],
        depends_on=vector,
        source_key="folder/sources/vector/both.gpkg",
    )
    ran = []

    def fake_run(client):
        ran.append((client.job.id, client.job.source_key))
        if client.job.pk == vector.pk:
            # Publishing moves the GeoPackage into its group folder.
            CngLiteJob.objects.filter(pk=vector.pk).update(
                source_key="folder/both/source/both.gpkg"
            )

    with patch.object(CNGProcessingClient, "run", autospec=True, side_effect=fake_run):
        assert resume_interrupted_conversions() == 3

    assert ran == [
        (shapefile.id, shapefile.source_key),
        (vector.id, vector.source_key),
        # After the vector job, from where it moved the source to.
        (raster.id, "folder/both/source/both.gpkg"),
    ]


# -- CngLiteJobLog: the job's requests to its CloudNativeGIS -------------------


def logged(job):
    return [
        (log.step, log.method, log.url, log.status_code, bool(log.error)) for log in job.logs.all()
    ]


@pytest.mark.django_db
def test_the_submission_and_its_outcome_are_logged(job):
    pushing = job(status=CngLiteJobStatus.PUSHING)
    presigned = (
        "https://minio:9000/bucket/folder/sources/job/roads.zip"
        "?X-Amz-Credential=key&X-Amz-Signature=abc"
    )

    def respond(request):
        if request.method == "POST" and request.url.path == "/api/v1/pmtiles":
            return httpx.Response(202, json={"job_id": "cng-job-1", "status": "processing"})
        return cng_lite(request)

    run(pushing, respond, presigned=presigned)

    assert pushing.status == CngLiteJobStatus.COMPLETED
    assert logged(pushing) == [
        ("pushing", "POST", "http://cloudnativegis/api/v1/pmtiles", 202, False),
        ("polling", "GET", "http://cloudnativegis/api/v1/jobs/cng-job-1", 200, False),
    ]
    push, poll = pushing.logs.all()
    # The presigned URL's credentials never reach the log.
    assert push.request_payload["source"] == (
        "https://minio:9000/bucket/folder/sources/job/roads.zip?***"
    )
    assert push.request_payload["thumbnail"] is True
    assert push.response_payload == {"job_id": "cng-job-1", "status": "processing"}
    assert poll.response_payload["status"] == "done"


@pytest.mark.django_db
def test_still_converting_polls_are_not_logged(job):
    polling = job(status=CngLiteJobStatus.POLLING)
    polls = []

    def respond(request):
        if request.url.path == "/api/v1/jobs/cng-job-1" and len(polls) < 3:
            polls.append(1)
            return httpx.Response(200, json={"status": "processing", "detail": "Tiling"})
        return cng_lite(request)

    run(polling, respond)

    assert [log.method for log in polling.logs.all()] == ["GET"]  # just the "done"
    assert polling.logs.get().response_payload["status"] == "done"


@pytest.mark.django_db
def test_a_lost_job_and_its_resubmission_are_logged(job):
    polling = job(status=CngLiteJobStatus.POLLING)

    run(polling, cng_lite_that_lost({"/api/v1/jobs/cng-job-1"}))

    assert logged(polling) == [
        ("polling", "GET", "http://cloudnativegis/api/v1/jobs/cng-job-1", 404, True),
        ("pushing", "POST", "http://cloudnativegis/api/v1/pmtiles", 202, False),
        ("polling", "GET", "http://cloudnativegis/api/v1/jobs/cng-job-2", 200, False),
    ]


@pytest.mark.django_db
def test_a_failed_conversion_is_logged(job):
    polling = job(status=CngLiteJobStatus.POLLING)

    def respond(request):
        return httpx.Response(200, json={"status": "failed", "detail": "tippecanoe failed"})

    run(polling, respond)

    [log] = polling.logs.all()
    assert (log.step, log.status_code) == ("polling", 200)
    assert log.response_payload["detail"] == "tippecanoe failed"


@pytest.mark.django_db
def test_a_failed_download_is_logged(job):
    downloading = job(status=CngLiteJobStatus.DOWNLOADING)
    downloading.cng_results = [{"name": "output.pmtiles", "result_url": RESULT_URL}]
    downloading.save(update_fields=["cng_results"])

    run(downloading, lambda _request: httpx.Response(500, text="disk full"))

    [log] = downloading.logs.all()
    assert log.step == "downloading"
    assert log.url == f"http://cloudnativegis{RESULT_URL}"
    assert log.status_code == 500
    assert log.error
    assert downloading.status == CngLiteJobStatus.FAILED


@pytest.mark.django_db
def test_an_unreachable_cloudnativegis_is_logged(job):
    pushing = job(status=CngLiteJobStatus.PUSHING)

    def unreachable(request):
        raise httpx.ConnectError("refused", request=request)

    run(pushing, unreachable)

    [log] = pushing.logs.all()
    assert (log.step, log.method, log.status_code) == ("pushing", "POST", None)
    assert "refused" in log.error
    assert pushing.status == CngLiteJobStatus.FAILED
