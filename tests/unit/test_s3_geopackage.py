"""geopackage.read_contents: a GeoPackage's layers and raster tables, via ogr2ogr."""

import shutil
import sqlite3
import subprocess

import pytest

from apps.s3.geopackage import read_contents

pytestmark = pytest.mark.skipif(not shutil.which("ogr2ogr"), reason="needs GDAL's ogr2ogr")

POLYGONS = (
    '{"type": "FeatureCollection", "features": ['
    '{"type": "Feature", "properties": {"n": 1}, "geometry": {"type": "Polygon",'
    ' "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}},'
    '{"type": "Feature", "properties": {"n": 2}, "geometry": {"type": "Polygon",'
    ' "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 0]]]}}]}'
)


def ogr2ogr(*args):
    subprocess.run(["ogr2ogr", *args], check=True, capture_output=True)


@pytest.fixture
def gpkg(tmp_path):
    """Two polygon layers (one with a quote in its name) and an attribute table."""
    path = tmp_path / "source.gpkg"
    geojson = tmp_path / "polygons.geojson"
    geojson.write_text(POLYGONS)
    attributes = tmp_path / "attributes.csv"
    attributes.write_text("x,y\n1,2\n")
    ogr2ogr("-f", "GPKG", str(path), str(geojson), "-nln", "parcels")
    ogr2ogr("-update", str(path), str(geojson), "-nln", 'roads "main"', "-nlt", "MULTIPOLYGON")
    ogr2ogr("-update", str(path), str(attributes), "-nln", "attributes")
    return path


def test_lists_vector_layers_without_attribute_tables(gpkg):
    assert read_contents(str(gpkg)) == {
        "layers": [
            {"name": "parcels", "geometryType": "Polygon", "featureCount": 2},
            {"name": 'roads "main"', "geometryType": "MultiPolygon", "featureCount": 2},
        ],
        "rasterTables": [],
    }


def test_counts_features_without_gpkg_ogr_contents(gpkg):
    with sqlite3.connect(gpkg) as connection:
        connection.execute("DROP TABLE gpkg_ogr_contents")
    layers = read_contents(str(gpkg))["layers"]
    assert [layer["featureCount"] for layer in layers] == [2, 2]


def test_lists_raster_tables(gpkg):
    with sqlite3.connect(gpkg) as connection:
        connection.execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier)"
            " VALUES ('elevation', '2d-gridded-coverage', 'elevation')"
        )
    assert read_contents(str(gpkg))["rasterTables"] == [{"name": "elevation"}]


def test_unreadable_file_raises_value_error(tmp_path):
    path = tmp_path / "broken.gpkg"
    path.write_bytes(b"SQLite format 3\x00" + b"\x00" * 100)
    with pytest.raises(ValueError, match="Could not read the GeoPackage"):
        read_contents(str(path))
