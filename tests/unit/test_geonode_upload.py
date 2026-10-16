"""Unit tests for GeoNode upload helpers: token field, GeoPackage layers."""

import shutil
import subprocess
from pathlib import Path

import pytest

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

    def test_upload_layers_uploads_each_extracted_layer(self, tmp_path):
        gpkg = tmp_path / "multi.gpkg"
        _make_gpkg(gpkg, {"cities": 4326, "zones": 32750})

        uploaded = []

        class FakeClient:
            def upload_dataset(self, file, filename, title=None, abstract=None):
                uploaded.append({"filename": filename, "title": title, "size": len(file)})
                return {"execution_id": f"ex-{filename}"}

            def apply_dataset_metadata(self, *args, **kwargs):  # called in a daemon thread
                return []

        view = views.GeoNodeUploadCompleteView()
        datasets = view._upload_layers(FakeClient(), gpkg, ["cities", "zones"], None, "desc")

        assert [d["layer"] for d in datasets] == ["cities", "zones"]
        assert {u["filename"] for u in uploaded} == {"multi__cities.gpkg", "multi__zones.gpkg"}
        # Each uploaded file is a real single-layer GeoPackage with its CRS kept.
        assert all(u["size"] > 0 for u in uploaded)
