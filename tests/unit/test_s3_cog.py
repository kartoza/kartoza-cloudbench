"""CloudNativeGIS Lite COG conversion contract and failure handling."""

from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3 import cng_lite, portolan
from apps.s3.cog import (
    assets_for,
    output_key,
    prepare_tiff,
    run_conversion,
    start_conversion,
)
from apps.s3.cog import (
    start_geopackage_conversion as start_geopackage_cog_conversion,
)
from apps.s3.models import CngLiteJob, S3Connection
from apps.s3.pmtiles import inspect_geopackage
from tests.unit.fake_s3 import FakeS3, converting_cng, key_of

GPKG_MAGIC = b"SQLite format 3\x00"


@pytest.fixture
def owner(django_user_model):
    """Job owner (CngLiteJob.owner)."""
    return django_user_model.objects.create(username="7")


@pytest.fixture
def connection(owner):
    """The S3 connection uploads go to (get_s3_client itself is patched)."""
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


def gpkg_file(name="rasters.gpkg"):
    return SimpleUploadedFile(name, GPKG_MAGIC + b"fixture-bytes", "application/geopackage+sqlite3")


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


def test_plan_layers_names_a_tiff_after_its_upload():
    job = Mock(source_name="my raster.tif", layers=None)
    [layer] = cng_lite.plan_layers(job, [None], assets_for)
    assert (layer["layer_id"], layer["title"]) == ("my-raster", "My Raster")
    assert [(a["role"], a["filename"], a["media_type"]) for a in layer["assets"]] == [
        ("data", "my-raster.tif", portolan.COG_MEDIA_TYPE),
        ("visual", "my-raster_3857.tif", portolan.COG_MEDIA_TYPE),
        ("thumbnail", "thumbnail.png", "image/png"),
    ]


def test_plan_layers_names_a_geopackages_rasters_after_their_tables():
    job = Mock(source_name="data.gpkg", layers=["roads", "rivers"])
    layers = cng_lite.plan_layers(job, job.layers, assets_for)
    assert [(layer["name"], layer["layer_id"]) for layer in layers] == [
        ("roads", "roads"),
        ("rivers", "rivers"),
    ]


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
def test_upload_starts_cog_conversion(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with (
        patch("apps.s3.cog.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.cog.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        response = api.post(
            f"/api/s3/upload/{connection.id}",
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
    assert job.license == "other"
    assert (tmp_path / "cog" / str(job.id) / "source.tif").exists()
    get_client.return_value.client.upload_fileobj.assert_called_once()


@pytest.mark.django_db
def test_upload_accepts_chosen_license(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with (
        patch("apps.s3.cog.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.cog.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        response = api.post(
            f"/api/s3/upload/{connection.id}",
            {
                "file": tiff_file(),
                "convert": "true",
                "targetFormat": "cog",
                "key": "folder/raster.tif",
                "license": "CC0-1.0",
            },
            format="multipart",
        )
    job = CngLiteJob.objects.get(pk=response.json()["conversionJobId"])
    assert job.license == "CC0-1.0"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "license_id, license_url, expected",
    [
        # "other" keeps its URL (the terms its rel=license link points at)...
        ("other", " https://example.org/terms ", ("other", "https://example.org/terms")),
        # ...an SPDX id needs none, so any URL sent along is dropped...
        ("CC-BY-4.0", "https://example.org/terms", ("CC-BY-4.0", "")),
        # ...and the forbidden "proprietary" (older clients) becomes "other".
        ("proprietary", "", ("other", "")),
    ],
)
def test_upload_records_license_url(
    settings, tmp_path, owner, connection, license_id, license_url, expected
):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with (
        patch("apps.s3.cog.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.cog.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        response = api.post(
            f"/api/s3/upload/{connection.id}",
            {
                "file": tiff_file(),
                "convert": "true",
                "targetFormat": "cog",
                "key": "folder/raster.tif",
                "license": license_id,
                "licenseUrl": license_url,
            },
            format="multipart",
        )
    job = CngLiteJob.objects.get(pk=response.json()["conversionJobId"])
    assert (job.license, job.license_url) == expected


@pytest.mark.django_db
def test_upload_rejects_invalid_license_url(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with patch("apps.s3.views.get_s3_client"):
        response = api.post(
            f"/api/s3/upload/{connection.id}",
            {
                "file": tiff_file(),
                "convert": "true",
                "targetFormat": "cog",
                "license": "other",
                "licenseUrl": "javascript:alert(1)",
            },
            format="multipart",
        )
    assert response.status_code == 400
    assert not CngLiteJob.objects.exists()


@pytest.mark.django_db
def test_upload_rejects_companion_files_for_cog(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with patch("apps.s3.views.get_s3_client"):
        response = api.post(
            f"/api/s3/upload/{connection.id}",
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
def cog_job(settings, tmp_path, owner, connection):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    with (
        patch("apps.s3.cog.get_s3_client") as get_client,
        patch("apps.s3.cog.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        return start_conversion(tiff_file(), "folder/raster.tif", str(connection.id), owner)


COG = b"II*\x00cog-fixture"
PNG = b"\x89PNG\r\n\x1a\nfixture"


def raster_results(layer=None):
    return {
        layer: {
            "data": (COG, {"bbox": [1, 2, 3, 4]}),
            "visual": (COG + b"-3857", {"bbox": [1, 2, 3, 4]}),
            "thumbnail": (PNG, {}),
        }
    }


@pytest.mark.django_db
@pytest.mark.parametrize("outcome", ["success", "failed", "not-a-tiff"])
def test_cog_conversion_pipeline(cog_job, settings, outcome):
    s3 = FakeS3()
    if outcome == "failed":

        def respond(request):
            if request.url.path == "/api/v1/cog":
                return httpx.Response(202, json={"job_id": "cng-1"})
            return httpx.Response(200, json={"status": "failed", "detail": "gdal_translate failed"})

        client = httpx.Client(
            base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond)
        )
        submitted = []
    else:
        client, submitted = converting_cng(
            s3,
            "cog",
            raster_results(),
            tamper=(
                (lambda url, body: b"<html>".ljust(len(body)) if "_3857" in url else body)
                if outcome == "not-a-tiff"
                else None
            ),
        )
    with (
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        run_conversion(cog_job.pk)

    cog_job.refresh_from_db()
    assert not (Path(settings.UPLOAD_TEMP_DIR) / "cog" / str(cog_job.id)).exists()
    if outcome != "success":
        assert cog_job.status == "failed"
        assert cog_job.error
        assert not [key for key in s3.objects if key.startswith("folder/raster/")]
        return
    assert cog_job.status == "completed", cog_job.error
    assert cog_job.progress == 100
    [payload] = submitted
    assert payload["thumbnail"] is True
    [spec] = payload["uploads"]
    # Every layer gets its own Portolan folder ("folder/raster/"): the
    # original-CRS COG and the EPSG:3857 one land there together.
    assert {role: key_of(t["url"]) for role, t in spec["files"].items()} == {
        "data": "folder/raster/raster.tif",
        "visual": "folder/raster/raster_3857.tif",
        "thumbnail": "folder/raster/thumbnail.png",
    }
    # Both COGs are signed for - and so carry - the full COG media type.
    assert s3.content_types["folder/raster/raster.tif"] == portolan.COG_MEDIA_TYPE
    assert s3.content_types["folder/raster/raster_3857.tif"] == portolan.COG_MEDIA_TYPE
    assert set(cog_job.to_dict()["outputPaths"]) == {
        "s3://bucket/folder/raster/raster.tif",
        "s3://bucket/folder/raster/raster_3857.tif",
        "s3://bucket/folder/raster/thumbnail.png",
    }
    assets = s3.json("folder/raster/collection.json")["assets"]
    assert assets["data"]["type"] == assets["visual"]["type"] == portolan.COG_MEDIA_TYPE
    assert assets["data"]["file:size"] == len(COG)


@pytest.mark.django_db
def test_a_geopackage_uploaded_to_convert_lists_its_raster_tables(cog_job, settings):
    cog_job.source_name = "rasters.gpkg"
    cog_job.save(update_fields=["source_name"])
    s3 = FakeS3()
    s3.objects[cog_job.source_key] = b"SQLite format 3\x00gpkg"
    client, submitted = converting_cng(
        s3,
        "cog",
        raster_results("dem"),
        inspection={"layers": [{"name": "roads"}], "rasterTables": [{"name": "dem"}]},
    )
    with (
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        run_conversion(cog_job.pk)

    cog_job.refresh_from_db()
    assert cog_job.status == "completed", cog_job.error
    # Only the raster tables: the vector layer is another job's.
    assert cog_job.layers == ["dem"]
    assert submitted[0]["tables"] == ["dem"]
    assert s3.objects["folder/rasters/dem/dem.tif"] == COG


@pytest.mark.django_db
def test_cog_job_status_reports_formats(cog_job, owner):
    api = APIClient()
    api.force_authenticate(user=owner)
    response = api.get(f"/api/s3/conversion/jobs/{cog_job.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["sourceFormat"] == "tiff"
    assert body["targetFormat"] == "cog"
    assert body["outputPath"] == "s3://bucket/folder/raster.tif"


@pytest.fixture
def raster_gpkg_inspect_job(settings, tmp_path, owner, connection):
    """A GeoPackage inspection that finds only raster tables (no vector layers)."""
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"

    def respond(request):
        assert request.url.path == "/api/v1/gpkg/layers"
        return httpx.Response(200, json={"layers": [], "rasterTables": [{"name": "elevation"}]})

    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.pmtiles.httpx.Client", return_value=client),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        get_client.return_value.generate_presigned_url.return_value = (
            "http://cloudnativegis/presigned"
        )
        job, layers, raster_tables = inspect_geopackage(
            gpkg_file(), "folder/rasters.gpkg", str(connection.id), owner
        )
    return job, layers, raster_tables


@pytest.mark.django_db
def test_raster_geopackage_inspection_finds_no_vector_layers(raster_gpkg_inspect_job):
    job, layers, raster_tables = raster_gpkg_inspect_job
    assert job.kind == "pmtiles"  # not yet reassigned — inspection alone doesn't decide
    assert layers == []
    assert raster_tables == [{"name": "elevation"}]


@pytest.mark.django_db
def test_start_geopackage_cog_conversion_reassigns_job_kind(
    raster_gpkg_inspect_job, settings, tmp_path, owner
):
    job, _, raster_tables = raster_gpkg_inspect_job
    # The staging directory from inspect_geopackage (kind="pmtiles") exists...
    assert (Path(settings.UPLOAD_TEMP_DIR) / "pmtiles" / str(job.id)).exists()
    with patch("apps.s3.cog.threading.Thread"):
        started = start_geopackage_cog_conversion(
            job.id, owner, [table["name"] for table in raster_tables]
        )
    started.refresh_from_db()
    assert started.kind == "cog"
    assert started.layers == ["elevation"]
    # ...and is cleaned up once reassigned, since cog's run_conversion
    # creates its own "cog" directory instead of reusing it.
    assert not (Path(settings.UPLOAD_TEMP_DIR) / "pmtiles" / str(job.id)).exists()


@pytest.mark.django_db
def test_start_geopackage_cog_conversion_requires_tables(raster_gpkg_inspect_job, owner):
    job, _, _ = raster_gpkg_inspect_job
    with pytest.raises(ValueError, match="Select at least one"):
        start_geopackage_cog_conversion(job.id, owner, [])


@pytest.mark.django_db
def test_geopackage_convert_endpoint_routes_by_format(raster_gpkg_inspect_job, settings, owner):
    job, _, raster_tables = raster_gpkg_inspect_job
    api = APIClient()
    api.force_authenticate(user=owner)
    with patch("apps.s3.cog.threading.Thread"):
        response = api.post(
            f"/api/s3/gpkg/convert/{job.id}",
            {"layers": [table["name"] for table in raster_tables], "format": "cog"},
            format="json",
        )
    assert response.status_code == 202
    job.refresh_from_db()
    assert job.kind == "cog"
