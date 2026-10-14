"""Upload filename safety: the assembled file must stay inside its session dir.

The filename comes from the client, so a value like ``../x`` or ``/etc/x``
must not let the assembled upload be written outside the session's own
directory.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from apps.core.exceptions import UploadError
from apps.upload.views import _assemble_file, _safe_filename


@pytest.mark.unit
class TestSafeFilename:
    @pytest.mark.parametrize(
        "given, expected",
        [
            ("roads.zip", "roads.zip"),
            ("../../etc/passwd", "passwd"),
            ("/abs/path/dem.tif", "dem.tif"),
            ("a/b/c.gpkg", "c.gpkg"),
            (r"..\..\win.txt", r"..\..\win.txt"),  # backslashes aren't separators on POSIX
        ],
    )
    def test_keeps_basename(self, given, expected):
        assert _safe_filename(given) == expected

    @pytest.mark.parametrize("given", ["", ".", "..", "../..", "/"])
    def test_rejects_traversal_only_names(self, given):
        with pytest.raises(UploadError):
            _safe_filename(given)


@pytest.mark.unit
class TestAssembleStaysInDir:
    def _session(self, tmp_path: Path, filename: str) -> SimpleNamespace:
        (tmp_path / "chunk_000000").write_bytes(b"DATA")
        return SimpleNamespace(
            upload_dir=str(tmp_path),
            filename=filename,
            total_chunks=1,
            received_chunks=[0],
            completed=False,
            is_complete=lambda: True,
            save=lambda **_: None,
        )

    def test_normal_file_assembles(self, tmp_path):
        final = _assemble_file(self._session(tmp_path, "roads.zip"))
        assert final == tmp_path / "roads.zip" and final.read_bytes() == b"DATA"

    def test_traversal_name_cannot_escape(self, tmp_path):
        outside = tmp_path.parent / "pwned_by_test.txt"
        outside.unlink(missing_ok=True)
        # A session that slipped past init with a crafted name still can't escape.
        _assemble_file(self._session(tmp_path, "../pwned_by_test.txt"))
        assert not outside.exists(), "assembled file escaped the upload directory"
