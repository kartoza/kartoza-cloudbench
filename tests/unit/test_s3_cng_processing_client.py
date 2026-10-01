"""CNGProcessingClient picking a conversion up from whichever step its status says."""

import hashlib
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from apps.s3 import portolan
from apps.s3.cng_lite import CNGProcessingClient, job_directory, resume_interrupted_conversions
from apps.s3.models import CngLiteJob, CngLiteJobStatus, S3Connection
from apps.s3.pmtiles import CONTENT_TYPE, PARQUET_CONTENT_TYPE
from tests.unit.fake_s3 import FakeS3, converting_cng

PMTILES = b"PMTiles\x03fixture"
PARQUET = b"PAR1fixture"
# What a vector conversion makes, by role: (bytes, info).
RESULTS = {None: {"data": (PARQUET, {}), "visual": (PMTILES, {"bbox": [1, 2, 3, 4]})}}


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


def already_uploaded(s3, folder="folder/roads", layer_id="roads"):
    """Put a conversion's results in `s3`, as CloudNativeGIS uploads them.

    Returns what CloudNativeGIS reports for them (CngLiteJob.cng_results).
    """
    files = {}
    for role, filename, body, content_type in [
        ("data", f"{layer_id}.parquet", PARQUET, PARQUET_CONTENT_TYPE),
        ("visual", f"{layer_id}.pmtiles", PMTILES, CONTENT_TYPE),
    ]:
        s3.put_object(f"{folder}/{filename}", body, content_type)
        files[role] = {"size": len(body), "sha256": hashlib.sha256(body).hexdigest(), "info": {}}
    return [{"files": files}]


def done(outputs):
    """A cng-lite whose job cng-job-1 is done, having uploaded `outputs`."""

    def respond(request):
        if request.url.path == "/api/v1/jobs/cng-job-1":
            return httpx.Response(
                200, json={"status": "done", "results": [], "outputs": {"layers": outputs}}
            )
        return httpx.Response(404)

    return httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))


def run(job, client, s3=None):
    """Run `job` against the cng-lite `client`; returns its requests and the bucket."""
    s3 = s3 or FakeS3()
    requests = []
    client.event_hooks["request"].append(
        lambda request: requests.append((request.method, request.url.path))
    )
    with (
        # A resumed job first waits for its CloudNativeGIS to be healthy.
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3),
        patch("apps.s3.cng_lite.portolan.finalize_layer") as finalize_layer,
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        CNGProcessingClient(job).run()
    job.refresh_from_db()
    return requests, s3, finalize_layer


@pytest.mark.django_db
def test_resumes_polling_without_resubmitting(job):
    polling = job(status=CngLiteJobStatus.POLLING)
    s3 = FakeS3()
    outputs = already_uploaded(s3)

    requests, _, finalize_layer = run(polling, done(outputs), s3)

    assert requests == [("GET", "/api/v1/jobs/cng-job-1")]
    assert polling.status == CngLiteJobStatus.COMPLETED, polling.error
    assert polling.cng_results == outputs
    finalize_layer.assert_called_once()
    assert not job_directory(polling.kind, polling.id).exists()


@pytest.mark.django_db
def test_resumed_publish_checks_the_uploads_again(job):
    s3 = FakeS3()
    publishing = job(status=CngLiteJobStatus.PUBLISHING, cng_results=already_uploaded(s3))

    requests, _, finalize_layer = run(publishing, done([]), s3)

    assert requests == []
    assert publishing.status == CngLiteJobStatus.COMPLETED, publishing.error
    assert publishing.output_size == len(PARQUET) + len(PMTILES)
    data_assets = finalize_layer.call_args.kwargs["data_assets"]
    assert data_assets[0]["file"] == {
        "size": len(PARQUET),
        "checksum": portolan.sha256_multihash(hashlib.sha256(PARQUET).digest()),
    }


@pytest.mark.django_db
def test_resumed_publish_fails_when_an_upload_is_gone(job):
    s3 = FakeS3()
    publishing = job(status=CngLiteJobStatus.PUBLISHING, cng_results=already_uploaded(s3))
    s3.delete_object("folder/roads/roads.pmtiles")

    _, _, finalize_layer = run(publishing, done([]), s3)

    assert publishing.status == CngLiteJobStatus.FAILED
    assert "roads.pmtiles uploaded, but it isn't there" in publishing.error
    finalize_layer.assert_not_called()
    # A new layer's half-written folder doesn't stay behind.
    assert not any(key.startswith("folder/roads/") for key in s3.objects)


@pytest.mark.django_db
def test_legacy_downloading_job_converts_again(job):
    # Saved mid-download by a CloudBench from before direct uploads.
    downloading = job(status=CngLiteJobStatus.DOWNLOADING)
    s3 = FakeS3()
    client, submitted = converting_cng(s3, "pmtiles", RESULTS)

    requests, _, _ = run(downloading, client, s3)

    assert requests == [("POST", "/api/v1/pmtiles"), ("GET", "/api/v1/jobs/cng-1")]
    assert downloading.status == CngLiteJobStatus.COMPLETED, downloading.error
    assert s3.objects["folder/roads/roads.pmtiles"] == PMTILES


@pytest.mark.django_db
def test_legacy_running_job_cannot_be_resumed(job):
    legacy = job(status=CngLiteJobStatus.RUNNING)

    requests, _, _ = run(legacy, done([]))

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

    run(
        polling,
        httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(broken)),
    )

    assert polling.status == CngLiteJobStatus.FAILED
    assert "tippecanoe failed" in polling.error
    assert not directory.exists()


@pytest.mark.django_db
def test_cloudnativegis_that_doesnt_upload_fails_the_job(job):
    polling = job(status=CngLiteJobStatus.POLLING)

    def old(request):
        return httpx.Response(200, json={"status": "done", "results": [{"name": "out.pmtiles"}]})

    run(
        polling, httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(old))
    )

    assert polling.status == CngLiteJobStatus.FAILED
    assert "needs updating" in polling.error


@pytest.mark.django_db
def test_resubmits_when_cloudnativegis_lost_the_job(job):
    polling = job(status=CngLiteJobStatus.POLLING)
    s3 = FakeS3()
    client, submitted = converting_cng(s3, "pmtiles", RESULTS, lost={"/api/v1/jobs/cng-job-1"})

    requests, _, _ = run(polling, client, s3)

    assert requests == [
        ("GET", "/api/v1/jobs/cng-job-1"),
        ("POST", "/api/v1/pmtiles"),
        ("GET", "/api/v1/jobs/cng-1"),
    ]
    assert polling.status == CngLiteJobStatus.COMPLETED, polling.error
    assert polling.cng_job_id == "cng-1"
    # The resubmission is handed fresh upload URLs.
    assert submitted[0]["uploads"][0]["files"]["visual"]["url"]


@pytest.mark.django_db
def test_resubmits_only_once(job):
    polling = job(status=CngLiteJobStatus.POLLING)
    client, _ = converting_cng(
        FakeS3(), "pmtiles", RESULTS, lost={"/api/v1/jobs/cng-job-1", "/api/v1/jobs/cng-1"}
    )

    requests, _, _ = run(polling, client)

    assert [method for method, _ in requests].count("POST") == 1
    assert polling.status == CngLiteJobStatus.FAILED
    assert "no job cng-1" in polling.error


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
