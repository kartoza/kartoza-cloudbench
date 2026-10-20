"""Shared GeoPackage (.gpkg) upload validation and inspection for the pmtiles/cog flows.

A GeoPackage can hold either vector layers (-> pmtiles) or raster tiles
(-> COG); cng-lite converts them via ogr2ogr/gdal_translate. Cloudbench
validates the upload really is one, and reads what it holds (read_contents)
to let the user pick layers before any CloudNativeGIS server is needed.
"""

import csv
import io
import subprocess

# GeoPackage is a SQLite3 database; a valid file starts with this header.
GPKG_MAGIC = b"SQLite format 3\x00"

# Reading a GeoPackage's bookkeeping tables over HTTP takes a few range
# requests; a stalled one shouldn't hold the upload request forever.
INSPECT_TIMEOUT = 120

# A presigned URL is a single object: don't look for sibling files next to it.
GDAL_CONFIG = ["--config", "GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR"]

CONTENTS_SQL = (
    "SELECT c.table_name AS name, c.data_type AS data_type,"
    " g.geometry_type_name AS geometry_type{count}"
    " FROM gpkg_contents c"
    " LEFT JOIN gpkg_geometry_columns g ON g.table_name = c.table_name{join}"
)
# gpkg_ogr_contents is GDAL's (and QGIS's) stored feature count; a
# GeoPackage written by something else may not have it.
OGR_CONTENTS = (
    ", o.feature_count AS feature_count",
    " LEFT JOIN gpkg_ogr_contents o ON o.table_name = c.table_name",
)
RASTER_DATA_TYPES = ("tiles", "2d-gridded-coverage")

# gpkg_geometry_columns' names, as CloudNativeGIS's `ogrinfo -json` reports them.
GEOMETRY_TYPES = {
    "GEOMETRY": "Unknown",
    "POINT": "Point",
    "LINESTRING": "LineString",
    "POLYGON": "Polygon",
    "MULTIPOINT": "MultiPoint",
    "MULTILINESTRING": "MultiLineString",
    "MULTIPOLYGON": "MultiPolygon",
    "GEOMETRYCOLLECTION": "GeometryCollection",
}


def is_geopackage(filename):
    return filename.lower().endswith(".gpkg")


def prepare_geopackage(uploaded_file, destination, max_size):
    """Validate the upload is a single GeoPackage and copy it to `destination`."""
    if uploaded_file.size > max_size:
        raise ValueError("The GeoPackage exceeds the upload size limit.")
    header = uploaded_file.read(len(GPKG_MAGIC))
    uploaded_file.seek(0)
    if header != GPKG_MAGIC:
        raise ValueError("The file is not a valid GeoPackage (not a SQLite database).")
    with destination.open("wb") as output:
        for chunk in uploaded_file.chunks():
            output.write(chunk)


def _query(source, sql):
    """Rows of `sql` run on GeoPackage `source` (any GDAL path), via ogr2ogr to CSV.

    The CLI rather than GDAL's Python bindings, which the image's Python
    can't import; and not `ogrinfo -json`, which its GDAL (3.6) predates.
    """
    try:
        result = subprocess.run(
            ["ogr2ogr", *GDAL_CONFIG, "-f", "CSV", "/vsistdout/", source, "-sql", sql],
            capture_output=True,
            text=True,
            timeout=INSPECT_TIMEOUT,
            check=False,
        )
    except FileNotFoundError as exc:
        raise ValueError("ogr2ogr isn't installed on the CloudBench server.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Reading the GeoPackage timed out.") from exc
    if result.returncode != 0:
        # Drop the list of every driver tried, after "with the following drivers."
        error = result.stderr.split(" with the following drivers")[0].strip()
        raise ValueError(f"Could not read the GeoPackage: {error[-500:]}")
    return list(csv.DictReader(io.StringIO(result.stdout)))


def read_contents(source):
    """What GeoPackage `source` holds: {"layers": [...], "rasterTables": [...]}.

    The same shape as CloudNativeGIS's /api/v1/gpkg/layers: vector layers as
    {name, geometryType, featureCount} (non-spatial attribute tables left
    out), raster tables as {name}. Only a layer whose feature count isn't
    stored is counted, which reads all its rows.

    `source` is a GDAL path: for now the staged copy on disk.
    TODO: Migrate to read directly from S3, with `/vsicurl/<presigned URL>`,
    which only fetches the pages holding the gpkg_* bookkeeping tables (range
    requests; ~100 KB of a 200 MB GeoPackage), not the whole file. Works on
    MinIO, but not yet on DigitalOcean Spaces (see inspect_geopackage).
    """
    try:
        rows = _query(source, CONTENTS_SQL.format(count=OGR_CONTENTS[0], join=OGR_CONTENTS[1]))
    except ValueError:
        rows = _query(source, CONTENTS_SQL.format(count="", join=""))
    layers = []
    for row in rows:
        geometry_type = row.get("geometry_type")
        if row["data_type"] != "features" or not geometry_type:
            continue
        count = row.get("feature_count")
        if not count:
            quoted = row["name"].replace('"', '""')
            count = _query(source, f'SELECT COUNT(*) AS n FROM "{quoted}"')[0]["n"]
        layers.append(
            {
                "name": row["name"],
                "geometryType": GEOMETRY_TYPES.get(geometry_type.upper(), geometry_type),
                "featureCount": int(count),
            }
        )
    raster_tables = [{"name": row["name"]} for row in rows if row["data_type"] in RASTER_DATA_TYPES]
    return {"layers": layers, "rasterTables": raster_tables}
