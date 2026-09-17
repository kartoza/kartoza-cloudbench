"""CloudNativeGIS PMTiles conversion contract and failure handling."""

import io
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3.models import PMTilesJob
from apps.s3.pmtiles import (
    download_pmtiles,
    output_key,
    prepare_shapefile,
    run_conversion,
    start_conversion,
)


def shapefile_zip(names=("folder/roads.shp", "folder/roads.shx", "folder/roads.dbf")):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, b"fixture")
    return SimpleUploadedFile("roads.zip", buffer.getvalue(), "application/zip")


@pytest.mark.parametrize(
    "key,expected",
    [
        ("folder/roads.zip", "folder/roads.pmtiles"),
        ("folder/roads.SHP.ZIP", "folder/roads.pmtiles"),
        ("roads.shp", "roads.pmtiles"),
        ("folder/roads.pmtiles", "folder/roads.pmtiles"),
    ],
)
def test_output_key(key, expected):
    assert output_key(key) == expected


def test_flattens_and_uniquely_names_shapefile(tmp_path):
    destination = tmp_path / "prepared.zip"
    prepare_shapefile(shapefile_zip(), destination, "unique-job")
    with zipfile.ZipFile(destination) as archive:
        assert set(archive.namelist()) == {"unique-job.shp", "unique-job.shx", "unique-job.dbf"}


@pytest.mark.parametrize(
    "names",
    [
        ("roads.shp",),
        ("roads.shp", "other.shp", "roads.shx", "roads.dbf"),
        ("roads.shp", "roads.shx", "other.dbf"),
    ],
)
def test_rejects_incomplete_or_ambiguous_archives(tmp_path, names):
    with pytest.raises(ValueError):
        prepare_shapefile(shapefile_zip(names), tmp_path / "prepared.zip", "job")


def test_rejects_standalone_shapefile(tmp_path):
    with pytest.raises(ValueError, match="files together"):
        prepare_shapefile(SimpleUploadedFile("roads.shp", b"shape"), tmp_path / "out.zip", "job")


def test_zips_loose_shapefile_components(tmp_path):
    destination = tmp_path / "prepared.zip"
    source = SimpleUploadedFile("roads.shp", b"shape")
    companions = [
        SimpleUploadedFile("roads.SHX", b"index"),
        SimpleUploadedFile("roads.dbf", b"attributes"),
        SimpleUploadedFile("roads.prj", b"projection"),
    ]
    prepare_shapefile(source, destination, "unique-job", companions)
    with zipfile.ZipFile(destination) as archive:
        assert set(archive.namelist()) == {
            "unique-job.shp",
            "unique-job.shx",
            "unique-job.dbf",
            "unique-job.prj",
        }
        assert archive.read("unique-job.dbf") == b"attributes"


def test_rejects_mismatched_loose_components(tmp_path):
    with pytest.raises(ValueError, match="matching components"):
        prepare_shapefile(
            SimpleUploadedFile("roads.shp", b"shape"),
            tmp_path / "out.zip",
            "job",
            [SimpleUploadedFile("other.dbf", b"attributes")],
        )


@pytest.mark.django_db
@pytest.mark.parametrize("convert", [True, False])
def test_upload_loose_shapefile_components(settings, tmp_path, convert):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.CLOUDNATIVEGIS_USERNAME = "service"
    settings.CLOUDNATIVEGIS_PASSWORD = "secret"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    archives = []

    def capture_archive(**kwargs):
        archives.append(kwargs["body"].read())
        assert kwargs["key"] == "folder/roads.zip"
        assert kwargs["content_type"] == "application/zip"
        return {"etag": "test"}

    with (
        patch("apps.s3.views.get_s3_client") as get_client,
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.put_object.side_effect = capture_archive
        response = APIClient().post(
            "/api/s3/upload/s3-one/bucket",
            {
                "file": SimpleUploadedFile("roads.shp", b"shape"),
                "companions": [
                    SimpleUploadedFile("roads.shx", b"index"),
                    SimpleUploadedFile("roads.dbf", b"attributes"),
                ],
                "convert": str(convert).lower(),
                "targetFormat": "pmtiles",
                "key": "folder/roads.shp",
            },
            format="multipart",
        )
    if convert:
        assert response.status_code == 202
        job = PMTilesJob.objects.get(pk=response.json()["conversionJobId"])
        assert job.input_size == len(b"shapeindexattributes")
        with zipfile.ZipFile(tmp_path / "pmtiles" / str(job.id) / "source.zip") as archive:
            assert len(archive.namelist()) == 3
        assert not archives
    else:
        assert response.status_code == 201
        with zipfile.ZipFile(io.BytesIO(archives[0])) as archive:
            assert set(archive.namelist()) == {"roads.shp", "roads.shx", "roads.dbf"}


def test_download_does_not_follow_upstream_host(tmp_path):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, content=b"PMTiles\x03fixture")

    with httpx.Client(
        base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond)
    ) as client:
        size = download_pmtiles(
            client, "http://untrusted/media/file.pmtiles", tmp_path / "file.pmtiles"
        )
    assert size == 15
    assert requests[0].url.host == "cloudnativegis"


def test_rejects_html_download(tmp_path):
    with (
        httpx.Client(
            base_url="http://cloudnativegis/",
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(200, text="<html>Login</html>")
            ),
        ) as client,
        pytest.raises(ValueError, match="valid PMTiles"),
    ):
        download_pmtiles(client, "/media/file.pmtiles", tmp_path / "file.pmtiles")


@pytest.fixture
def conversion_job(settings, tmp_path):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.CLOUDNATIVEGIS_USERNAME = "service"
    settings.CLOUDNATIVEGIS_PASSWORD = "secret"
    with patch("apps.s3.pmtiles.threading.Thread"):
        return start_conversion(shapefile_zip(), "folder/roads.zip", "s3-one", "bucket", "7")


@pytest.mark.django_db
@pytest.mark.parametrize(
    "outcome", ["success", "failed", "missing", "timeout", "s3-failed", "unauthorized"]
)
def test_conversion_pipeline(conversion_job, settings, outcome):
    requests = []
    polls = 0
    s3_client = Mock()
    uploaded = []

    def upload(source, bucket, key, **kwargs):
        if outcome == "s3-failed":
            raise RuntimeError("S3 transfer failed")
        uploaded.append((source.read(), bucket, key, kwargs))

    s3_client.client.upload_fileobj.side_effect = upload

    def respond(request):
        nonlocal polls
        requests.append((request.method, request.url.path))
        assert request.headers["Authorization"].startswith("Basic ")
        if outcome == "unauthorized":
            return httpx.Response(401)
        if request.url.path == "/api/layer/":
            return httpx.Response(201, json={"id": 12})
        if request.method == "POST":
            assert b"application/zip" in request.content
            return httpx.Response(200, json="Uploaded")
        if request.url.path.endswith("layer-upload/"):
            polls += 1
            if outcome == "failed":
                return httpx.Response(
                    200, json={"results": [{"status": "Failed", "note": "Invalid projection"}]}
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "status": "Running" if polls == 1 else "Success",
                            "progress": 50,
                        }
                    ]
                },
            )
        if request.url.path == "/api/layer/12/":
            return httpx.Response(
                200,
                json={
                    "is_ready": polls > 1,
                    "pmtile": None if outcome == "missing" else "/media/roads.pmtiles",
                },
            )
        return httpx.Response(200, content=b"PMTiles\x03fixture")

    client = httpx.Client(
        base_url="http://cloudnativegis/",
        auth=("service", "secret"),
        transport=httpx.MockTransport(respond),
    )
    if outcome == "timeout":
        settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 0
    with (
        patch("apps.s3.pmtiles.httpx.Client", return_value=client),
        patch("apps.s3.pmtiles.get_s3_client", return_value=s3_client),
        patch("apps.s3.pmtiles.time.sleep"),
        patch("apps.s3.pmtiles.close_old_connections"),
    ):
        run_conversion(conversion_job.pk)

    conversion_job.refresh_from_db()
    assert not (Path(settings.UPLOAD_TEMP_DIR) / "pmtiles" / str(conversion_job.id)).exists()
    if outcome == "success":
        assert conversion_job.status == "completed"
        assert conversion_job.progress == 100
        assert uploaded[0][:3] == (b"PMTiles\x03fixture", "bucket", "folder/roads.pmtiles")
        assert requests[-1] == ("GET", "/media/roads.pmtiles")
        assert polls == 2
    else:
        assert conversion_job.status == "failed"
        assert conversion_job.error
        assert not uploaded


@pytest.mark.django_db
def test_job_status_is_scoped_to_owner(conversion_job):
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    response = api.get(f"/api/s3/conversion/jobs/{conversion_job.id}")
    assert response.status_code == 200
    assert response.json()["outputPath"] == "s3://bucket/folder/roads.pmtiles"
    api.force_authenticate(user=Mock(id=8, is_authenticated=True))
    assert api.get(f"/api/s3/conversion/jobs/{conversion_job.id}").status_code == 404


@pytest.mark.django_db
def test_upload_starts_conversion_without_putting_zip_in_s3(settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.CLOUDNATIVEGIS_USERNAME = "service"
    settings.CLOUDNATIVEGIS_PASSWORD = "secret"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    with (
        patch("apps.s3.views.get_s3_client") as get_client,
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        response = APIClient().post(
            "/api/s3/upload/s3-one/bucket",
            {
                "file": shapefile_zip(),
                "convert": "true",
                "targetFormat": "pmtiles",
                "key": "folder/roads.zip",
            },
            format="multipart",
        )
    assert response.status_code == 202
    assert response.json()["key"] == "folder/roads.pmtiles"
    assert PMTilesJob.objects.filter(pk=response.json()["conversionJobId"]).exists()
    get_client.return_value.put_object.assert_not_called()
