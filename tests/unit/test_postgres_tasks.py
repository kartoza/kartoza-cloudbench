"""Unit tests for apps.postgres.tasks - upload cleanup after PG imports.

Covers the fix for a bug where importing a multi-layer file (e.g. a
GeoPackage with several layers) deleted the shared uploaded source file
after the first layer's import, breaking every subsequent layer with a
"File not found" error. Also covers zip sources, which are read in place
through GDAL's /vsizip/ instead of being extracted.
"""

import json
import shutil
import subprocess
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from apps.postgres.tasks import _cleanup, ogr_source_path, run_raster_import, run_vector_import

requires_gdal = pytest.mark.skipif(
    not (shutil.which("ogr2ogr") and shutil.which("ogrinfo")), reason="needs GDAL"
)


@pytest.fixture
def uploaded_file(tmp_path: Path) -> Path:
    """An uploaded file in its own session dir."""
    upload_dir = tmp_path / "uploads" / "session-123"
    upload_dir.mkdir(parents=True)
    file_path = upload_dir / "data.gpkg"
    file_path.write_bytes(b"fake gpkg content")
    return file_path


def _make_zip(path: Path, members: list) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        for name in members:
            zf.writestr(name, b"x")
    return path


class TestCleanup:
    """Tests for the shared _cleanup() helper."""

    def test_keeps_source_by_default(self, uploaded_file: Path) -> None:
        _cleanup(str(uploaded_file))

        assert uploaded_file.exists()

    def test_deletes_source_when_requested(self, uploaded_file: Path) -> None:
        _cleanup(str(uploaded_file), delete_source=True)

        assert not uploaded_file.parent.exists()


class TestRunVectorImport:
    """Tests for run_vector_import(), the entry point PGImportView calls."""

    @patch("apps.postgres.tasks.subprocess.run")
    def test_success_keeps_source_by_default(
        self, mock_run: MagicMock, uploaded_file: Path
    ) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")

        result = run_vector_import(["ogr2ogr", str(uploaded_file)], str(uploaded_file))

        assert result == {"status": "completed"}
        assert uploaded_file.exists()

    @patch("apps.postgres.tasks.subprocess.run")
    def test_success_deletes_source_when_flagged(
        self, mock_run: MagicMock, uploaded_file: Path
    ) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")

        result = run_vector_import(
            ["ogr2ogr", str(uploaded_file)], str(uploaded_file), delete_source=True
        )

        assert result == {"status": "completed"}
        assert not uploaded_file.parent.exists()

    @patch("apps.postgres.tasks.subprocess.run")
    def test_failure_still_cleans_up_when_flagged(
        self, mock_run: MagicMock, uploaded_file: Path
    ) -> None:
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="ogr2ogr exploded")

        result = run_vector_import(
            ["ogr2ogr", str(uploaded_file)], str(uploaded_file), delete_source=True
        )

        assert result["status"] == "failed"
        assert not uploaded_file.parent.exists()

    @patch("apps.postgres.tasks.subprocess.run")
    def test_failure_without_flag_keeps_source(
        self, mock_run: MagicMock, uploaded_file: Path
    ) -> None:
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="ogr2ogr exploded")

        result = run_vector_import(["ogr2ogr", str(uploaded_file)], str(uploaded_file))

        assert result["status"] == "failed"
        assert uploaded_file.exists()

    @patch("apps.postgres.tasks.subprocess.run")
    def test_multi_layer_sequence_keeps_source_until_last_layer(
        self, mock_run: MagicMock, uploaded_file: Path
    ) -> None:
        """Mirrors PGUploadDialog's per-layer loop for a 3-layer GeoPackage:
        one request per layer, all sharing the same uploaded file, with
        delete_source only true on the last one.
        """
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        cmd = ["ogr2ogr", str(uploaded_file)]

        run_vector_import(cmd, str(uploaded_file), delete_source=False)  # layer 1: aoi
        assert uploaded_file.exists(), "source must survive the first layer's import"

        run_vector_import(cmd, str(uploaded_file), delete_source=False)  # layer 2: boundary_lines
        assert uploaded_file.exists(), "source must survive the second layer's import"

        run_vector_import(cmd, str(uploaded_file), delete_source=True)  # layer 3: camps (last)
        assert not uploaded_file.parent.exists(), "source must be removed after the last layer"

        assert mock_run.call_count == 3

    @patch("apps.postgres.tasks.subprocess.run")
    def test_zip_source_is_passed_as_vsizip(self, mock_run: MagicMock, tmp_path: Path) -> None:
        zip_path = _make_zip(tmp_path / "up" / "x.zip", ["a.shp", "a.shx", "a.dbf"])
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")

        result = run_vector_import(["ogr2ogr", "out", str(zip_path), "a"], str(zip_path))

        assert result == {"status": "completed"}
        cmd = mock_run.call_args[0][0]
        assert f"/vsizip/{zip_path.resolve()}" in cmd
        assert str(zip_path) not in cmd
        assert not (zip_path.parent / "extracted").exists()

    def test_corrupt_zip_fails_cleanly(self, tmp_path: Path) -> None:
        bad = tmp_path / "up" / "bad.zip"
        bad.parent.mkdir()
        bad.write_text("not a zip")

        result = run_vector_import(["ogr2ogr", "out", str(bad)], str(bad), delete_source=True)

        assert result == {"status": "failed", "error": "Invalid or corrupted zip file."}
        assert not bad.parent.exists()


class TestRunRasterImport:
    """Tests for run_raster_import(), always a single call per uploaded file."""

    @patch("psycopg2.connect")
    @patch("apps.postgres.tasks.subprocess.run")
    def test_success_deletes_source(
        self, mock_run: MagicMock, mock_connect: MagicMock, uploaded_file: Path
    ) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="dummy sql", stderr="")
        mock_connect.return_value = MagicMock()

        result = run_raster_import(
            ["raster2pgsql", str(uploaded_file)],
            {"host": "localhost", "port": 5432, "user": "u", "password": "p", "dbname": "d"},
            str(uploaded_file),
        )

        assert result == {"status": "completed"}
        assert not uploaded_file.parent.exists()

    @patch("apps.postgres.tasks.subprocess.run")
    def test_raster2pgsql_failure_still_deletes_source(
        self, mock_run: MagicMock, uploaded_file: Path
    ) -> None:
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="raster2pgsql exploded")

        result = run_raster_import(
            ["raster2pgsql", str(uploaded_file)],
            {"host": "localhost", "port": 5432, "user": "u", "password": "p", "dbname": "d"},
            str(uploaded_file),
        )

        assert result["status"] == "failed"
        assert not uploaded_file.parent.exists()


@pytest.mark.unit
class TestOgrSourcePath:
    def test_non_zip_is_unchanged(self, tmp_path: Path) -> None:
        assert ogr_source_path(str(tmp_path / "a.gpkg")) == str(tmp_path / "a.gpkg")

    def test_root_shapefile_uses_zip_root(self, tmp_path: Path) -> None:
        z = _make_zip(tmp_path / "x.zip", ["a.shp", "a.shx", "a.dbf"])
        assert ogr_source_path(str(z)) == f"/vsizip/{z.resolve()}"

    def test_shapefile_in_subfolder_points_at_folder(self, tmp_path: Path) -> None:
        z = _make_zip(
            tmp_path / "x.zip",
            ["inner/x.shp", "inner/x.shx", "inner/x.dbf", "__MACOSX/inner/._x.shp"],
        )
        assert ogr_source_path(str(z)) == f"/vsizip/{z.resolve()}/inner"

    def test_single_geopackage_member(self, tmp_path: Path) -> None:
        z = _make_zip(tmp_path / "x.zip", ["data/p.gpkg"])
        assert ogr_source_path(str(z)) == f"/vsizip/{z.resolve()}/data/p.gpkg"

    def test_shapefiles_in_several_folders_raise(self, tmp_path: Path) -> None:
        z = _make_zip(tmp_path / "x.zip", ["a/x.shp", "b/y.shp"])
        with pytest.raises(ValueError, match="more than one folder"):
            ogr_source_path(str(z))

    def test_bad_zip_raises(self, tmp_path: Path) -> None:
        bad = tmp_path / "bad.zip"
        bad.write_text("not a zip")
        with pytest.raises(zipfile.BadZipFile):
            ogr_source_path(str(bad))


def _make_zipped_shapefile(
    tmp_path: Path,
    layer: str = "bali_districts",
    zip_name: str = "bali_districts_shp.zip",
    folder: str = "",
) -> Path:
    src = tmp_path / "src"
    src.mkdir(exist_ok=True)
    geojson = src / f"{layer}.geojson"
    geojson.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": 1},
                        "geometry": {"type": "Point", "coordinates": [115.0, -8.5]},
                    }
                ],
            }
        )
    )
    shp_dir = tmp_path / "shp"
    shp_dir.mkdir(exist_ok=True)
    subprocess.run(
        ["ogr2ogr", "-f", "ESRI Shapefile", str(shp_dir / f"{layer}.shp"), str(geojson)],
        check=True,
        capture_output=True,
    )
    zip_path = tmp_path / "up" / zip_name
    zip_path.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(zip_path, "w") as zf:
        for f in shp_dir.glob(f"{layer}.*"):
            zf.write(f, f"{folder}/{f.name}" if folder else f.name)
    return zip_path


@requires_gdal
class TestZippedShapefileWithGdal:
    @pytest.mark.parametrize("folder", ["", "inner"])
    def test_detects_real_layer_name_not_zip_name(self, tmp_path: Path, folder: str) -> None:
        zip_path = _make_zipped_shapefile(tmp_path, folder=folder)

        out = subprocess.run(
            ["ogrinfo", "-so", "-al", ogr_source_path(str(zip_path))],
            capture_output=True,
            text=True,
        )

        assert "Layer name: bali_districts" in out.stdout

    def test_ogr2ogr_imports_detected_layer(self, tmp_path: Path) -> None:
        zip_path = _make_zipped_shapefile(tmp_path)
        out_gpkg = tmp_path / "out.gpkg"

        def cmd(layer: str) -> list:
            return [
                "ogr2ogr", "-f", "GPKG", str(out_gpkg), str(zip_path),
                "-nlt", "PROMOTE_TO_MULTI", "-nln", "bali_districts", layer,
            ]  # fmt: skip

        result = run_vector_import(cmd("bali_districts"), str(zip_path))
        assert result == {"status": "completed"}
        info = subprocess.run(["ogrinfo", "-so", str(out_gpkg)], capture_output=True, text=True)
        assert "bali_districts" in info.stdout

        failed = run_vector_import(cmd("bali_districts_shp"), str(zip_path))
        assert failed["status"] == "failed"
        assert "Couldn't fetch requested layer" in failed["error"]
