"""CloudNativeGIS Lite PMTiles conversion contract and failure handling."""

import hashlib
import io
import zipfile
from unittest.mock import Mock, patch

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3 import cng_lite, direct_upload, portolan
from apps.s3.models import CngLiteJob, S3Connection
from apps.s3.pmtiles import (
    assets_for,
    cancel_geopackage_inspection,
    inspect_geopackage,
    output_key,
    prepare_shapefile,
    run_conversion,
    start_conversion,
    start_geopackage_conversion,
)
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


def gpkg_file(name="parcels.gpkg"):
    return SimpleUploadedFile(name, GPKG_MAGIC + b"fixture-bytes", "application/geopackage+sqlite3")


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


def test_plan_layers_names_a_shapefile_after_its_upload():
    job = Mock(source_name="roads.zip", layers=None)
    [layer] = cng_lite.plan_layers(job, [None], assets_for)
    assert (layer["name"], layer["layer_id"], layer["title"]) == (None, "roads", "Roads")
    # Each file's name - and so its final key - is known before converting.
    assert [(a["role"], a["filename"], a["media_type"]) for a in layer["assets"]] == [
        ("data", "roads.parquet", "application/vnd.apache.parquet"),
        ("visual", "roads.pmtiles", "application/vnd.pmtiles"),
        ("thumbnail", "thumbnail.png", "image/png"),
    ]


def test_plan_layers_names_a_geopackages_layers_uniquely():
    job = Mock(source_name="data.gpkg", layers=["Main Roads", "main_roads", "rivers"])
    layers = cng_lite.plan_layers(job, job.layers, assets_for)
    assert [(layer["name"], layer["layer_id"], layer["title"]) for layer in layers] == [
        ("Main Roads", "main-roads", "Main Roads"),
        ("main_roads", "main-roads-2", "Main Roads"),
        ("rivers", "rivers", "Rivers"),
    ]


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
def test_upload_starts_conversion_without_putting_zip_in_s3(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        response = api.post(
            f"/api/s3/upload/{connection.id}",
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
    job = CngLiteJob.objects.get(pk=response.json()["conversionJobId"])
    assert job.kind == "pmtiles"
    with zipfile.ZipFile(tmp_path / "pmtiles" / str(job.id) / "source.zip") as archive:
        assert len(archive.namelist()) == 3
    get_client.return_value.client.upload_fileobj.assert_called_once()


@pytest.mark.django_db
def test_upload_loose_shapefile_components_starts_conversion(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        response = api.post(
            f"/api/s3/upload/{connection.id}",
            {
                "file": SimpleUploadedFile("roads.shp", b"shape"),
                "companions": [
                    SimpleUploadedFile("roads.shx", b"index"),
                    SimpleUploadedFile("roads.dbf", b"attributes"),
                ],
                "convert": "true",
                "targetFormat": "pmtiles",
                "key": "folder/roads.shp",
            },
            format="multipart",
        )
    assert response.status_code == 202
    job = CngLiteJob.objects.get(pk=response.json()["conversionJobId"])
    assert job.input_size == len(b"shapeindexattributes")
    # Original components are persisted alongside the synthesized zip.
    assert get_client.return_value.client.upload_fileobj.call_count == 4


@pytest.mark.django_db
def test_upload_without_convert_zips_loose_components(settings, tmp_path):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))
    archives = []

    def capture_archive(**kwargs):
        archives.append((kwargs["key"], kwargs["body"].read()))
        return {"etag": "test"}

    with patch("apps.s3.views.get_s3_client") as get_client:
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        get_client.return_value.put_object.side_effect = capture_archive
        response = api.post(
            "/api/s3/upload/s3-one",
            {
                "file": SimpleUploadedFile("roads.shp", b"shape"),
                "companions": [
                    SimpleUploadedFile("roads.shx", b"index"),
                    SimpleUploadedFile("roads.dbf", b"attributes"),
                ],
                "convert": "false",
                "key": "folder/roads.shp",
            },
            format="multipart",
        )
    assert response.status_code == 201
    key, body = archives[0]
    assert key == "folder/roads.zip"
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        assert set(archive.namelist()) == {"roads.shp", "roads.shx", "roads.dbf"}


@pytest.fixture
def conversion_job(settings, tmp_path, owner, connection):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        get_client.return_value.generate_presigned_url.return_value = (
            "http://cloudnativegis/presigned"
        )
        return start_conversion(shapefile_zip(), "folder/roads.zip", str(connection.id), owner)


PMTILES = b"PMTiles\x03fixture"
PARQUET = b"PAR1fixture"
PNG = b"\x89PNG\r\n\x1a\nfixture"
COLUMNS = [{"name": "name", "type": "string"}, {"name": "geometry", "type": "binary"}]


def vector_results(layer=None):
    """What CloudNativeGIS makes of one vector layer: {role: (bytes, info)}."""
    return {
        layer: {
            "data": (PARQUET, {"columns": COLUMNS}),
            "visual": (PMTILES, {"bbox": [1, 2, 3, 4], "layers": ["default"]}),
            "thumbnail": (PNG, {}),
        }
    }


def run_with(conversion_job, s3, client, settings=None):
    updates = []
    real_update_job = cng_lite.update_job

    def record(job_id, **values):
        updates.append(values)
        real_update_job(job_id, **values)

    with (
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.update_job", side_effect=record),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        run_conversion(conversion_job.pk)
    conversion_job.refresh_from_db()
    return updates


@pytest.mark.django_db
def test_cloudnativegis_uploads_each_file_to_its_final_key(conversion_job, settings):
    s3 = FakeS3()
    client, submitted = converting_cng(
        s3,
        "pmtiles",
        vector_results(),
        detail={
            "detail": "Generating vector tiles (PMTiles): 50% · GeoParquet ready",
            "detailProgress": 0.6,
        },
    )

    updates = run_with(conversion_job, s3, client)

    assert conversion_job.status == "completed", conversion_job.error
    assert conversion_job.progress == 100
    [payload] = submitted
    assert payload["thumbnail"] is True
    # One URL per file, for its final key, signed for the only type it may carry...
    [spec] = payload["uploads"]
    assert "layer" not in spec  # a shapefile has one layer
    assert {role: key_of(t["url"]) for role, t in spec["files"].items()} == {
        "data": "folder/roads/roads.parquet",
        "visual": "folder/roads/roads.pmtiles",
        "thumbnail": "folder/roads/thumbnail.png",
    }
    assert spec["files"]["visual"]["content_type"] == "application/vnd.pmtiles"
    # ...lasting only as long as CloudBench waits for the job.
    timeout = cng_lite.conversion_timeout(conversion_job.input_size)
    assert timeout + direct_upload.URL_MARGIN in s3.expirations
    # Nothing was downloaded through CloudBench: the files are CloudNativeGIS's uploads.
    assert s3.objects["folder/roads/roads.pmtiles"] == PMTILES
    s3.client.upload_fileobj.assert_not_called()
    assert conversion_job.to_dict()["outputPaths"] == [
        "s3://bucket/folder/roads/roads.parquet",
        "s3://bucket/folder/roads/roads.pmtiles",
        "s3://bucket/folder/roads/thumbnail.png",
    ]
    assert conversion_job.output_size == len(PARQUET) + len(PMTILES) + len(PNG)
    # Progress says what's happening, and never goes back.
    steps = [(u["progress"], u.get("message")) for u in updates if "progress" in u]
    assert [p for p, _m in steps] == sorted(p for p, _m in steps)
    messages = [m for _p, m in steps]
    assert (56, "Generating vector tiles (PMTiles): 50% · GeoParquet ready") in steps
    assert "Checking the uploaded files" in messages
    assert "Writing the catalog entry: Roads" in messages


@pytest.mark.django_db
def test_portolan_metadata_records_what_cloudnativegis_uploaded(conversion_job):
    s3 = FakeS3()
    client, _submitted = converting_cng(s3, "pmtiles", vector_results())

    run_with(conversion_job, s3, client)

    assert conversion_job.status == "completed", conversion_job.error
    collection = s3.json("folder/roads/collection.json")
    assert collection["assets"]["data"]["href"] == "./roads.parquet"

    def file_fields(content):
        return {
            "file:checksum": "1220" + hashlib.sha256(content).hexdigest(),
            "file:size": len(content),
        }

    assert collection["assets"]["thumbnail"] == {
        "href": "./thumbnail.png",
        "type": "image/png",
        "title": "Roads thumbnail",
        "roles": ["thumbnail"],
        **file_fields(PNG),
    }
    data_file = {k: v for k, v in collection["assets"]["data"].items() if k.startswith("file:")}
    assert data_file == file_fields(PARQUET)
    [pmtiles_link] = [link for link in collection["links"] if link["rel"] == "pmtiles"]
    assert pmtiles_link["file:checksum"] == file_fields(PMTILES)["file:checksum"]
    # The style editor rewrites the style in place, so it never gets a checksum.
    assert not any(k.startswith("file:") for k in collection["assets"]["style-default"])
    assert portolan.FILE_SCHEMA in collection["stac_extensions"]
    assert b"![Roads](./thumbnail.png)" in s3.objects["folder/roads/README.md"]
    assert collection["table:columns"] == COLUMNS
    # bbox comes from the PMTiles (WGS84), never the GeoParquet's own CRS.
    assert collection["extent"]["spatial"]["bbox"] == [[1, 2, 3, 4]]
    assert collection["providers"] == [
        {"name": "7", "roles": ["producer"]},
        {"name": "minio", "roles": ["host"], "url": "http://minio:9000/bucket"},
    ]
    root = s3.json("catalog.json")
    assert any(link["href"] == "./folder/roads/collection.json" for link in root["links"])


@pytest.mark.django_db
def test_a_geopackage_uploaded_to_convert_is_listed_first(conversion_job):
    conversion_job.source_name = "roads.gpkg"
    conversion_job.save(update_fields=["source_name"])
    s3 = FakeS3()
    s3.objects[conversion_job.source_key] = b"SQLite format 3\x00gpkg"
    results = {**vector_results("roads"), **vector_results("rivers")}
    client, submitted = converting_cng(
        s3,
        "pmtiles",
        results,
        inspection={"layers": [{"name": "roads"}, {"name": "rivers"}], "rasterTables": []},
    )

    run_with(conversion_job, s3, client)

    assert conversion_job.status == "completed", conversion_job.error
    assert conversion_job.layers == ["roads", "rivers"]
    [payload] = submitted
    assert payload["layers"] == ["roads", "rivers"]
    assert [spec["layer"] for spec in payload["uploads"]] == ["roads", "rivers"]
    assert key_of(payload["uploads"][1]["files"]["visual"]["url"]) == (
        "folder/roads/rivers/rivers.pmtiles"
    )
    assert s3.objects["folder/roads/rivers/rivers.pmtiles"] == PMTILES
    # The original is kept once in the group folder, beside its layers.
    assert "folder/roads/source/roads.gpkg" in s3.objects
    assert conversion_job.message == "Published 2 layers to the catalog"


@pytest.mark.django_db
def test_a_skipped_layer_is_reported_not_published(conversion_job):
    conversion_job.source_name = "roads.gpkg"
    conversion_job.layers = ["roads", "broken"]
    conversion_job.save(update_fields=["source_name", "layers"])
    s3 = FakeS3()
    s3.objects[conversion_job.source_key] = b"SQLite format 3\x00gpkg"
    client, _submitted = converting_cng(
        s3,
        "pmtiles",
        vector_results("roads"),
        errors=[{"name": "broken", "error": "unsupported geometry"}],
    )

    run_with(conversion_job, s3, client)

    assert conversion_job.status == "completed", conversion_job.error
    assert conversion_job.message == "Published 1 layer to the catalog (1 skipped)"
    assert "broken: unsupported geometry" in conversion_job.error
    assert not any("broken" in key for key in s3.objects)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "tamper, error",
    [
        # Reported uploaded, but never arrived.
        (lambda url, body: None if ".pmtiles" in url else body, "isn't there"),
        # Arrived short.
        (lambda url, body: body[:4] if ".parquet" in url else body, "is 4 bytes"),
        # Arrived, but isn't what it should be.
        (
            lambda url, body: b"<html>".ljust(len(body)) if ".pmtiles" in url else body,
            "isn't a PMTiles",
        ),
    ],
)
def test_uploads_are_checked_in_the_bucket_not_taken_on_trust(conversion_job, tamper, error):
    s3 = FakeS3()
    client, _submitted = converting_cng(s3, "pmtiles", vector_results(), tamper=tamper)

    run_with(conversion_job, s3, client)

    assert conversion_job.status == "failed"
    assert error in conversion_job.error
    # Nothing published, and the new layer's folder isn't left half-written.
    assert not [key for key in s3.objects if key.startswith("folder/roads/")]
    assert "catalog.json" not in s3.objects


@pytest.mark.django_db
def test_a_replace_drops_the_old_layers_leftovers_once_the_new_one_is_up(conversion_job):
    conversion_job.replace_existing = True
    conversion_job.save(update_fields=["replace_existing"])
    s3 = FakeS3()
    s3.objects["folder/roads/old-style-thing.json"] = b"{}"
    s3.objects["folder/roads/roads.pmtiles"] = b"PMTiles old"
    client, _submitted = converting_cng(s3, "pmtiles", vector_results())

    run_with(conversion_job, s3, client)

    assert conversion_job.status == "completed", conversion_job.error
    assert "folder/roads/old-style-thing.json" not in s3.objects
    assert s3.objects["folder/roads/roads.pmtiles"] == PMTILES  # the new one
    assert "folder/roads/collection.json" in s3.objects


@pytest.mark.django_db
@pytest.mark.parametrize("outcome", ["failed", "timeout", "too-old"])
def test_conversion_failures(conversion_job, settings, outcome):
    s3 = FakeS3()

    def respond(request):
        if request.url.path == "/api/v1/pmtiles":
            return httpx.Response(202, json={"job_id": "cng-1"})
        if outcome == "failed":
            return httpx.Response(200, json={"status": "failed", "detail": "tippecanoe failed"})
        if outcome == "timeout":
            return httpx.Response(200, json={"status": "processing"})
        # A CloudNativeGIS that predates uploading results: it offers downloads.
        return httpx.Response(
            200, json={"status": "done", "results": [{"name": "output.pmtiles"}], "errors": []}
        )

    if outcome == "timeout":
        settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 0
    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))

    run_with(conversion_job, s3, client)

    assert conversion_job.status == "failed"
    assert conversion_job.error
    if outcome == "too-old":
        assert "needs updating" in conversion_job.error
    assert not [key for key in s3.objects if key.startswith("folder/roads/")]


@pytest.mark.django_db
def test_job_status_is_scoped_to_owner(conversion_job, owner, django_user_model):
    api = APIClient()
    api.force_authenticate(user=owner)
    response = api.get(f"/api/s3/conversion/jobs/{conversion_job.id}")
    assert response.status_code == 200
    assert response.json()["outputPath"] == "s3://bucket/folder/roads.pmtiles"
    assert response.json()["sourceFormat"] == "shapefile"
    assert response.json()["targetFormat"] == "pmtiles"
    api.force_authenticate(user=django_user_model.objects.create(username="8"))
    assert api.get(f"/api/s3/conversion/jobs/{conversion_job.id}").status_code == 404


@pytest.fixture
def gpkg_inspect_job(settings, tmp_path, owner, connection):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"

    def respond(request):
        assert request.url.path == "/api/v1/gpkg/layers"
        return httpx.Response(
            200,
            json={
                "layers": [{"name": "parcels", "geometryType": "Polygon", "featureCount": 3}],
                "rasterTables": [],
            },
        )

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
            gpkg_file(), "folder/parcels.gpkg", str(connection.id), owner
        )
    return job, layers, raster_tables


@pytest.mark.django_db
def test_cancel_geopackage_inspection_deletes_staged_upload(gpkg_inspect_job, owner):
    job, _, _ = gpkg_inspect_job
    with patch("apps.s3.pmtiles.get_s3_client") as get_client:
        cancel_geopackage_inspection(job.id, owner)
    get_client.return_value.delete_object.assert_called_once_with(job.source_key)
    assert not CngLiteJob.objects.filter(pk=job.id).exists()


@pytest.mark.django_db
def test_cancel_geopackage_inspection_rejects_wrong_owner(gpkg_inspect_job, django_user_model):
    job, _, _ = gpkg_inspect_job
    someone_else = django_user_model.objects.create(username="someone-else")
    with pytest.raises(ValueError, match="Job not found"):
        cancel_geopackage_inspection(job.id, someone_else)
    assert CngLiteJob.objects.filter(pk=job.id).exists()


@pytest.mark.django_db
def test_cancel_geopackage_inspection_rejects_already_confirmed_job(gpkg_inspect_job, owner):
    job, layers, _ = gpkg_inspect_job
    with patch("apps.s3.pmtiles.threading.Thread"):
        start_geopackage_conversion(job.id, owner, [layer["name"] for layer in layers])
    with pytest.raises(ValueError, match="already started"):
        cancel_geopackage_inspection(job.id, owner)


def test_conversion_timeout_scales_with_the_upload(settings):
    settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 1800
    gb = 1024**3

    assert cng_lite.conversion_timeout(10 * 1024**2) == 1800 + 6  # small: about the base
    # A 1 GB shapefile of millions of buildings gets 40 minutes, not 30.
    assert cng_lite.conversion_timeout(gb) == 1800 + 600
    assert cng_lite.conversion_timeout(1000 * gb) == 6 * 3600  # capped
