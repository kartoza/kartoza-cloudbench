"""Generate the files for testing CloudBench uploads by hand.

Covers the four targets (PostGIS, GeoServer, GeoNode, S3) and the S3
CloudNativeGIS conversions, on-demand included. Everything is synthetic and
lies around Bali (EPSG:4326, or UTM 50S / EPSG:32750 where a projected CRS is
the point), so layers from different files overlap on the map.

    python3 tests/staging/manual-test-data/generate.py            # small and medium files
    python3 tests/staging/manual-test-data/generate.py --large    # also the large ones (cancel tests)

Needs GDAL's Python bindings (``osgeo``) and numpy. Output goes next to this
script; see README.md for which file to use where.
"""

import argparse
import json
import random
import shutil
import struct
import zipfile
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

ROOT = Path(__file__).resolve().parent
SEED = 20261013

# Bali, roughly.
WEST, SOUTH, EAST, NORTH = 114.4, -8.85, 115.75, -8.05

PLACES = [
    ("Denpasar", 115.2167, -8.65, 726599, "kota"),
    ("Singaraja", 115.0889, -8.1120, 150000, "kota"),
    ("Ubud", 115.2625, -8.5069, 74800, "desa"),
    ("Gianyar", 115.3250, -8.5442, 93000, "kabupaten"),
    ("Tabanan", 115.1250, -8.5400, 76000, "kabupaten"),
    ("Negara", 114.6150, -8.3580, 80000, "kabupaten"),
    ("Amlapura", 115.6130, -8.4500, 41000, "kabupaten"),
    ("Kuta", 115.1710, -8.7230, 47600, "desa"),
    ("Nusa Dua", 115.2300, -8.8000, 21000, "desa"),
    ("Kintamani", 115.3330, -8.2500, None, "desa"),  # null population on purpose
]


def srs(epsg):
    ref = osr.SpatialReference()
    ref.ImportFromEPSG(epsg)
    ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return ref


def reset(path):
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


# --------------------------------------------------------------------------
# Geometries (as GeoJSON-like dicts, lon/lat)
# --------------------------------------------------------------------------


def city_features():
    features = []
    for i, (name, lon, lat, population, kind) in enumerate(PLACES, start=1):
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": i,
                    "name": name,
                    "kind": kind,
                    "population": population,
                    "area_km2": round(random.uniform(5, 130), 3),
                    "founded": f"{random.randint(1500, 1950)}-01-01",
                    "is_capital": name == "Denpasar",
                    # Non-ASCII on purpose: encoding must survive every target.
                    "note": "Pura Ulun Danu — ñ é ü 日本",
                },
            }
        )
    return features


def road_features():
    by_name = {p[0]: (p[1], p[2]) for p in PLACES}
    routes = [
        ("Jalan Denpasar–Singaraja", ["Denpasar", "Tabanan", "Kintamani", "Singaraja"], "primary"),
        ("Jalan Denpasar–Gilimanuk", ["Denpasar", "Tabanan", "Negara"], "primary"),
        ("Jalan Bypass Ngurah Rai", ["Kuta", "Denpasar", "Nusa Dua"], "trunk"),
        ("Jalan Ubud–Amlapura", ["Ubud", "Gianyar", "Amlapura"], "secondary"),
    ]
    features = []
    for i, (name, stops, kind) in enumerate(routes, start=1):
        coords = []
        for a, b in zip(stops, stops[1:], strict=False):
            (x1, y1), (x2, y2) = by_name[a], by_name[b]
            for t in np.linspace(0, 1, 12, endpoint=False):
                coords.append(
                    [x1 + (x2 - x1) * t + random.uniform(-0.004, 0.004), y1 + (y2 - y1) * t]
                )
        coords.append(list(by_name[stops[-1]]))
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "id": i,
                    "name": name,
                    "class": kind,
                    "lanes": random.choice([2, 4]),
                },
            }
        )
    return features


def district_features():
    """A 3x3 grid of districts over Bali; one of them a MultiPolygon."""
    features = []
    cols, rows = 3, 3
    dx, dy = (EAST - WEST) / cols, (NORTH - SOUTH) / rows
    n = 0
    for r in range(rows):
        for c in range(cols):
            n += 1
            x0, y0 = WEST + c * dx, SOUTH + r * dy
            ring = [[x0, y0], [x0 + dx, y0], [x0 + dx, y0 + dy], [x0, y0 + dy], [x0, y0]]
            if n == 5:
                # Second part (an islet) and a hole: MultiPolygon with interior ring.
                hole = [
                    [x0 + dx * 0.4, y0 + dy * 0.4],
                    [x0 + dx * 0.4, y0 + dy * 0.6],
                    [x0 + dx * 0.6, y0 + dy * 0.6],
                    [x0 + dx * 0.6, y0 + dy * 0.4],
                    [x0 + dx * 0.4, y0 + dy * 0.4],
                ]
                islet = [
                    [x0 + 0.01, y0 - 0.08],
                    [x0 + 0.08, y0 - 0.08],
                    [x0 + 0.08, y0 - 0.02],
                    [x0 + 0.01, y0 - 0.08],
                ]
                geometry = {"type": "MultiPolygon", "coordinates": [[ring, hole], [islet]]}
            else:
                geometry = {"type": "MultiPolygon", "coordinates": [[ring]]}
            features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {
                        "id": n,
                        "code": f"BALI-{n:02d}",
                        "name": f"Distrik {n}",
                        "density": round(random.uniform(100, 3000), 1),
                    },
                }
            )
    return features


def random_points(count):
    for i in range(1, count + 1):
        yield {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [random.uniform(WEST, EAST), random.uniform(SOUTH, NORTH)],
            },
            "properties": {
                "id": i,
                "category": random.choice(["temple", "warung", "hotel", "school", "clinic"]),
                "value": round(random.gauss(50, 15), 2),
            },
        }


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------


def write_geojson(path, features):
    reset(path)
    path.write_text(
        json.dumps({"type": "FeatureCollection", "features": list(features)}, ensure_ascii=False),
        encoding="utf-8",
    )


def convert_vector(source, target, driver, layer_name=None, epsg=None, options=(), append=False):
    """ogr2ogr ``source`` into ``target`` (optionally reprojected)."""
    if not append:
        reset(target)
    kwargs = {"format": driver, "layerCreationOptions": list(options)}
    if layer_name:
        kwargs["layerName"] = layer_name
    if epsg:
        kwargs["dstSRS"] = f"EPSG:{epsg}"
        kwargs["reproject"] = True
    if append:
        kwargs["accessMode"] = "update"
    gdal.VectorTranslate(str(target), str(source), **kwargs)


def zip_shapefile(shp, zip_path, skip=()):
    reset(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for part in sorted(shp.parent.glob(f"{shp.stem}.*")):
            if part.suffix.lower() not in skip:
                archive.write(part, part.name)


def write_raster(path, data, bounds, epsg, nodata=None, options=("COMPRESS=DEFLATE", "TILED=YES")):
    """Write ``data`` (bands, rows, cols) as a GeoTIFF covering ``bounds``."""
    reset(path)
    bands, rows, cols = data.shape
    dtype = gdal.GDT_Float32 if data.dtype == np.float32 else gdal.GDT_Byte
    if data.dtype == np.uint16:
        dtype = gdal.GDT_UInt16
    ds = gdal.GetDriverByName("GTiff").Create(str(path), cols, rows, bands, dtype, list(options))
    west, south, east, north = bounds
    ds.SetGeoTransform((west, (east - west) / cols, 0, north, 0, -(north - south) / rows))
    ds.SetProjection(srs(epsg).ExportToWkt())
    for b in range(bands):
        band = ds.GetRasterBand(b + 1)
        band.WriteArray(data[b])
        if nodata is not None:
            band.SetNoDataValue(nodata)
    if bands == 3:
        for b, ci in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand), start=1):
            ds.GetRasterBand(b).SetColorInterpretation(ci)
    ds.FlushCache()
    ds = None


def elevation(rows, cols, bounds):
    """A smooth fake DEM: a few volcanoes (Agung, Batur, Batukaru) plus noise."""
    west, south, east, north = bounds
    lon = np.linspace(west, east, cols, dtype=np.float32)
    lat = np.linspace(north, south, rows, dtype=np.float32)
    x, y = np.meshgrid(lon, lat)
    z = np.zeros_like(x)
    for vx, vy, height, spread in (
        (115.508, -8.343, 3031, 0.12),
        (115.375, -8.242, 1717, 0.08),
        (115.09, -8.33, 2276, 0.1),
    ):
        z += height * np.exp(-(((x - vx) ** 2 + (y - vy) ** 2) / (2 * spread**2)))
    z += np.random.default_rng(SEED).normal(0, 5, z.shape).astype(np.float32)
    z = np.clip(z, 0, None).astype(np.float32)
    z[z < 2] = -9999  # sea -> nodata
    return z


def write_las(path, count, epsg=32750):
    """A LAS 1.2, point format 0, with an EPSG GeoKey VLR (no laspy needed)."""
    reset(path)
    rng = np.random.default_rng(SEED)
    # Ubud-ish area in UTM 50S.
    x0, y0 = 307000.0, 9058000.0
    xs = x0 + rng.uniform(0, 1000, count)
    ys = y0 + rng.uniform(0, 1000, count)
    zs = 200 + 30 * np.sin(xs / 80) * np.cos(ys / 120) + rng.normal(0, 0.5, count)
    classes = rng.choice([2, 3, 5, 6], count, p=[0.5, 0.2, 0.2, 0.1]).astype(np.uint8)
    scale = 0.01

    # GeoKeyDirectoryTag: header + 3 keys.
    keys = [1, 1, 0, 3, 1024, 0, 1, 1, 3072, 0, 1, epsg, 3076, 0, 1, 9001]
    vlr_data = struct.pack(f"<{len(keys)}H", *keys)
    vlr = (
        struct.pack(
            "<H16sHH32s", 0, b"LASF_Projection", 34735, len(vlr_data), b"GeoKeyDirectoryTag"
        )
        + vlr_data
    )

    header_size, point_size = 227, 20
    offset = header_size + len(vlr)
    by_return = [count, 0, 0, 0, 0]
    header = struct.pack(
        "<4sHHLHH8sBB32s32sHHHLLBHL5L3d3d6d",
        b"LASF",
        0,
        0,
        0,
        0,
        0,
        b"\0" * 8,
        1,
        2,
        b"CloudBench manual test".ljust(32, b"\0"),
        b"generate.py".ljust(32, b"\0"),
        286,
        2026,
        header_size,
        offset,
        1,
        0,
        point_size,
        count,
        *by_return,
        scale,
        scale,
        scale,
        x0,
        y0,
        0.0,
        xs.max(),
        xs.min(),
        ys.max(),
        ys.min(),
        zs.max(),
        zs.min(),
    )
    assert len(header) == header_size
    points = np.zeros(
        count,
        dtype=[
            ("x", "<i4"),
            ("y", "<i4"),
            ("z", "<i4"),
            ("i", "<u2"),
            ("f", "u1"),
            ("c", "u1"),
            ("a", "i1"),
            ("u", "u1"),
            ("p", "<u2"),
        ],
    )
    points["x"] = np.round((xs - x0) / scale)
    points["y"] = np.round((ys - y0) / scale)
    points["z"] = np.round(zs / scale)
    points["i"] = rng.integers(0, 4000, count)
    points["f"] = 0b00001001  # return 1 of 1
    points["c"] = classes
    with open(path, "wb") as f:
        f.write(header)
        f.write(vlr)
        f.write(points.tobytes())


def write_pdf(path, text):
    """A one-page PDF, written by hand (for GeoNode document uploads)."""
    reset(path)
    stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    path.write_bytes(bytes(out))


# --------------------------------------------------------------------------
# Sets
# --------------------------------------------------------------------------


def vectors():
    d = ROOT / "vector"
    d.mkdir(exist_ok=True)
    tmp = ROOT / ".tmp"
    tmp.mkdir(exist_ok=True)

    cities, roads, districts = city_features(), road_features(), district_features()
    write_geojson(d / "bali_cities.geojson", cities)
    write_geojson(d / "bali_roads.geojson", roads)
    write_geojson(d / "bali_districts.geojson", districts)
    # Same content, .json suffix (PostGIS / GeoNode accept it as GeoJSON).
    shutil.copy(d / "bali_cities.geojson", d / "bali_cities.json")

    # Shapefiles, zipped (GeoServer / GeoNode / PostGIS / S3).
    shp = tmp / "bali_districts.shp"
    convert_vector(
        d / "bali_districts.geojson",
        shp,
        "ESRI Shapefile",
        "bali_districts",
        options=["ENCODING=UTF-8"],
    )
    zip_shapefile(shp, d / "bali_districts_shp.zip")
    zip_shapefile(shp, ROOT / "invalid" / "shapefile_missing_shx.zip", skip={".shx"})
    shp_utm = tmp / "bali_districts_utm50s.shp"
    convert_vector(
        d / "bali_districts.geojson",
        shp_utm,
        "ESRI Shapefile",
        "bali_districts_utm50s",
        epsg=32750,
        options=["ENCODING=UTF-8"],
    )
    zip_shapefile(shp_utm, d / "bali_districts_utm50s_shp.zip")
    shp_roads = tmp / "bali_roads.shp"
    convert_vector(
        d / "bali_roads.geojson",
        shp_roads,
        "ESRI Shapefile",
        "bali_roads",
        options=["ENCODING=UTF-8"],
    )
    zip_shapefile(shp_roads, d / "bali_roads_shp.zip")

    # FlatGeobuf, KML, KMZ.
    convert_vector(d / "bali_districts.geojson", d / "bali_districts.fgb", "FlatGeobuf")
    convert_vector(d / "bali_cities.geojson", d / "bali_cities.kml", "KML", "bali_cities")
    reset(d / "bali_cities.kmz")
    with zipfile.ZipFile(d / "bali_cities.kmz", "w", zipfile.ZIP_DEFLATED) as kmz:
        kmz.write(d / "bali_cities.kml", "doc.kml")

    # CSV: one with lat/lon columns, one with a WKT column.
    rows = ["id,name,kind,population,latitude,longitude"]
    rows += [
        f"{i},{n},{k},{'' if p is None else p},{la},{lo}"
        for i, (n, lo, la, p, k) in enumerate(PLACES, 1)
    ]
    (d / "bali_cities_latlon.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    rows = ["id,name,kind,WKT"]
    rows += [f'{i},{n},{k},"POINT ({lo} {la})"' for i, (n, lo, la, _, k) in enumerate(PLACES, 1)]
    (d / "bali_cities_wkt.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")

    # GeoPackage with three vector layers (+ one in a projected CRS).
    gpkg = d / "bali_multi_layer.gpkg"
    convert_vector(d / "bali_cities.geojson", gpkg, "GPKG", "cities")
    convert_vector(d / "bali_roads.geojson", gpkg, "GPKG", "roads", append=True)
    convert_vector(d / "bali_districts.geojson", gpkg, "GPKG", "districts", append=True)
    convert_vector(
        d / "bali_districts.geojson", gpkg, "GPKG", "districts_utm50s", epsg=32750, append=True
    )

    # Single-layer GeoPackage (simplest GeoServer / GeoNode case).
    convert_vector(
        d / "bali_districts.geojson", d / "bali_districts.gpkg", "GPKG", "bali_districts"
    )

    # Medium: 50k points, for a conversion that takes a moment.
    write_geojson(d / "bali_poi_50k.geojson", random_points(50_000))
    convert_vector(d / "bali_poi_50k.geojson", d / "bali_poi_50k.fgb", "FlatGeobuf")

    shutil.rmtree(tmp)


def rasters():
    d = ROOT / "raster"
    d.mkdir(exist_ok=True)
    bounds = (WEST, SOUTH, EAST, NORTH)

    dem = elevation(1024, 1600, bounds)
    write_raster(d / "bali_dem.tif", dem[None], bounds, 4326, nodata=-9999)

    # RGB "orthophoto" derived from the DEM (byte, 3 bands, no nodata).
    land = dem > 0
    r = np.where(land, 60 + dem / 3031 * 150, 20).astype(np.uint8)
    g = np.where(land, 140 - dem / 3031 * 60, 60).astype(np.uint8)
    b = np.where(land, 60, 140).astype(np.uint8)
    write_raster(
        d / "bali_rgb.tif",
        np.stack([r, g, b]),
        bounds,
        4326,
        options=("COMPRESS=DEFLATE", "TILED=YES", "PHOTOMETRIC=RGB"),
    )

    # Projected CRS (UTM 50S), striped (not tiled), uncompressed: a "plain" GeoTIFF.
    utm = gdal.Warp(
        "", str(d / "bali_dem.tif"), format="MEM", dstSRS="EPSG:32750", xRes=100, yRes=100
    )
    reset(d / "bali_dem_utm50s.tif")
    gdal.Translate(str(d / "bali_dem_utm50s.tif"), utm, creationOptions=[])

    # Already a COG: conversion should be quick / a no-op.
    reset(d / "bali_dem_already_cog.tif")
    gdal.Translate(
        str(d / "bali_dem_already_cog.tif"),
        str(d / "bali_dem.tif"),
        format="COG",
        creationOptions=["COMPRESS=DEFLATE"],
    )

    # Mosaic: the DEM cut into 2x2 tiles (S3 multi-file upload -> one COG).
    tiles = d / "mosaic_tiles"
    reset(tiles)
    tiles.mkdir()
    rows, cols = dem.shape
    xres, yres = (EAST - WEST) / cols, (NORTH - SOUTH) / rows
    n = 0
    for ty in range(2):
        for tx in range(2):
            n += 1
            r0, r1 = ty * rows // 2, (ty + 1) * rows // 2
            c0, c1 = tx * cols // 2, (tx + 1) * cols // 2
            tb = (WEST + c0 * xres, NORTH - r1 * yres, WEST + c1 * xres, NORTH - r0 * yres)
            write_raster(
                tiles / f"bali_dem_{n:02d}.tif", dem[None, r0:r1, c0:c1], tb, 4326, nodata=-9999
            )

    # GeoPackage with a raster table and a vector layer (S3: two jobs from one file).
    gpkg = d / "bali_vector_and_raster.gpkg"
    reset(gpkg)
    gdal.Translate(
        str(gpkg),
        str(d / "bali_rgb.tif"),
        format="GPKG",
        creationOptions=["RASTER_TABLE=rgb", "TILE_FORMAT=PNG"],
    )
    convert_vector(
        ROOT / "vector" / "bali_districts.geojson", gpkg, "GPKG", "districts", append=True
    )

    # PNG for GeoNode document upload.
    gdal.Translate(
        str(ROOT / "documents" / "bali_preview.png"),
        str(d / "bali_rgb.tif"),
        format="PNG",
        width=400,
    )
    for aux in (ROOT / "documents").glob("*.aux.xml"):
        aux.unlink()


def pointclouds():
    d = ROOT / "pointcloud"
    d.mkdir(exist_ok=True)
    write_las(d / "ubud_100k.las", 100_000)


def documents():
    d = ROOT / "documents"
    d.mkdir(exist_ok=True)
    write_pdf(d / "bali_report.pdf", "CloudBench manual test document")
    (d / "bali_notes.txt").write_text(
        "CloudBench manual test: GeoNode document upload.\n", encoding="utf-8"
    )


def invalid():
    d = ROOT / "invalid"
    d.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    (d / "corrupt.tif").write_bytes(b"II*\x00" + rng.bytes(4096))  # TIFF magic, garbage after
    (d / "broken.geojson").write_text(
        '{"type": "FeatureCollection", "features": [', encoding="utf-8"
    )
    write_geojson(d / "empty.geojson", [])
    (d / "not_spatial.csv").write_text("a,b,c\n1,2,3\n4,5,6\n", encoding="utf-8")
    (d / "unsupported.txt").write_text("not a geospatial file\n", encoding="utf-8")
    write_geojson(
        d / "no_crs_projected_coords.geojson",
        # UTM metres in a GeoJSON (which means lon/lat): out of range.
        [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [307000, 9058000]},
                "properties": {"id": 1},
            }
        ],
    )


def large():
    """Big enough that a conversion runs for a while: for cancel / restart tests."""
    d = ROOT / "large"
    d.mkdir(exist_ok=True)
    # ~12000 x 7500 float32 noise-ish DEM, uncompressed: ~360 MB.
    rows, cols = 7500, 12000
    path = d / "bali_dem_large.tif"
    reset(path)
    ds = gdal.GetDriverByName("GTiff").Create(
        str(path), cols, rows, 1, gdal.GDT_Float32, ["TILED=NO", "BIGTIFF=IF_SAFER"]
    )
    ds.SetGeoTransform((WEST, (EAST - WEST) / cols, 0, NORTH, 0, -(NORTH - SOUTH) / rows))
    ds.SetProjection(srs(4326).ExportToWkt())
    band = ds.GetRasterBand(1)
    band.SetNoDataValue(-9999)
    rng = np.random.default_rng(SEED)
    step = 500
    for r0 in range(0, rows, step):
        chunk_bounds = (
            WEST,
            NORTH - (r0 + step) * (NORTH - SOUTH) / rows,
            EAST,
            NORTH - r0 * (NORTH - SOUTH) / rows,
        )
        block = elevation(step, cols, chunk_bounds) + rng.normal(0, 20, (step, cols)).astype(
            np.float32
        )
        band.WriteArray(block.astype(np.float32), 0, r0)
    ds.FlushCache()
    ds = None

    # 1M points as FlatGeobuf.
    tmp = d / "poi_1m.geojson"
    write_geojson(tmp, random_points(1_000_000))
    convert_vector(tmp, d / "bali_poi_1m.fgb", "FlatGeobuf")
    tmp.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--large", action="store_true", help="also make the large files (~400 MB)")
    args = parser.parse_args()

    random.seed(SEED)
    for name in ("vector", "raster", "pointcloud", "documents", "invalid"):
        (ROOT / name).mkdir(exist_ok=True)
    documents()
    vectors()
    rasters()
    pointclouds()
    invalid()
    if args.large:
        large()

    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and path.suffix not in {".py", ".md"} and path.name != ".gitignore":
            print(f"{path.stat().st_size / 1024:>10.1f} KB  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
