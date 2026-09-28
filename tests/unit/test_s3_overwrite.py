"""Uploads never silently overwrite an existing layer or GeoPackage layer group."""

from unittest.mock import Mock, patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3 import cog, pmtiles, portolan
from apps.s3.cng_lite import target_folder
from apps.s3.models import CngLiteJob

GPKG_MAGIC = b"SQLite format 3\x00"


def tiff_file(name="raster.tif"):
    return SimpleUploadedFile(name, b"II*\x00fixture", "image/tiff")


def gpkg_file(name="castelo-branco.gpkg"):
    return SimpleUploadedFile(name, GPKG_MAGIC + b"fixture", "application/geopackage+sqlite3")


@pytest.fixture
def api():
    client = APIClient()
    client.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))
    return client


def bucket_with(*keys):
    """A mock S3 client whose listing of any prefix finds `keys` under it."""
    client = Mock(bucket="bucket")

    def list_objects(prefix="", **kwargs):
        return {"objects": [{"key": key} for key in keys if key.startswith(prefix)]}

    client.list_objects.side_effect = list_objects
    return client


# -- Duplicate layer ids within one GeoPackage -------------------------------


def test_unique_layer_id_suffixes_repeats():
    taken = set()
    assert [portolan.unique_layer_id("roads", taken) for _ in range(3)] == [
        "roads",
        "roads-2",
        "roads-3",
    ]


def test_geopackage_layers_differing_only_in_case_get_distinct_folders():
    job = Mock(source_name="data.gpkg", layers=["Roads", "roads"])
    results = [
        {"name": "Roads.parquet"},
        {"name": "Roads.pmtiles"},
        {"name": "roads.parquet"},
        {"name": "roads.pmtiles"},
    ]
    layers = pmtiles.group_results(job, results)
    assert [layer["layer_id"] for layer in layers] == ["roads", "roads-2"]
    assert layers[1]["assets"][0]["filename"] == "roads-2.parquet"


def test_raster_tables_differing_only_in_case_get_distinct_folders():
    job = Mock(source_name="rasters.gpkg", layers=None)
    results = [
        {"name": "DEM_cog.tif"},
        {"name": "DEM_cog_3857.tif"},
        {"name": "dem_cog.tif"},
        {"name": "dem_cog_3857.tif"},
    ]
    with patch("apps.s3.cog.is_geopackage", return_value=True):
        layers = cog.group_results(job, results)
    assert [layer["layer_id"] for layer in layers] == ["dem", "dem-2"]


# -- Where an upload publishes ------------------------------------------------


@pytest.mark.parametrize(
    "key, filename, expected",
    [
        ("roads.zip", "roads.zip", "roads"),
        ("imports/roads.zip", "roads.zip", "imports/roads"),
        ("imports/custom-name.pmtiles", "Roads.shp", "imports/roads"),
        ("CasteloBranco.pmtiles", "CasteloBranco.gpkg", "castelobranco"),
        ("dem.tif", "DEM 2024.tif", "dem-2024"),
    ],
)
def test_target_folder(key, filename, expected):
    assert target_folder(key, filename) == expected


def test_sources_is_reserved():
    # Every job's raw upload lives in "<parent>/sources/": never a layer folder.
    with pytest.raises(ValueError, match="reserved"):
        target_folder("sources.tif", "sources.tif")


# -- Refusing, then confirming, an overwrite ----------------------------------


def upload(api, client, file, replace=False):
    with (
        patch("apps.s3.cog.get_s3_client", return_value=client),
        patch("apps.s3.views.get_s3_client", return_value=client),
        patch("apps.s3.cog.threading.Thread"),
    ):
        data = {"file": file, "convert": "true", "targetFormat": "cog", "key": "maps/raster.tif"}
        if replace:
            data["replace"] = "true"
        return api.post("/api/s3/upload/s3-one", data, format="multipart")


@pytest.mark.django_db
def test_upload_into_an_existing_layer_is_refused_until_confirmed(api, settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    client = bucket_with("maps/raster/collection.json")

    refused = upload(api, client, tiff_file())
    assert refused.status_code == 409
    assert refused.json()["conflict"] == {"folder": "maps/raster", "kind": "layer"}
    assert not CngLiteJob.objects.exists()
    client.client.upload_fileobj.assert_not_called()  # the source never reached S3

    confirmed = upload(api, client, tiff_file(), replace=True)
    assert confirmed.status_code == 202
    assert CngLiteJob.objects.get().replace_existing is True


@pytest.mark.django_db
def test_upload_into_a_new_folder_needs_no_confirmation(api, settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    # A different layer that merely shares a prefix ("maps/raster-2/") isn't a clash.
    response = upload(api, bucket_with("maps/raster-2/collection.json"), tiff_file())
    assert response.status_code == 202
    assert CngLiteJob.objects.get().replace_existing is False


@pytest.mark.django_db
def test_geopackage_inspection_is_refused_for_an_existing_layer_group(api, settings, tmp_path):
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    client = bucket_with("castelo-branco/catalog.json")
    with patch("apps.s3.pmtiles.get_s3_client", return_value=client):
        response = api.post(
            "/api/s3/gpkg/inspect/s3-one", {"file": gpkg_file()}, format="multipart"
        )
    assert response.status_code == 409
    assert response.json()["conflict"] == {"folder": "castelo-branco", "kind": "layer group"}


@pytest.mark.django_db
def test_target_endpoint_reports_before_uploading(api):
    client = bucket_with("maps/raster/collection.json")
    with patch("apps.s3.views.get_s3_client", return_value=client):
        existing = api.post(
            "/api/s3/portolan/target/s3-one",
            {"filename": "raster.tif", "key": "maps/raster.tif"},
            format="json",
        ).json()
        new = api.post(
            "/api/s3/portolan/target/s3-one",
            {"filename": "Castelo Branco.gpkg"},
            format="json",
        ).json()
        reserved = api.post(
            "/api/s3/portolan/target/s3-one", {"filename": "sources.zip"}, format="json"
        )
    assert existing == {"folder": "maps/raster", "exists": True, "kind": "layer"}
    assert new == {"folder": "castelo-branco", "exists": False, "kind": "layer group"}
    assert reserved.status_code == 400


# -- Replacing -----------------------------------------------------------------


@pytest.mark.django_db
def test_replace_clears_the_folder_before_publishing():
    from apps.s3.cng_lite import _clear_for_replace

    job = CngLiteJob.objects.create(
        kind="pmtiles",
        owner_id="7",
        connection_id="conn",
        bucket="bucket",
        source_name="castelo-branco.gpkg",
        output_key="maps/castelo-branco.pmtiles",
        input_size=1,
        replace_existing=True,
    )
    client = Mock()

    _clear_for_replace(job, client)

    # Map Explorer's group for it is read from the catalog, so it goes with the folder.
    client.delete_prefix.assert_called_once_with("maps/castelo-branco/")
