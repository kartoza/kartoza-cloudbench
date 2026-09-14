"""Unit tests for apps.postgres.tasks - upload cleanup after PG imports.

Covers the fix for a bug where importing a multi-layer file (e.g. a
GeoPackage with several layers) deleted the shared uploaded source file
after the first layer's import, breaking every subsequent layer with a
"File not found" error.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from apps.postgres.tasks import _cleanup, run_raster_import, run_vector_import


@pytest.fixture
def uploaded_file(tmp_path: Path) -> Path:
    """An uploaded file in its own session dir, plus a stale 'extracted'
    scratch dir left over from a previous zip-shapefile extraction.
    """
    upload_dir = tmp_path / "uploads" / "session-123"
    upload_dir.mkdir(parents=True)
    file_path = upload_dir / "data.gpkg"
    file_path.write_bytes(b"fake gpkg content")
    extracted_dir = upload_dir / "extracted"
    extracted_dir.mkdir()
    (extracted_dir / "data.shp").write_bytes(b"fake shp content")
    return file_path


class TestCleanup:
    """Tests for the shared _cleanup() helper."""

    def test_keeps_source_by_default(self, uploaded_file: Path) -> None:
        _cleanup(str(uploaded_file))

        assert uploaded_file.exists()
        assert not (uploaded_file.parent / "extracted").exists()

    def test_deletes_source_when_requested(self, uploaded_file: Path) -> None:
        _cleanup(str(uploaded_file), delete_source=True)

        assert not uploaded_file.parent.exists()

    def test_missing_extracted_dir_is_not_an_error(self, tmp_path: Path) -> None:
        file_path = tmp_path / "data.geojson"
        file_path.write_bytes(b"{}")

        _cleanup(str(file_path))  # no "extracted" dir was ever created

        assert file_path.exists()


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
