"""CloudNativeGIS Lite COG conversion contract and failure handling."""

from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3.cog import cog_dest_key, output_key, prepare_tiff, run_conversion, start_conversion
from apps.s3.models import CngLiteJob, LayerCollection


def tiff_file(name="raster.tif", header=b"II*\x00"):
    return SimpleUploadedFile(name, header + b"fixture-bytes", "image/tiff")


@pytest.mark.parametrize(
    "key,expected",
    [
        ("folder/raster.tif", "folder/raster.tif"),
        ("folder/raster.TIFF", "folder/raster.TIFF"),
        ("folder/raster", "folder/raster.tif"),
    ],
)
def test_output_key(key, expected):
    assert output_key(key) == expected


def test_cog_dest_key_folder_mode_uses_item_name():
    job = Mock(output_key="folder/raster.tif")
    item = {"name": "table_cog_3857.tif"}
    assert cog_dest_key(job, item, True, "sources/job-1") == "sources/job-1/table_cog_3857.tif"


def test_cog_dest_key_non_folder_original_uses_output_key():
    job = Mock(output_key="folder/raster.tif")
    item = {"name": "output_cog.tif"}
    assert cog_dest_key(job, item, False, None) == "folder/raster.tif"


def test_cog_dest_key_non_folder_3857_variant_gets_suffixed():
    job = Mock(output_key="folder/raster.tif")
    item = {"name": "output_cog_3857.tif"}
    assert cog_dest_key(job, item, False, None) == "folder/raster_3857.tif"


def test_prepare_tiff_rejects_non_tiff_extension(tmp_path):
    with pytest.raises(ValueError, match="GeoTIFF"):
        prepare_tiff(SimpleUploadedFile("raster.png", b"II*\x00fixture"), tmp_path / "out.tif")


def test_prepare_tiff_rejects_bad_magic_bytes(tmp_path):
    with pytest.raises(ValueError, match="not a valid TIFF"):
        prepare_tiff(SimpleUploadedFile("raster.tif", b"not-a-tiff"), tmp_path / "out.tif")


@pytest.mark.parametrize("header", [b"II*\x00", b"MM\x00*"])
def test_prepare_tiff_accepts_both_byte_orders(tmp_path, header):
    destination = tmp_path / "out.tif"
    prepare_tiff(tiff_file(header=header), destination)
    assert destination.read_bytes().startswith(header)


@pytest.mark.django_db
def test_upload_starts_cog_conversion(settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    with (
        patch("apps.s3.cog.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.cog.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        response = api.post(
            "/api/s3/upload/s3-one",
            {
                "file": tiff_file(),
                "convert": "true",
                "targetFormat": "cog",
                "key": "folder/raster.tif",
            },
            format="multipart",
        )
    assert response.status_code == 202
    assert response.json()["key"] == "folder/raster.tif"
    job = CngLiteJob.objects.get(pk=response.json()["conversionJobId"])
    assert job.kind == "cog"
    assert (tmp_path / "cog" / str(job.id) / "source.tif").exists()
    get_client.return_value.client.upload_fileobj.assert_called_once()


@pytest.mark.django_db
def test_upload_rejects_companion_files_for_cog(settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    with patch("apps.s3.views.get_s3_client"):
        response = api.post(
            "/api/s3/upload/s3-one",
            {
                "file": tiff_file(),
                "companions": [SimpleUploadedFile("raster.tfw", b"world file")],
                "convert": "true",
                "targetFormat": "cog",
                "key": "folder/raster.tif",
            },
            format="multipart",
        )
    assert response.status_code == 400
    assert not CngLiteJob.objects.exists()


@pytest.fixture
def cog_job(settings, tmp_path):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    with (
        patch("apps.s3.cog.get_s3_client") as get_client,
        patch("apps.s3.cog.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        return start_conversion(tiff_file(), "folder/raster.tif", "s3-one", "7")


@pytest.mark.django_db
@pytest.mark.parametrize("outcome", ["success", "failed", "bad-magic"])
def test_cog_conversion_pipeline(cog_job, settings, outcome):
    s3_client = Mock()
    s3_client.generate_presigned_url.return_value = "http://cloudnativegis/presigned/source.tif"
    uploaded = []
    s3_client.client.upload_fileobj.side_effect = lambda source, bucket, key, **kw: uploaded.append(
        (source.read(), bucket, key, kw)
    )

    def respond(request):
        if request.url.path == "/api/v1/cog":
            return httpx.Response(202, json={"job_id": "cng-job-1", "status": "processing"})
        if request.url.path == "/api/v1/jobs/cng-job-1":
            if outcome == "failed":
                return httpx.Response(200, json={"status": "failed", "detail": "gdal_translate failed"})
            return httpx.Response(
                200,
                json={
                    "status": "done",
                    "results": [
                        {"name": "output_cog.tif", "result_url": "/api/v1/jobs/cng-job-1/result/output_cog.tif"},
                        {
                            "name": "output_cog_3857.tif",
                            "result_url": "/api/v1/jobs/cng-job-1/result/output_cog_3857.tif",
                        },
                    ],
                    "errors": [],
                },
            )
        if request.url.path in (
            "/api/v1/jobs/cng-job-1/result/output_cog.tif",
            "/api/v1/jobs/cng-job-1/result/output_cog_3857.tif",
        ):
            content = b"not-a-tiff" if outcome == "bad-magic" else b"II*\x00cog-fixture"
            return httpx.Response(200, content=content)
        return httpx.Response(404)

    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))
    with (
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3_client),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        run_conversion(cog_job.pk)

    cog_job.refresh_from_db()
    assert not (Path(settings.UPLOAD_TEMP_DIR) / "cog" / str(cog_job.id)).exists()
    if outcome == "success":
        assert cog_job.status == "completed"
        assert cog_job.progress == 100
        # Distinct keys — the two files must not overwrite each other.
        uploaded_keys = {entry[2] for entry in uploaded}
        assert uploaded_keys == {"folder/raster.tif", "folder/raster_3857.tif"}
        assert cog_job.output_keys and len(cog_job.output_keys) == 2
        assert set(cog_job.to_dict()["outputPaths"]) == {
            "s3://bucket/folder/raster.tif",
            "s3://bucket/folder/raster_3857.tif",
        }
        assert not LayerCollection.objects.exists()
    else:
        assert cog_job.status == "failed"
        assert cog_job.error
        assert not uploaded


@pytest.mark.django_db
def test_cog_job_status_reports_formats(cog_job):
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    response = api.get(f"/api/s3/conversion/jobs/{cog_job.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["sourceFormat"] == "tiff"
    assert body["targetFormat"] == "cog"
    assert body["outputPath"] == "s3://bucket/folder/raster.tif"
