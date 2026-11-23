"""Unit tests for GeoNode upload helpers: token field, GeoPackage layers."""

import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.geonode import views


def _ogr() -> bool:
    return shutil.which("ogr2ogr") is not None and shutil.which("ogrinfo") is not None


requires_gdal = pytest.mark.skipif(not _ogr(), reason="GDAL (ogr2ogr/ogrinfo) not installed")


@pytest.mark.unit
class TestApiKeyField:
    def test_prefers_apikey_then_token(self):
        assert views._api_key({"apiKey": "a", "token": "b"}) == "a"
        assert views._api_key({"token": "b"}) == "b"
        assert views._api_key({}) == ""


def _make_gpkg(path: Path, layers: dict[str, str]) -> None:
    """Build a GeoPackage with the given {layer_name: EPSG} point layers."""
    for i, (name, epsg) in enumerate(layers.items()):
        geojson = path.parent / f"{name}.geojson"
        geojson.write_text(
            '{"type":"FeatureCollection","features":[{"type":"Feature",'
            '"properties":{},"geometry":{"type":"Point","coordinates":[115.2,-8.5]}}]}'
        )
        cmd = ["ogr2ogr", "-f", "GPKG"]
        cmd += ["-update", "-append"] if i else []
        cmd += ["-nln", name, "-t_srs", f"EPSG:{epsg}", str(path), str(geojson)]
        subprocess.run(cmd, check=True, capture_output=True)


@pytest.mark.unit
@requires_gdal
class TestGpkgLayers:
    def test_detect_layers(self, tmp_path):
        gpkg = tmp_path / "multi.gpkg"
        _make_gpkg(gpkg, {"cities": 4326, "zones": 32750})
        assert sorted(views._gpkg_layers(gpkg)) == ["cities", "zones"]

    def test_non_gpkg_has_no_layers(self, tmp_path):
        f = tmp_path / "a.geojson"
        f.write_text("{}")
        assert views._gpkg_layers(f) == []

    def test_extract_single_layer(self, tmp_path):
        gpkg = tmp_path / "multi.gpkg"
        _make_gpkg(gpkg, {"cities": 4326, "zones": 32750})
        out = tmp_path / "just_zones.gpkg"
        views._extract_gpkg_layer(gpkg, "zones", out)
        assert views._gpkg_layers(out) == ["zones"]


class FakeGeoNode:
    """Takes uploads the way GeoNodeClient.upload_dataset does: streamed."""

    def __init__(self):
        self.uploaded = []

    def upload_dataset(self, content, filename, size, response_timeout, title=None, abstract=None):
        body = b"".join(content)
        assert len(body) == size
        self.uploaded.append({"filename": filename, "title": title, "body": body})
        return {"execution_id": f"ex-{filename}"}

    def apply_dataset_metadata(self, *args, **kwargs):  # called in a daemon thread
        return []


def _stage(api, path: Path) -> str:
    """Stage a file for GeoNode as the dialog does (init, then its one chunk)."""
    data = path.read_bytes()
    started = api.post(
        "/api/upload/init", {"filename": path.name, "fileSize": len(data)}, format="json"
    )
    session_id = started.json()["sessionId"]
    sent = api.post(
        "/api/upload/chunk",
        {"sessionId": session_id, "chunkIndex": 0, "chunk": SimpleUploadedFile("c", data)},
        format="multipart",
    )
    assert sent.status_code == 200, sent.json()
    return session_id


@pytest.mark.django_db
@requires_gdal
class TestStagedGeoPackage:
    @pytest.fixture
    def geonode(self):
        client = FakeGeoNode()
        with patch("apps.geonode.views.get_geonode_client", return_value=client):
            yield client

    def test_layers_are_picked_then_uploaded_one_each(
        self, authenticated_api_client, geonode, tmp_path
    ):
        api = authenticated_api_client
        gpkg = tmp_path / "multi.gpkg"
        _make_gpkg(gpkg, {"cities": 4326, "zones": 32750})
        session_id = _stage(api, gpkg)

        detected = api.post("/api/geonode/upload/detect-layers", {"sessionId": session_id})
        assert sorted(detected.json()["layers"]) == ["cities", "zones"]

        done = api.post(
            "/api/geonode/upload/complete",
            {"sessionId": session_id, "connectionId": "g1", "sourceLayers": ["zones"]},
            format="json",
        )
        assert done.status_code == 201, done.json()
        assert done.json()["layers"] == ["zones"]
        [upload] = geonode.uploaded
        assert upload["filename"] == "multi__zones.gpkg"
        # A real single-layer GeoPackage, with its CRS kept.
        extracted = tmp_path / "out.gpkg"
        extracted.write_bytes(upload["body"])
        assert views._gpkg_layers(extracted) == ["zones"]

    def test_a_single_layer_geopackage_goes_whole(
        self, authenticated_api_client, geonode, tmp_path
    ):
        api = authenticated_api_client
        gpkg = tmp_path / "one.gpkg"
        _make_gpkg(gpkg, {"cities": 4326})
        session_id = _stage(api, gpkg)
        done = api.post(
            "/api/geonode/upload/complete",
            {"sessionId": session_id, "connectionId": "g1", "title": "Cities"},
            format="json",
        )
        assert done.status_code == 201, done.json()
        assert geonode.uploaded == [
            {"filename": "one.gpkg", "title": "Cities", "body": gpkg.read_bytes()}
        ]

    def test_only_geopackages_are_staged(self, authenticated_api_client, geonode, tmp_path):
        api = authenticated_api_client
        tif = tmp_path / "dem.tif"
        tif.write_bytes(b"II*\0")
        session_id = _stage(api, tif)
        done = api.post(
            "/api/geonode/upload/complete",
            {"sessionId": session_id, "connectionId": "g1"},
            format="json",
        )
        assert done.status_code == 400 and "Only GeoPackage" in done.json()["error"]
        assert geonode.uploaded == []

    def test_someone_elses_session_is_not_found(
        self, authenticated_api_client, geonode, tmp_path, django_user_model
    ):
        gpkg = tmp_path / "one.gpkg"
        _make_gpkg(gpkg, {"cities": 4326})
        session_id = _stage(authenticated_api_client, gpkg)
        other = APIClient()
        other.force_authenticate(django_user_model.objects.create_user(username="other"))
        for path, body in (
            ("detect-layers", {"sessionId": session_id}),
            ("complete", {"sessionId": session_id, "connectionId": "g1"}),
        ):
            response = other.post(f"/api/geonode/upload/{path}", body, format="json")
            assert response.status_code == 404
        assert geonode.uploaded == []
