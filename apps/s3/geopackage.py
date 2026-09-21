"""Shared GeoPackage (.gpkg) upload validation for the pmtiles/cog conversion flows.

A GeoPackage can hold either vector layers (-> pmtiles) or raster tiles
(-> COG); cng-lite figures out which via ogr2ogr/gdal_translate, so
Cloudbench only needs to validate that the upload really is one.
"""

# GeoPackage is a SQLite3 database; a valid file starts with this header.
GPKG_MAGIC = b"SQLite format 3\x00"


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
