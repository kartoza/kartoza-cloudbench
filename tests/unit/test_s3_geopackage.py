"""geopackage.validate_geopackage: upload validation, before staging to S3."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.s3.geopackage import validate_geopackage

GPKG_MAGIC = b"SQLite format 3\x00"


def gpkg_file(name="parcels.gpkg", body=b"fixture-bytes"):
    return SimpleUploadedFile(name, GPKG_MAGIC + body, "application/geopackage+sqlite3")


def test_accepts_a_valid_geopackage_without_consuming_it():
    upload = gpkg_file()
    validate_geopackage(upload, max_size=1_000_000)
    # Left readable from the start, for whatever uploads it next (e.g. to S3).
    assert upload.read() == GPKG_MAGIC + b"fixture-bytes"


def test_rejects_a_file_that_isnt_a_sqlite_database():
    upload = SimpleUploadedFile("broken.gpkg", b"not a geopackage", "application/octet-stream")
    with pytest.raises(ValueError, match="not a valid GeoPackage"):
        validate_geopackage(upload, max_size=1_000_000)


def test_rejects_an_upload_over_the_size_limit():
    upload = gpkg_file(body=b"x" * 100)
    with pytest.raises(ValueError, match="exceeds the upload size limit"):
        validate_geopackage(upload, max_size=10)
