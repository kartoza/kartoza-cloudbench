"""CloudNativeGIS Lite PMTiles conversion contract and failure handling."""

import io
import json
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3.models import CngLiteJob, LayerCollection
from apps.s3.pmtiles import (
    cancel_geopackage_inspection,
    group_results,
    inspect_geopackage,
    output_key,
    prepare_shapefile,
    run_conversion,
    start_conversion,
    start_geopackage_conversion,
)

GPKG_MAGIC = b"SQLite format 3\x00"


@pytest.fixture
def owner(django_user_model):
    """Job owner; run_conversion looks it up by username (CngLiteJob.owner_id)."""
    return django_user_model.objects.create(username="7")


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


def test_group_results_plain_shapefile_uses_source_name_for_title():
    job = Mock(source_name="roads.zip", layers=None)
    results = [{"name": "output.pmtiles", "info": {}}]
    layers = group_results(job, results)
    assert len(layers) == 1
    layer = layers[0]
    assert layer["layer_id"] == "roads"
    assert layer["title"] == "Roads"
    assert layer["assets"] == [{"item": results[0], "filename": "roads.pmtiles", "role": "visual"}]


def test_group_results_pairs_geoparquet_with_pmtiles():
    job = Mock(source_name="data.gpkg", layers=["roads", "rivers"])
    results = [
        {"name": "roads.parquet", "info": {}},
        {"name": "roads.pmtiles", "info": {}},
        {"name": "rivers.parquet", "info": {}},
        {"name": "rivers.pmtiles", "info": {}},
    ]
    layers = group_results(job, results)
    assert [layer["layer_id"] for layer in layers] == ["roads", "rivers"]
    assert layers[0]["assets"] == [
        {
            "item": results[0],
            "filename": "roads.parquet",
            "role": "data",
            "media_type": "application/vnd.apache.parquet",
        },
        {"item": results[1], "filename": "roads.pmtiles", "role": "visual"},
    ]


def test_group_results_geopackage_uses_layer_names():
    job = Mock(source_name="data.gpkg", layers=["roads", "rivers"])
    results = [{"name": "roads.pmtiles", "info": {}}, {"name": "rivers.pmtiles", "info": {}}]
    layers = group_results(job, results)
    assert [layer["layer_id"] for layer in layers] == ["roads", "rivers"]
    assert [layer["title"] for layer in layers] == ["Roads", "Rivers"]


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
def test_upload_starts_conversion_without_putting_zip_in_s3(settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        response = api.post(
            "/api/s3/upload/s3-one",
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
def test_upload_loose_shapefile_components_starts_conversion(settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        response = api.post(
            "/api/s3/upload/s3-one",
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
def conversion_job(settings, tmp_path, owner):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    with (
        patch("apps.s3.pmtiles.get_s3_client") as get_client,
        patch("apps.s3.pmtiles.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.generate_presigned_url.return_value = (
            "http://cloudnativegis/presigned"
        )
        return start_conversion(shapefile_zip(), "folder/roads.zip", "s3-one", owner)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "outcome, source_name",
    [
        ("success", "roads.zip"),
        ("success", "roads.gpkg"),
        ("failed", "roads.zip"),
        ("bad-magic", "roads.zip"),
        ("timeout", "roads.zip"),
        ("s3-failed", "roads.zip"),
    ],
)
def test_conversion_pipeline(conversion_job, settings, outcome, source_name):
    conversion_job.source_name = source_name
    conversion_job.save(update_fields=["source_name"])
    requests = []
    polls = 0
    s3_client = Mock()
    s3_client.generate_presigned_url.return_value = "http://cloudnativegis/presigned/source.zip"
    uploaded = []

    def upload(source, bucket, key, **kwargs):
        if outcome == "s3-failed":
            raise RuntimeError("S3 transfer failed")
        uploaded.append((source.read(), bucket, key, kwargs))

    s3_client.client.upload_fileobj.side_effect = upload

    def respond(request):
        nonlocal polls
        requests.append((request.method, request.url.path))
        if request.url.path == "/api/v1/pmtiles":
            return httpx.Response(202, json={"job_id": "cng-job-1", "status": "processing"})
        if request.url.path == "/api/v1/jobs/cng-job-1":
            polls += 1
            if outcome == "failed":
                return httpx.Response(200, json={"status": "failed", "detail": "tippecanoe failed"})
            if outcome == "timeout":
                return httpx.Response(200, json={"status": "processing"})
            return httpx.Response(
                200,
                json={
                    "status": "done",
                    "results": [
                        {
                            "name": "output.pmtiles",
                            "result_url": "/api/v1/jobs/cng-job-1/result/output.pmtiles",
                        }
                    ],
                    "errors": [],
                },
            )
        if request.url.path == "/api/v1/jobs/cng-job-1/result/output.pmtiles":
            content = b"NOT-PMTILES" if outcome == "bad-magic" else b"PMTiles\x03fixture"
            return httpx.Response(200, content=content)
        return httpx.Response(404)

    client = httpx.Client(
        base_url="http://cloudnativegis/",
        transport=httpx.MockTransport(respond),
    )
    if outcome == "timeout":
        settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 0
    with (
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3_client),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        run_conversion(conversion_job.pk)

    conversion_job.refresh_from_db()
    assert not (Path(settings.UPLOAD_TEMP_DIR) / "pmtiles" / str(conversion_job.id)).exists()
    if outcome == "success":
        assert conversion_job.status == "completed"
        assert conversion_job.progress == 100
        # Every layer gets its own Portolan folder ("folder/roads/").
        assert uploaded[0][:3] == (b"PMTiles\x03fixture", "bucket", "folder/roads/roads.pmtiles")
        assert conversion_job.to_dict()["outputPath"] == "s3://bucket/folder/roads/roads.pmtiles"
        # Only a GeoPackage upload is grouped into a collection; a shapefile isn't.
        if source_name.endswith(".gpkg"):
            collection = LayerCollection.objects.get()
            assert collection.items.get().key == "folder/roads/roads.pmtiles"
        else:
            assert not LayerCollection.objects.exists()
    else:
        assert conversion_job.status == "failed"
        assert conversion_job.error
        assert not uploaded


@pytest.mark.django_db
@pytest.mark.parametrize("parquet_content, succeeds", [(b"PAR1fixture", True), (b"junk", False)])
def test_conversion_publishes_geoparquet_alongside_pmtiles(
    conversion_job, parquet_content, succeeds
):
    s3_client = Mock()
    s3_client.generate_presigned_url.return_value = "http://cloudnativegis/presigned/source.zip"
    s3_client.get_object.side_effect = Exception("no catalog.json yet")
    uploaded = {}

    def upload(_source, _bucket, key, **kwargs):
        uploaded[key] = kwargs["ExtraArgs"]["ContentType"]

    s3_client.client.upload_fileobj.side_effect = upload
    columns = [{"name": "name", "type": "string"}, {"name": "geometry", "type": "binary"}]
    results = {
        "output.parquet": (parquet_content, {"columns": columns}),
        "output.pmtiles": (b"PMTiles\x03fixture", {"bbox": [1, 2, 3, 4], "layers": ["default"]}),
    }

    def respond(request):
        path = request.url.path
        if path == "/api/v1/pmtiles":
            return httpx.Response(202, json={"job_id": "cng-job-1", "status": "processing"})
        if path == "/api/v1/jobs/cng-job-1":
            return httpx.Response(
                200,
                json={
                    "status": "done",
                    "results": [
                        {
                            "name": name,
                            "result_url": f"/api/v1/jobs/cng-job-1/result/{name}",
                            "info": info,
                        }
                        for name, (_, info) in results.items()
                    ],
                },
            )
        name = path.rsplit("/", 1)[-1]
        if name in results:
            return httpx.Response(200, content=results[name][0])
        return httpx.Response(404)

    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))
    with (
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.get_s3_client", return_value=s3_client),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        run_conversion(conversion_job.pk)

    conversion_job.refresh_from_db()
    if not succeeds:
        assert conversion_job.status == "failed"
        return
    assert conversion_job.status == "completed"
    assert uploaded == {
        "folder/roads/roads.parquet": "application/vnd.apache.parquet",
        "folder/roads/roads.pmtiles": "application/vnd.pmtiles",
    }
    assert conversion_job.to_dict()["outputPaths"] == [
        "s3://bucket/folder/roads/roads.parquet",
        "s3://bucket/folder/roads/roads.pmtiles",
    ]
    written = {
        call.kwargs["key"]: call.kwargs["body"] for call in s3_client.put_object.call_args_list
    }
    collection = json.loads(written["folder/roads/collection.json"])
    assert collection["assets"]["data"]["href"] == "./roads.parquet"
    assert collection["table:columns"] == columns
    # bbox comes from the PMTiles (WGS84), never the GeoParquet's own CRS.
    assert collection["extent"]["spatial"]["bbox"] == [[1, 2, 3, 4]]


@pytest.mark.django_db
def test_job_status_is_scoped_to_owner(conversion_job):
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))
    response = api.get(f"/api/s3/conversion/jobs/{conversion_job.id}")
    assert response.status_code == 200
    assert response.json()["outputPath"] == "s3://bucket/folder/roads.pmtiles"
    assert response.json()["sourceFormat"] == "shapefile"
    assert response.json()["targetFormat"] == "pmtiles"
    api.force_authenticate(user=Mock(id=8, username="8", is_authenticated=True))
    assert api.get(f"/api/s3/conversion/jobs/{conversion_job.id}").status_code == 404


@pytest.fixture
def gpkg_inspect_job(settings, tmp_path, owner):
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
        get_client.return_value.generate_presigned_url.return_value = (
            "http://cloudnativegis/presigned"
        )
        job, layers, raster_tables = inspect_geopackage(
            gpkg_file(), "folder/parcels.gpkg", "s3-one", owner
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
def test_cancel_geopackage_inspection_rejects_wrong_owner(gpkg_inspect_job):
    job, _, _ = gpkg_inspect_job
    with pytest.raises(ValueError, match="Job not found"):
        cancel_geopackage_inspection(job.id, Mock(username="someone-else"))
    assert CngLiteJob.objects.filter(pk=job.id).exists()


@pytest.mark.django_db
def test_cancel_geopackage_inspection_rejects_already_confirmed_job(gpkg_inspect_job, owner):
    job, layers, _ = gpkg_inspect_job
    with patch("apps.s3.pmtiles.threading.Thread"):
        start_geopackage_conversion(job.id, owner, [layer["name"] for layer in layers])
    with pytest.raises(ValueError, match="already started"):
        cancel_geopackage_inspection(job.id, owner)
