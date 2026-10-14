# Manual test data

Files for testing CloudBench uploads by hand: PostGIS, GeoServer, GeoNode,
and S3 (including CloudNativeGIS conversions, on-demand or not).

All data is synthetic and covers Bali, so layers from different files line up
on the map. Most files are EPSG:4326. Files with `utm50s` in the name use
EPSG:32750, to check reprojection.

```bash
python3 manual-test-data/generate.py           # ~35 MB
python3 manual-test-data/generate.py --large   # also large/ (~500 MB), for cancel/restart tests
```

The script needs GDAL's Python bindings and numpy. Only the script and this
README are tracked; the generated files are git-ignored.

## Contents

| File | What it is |
|---|---|
| `vector/bali_cities.geojson` / `.json` | 10 points; int/float/bool/date/text fields, a null, non-ASCII text |
| `vector/bali_roads.geojson`, `bali_roads_shp.zip` | 4 lines |
| `vector/bali_districts.geojson` | 9 multipolygons, one with a hole and an islet |
| `vector/bali_districts_shp.zip` | same, as a zipped shapefile (shp/shx/dbf/prj/cpg) |
| `vector/bali_districts_utm50s_shp.zip` | same, in EPSG:32750 |
| `vector/bali_districts.fgb` | same, as FlatGeobuf |
| `vector/bali_districts.gpkg` | same, as a single-layer GeoPackage |
| `vector/bali_multi_layer.gpkg` | 4 layers: cities, roads, districts, districts_utm50s |
| `vector/bali_cities.kml` / `.kmz` | the cities as KML / KMZ |
| `vector/bali_cities_latlon.csv` | cities with `latitude`/`longitude` columns |
| `vector/bali_cities_wkt.csv` | cities with a `WKT` column |
| `vector/bali_poi_50k.geojson` / `.fgb` | 50,000 points (medium-sized conversion) |
| `raster/bali_dem.tif` | DEM, float32, nodata -9999, tiled + deflate |
| `raster/bali_rgb.tif` | 3-band byte RGB |
| `raster/bali_dem_utm50s.tif` | DEM in EPSG:32750, striped, uncompressed |
| `raster/bali_dem_already_cog.tif` | DEM already as a COG |
| `raster/mosaic_tiles/bali_dem_01..04.tif` | the DEM cut into 2×2 tiles (mosaic) |
| `raster/bali_vector_and_raster.gpkg` | GeoPackage with a raster table (`rgb`) and a vector layer (`districts`) |
| `pointcloud/ubud_100k.las` | LAS 1.2, 100k points, EPSG:32750 |
| `documents/bali_report.pdf`, `bali_preview.png`, `bali_notes.txt` | GeoNode documents |
| `invalid/*` | files that must be rejected cleanly (see below) |
| `large/bali_dem_large.tif` | ~350 MB DEM (`--large`) |
| `large/bali_poi_1m.fgb` | 1M points, ~135 MB (`--large`) |

## Which file for which target

✔ means the target should accept the file. Formats are taken from each
upload dialog's file picker.

| File | PostGIS | GeoServer | GeoNode | S3 conversion |
|---|:-:|:-:|:-:|---|
| `bali_districts_shp.zip` | ✔ | ✔ | ✔ | GeoParquet + PMTiles |
| `bali_districts_utm50s_shp.zip` | ✔ | ✔ | ✔ | GeoParquet + PMTiles (reprojected) |
| `bali_roads_shp.zip` | ✔ | ✔ | ✔ | GeoParquet + PMTiles |
| `bali_districts.gpkg` | ✔ | ✔ | ✔ | layer picker → GeoParquet + PMTiles |
| `bali_multi_layer.gpkg` | ✔ (layer picker) | ✔ | ✔ | layer picker, one job per layer |
| `bali_*.geojson` / `.json` | ✔ | — | ✔ | GeoParquet + PMTiles |
| `bali_districts.fgb` | ✔ | — | — | GeoParquet + PMTiles |
| `bali_cities.kml` | ✔ | — | ✔ | GeoParquet + PMTiles |
| `bali_cities.kmz` | — | — | — | GeoParquet + PMTiles |
| `bali_cities_*.csv` | ✔ | — | ✔ | stored as-is (DuckDB query) |
| `bali_dem.tif`, `bali_rgb.tif` | ✔ (raster) | ✔ | ✔ | COG |
| `bali_dem_utm50s.tif` | ✔ (raster) | ✔ | ✔ | COG |
| `bali_dem_already_cog.tif` | ✔ | ✔ | ✔ | COG (should be quick) |
| `mosaic_tiles/*.tif` (select all 4) | — | — | — | mosaic → one COG |
| `bali_vector_and_raster.gpkg` | ✔ | ✔ | ✔ | **two jobs**: vector → PMTiles, raster → COG |
| `ubud_100k.las` | — | — | — | COPC |
| `documents/*` | — | — | ✔ (document upload) | — |

For each upload, check:

- **PostGIS**: the table exists in the expected schema, has the right row
  count (cities 10, districts 9, roads 4, poi 50,000), the right SRID, and the
  non-ASCII `note` field reads `Pura Ulun Danu — ñ é ü 日本`.
- **GeoServer**: a store and layer are created and the layer preview draws in
  the right place (Bali). Uploading a shapefile into an existing store of a
  different type must be refused.
- **GeoNode**: the dataset is created, has a thumbnail, and can be downloaded
  again (gpkg/shp/csv/json). Documents open.
- **S3**: the outputs land in the bucket (`.parquet` + `.pmtiles` +
  thumbnail, or `.tif` COG, or `.copc.laz`), appear in the Portolan catalog,
  and preview on the map. A GeoParquet opens in the table view.

## Invalid files

Each of these must fail with a readable error, not hang, and must leave
nothing half-made behind (no empty table, store or object).

| File | Problem |
|---|---|
| `invalid/corrupt.tif` | TIFF header, garbage after it |
| `invalid/broken.geojson` | truncated JSON |
| `invalid/empty.geojson` | valid, but no features |
| `invalid/not_spatial.csv` | no geometry columns |
| `invalid/unsupported.txt` | not a geospatial format |
| `invalid/shapefile_missing_shx.zip` | shapefile without `.shx` |
| `invalid/no_crs_projected_coords.geojson` | UTM metres stored as lon/lat (out of range) |

## S3 conversion, on-demand

Before you start, set up both sides:

- **CloudBench**: `CLOUDNATIVEGIS_ON_DEMAND=True`, plus `GEOHOSTING_URL` and
  the OAuth client id and secret.
- **GeoHosting**: Celery worker and beat running (`check_servers`). An OAuth
  Application whose client id is `CLOUDBENCH_OAUTH_CLIENT_ID`. Some
  `HetznerServer` types enabled. The CloudBench user must also exist as a
  GeoHosting user.

Each job starts a real Hetzner server, which costs money. There is no reaper
yet (G5), so after every test check in Hetzner / GeoHosting admin that the
server is gone.

Each line below is one test. Its check follows the →.

1. **Server picker**: open the S3 upload dialog → server types are listed
   with price per hour, which is Hetzner's price plus GeoHosting's margin
   (currently 20%). Compare one price with Hetzner's.
2. **Happy path**: upload `raster/bali_dem.tif` with a server type picked →
   the job goes `provisioning` → `pushing` → `polling` → `verifying` →
   `publishing` → `deprovisioning` → `completed`. In the job's admin page,
   `CngLiteJobLog` shows the GeoHosting POST/GET/DELETE and the cng-lite
   push/poll. In GeoHosting, the `HetznerServerInstance` ends up `deleted`.
3. **Each converter**: one vector (`bali_districts_shp.zip`), one point cloud
   (`ubud_100k.las`), one mosaic (all of `mosaic_tiles/`) → each completes,
   with its own server.
4. **GeoPackage with two jobs**: `raster/bali_vector_and_raster.gpkg`, both
   layers ticked → two jobs, and each gets and deletes its own server.
5. **Failure still deletes the server**: `invalid/corrupt.tif` (if the dialog
   lets it through) → the job ends `failed` after `deprovisioning`, and the
   server is deleted.
6. **Cancel**: `large/bali_dem_large.tif`, cancel while it is
   `provisioning`, then again with another upload while it is `polling` →
   the job goes `cancelling` → `deprovisioning` → `cancelled`, and the server
   is deleted. Cancel should not be offered once the job is `verifying`.
7. **Restart**: start `large/bali_dem_large.tif`, restart CloudBench while it
   is `provisioning`, and again with another upload while it is `polling` →
   the job carries on and reuses the same server, not a second one. Restart
   during `deprovisioning` → the job finishes with its saved outcome.
8. **Refusals**:
   - A user who isn't a GeoHosting user → the job fails with a clear message
     (GeoHosting answers 400).
   - A server type that isn't enabled → same.
   - GeoHosting down → the tools API reports CloudNativeGIS unavailable.
9. **Non-demand, for comparison**: `CLOUDNATIVEGIS_ON_DEMAND=False` with a
   fixed `CLOUDNATIVEGIS_URL` → there is no server picker, and the same
   uploads go straight from `publishing` to `completed`.
