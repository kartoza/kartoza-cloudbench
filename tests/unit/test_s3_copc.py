"""LAS/LAZ point clouds converted to COPC by CloudNativeGIS, and published to Portolan."""

from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3 import portolan
from apps.s3.copc import output_key, run_conversion, start_conversion
from apps.s3.models import CngLiteJob, S3Connection
from tests.unit.fake_s3 import FakeS3, converting_cng, key_of

# A COPC: a LAS header, then (at byte 377) the "copc" VLR's user id.
COPC = b"LASF".ljust(377, b"\x00") + b"copc" + b"points"
PNG = b"\x89PNG\r\n\x1a\nfixture"
INFO = {
    "bbox": [-123.07, 44.05, -123.06, 44.06],
    "count": 110000,
    "crs": "EPSG:2994",
    "dimensions": [
        {"name": "X", "size": 8, "type": "floating"},
        {"name": "Intensity", "size": 2, "type": "unsigned"},
    ],
}


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


def las_file(name="autzen.laz", header=b"LASF"):
    return SimpleUploadedFile(name, header + b"fixture-points", "application/octet-stream")


@pytest.mark.parametrize(
    "key, expected",
    [
        ("lidar/autzen.laz", "lidar/autzen.copc.laz"),
        ("lidar/autzen.las", "lidar/autzen.copc.laz"),
        ("lidar/autzen.copc.laz", "lidar/autzen.copc.laz"),
    ],
)
def test_output_key(key, expected):
    assert output_key(key) == expected


@pytest.fixture
def copc_job(settings, tmp_path, owner, connection):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    with (
        patch("apps.s3.copc.get_s3_client") as get_client,
        patch("apps.s3.copc.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}  # target folder is new
        return start_conversion(las_file(), "lidar/autzen.laz", str(connection.id), owner)


@pytest.mark.django_db
def test_upload_starts_copc_conversion(settings, tmp_path, owner, connection):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    api = APIClient()
    api.force_authenticate(user=owner)
    with (
        patch("apps.s3.copc.get_s3_client") as get_client,
        patch("apps.s3.views.get_s3_client", get_client),
        patch("apps.s3.copc.threading.Thread"),
    ):
        get_client.return_value.bucket = "bucket"
        get_client.return_value.list_objects.return_value = {"objects": []}
        response = api.post(
            f"/api/s3/upload/{connection.id}",
            {
                "file": las_file(),
                "convert": "true",
                "targetFormat": "copc",
                "key": "lidar/autzen.laz",
            },
            format="multipart",
        )

    assert response.status_code == 202, response.json()
    job = CngLiteJob.objects.get(pk=response.json()["conversionJobId"])
    assert job.kind == "copc"
    assert job.to_dict()["targetFormat"] == "copc"
    # The original LAS/LAZ is kept under sources/, as for every conversion.
    uploaded_key = get_client.return_value.client.upload_fileobj.call_args.args[2]
    assert uploaded_key.endswith("/autzen.laz")


@pytest.mark.django_db
@pytest.mark.parametrize(
    "name, header, error",
    [
        ("autzen.txt", b"LASF", "LAS or LAZ"),
        ("autzen.laz", b"NOPE", "not a valid LAS/LAZ"),
    ],
)
def test_rejects_what_isnt_a_point_cloud(
    settings, tmp_path, owner, connection, name, header, error
):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    with (
        patch("apps.s3.copc.get_s3_client") as get_client,
        patch("apps.s3.copc.threading.Thread"),
        pytest.raises(ValueError, match=error),
    ):
        get_client.return_value.list_objects.return_value = {"objects": []}
        start_conversion(las_file(name, header), "lidar/autzen.laz", str(connection.id), owner)
    assert not CngLiteJob.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("outcome", ["success", "not-a-copc"])
def test_copc_conversion_pipeline(copc_job, settings, outcome):
    s3 = FakeS3()
    client, submitted = converting_cng(
        s3,
        "copc",
        {None: {"data": (COPC, INFO), "thumbnail": (PNG, {})}},
        tamper=(
            # A plain LAS - right signature, but no COPC octree.
            (lambda url, body: b"LASF".ljust(len(body), b"\x00") if ".copc.laz" in url else body)
            if outcome == "not-a-copc"
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
        run_conversion(copc_job.pk)

    copc_job.refresh_from_db()
    assert not (Path(settings.UPLOAD_TEMP_DIR) / "copc" / str(copc_job.id)).exists()
    if outcome != "success":
        assert copc_job.status == "failed"
        assert "isn't a COPC point cloud" in copc_job.error
        assert not [key for key in s3.objects if key.startswith("lidar/autzen/")]
        return
    assert copc_job.status == "completed", copc_job.error
    [payload] = submitted
    assert payload["thumbnail"] is True
    [spec] = payload["uploads"]
    assert {role: key_of(t["url"]) for role, t in spec["files"].items()} == {
        "data": "lidar/autzen/autzen.copc.laz",
        "thumbnail": "lidar/autzen/thumbnail.png",
    }
    assert s3.content_types["lidar/autzen/autzen.copc.laz"] == portolan.COPC_MEDIA_TYPE

    collection = s3.json("lidar/autzen/collection.json")
    data = collection["assets"]["data"]
    assert data["type"] == portolan.COPC_MEDIA_TYPE
    assert data["file:size"] == len(COPC)
    # The STAC Point Cloud extension's fields, from CloudNativeGIS's report.
    assert data["pc:count"] == 110000
    assert data["pc:type"] == "lidar"
    assert data["pc:encoding"] == "LASzip"
    assert data["pc:schemas"] == INFO["dimensions"]
    assert portolan.POINTCLOUD_SCHEMA in collection["stac_extensions"]
    assert collection["extent"]["spatial"]["bbox"] == [INFO["bbox"]]
    # A MapLibre style can't draw a point cloud: none is written or listed.
    assert "style-default" not in collection["assets"]
    assert "lidar/autzen/styles/default.json" not in s3.objects
    readme = s3.objects["lidar/autzen/README.md"].decode()
    assert "Cloud Optimized Point Cloud" in readme
    assert "Points: 110000" in readme
    agents = s3.objects["lidar/autzen/AGENTS.md"].decode()
    assert "readers.copc" in agents
    assert "styles/default.json" not in agents
