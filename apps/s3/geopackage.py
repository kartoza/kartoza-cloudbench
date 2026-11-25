"""Shared GeoPackage (.gpkg) upload validation for the pmtiles/cog flows.

A GeoPackage can hold either vector layers (-> pmtiles) or raster tiles
(-> COG); cng-lite converts them via ogr2ogr/gdal_translate, and is also
what reads a GeoPackage's contents to let the user pick layers (see
apps.s3.cng_lite.CNGProcessingClient.inspect) - CloudBench only validates
the upload really is one.
"""

# GeoPackage is a SQLite3 database; a valid file starts with this header.
GPKG_MAGIC = b"SQLite format 3\x00"


def is_geopackage(filename):
    return filename.lower().endswith(".gpkg")


def validate_geopackage(uploaded_file, max_size):
    """Check the upload is a single GeoPackage within the size limit."""
    if uploaded_file.size > max_size:
        raise ValueError("The GeoPackage exceeds the upload size limit.")
    header = uploaded_file.read(len(GPKG_MAGIC))
    uploaded_file.seek(0)
    if header != GPKG_MAGIC:
        raise ValueError("The file is not a valid GeoPackage (not a SQLite database).")
