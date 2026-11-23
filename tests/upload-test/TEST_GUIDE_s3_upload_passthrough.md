# Manual Test Guide: S3 Uploads Straight Into the Bucket

**Branch:** `feat/s3-upload-passthrough`
**Design and automated test results:** `docs/dev-guide/s3-upload-passthrough.md`
**Data usage:** none. Everything runs locally (MinIO and CloudNativeGIS from images already pulled).

Fill in the **Result** column as you go: ✅ pass, ❌ fail (with a note), ⏭ skipped.

## 1. What to check

S3 uploads used to be one big request. Django stored the file in `/tmp`, a conversion copied
it again to the data volume, and a plain upload read it whole into memory. Now the browser
sends 5 MB chunks, and CloudBench passes each one on to the bucket as part of an S3 multipart
upload. This guide checks that:

1. plain uploads, shapefiles, GeoPackages, mosaics and conversions (COG, PMTiles, COPC) still work;
2. nothing is written to CloudBench's disk;
3. a connection drop of a few minutes resumes on its own, and closing the dialog cancels;
4. bad files are refused, before or right after they're sent.

## 2. Setup

### 2.1 Start the stack

`tests/upload-test/` runs CloudBench like production: production settings, 4 gunicorn
workers, an ingress-like nginx. `docker-compose.s3.yml` adds:

- a **MinIO** with a bucket named `cloudbench`;
- **CloudNativeGIS** for the conversions.

```bash
cd ~/PycharmProjects/Kartoza/GeoHosting/kartoza-cloudbench
git switch feat/s3-upload-passthrough && git pull
(cd web && npm run build)

cd tests/upload-test
docker compose -f docker-compose.yml -f docker-compose.s3.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.s3.yml logs -f cloudbench   # leave open
```

Wait for four `Booting worker` lines. Then:

1. Open **http://localhost:8000** and log in as `admin` / `admin`.
2. Add an **S3** connection (in the tree, **S3** → **+**):

   | Field | Value |
   |---|---|
   | Connection Name | `Test MinIO` |
   | Endpoint | `minio:9000` |
   | Bucket | `cloudbench` |
   | Access Key / Secret Key | `cloudbench` / `cloudbench-test` |
   | Use SSL | **off** |
   | Path Style | **on** |

   Click **Test Connection**, then save. If `Test MinIO` is already there, skip this step.
3. The MinIO console is at **http://localhost:9001** (`cloudbench` / `cloudbench-test`). Use
   it to see exactly what's in the bucket.

### 2.2 Test files

The tests use the repo's manual test data, `tests/staging/manual-test-data/` (see its
README). If its files aren't there yet, make them (needs GDAL's Python bindings and numpy):

```bash
cd ~/PycharmProjects/Kartoza/GeoHosting/kartoza-cloudbench
python3 tests/staging/manual-test-data/generate.py
```

Two more, for the tests below, made from it:

```bash
D=tests/staging/manual-test-data
mkdir -p /tmp/s3test/roads
unzip -oq $D/vector/bali_roads_shp.zip -d /tmp/s3test/roads    # a shapefile as its parts
cp $D/invalid/unsupported.txt /tmp/s3test/not_a_tiff.tif      # named like a TIFF, but isn't one
```

| File (in `tests/staging/manual-test-data/`) | Used for |
|---|---|
| `raster/bali_dem_utm50s.tif` (5.3 MB, 2 chunks) | plain upload |
| `vector/bali_poi_50k.geojson` (8.7 MB, 2 chunks) | resume, cancel |
| `raster/bali_dem.tif` | COG |
| `/tmp/s3test/roads/bali_roads.*` (5 parts), `vector/bali_districts_shp.zip` | shapefile |
| `vector/bali_districts.geojson` | PMTiles |
| `pointcloud/ubud_100k.las` | COPC |
| `raster/bali_vector_and_raster.gpkg` (vector `districts`, raster `rgb`) | GeoPackage |
| `raster/mosaic_tiles/bali_dem_01..04.tif` | mosaic |
| `raster/bali_dem.tif` + `raster/bali_dem_utm50s.tif` | mosaic whose tiles don't agree |
| `invalid/corrupt.tif`, `/tmp/s3test/not_a_tiff.tif` | refused |

### 2.3 Second terminal: watch CloudBench's disk

```bash
cd ~/PycharmProjects/Kartoza/GeoHosting/kartoza-cloudbench/tests/upload-test
watch -n1 'docker compose exec -T cloudbench sh -c "echo data: \$(du -sb /home/web/cloudbench_data | cut -f1)  tmp: \$(du -sb /tmp | cut -f1)"'
```

Before an upload, `data` is a few hundred KB (`db.sqlite3`) and `tmp` is 4096. They should
stay like that: only `data` grows, by a few KB when a conversion job is recorded. To see
which file grows, use `du -ab /home/web/cloudbench_data /tmp | sort -n | tail -5` instead.

## 3. Tests

Upload everything to one folder, e.g. `manual/`. Click it in the tree, then **Upload**, or
type the key into **Object Key (optional)**. **Convert to Cloud-Native** is **on** by
default: turn it off for the plain uploads.

### A. A plain file

Upload `raster/bali_dem_utm50s.tif` with **Convert** off.

| Expect | Result |
|---|---|
| Progress goes to 100%, then "Upload successful" | |
| Log: `POST /api/s3/multipart/<conn>`, `PUT …/parts/0` and `/parts/1`, then `POST …/complete`, all `2xx`; no `POST /api/s3/upload/` | |
| `manual/bali_dem_utm50s.tif` is in the bucket, 5.3 MB | |
| The disk (second terminal) doesn't grow | |

### B. A shapefile's parts

Select the five `/tmp/s3test/roads/bali_roads.*` files together, with **Convert** off.

| Expect | Result |
|---|---|
| "Upload successful" | |
| Log: one `parts/0` for each of the five files, then one `complete` | |
| In the bucket: `manual/bali_roads.zip`, and nothing else from this upload | |
| The ZIP holds the five parts | |

Then select only `bali_roads.shp` and `bali_roads.shx`:

| Expect | Result |
|---|---|
| Refused before anything is sent: "This shapefile is incomplete" (it lists the missing `.dbf`); no `/api/s3/multipart/` line in the log | |

### C. GeoTIFF → COG

Upload `raster/bali_dem.tif` with **Convert** on (COG), to `manual/cog/bali_dem.tif`.

| Expect | Result |
|---|---|
| "Conversion started", then the job completes: "Published 1 layer to the catalog" | |
| Log: `/api/s3/multipart/…` lines only (no `POST /api/s3/upload/`) | |
| `manual/cog/bali-dem/` holds the COG, its `_3857` web copy and a thumbnail (layer folders are named with `-` for `_`); the source is kept in `manual/cog/sources/<job id>/bali_dem.tif` | |
| The COG previews in CloudBench | |

### D. Shapefile → PMTiles, from its parts and from its ZIP

1. Select the five `bali_roads.*` parts with **Convert** on (PMTiles), to `manual/shp/bali_roads.shp`.
2. Upload `vector/bali_districts_shp.zip` with **Convert** on, to `manual/zip/bali_districts_shp.zip`.

| Expect | Result |
|---|---|
| Both complete: "Published 1 layer to the catalog" | |
| Parts: `manual/shp/bali-roads/` holds the layer (`.pmtiles`, `.parquet`, thumbnail); the five parts and their ZIP are kept in `manual/shp/sources/<job id>/` | |
| ZIP: `manual/zip/bali-districts-shp/` holds the layer; `manual/zip/sources/<job id>/` holds only the ZIP (rewritten in the bucket; the uploaded one is dropped) | |
| The roads (4 lines) and districts (9 polygons) preview | |

### E. GeoJSON → PMTiles, LAS → COPC

1. Upload `vector/bali_districts.geojson` with **Convert** on, to `manual/geojson/`.
2. Upload `pointcloud/ubud_100k.las` with **Convert** on (COPC), to `manual/copc/`.

| Expect | Result |
|---|---|
| Both complete: "Published 1 layer to the catalog": `manual/geojson/bali-districts/` and `manual/copc/ubud-100k/` (`ubud-100k.copc.laz`); the districts preview | |

### F. A GeoPackage: inspected in the bucket, then converted

Upload `raster/bali_vector_and_raster.gpkg` with **Convert** on, to `manual/gpkg/`.

| Expect | Result |
|---|---|
| Progress, then the layer picker lists `districts` (vector) and `rgb` (raster), both selected | |
| Log: `/api/s3/multipart/…` lines; no `POST /api/s3/gpkg/inspect/` | |
| Confirm: two jobs complete ("Published 1 layer…" each) | |
| `manual/gpkg/bali-vector-and-raster/` holds `districts/` (PMTiles), `rgb/` (COG) and `source/bali_vector_and_raster.gpkg` | |
| The disk doesn't grow: the GeoPackage was read in the bucket (GDAL `/vsis3/`), not copied here | |

Then upload it again, and **close the dialog** at the layer picker:

| Expect | Result |
|---|---|
| The uploaded GeoPackage isn't left in `manual/gpkg/sources/` | |

### G. A dropped connection carries on for minutes

The upload has to be slow enough to interrupt, so throttle the browser.

1. Open DevTools (F12), go to **Network**, and set **Slow 3G**.
2. Upload `vector/bali_poi_50k.geojson` (**Convert** off) to `manual/resume/`.
3. While it's under 50%, set **Offline** for about **2 minutes**, then **No throttling**.

| Expect | Result |
|---|---|
| While offline: "Connection lost — retrying in Ns (attempt n)" under the progress bar | |
| Back online: it carries on by itself and completes; the file is the right size (8.7 MB) | |

The S3 bucket keeps the parts it already has, so the browser keeps retrying for about
5 minutes. A GeoServer/GeoNode upload only gets about 30 seconds.

### H. Closing the dialog cancels

Throttle to **Slow 3G**, upload `vector/bali_poi_50k.geojson` to `manual/cancel/`, and close
the dialog halfway.

| Expect | Result |
|---|---|
| Log: `DELETE /api/s3/multipart/<conn>/<id>` | |
| Nothing in `manual/cancel/` | |
| No incomplete upload is left (the command below prints nothing) | |

```bash
docker compose -f docker-compose.yml -f docker-compose.s3.yml exec -T minio sh -c \
  'mc alias set l http://localhost:9000 cloudbench cloudbench-test >/dev/null && mc ls --incomplete -r l/cloudbench'
```

### I. Refused

| Do | Expect | Result |
|---|---|---|
| Upload `/tmp/s3test/not_a_tiff.tif` with **Convert** on (COG) | "The file is not a valid TIFF." | |
| Upload `invalid/corrupt.tif` (a TIFF header, garbage after it) with **Convert** on | It uploads; the conversion then fails ("CloudNativeGIS conversion failed: gdal_translate failed…"), and nothing is published | |
| Upload `raster/bali_dem.tif` with **Convert** on to `manual/cog/bali_dem.tif` again (test C's layer) | Before anything is sent: "A layer already exists at manual/cog/bali-dem/"; **Keep existing** sends nothing | |
| Same, but click **Replace** | Converts and replaces the layer | |

### J. A mosaic

Select the four `raster/mosaic_tiles/bali_dem_0*.tif` together, name the mosaic `bali`,
and upload it to `manual/`.

| Expect | Result |
|---|---|
| Log: `/api/s3/multipart/…` for every tile (no `POST /api/s3/mosaic/`) | |
| "4 GeoTIFFs accepted…", then "Published a mosaic of 4 tiles to the catalog" | |
| `manual/bali/` holds `bali.vrt`, `bali_3857.tif`, a folder per tile (`bali-dem-01/`…) and `items.parquet`; the tiles are kept in `manual/sources/<job id>/` | |
| The disk doesn't grow: the tiles' headers were read in the bucket | |

Then a mosaic whose tiles don't agree: `raster/bali_dem.tif` with `raster/bali_dem_utm50s.tif`.

| Expect | Result |
|---|---|
| "bali_dem_utm50s.tif is in EPSG:32750, but bali_dem.tif is in EPSG:4326. Every tile of a mosaic must share one CRS."; nothing left in the bucket | |

## 4. If something fails

Note it in the **Result** column, with:

- the dialog's message;
- the log lines around it (especially `/api/s3/multipart/` lines and tracebacks);
- the CloudNativeGIS log: `docker compose -f docker-compose.yml -f docker-compose.s3.yml logs cng`.

| Symptom | Likely cause |
|---|---|
| Uploads still go to `POST /api/s3/upload/` | Stale frontend: run `cd web && npm run build`, then `up -d --build` |
| No **Convert to Cloud-Native** switch | CloudNativeGIS isn't up: check `docker compose … ps` (`cng` should be healthy) |
| "The bucket refused or failed" | MinIO is down, or the connection's key/endpoint is wrong |
| A conversion fails | Its message in the jobs list, and the `cng` log |

## 5. Clean up

```bash
cd ~/PycharmProjects/Kartoza/GeoHosting/kartoza-cloudbench/tests/upload-test
docker compose -f docker-compose.yml -f docker-compose.s3.yml down -v   # drops MinIO and the test data
rm -rf /tmp/s3test
```

## 6. Summary

| Area | Tests | Result |
|---|---|---|
| Plain and shapefile uploads | A, B | |
| Conversions | C, D, E | |
| GeoPackage | F | |
| Resume / cancel | G, H | |
| Refused | I | |
| Mosaic | J | |

**Tested on:** _(date)_ **by:** _(name)_
