# Manual Test Guide: Upload Passthrough to GeoServer and GeoNode

**Branch:** `feat/upload-passthrough`
**Design and automated test results:** `docs/dev-guide/upload-passthrough.md`
**Data usage:** about 8 MB per `dem.tif` upload; the whole guide is about 30–40 MB.

Fill in the **Result** column as you go: ✅ pass, ❌ fail (with a note), ⏭ skipped.

## 1. What to check

Uploads to GeoServer/GeoNode used to be stored on CloudBench first: twice on disk, then the
whole file read into memory. Now they're relayed straight through as the browser sends them.
This guide checks that:

1. uploads still work, to GeoServer and to GeoNode (including zipped shapefiles);
2. nothing is written to CloudBench's disk;
3. a short connection drop resumes on its own, and a long one fails cleanly;
4. cancel works, and bad uploads are refused before any data is sent.

## 2. Setup

### 2.1 Targets

Spin up a GeoNode instance on GeoHosting staging (it comes with its own GeoServer). Note its:

| Item | Value |
|---|---|
| GeoNode URL | `https://<name>.sta.geospatialhosting.com/` |
| GeoNode admin user / password | |
| GeoServer URL | `https://<name>.sta.geospatialhosting.com/geoserver` |
| GeoServer admin user / password | |

In GeoServer, create a workspace for the test (e.g. `cloudbench_test`) so `geonode` stays
untouched. Do it in the GeoServer web UI, or in the CloudBench tree once connected.

### 2.2 Run CloudBench like production (Docker)

`deployment/upload-test/` runs CloudBench the way GeoHosting runs it in production, with this
branch's code. It mirrors kartoza-devops' `cloudbench-deployment.yaml`:

- production settings;
- 4 gunicorn `gthread` workers, using the image's own gunicorn config and entrypoint;
- the data folder on its own volume, standing in for the PVC;
- an nginx in front that behaves like GeoHosting's ingress-nginx (`proxy-body-size: 2G`,
  request buffering on, 60 s timeouts).

The image is built on the local `ghcr.io/kartoza/kartoza-cloudbench:latest`, so **nothing is
downloaded**: this branch adds no dependencies.

```bash
cd ~/PycharmProjects/Kartoza/GeoHosting/kartoza-cloudbench
git switch feat/upload-passthrough && git pull
(cd web && npm run build)        # only if the frontend changed since the last build

cd deployment/upload-test
docker compose up -d --build
docker compose logs -f cloudbench   # leave open: used in several tests
```

Wait for `READY` and four `Booting worker` lines. Then:

1. Open **http://localhost:8000** (use `localhost`, not `127.0.0.1`: production settings use
   secure cookies, which browsers allow on `localhost`).
2. Log in as `admin` / `admin`.
3. Add the **GeoServer** connection (see 2.5) and the **GeoNode** connection from 2.1.

The gunicorn access log here doesn't show worker pids. Chunks moving between workers were
already checked with the automated tests and the smoke tests in
`docs/dev-guide/upload-passthrough.md`.

#### Without Docker

Run gunicorn directly. It's the same gunicorn config, but `runserver` (`make dev-web`) won't
do: it's one process.

```bash
export CLOUDBENCH_DATA_FOLDER=$HOME/cloudbench-upload-test
export DJANGO_SETTINGS_MODULE=cloudbench.settings.development
mkdir -p $CLOUDBENCH_DATA_FOLDER
.venv/bin/python manage.py migrate && .venv/bin/python manage.py createsuperuser
GUNICORN_WORKERS=4 .venv/bin/gunicorn cloudbench.wsgi:application \
  -c deployment/docker/gunicorn.conf.py -b 127.0.0.1:8000 \
  --access-logformat 'pid=%(p)s %(m)s %(U)s %(s)s'
```

Avoid the devcontainer on a metered connection. Opening it runs
`docker build --target prod`, which re-runs `pip install` and `npm install` after any code
change.

### 2.3 Test files (small, to save data)

```bash
mkdir -p /tmp/cbtest && cd /tmp/cbtest
# ~8 MB GeoTIFF: 2 chunks of 5 MB
gdal_create -outsize 1500 1300 -bands 1 -ot Float32 -burn 7 \
  -a_srs EPSG:4326 -a_ullr 106 -6 107 -7 -q dem.tif
# Zipped shapefile, < 1 KB
cat > p.geojson <<'GEOJSON'
{"type": "FeatureCollection", "features": [
 {"type": "Feature", "properties": {"n": "a"}, "geometry": {"type": "Point", "coordinates": [106.8, -6.2]}},
 {"type": "Feature", "properties": {"n": "b"}, "geometry": {"type": "Point", "coordinates": [107.6, -6.9]}}
]}
GEOJSON
ogr2ogr -q pts.shp p.geojson
zip -q pts.zip pts.shp pts.shx pts.dbf pts.prj
# The same points as a GeoPackage, ~100 KB
ogr2ogr -q -f GPKG pts.gpkg p.geojson -nln pts
# A document, for GeoNode
echo "CloudBench upload test" > note.txt
ls -la dem.tif pts.zip pts.gpkg note.txt
```

### 2.4 Second terminal: watch CloudBench's disk

With Docker:

```bash
cd ~/PycharmProjects/Kartoza/GeoHosting/kartoza-cloudbench/deployment/upload-test
watch -n1 docker compose exec -T cloudbench du -ah /home/web/cloudbench_data
```

Without Docker:

```bash
watch -n1 du -ah $HOME/cloudbench-upload-test
```

Every file in CloudBench's data folder is listed with its size. Before an upload, that's
`db.sqlite3` and a few small config files, about 330 KB in all. It should stay like that
throughout every upload: no new files, and no file growing by megabytes.

### 2.5 GeoServer in CloudBench

**Add the connection.** In the left tree, hover over **GeoServer** and click **+** (Add).
Fill in:

| Field | Value |
|---|---|
| Name | anything, e.g. `Staging GeoServer` |
| URL | `https://<name>.sta.geospatialhosting.com/geoserver` (with `https://` and `/geoserver`) |
| Username / Password | the **GeoServer** admin from 2.1, not the GeoNode one: GeoNode's admin is refused (401) |

Click **Test Connection**, then save. The connection shows in the tree with its workspaces.

**Create the test workspace.** Under the connection, hover over **Workspaces**, click **+**,
and name it `cloudbench_test`. (Or create it in the GeoServer web UI and click **Refresh**.)

**The Upload dialog.** Open it in either of these ways:

- select `cloudbench_test` in the tree, then click **Upload** in the header;
- or open the workspace and click **Upload Data** under Quick Actions.

Without a workspace selected, the header button says "Select a workspace first". In the dialog:

1. Drop a file onto the drop area, or click it to pick one. Accepted: `.zip` (zipped
   shapefile), `.gpkg`, `.tif`/`.tiff`.
2. **Store Name** is filled from the file name (`dem.tif` → `dem`). If a store with that name
   already exists, an upload of the same type replaces its data; one of another type (a
   GeoPackage into a shapefile store, say) is refused before anything is sent.
3. Click **Upload**. The dialog shows the chunks as they go (5 MB each), then "Creating
   store…" while GeoServer reads the file. Small files skip straight to that step.
4. When it's done, a result card shows the store name, its type (`geotiff`, `shapefile` or
   `geopackage`) and `completed`. GeoServer publishes the layer itself; click **Refresh** on
   the workspace if it isn't in the tree yet.

| File | GeoServer store | Layer |
|---|---|---|
| `.tif`/`.tiff` | coverage store (GeoTIFF) | one raster layer |
| `.zip` | data store (Shapefile) | one layer per shapefile in the zip |
| `.gpkg` | data store (GeoPackage) | each table, published by GeoServer |

Closing the dialog during an upload cancels it.

## 3. Tests

### A. Upload a GeoTIFF to GeoServer

1. In the tree, select the test workspace and click **Upload**.
2. Pick `dem.tif`, keep the store name `dem`, then click **Upload**.

| Expect | Result |
|---|---|
| Progress shows "Chunks: 1/2", then "2/2" | |
| Then "Waiting for GeoServer to create the store…" | |
| A green result card: `dem`, `geotiff`, `completed` | |
| The layer `dem` appears under the workspace in the tree | |
| The layer previews and shows the full raster | |
| CloudBench log: `PUT /api/upload/relay/<id>/chunks/0` and `/chunks/1`, both `200` | |

Without Docker, the log also shows `pid=`. It may differ between chunks: chunks landing in
another worker still reach the upload.

### B. Nothing is stored on CloudBench

During test A (and every other test), watch the second terminal.

| Expect | Result |
|---|---|
| The folder size doesn't grow during the upload | |
| `cache/uploads` doesn't exist or is empty | |

With the old flow, this folder grew by about 2× the file size.

### C. Upload a zipped shapefile to GeoServer

Upload `pts.zip` to the test workspace.

| Expect | Result |
|---|---|
| Result card: `pts`, `shapefile`, `completed` | |
| Layer `pts` previews with 2 points | |

Then upload `pts.zip` again with the same store name `pts`.

| Expect | Result |
|---|---|
| `completed` again, and the layer still has **2** points: the data is replaced, not added to | |

### C2. Upload a GeoPackage to GeoServer

Upload `pts.gpkg` with the store name `pts_gpkg`.

| Expect | Result |
|---|---|
| Result card: `pts_gpkg`, `geopackage`, `completed` | |
| A new layer from it previews with 2 points | |

GeoServer names the layer after the GeoPackage's table, `pts`. With test C's `pts` layer still
there, it's published as `pts1` instead: layer names are unique in a workspace.

### D. Resume after a short connection drop

The upload has to be slow enough to interrupt, so throttle the browser. This also saves data.

1. Open DevTools (F12), go to the **Network** tab, and set throttling to **Slow 3G**.
2. Upload `dem.tif` again with a new store name (e.g. `dem_resume`).
3. While "Chunks: 0/2" or "1/2" is showing, set throttling to **Offline**.
4. Wait about 10 seconds, then set it back to **No throttling**.

| Expect | Result |
|---|---|
| While offline: orange "Connection lost — retrying in Ns (attempt n)" | |
| Back online: the upload carries on by itself and completes | |
| The store `dem_resume` is created and the layer works | |

### E. A long drop fails cleanly

Same as D, but stay **Offline** for about 60 seconds.

| Expect | Result |
|---|---|
| The retries run out (about 30 s), then the dialog shows an error saying to start the upload again | |
| No broken `dem_*` store is left in GeoServer (refresh the tree) | |
| **Upload** works again afterwards | |

The target can't continue a partial upload, so starting over is the expected behaviour.

### F. Cancel

Throttle to **Slow 3G**, start an upload, and click the small red **Cancel** next to the
progress bar halfway. Then do it again, but close the dialog instead (the footer's **Cancel**,
or the **×**).

| Expect | Result |
|---|---|
| Red Cancel: "Upload cancelled" | |
| Closing the dialog: the CloudBench log shows `DELETE /api/upload/relay/<id>`, and no more chunks after it | |
| No store created in GeoServer, either way | |
| Reopening the dialog shows a fresh dialog, not the cancelled upload | |

### G. Upload a GeoTIFF dataset to GeoNode

1. Open the GeoNode connection and click **Upload** (Dataset).
2. Pick `dem.tif`, set a title (e.g. "CloudBench test DEM"), then click **Upload**.

| Expect | Result |
|---|---|
| Chunk progress, then "Waiting for GeoNode…" | |
| Green alert: "Dataset uploaded successfully. GeoNode is processing your file." | |
| After a few seconds, the dataset appears in GeoNode (web UI or CloudBench's GeoNode list) | |

Known issue, also on `main`: the dataset is titled after its file (`dem`), not with the title
you typed. GeoNode 4.4 ignores a title sent with the upload; documents (test I) keep theirs.

### H. Upload a zipped shapefile dataset to GeoNode

Upload `pts.zip` as a Dataset.

| Expect | Result |
|---|---|
| Success alert, and the dataset appears in GeoNode with 2 points | |
| CloudBench log: `GeoNode https://… takes a zipped dataset as zip_file` | |

`zip_file` means CloudBench asked this GeoNode and found it's 4.x (GeoHosting's version). A
newer GeoNode would show `base_file`. That case is untested: there's no newer GeoNode to try.

### I. Upload a document to GeoNode

Switch the dialog to **Document** and upload `note.txt`.

| Expect | Result |
|---|---|
| Success, and the document appears in GeoNode | |

### J. Too big for GeoNode is refused up front (optional, uses no data)

1. In GeoNode's Django admin, open **Upload size limits** and set `dataset_upload_size` to
   `1048576` (1 MB). Note the old value first.
2. Upload `dem.tif` as a Dataset.

| Expect | Result |
|---|---|
| Error straight away: "This GeoNode accepts datasets up to 1 MB (8 MB given)…" | |
| No chunk lines in the CloudBench log for it (nothing was sent) | |

Then **set the limit back** to its old value.

### K. Refused before any data is sent

| Do | Expect | Result |
|---|---|---|
| GeoServer upload with store name `a b` (with a space) | "Store name must contain only letters, numbers, underscores, hyphens and dots" | |
| GeoServer upload to a workspace deleted in GeoServer meanwhile | "Workspace not found" | |
| GeoServer upload of `pts.gpkg` with the store name `pts` (test C's shapefile store) | "cloudbench_test already has a shapefile store named pts; pick another store name" | |
| GeoServer upload of `dem.tif` with the store name `pts` | Same, refused: a raster can't go into a shapefile store's name either | |

Before this check, GeoServer took the GeoPackage into the shapefile store: it replaced the
store's files but kept its type, and the `pts` layer broke ("pts.shp: No such file").

### L. S3: a plain upload goes straight into the bucket

Branch `feat/s3-upload-passthrough` only. Use an S3 connection (MinIO, or a bucket you may
write to). On GeoHosting's staging S3, **don't delete anything afterwards**, not even these
test files: the bucket holds other people's data.

1. Open the S3 connection, click **Upload**, pick `dem.tif`, leave **Convert** off, and
   upload it to a test folder (e.g. `cloudbench-test/dem.tif`).

| Expect | Result |
|---|---|
| Progress goes up to 100%, then "File uploaded to S3" | |
| CloudBench log: `PUT /api/s3/multipart/<conn>/<id>/parts/0` and `/parts/1`, then `POST …/complete`, all `2xx` | |
| The file is in the bucket, the same size as `dem.tif` | |
| The data folder (second terminal) doesn't grow | |

### M. S3: a dropped connection carries on for minutes

As D, but for an S3 upload of `dem.tif` (to `cloudbench-test/dem_resume.tif`), and stay
**Offline** for about **2 minutes**.

| Expect | Result |
|---|---|
| While offline: "Connection lost — retrying in Ns (attempt n)" under the progress bar | |
| Back online: the upload carries on and completes (the bucket kept the parts) | |

### N. S3: conversions of one file go straight to the bucket

Needs CloudNativeGIS. Upload `dem.tif` with **Convert** on (COG) to
`cloudbench-test/dem_cog.tif`.

| Expect | Result |
|---|---|
| CloudBench log: `/api/s3/multipart/…` lines, no `POST /api/s3/upload/…` | |
| The conversion starts and completes, and the COG layer is published as with any conversion | |
| A file named `.tif` that isn't a TIFF is refused: "The file is not a valid TIFF." | |
| A mosaic still goes through `POST /api/s3/mosaic/…` as before | |

Then a shapefile and a GeoPackage, to `cloudbench-test/`:

| Do | Expect | Result |
|---|---|---|
| Upload `pts.shp` with `pts.shx`, `pts.dbf`, `pts.prj` selected, **Convert** off | `cloudbench-test/pts.zip` in the bucket, nothing else; log shows a session per file | |
| The same with **Convert** on (PMTiles) | The conversion starts; the parts are kept under `cloudbench-test/sources/<job id>/` beside `pts.zip` | |
| Upload `pts.zip` with **Convert** on | The conversion starts; only the rewritten `sources/<job id>/pts.zip` is left of the upload | |
| Upload `pts.gpkg` with **Convert** on | The layer picker lists `pts`; log shows `/api/s3/multipart/…`, no `gpkg/inspect` | |

### O. S3: closing the dialog cancels the upload

Throttle to **Slow 3G**, start an S3 upload of `dem.tif`, and close the dialog halfway.

| Expect | Result |
|---|---|
| CloudBench log: `DELETE /api/s3/multipart/<conn>/<id>` | |
| No `dem.tif` object is created at that key | |

## 4. If something fails

Note it in the **Result** column, with:

- the dialog's error message;
- the CloudBench log lines around it (especially `/api/upload/relay` lines and tracebacks);
- the file, its size, and the target.

| Symptom | Likely cause |
|---|---|
| Page loads without the new behaviour (a Pause button still shows) | Stale frontend: run `cd web && npm run build` and reload |
| `413` from GeoNode | GeoNode's upload size limit (test J) |
| "No data came for 60 seconds" | The connection was down longer than the resume window (expected in test E) |
| GeoNode upload "succeeds" but no dataset appears | GeoNode's import failed: check its execution request in GeoNode (`/api/v2/executionrequest/<execution_id>`) |

## 5. Clean up

- [ ] Delete the test layers/stores (`dem`, `dem_resume`, `pts`, `pts_gpkg`) and the test workspace in GeoServer.
- [ ] Delete the test datasets and document in GeoNode.
- [ ] If you ran test J, check GeoNode's upload size limit is back to its old value.
- [ ] Stop the `watch` terminal, then stop CloudBench:
  - Docker: `cd deployment/upload-test && docker compose down -v` (`-v` drops the test data).
  - Without Docker: Ctrl+C, then `rm -rf $HOME/cloudbench-upload-test`.
- [ ] `rm -rf /tmp/cbtest`

(GeoHosting staging instances are deleted daily anyway.)

## 6. Summary

| Area | Tests | Result |
|---|---|---|
| GeoServer upload | A, C, C2 | |
| Nothing stored | B | |
| Resume / failure / cancel | D, E, F | |
| GeoNode upload | G, H, I | |
| Refused up front | J, K | |
| S3 straight into the bucket | L, M, N, O | |

**Tested on:** _(date)_ **by:** _(name)_ **GeoNode/GeoServer:** _(staging instance)_
