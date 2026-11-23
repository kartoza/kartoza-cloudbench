# Test Report: S3 Uploads Straight Into the Bucket

**Branch:** `feat/s3-upload-passthrough` (`492a46c`, then with direct mosaics for run 2)
**Date:** 2026-10-23 (run 1 at 09:54, run 2 at 10:19)
**Target:** connection "S3": DigitalOcean Spaces `fra1`, bucket `ktz-prd-bkt-do-13` (GeoHosting), prefix `zakki/`

## Summary

All 16 tests passed, in two runs: run 1 (tests 1–8) deleted nothing in the bucket; run 2
(tests 9–16, after deleting under `zakki/` was allowed) covers mosaics, now uploaded
straight into the bucket too, and the flows where CloudBench deletes objects of its own.

In run 1: CloudBench's storage didn't grow with the files:

- `/tmp` stayed at 4 096 bytes throughout.
- The data folder grew by 16 384 bytes in all, and only in `db.sqlite3`: rows for the 3
  conversion jobs and their logs (see the notes under Results).
- No file was written there: about 23 MB were uploaded and 34 objects landed in the bucket.
- The plain upload, the resume and the cancel added **0 bytes**.

## How it was run

- **CloudBench:** the production-like test stack (`tests/upload-test/`, with
  `docker-compose.s3.yml`). That's production settings, 4 gunicorn `gthread` workers, behind
  an nginx set up like GeoHosting's ingress, with this branch's code and frontend. Conversions
  ran on a local CloudNativeGIS (`cloudnativegis-processing:0.0.5`), reading and writing the
  bucket through presigned URLs.
- **The uploads** went through CloudBench's HTTP API, as the upload dialog sends them:
  - `POST /api/s3/multipart/{conn}` to start;
  - `PUT …/parts/{n}` for each 5 MB chunk;
  - `POST …/complete` to finish.

  A script sent them, logged in as `admin` with an API token, through the nginx at
  `localhost:8000`.
- **The storage** was sampled every ~0.3 s during each test, with `du -sb` on
  `/home/web/cloudbench_data` (the data volume; the PVC on GeoHosting) and `/tmp` (where
  Django used to spool uploads) inside the CloudBench container.
- **Files:** made with GDAL for this run:
  - `dem.tif`: 5 728 166 bytes, 2 chunks;
  - a 2-point shapefile and GeoJSON;
  - `multi.gpkg`: 2 vector layers and a raster table;
  - `fake.tif`.

### Not in run 1 (they're in run 2)

Run 1 deleted nothing in GeoHosting's bucket. So the flows where CloudBench removes objects
of its own were left out of it, until deleting test files under `zakki/` was allowed:

| Flow | What it removes |
|---|---|
| Plain shapefile upload | its parts, once zipped |
| Shapefile ZIP → PMTiles | the ZIP uploaded, once rewritten |
| GeoPackage conversion | its source, moved into the layer group |
| Replacing a layer, an unreadable GeoPackage, closing the layer picker | their objects |

Each of them had been run end to end on a local MinIO through the same stack, the day
before, and is in the automated tests. Run 2 below ran them on this bucket. The conversions
used license `other` without a URL, so publishing wrote a `LICENSE.md` and made no delete
call.

## Results

In the order they ran. The last column is the test's ID in
`TEST_GUIDE_s3_upload_passthrough.md`.

| # | Test | Result | Data folder (bytes) before → max → after | `/tmp` max | Guide |
|---|---|---|---|---|---|
| 1 | Plain upload: `dem.tif` | ✅ in the bucket, same size (5 728 166) | 377 632 → 377 632 → 377 632 | 4 096 | A |
| 2 | Resume: 90 s without a chunk, then the rest | ✅ completed, same size | 377 632 → 377 632 → 377 632 | 4 096 | G |
| 3 | Cancel after the first chunk | ✅ `204`; no object; no incomplete upload left | 377 632 → 377 632 → 377 632 | 4 096 | H |
| 4 | `dem.tif` → COG | ✅ "Published 1 layer to the catalog" | 377 632 → 381 728 → 381 728 | 4 096 | C |
| 5 | Shapefile parts (`.shp`, `.shx`, `.dbf`, `.prj`) → PMTiles | ✅ "Published 1 layer to the catalog" | 381 728 → 385 824 → 385 824 | 4 096 | D |
| 6 | GeoJSON → PMTiles | ✅ "Published 1 layer to the catalog" | 385 824 → 394 016 → 394 016 | 4 096 | E |
| 7 | GeoPackage inspected in the bucket (`/vsis3/`) | ✅ layers `cities`, `zones`; raster table `elevation` | 394 016 → 394 016 → 394 016 | 4 096 | F |
| 8 | Refused: `fake.tif` as COG; `.shp` + `.shx` only | ✅ "The file is not a valid TIFF." / "Select the matching .shp, .shx and .dbf files together…" | 394 016 → 394 016 → 394 016 | 4 096 | I |

Notes:

- **2:** 90 s is longer than a GeoServer/GeoNode relay can wait (60 s). S3 keeps the parts,
  so the upload simply carried on.
- **4, 5, 6: why the data folder grew.** The growth is the conversion job's records in
  `db.sqlite3`, not the file:
  - each conversion writes its `CngLiteJob` row (~1.0–1.2 KB) and two `CngLiteJobLog`
    rows (~1.6–1.7 KB in all: the push to CloudNativeGIS and its last poll);
  - SQLite grows by whole 4 096-byte pages, so that's one page each for 4 and 5, and two
    for 6, where both the table and its index needed a new page.

  The 5.7 MB `dem.tif` added 4 096 bytes; the 264-byte GeoJSON added 8 192. The growth
  doesn't follow the file's size: no file data is stored.
- **1, 2, 3, 7, 8 added 0 bytes:** their `UploadSession` rows (~300 bytes) fit in free
  space in existing pages.
- **7:** the GeoPackage wasn't converted, since that moves (deletes) its source. Its job is
  left waiting for layers in the test stack's database.

## Run 2: mosaics, and the flows that delete

With mosaics now uploaded straight into the bucket (each tile's header read there), on the
rebuilt stack. Same storage sampling.

| # | Test | Result | Data folder (bytes) before → max → after | `/tmp` max |
|---|---|---|---|---|
| 9 | Mosaic: `dem.tif` + `dem2.tif` (11.5 MB) | ✅ "2 GeoTIFFs accepted…", then "Published a mosaic of 2 tiles to the catalog" | 394 016 → 394 016 → 394 016 | 4 096 |
| 10 | Mosaic whose tiles don't agree (`dem.tif` + the same in EPSG:3857) | ✅ "dem_3857.tif is in EPSG:3857, but dem.tif is in EPSG:4326. Every tile of a mosaic must share one CRS."; its tiles deleted | 394 016 → 394 016 → 394 016 | 4 096 |
| 11 | Plain shapefile from its parts | ✅ only `pts.zip` left (the parts deleted once zipped) | 394 016 → 394 016 → 394 016 | 4 096 |
| 12 | Shapefile ZIP → PMTiles | ✅ "Published 1 layer…"; only the rewritten ZIP left in `sources/` | 394 016 → 394 016 → 394 016 | 4 096 |
| 13 | GeoPackage inspected, then converted (2 layers + 1 raster table) | ✅ both jobs "Published…"; its source moved into the group (`multi/source/multi.gpkg`) | 394 016 → 406 304 → 406 304 | 4 096 |
| 14 | GeoPackage: layer picker closed | ✅ `204`; nothing left | 406 304 → 406 304 → 406 304 | 4 096 |
| 15 | Unreadable GeoPackage (SQLite header, random bytes) | ✅ "Could not read the GeoPackage: file is not a database"; deleted | 406 304 → 406 304 → 406 304 | 4 096 |
| 16 | Replace the COG layer of test 4 | ✅ `409` "A layer already exists at zakki/cog/dem/…" without `replace`; with it, "Published 1 layer…" | 406 304 → 414 496 → 414 496 | 4 096 |

Notes:

- **9:** the two 5.7 MB tiles added **0 bytes**. Before, a mosaic's tiles were all staged
  in the data volume (and in `/tmp`) until its job had uploaded them.
- **13, 16:** the growth is again job rows in `db.sqlite3` (three jobs: 12 288 + 8 192
  bytes, whole SQLite pages), not files.
- **15:** run 2 first showed GDAL's whole message, with the bucket and key of its
  `/vsis3/` path. It was fixed to keep only the reason, and checked again on the rebuilt
  stack.
- **16:** the replace removed the old layer's files from `zakki/cog/dem/`. The source of
  test 4's job stays in `zakki/cog/sources/db3d6b8c-…/`, as a staged upload's did:
  replacing a layer leaves the earlier job's sources folder.

After run 2:

```text
Storage after: data, tmp = (414496, 4096)

$ docker compose exec cloudbench sh -c 'find /home/web/cloudbench_data /tmp -type f -printf "%s %p\n"'
0 /home/web/cloudbench_data/admin/config/providers.json.lock
800 /home/web/cloudbench_data/admin/config/providers.json
401408 /home/web/cloudbench_data/db.sqlite3

incomplete multipart uploads under zakki/: 0
```

Run 2's log:

```text
Run 2 started 2026-10-23T10:19:44, connection S3 (621588c9-d828-42ec-8318-e20961dfc2e7), prefix zakki/
Storage before: data, tmp = (394016, 4096)
9. Mosaic: dem.tif + dem2.tif start 201
   complete 202: 2 GeoTIFFs accepted for conversion into one mosaic 85baaf8c-2f56-4e05-9f4f-bda8b4c23ad7
   job completed: Published a mosaic of 2 tiles to the catalog
10 start 201
   complete 400: {'error': 'dem_3857.tif is in EPSG:3857, but dem.tif is in EPSG:4326. Every tile of a mosaic must share one CRS.'}
11 start 201
   complete 201: zakki/plain-shp/pts.zip
12. Shapefile ZIP -> PMTiles start 201
   complete 202: File accepted for CloudNativeGIS conversion 75cc389f-47c2-49a1-bdcd-3ca7d319b48d
   job completed: Published 1 layer to the catalog
13 inspected 200: ['cities', 'zones'] ['elevation']
   convert 202: [('completed', 'Published 2 layers to the catalog'), ('completed', 'Published 1 layer to the catalog')]
14 inspected 200, picker closed -> 204
15 complete 400: (GDAL's message with its /vsis3/ path; after the fix:)
   complete 400: {'error': 'Could not read the GeoPackage: file is not a database'}
16 without replace -> 409: A layer already exists at zakki/cog/dem/. Confirm to replace it.
16. Replace the COG layer of test 4 start 201
   complete 202: File accepted for CloudNativeGIS conversion 31e6bab7-fa9e-43ba-aff7-c8f794c1a919
   job completed: Published 1 layer to the catalog
Storage after: data, tmp = (414496, 4096)
```

Run 2's files (data and sources; catalog docs left out):

| Size (bytes) | Key | From |
|---:|---|---|
| 5 728 166 ×2 | `zakki/mosaic/sources/85baaf8c-…/dem.tif`, `dem2.tif` | 9: the tiles, kept |
| 26 350 ×2 | `zakki/mosaic/bali/dem/dem.tif`, `dem2/dem2.tif` | 9: each tile as a COG |
| 25 314 / 1 518 / 5 196 / 1 558 | `zakki/mosaic/bali/bali_3857.tif`, `bali.vrt`, `items.parquet`, `thumbnail.png` | 9: the mosaic |
| 824 | `zakki/plain-shp/pts.zip` | 11 |
| 1 088 | `zakki/zip/sources/75cc389f-…/pts.zip` | 12: rewritten |
| 606 / 3 122 | `zakki/zip/pts/pts.pmtiles`, `pts.parquet` | 12 |
| 229 376 | `zakki/gpkg-convert/multi/source/multi.gpkg` | 13: the source, moved |
| 602 / 3 326, 600 / 8 445 | `zakki/gpkg-convert/multi/cities/…`, `zones/…` (`.pmtiles`, `.parquet`) | 13: vector layers |
| 26 500 / 25 464 | `zakki/gpkg-convert/multi/elevation/elevation.tif`, `elevation_3857.tif` | 13: raster table |
| 5 728 166 | `zakki/cog/sources/31e6bab7-…/dem.tif` | 16: the new source |

Nothing is left of 10, 14 and 15 (`zakki/mosaic-bad/`, `gpkg-closed/`, `gpkg-bad/`).

## Evidence

### Storage before and after (terminal)

```text
$ docker compose exec cloudbench sh -c 'du -sb /home/web/cloudbench_data /tmp | cut -f1'
Storage before anything: data, tmp = (377632, 4096)
…
Storage after everything: data, tmp = (394016, 4096)
```

### Every file in CloudBench's data folder and `/tmp`, after the tests

```text
$ docker compose exec cloudbench sh -c 'find /home/web/cloudbench_data /tmp -type f -printf "%s %p\n"'
0 /home/web/cloudbench_data/admin/config/providers.json.lock
800 /home/web/cloudbench_data/admin/config/providers.json
380928 /home/web/cloudbench_data/db.sqlite3
```

No upload, chunk, staged source or `uploads/` folder: only the database (364 544 bytes
before the tests), and nothing at all in `/tmp`.

### No incomplete multipart upload left in the bucket

```text
incomplete multipart uploads under zakki/: 0
```

So the cancel (3) and the refused `fake.tif` (8) were aborted, not left for S3 to bill.

### Run log

```text
Run started 2026-10-23T09:54:17, connection S3 (621588c9-d828-42ec-8318-e20961dfc2e7), prefix zakki/
Storage before anything: data, tmp = (377632, 4096)
A  start 201: 2 chunks of 5242880
   PUT dem.tif part 0 -> 200
   PUT dem.tif part 1 -> 200
   complete 201: {'key': 'zakki/plain/dem.tif', 'bucket': 'ktz-prd-bkt-do-13', 'success': True, 'message': 'File uploaded to S3', 'size': 5728166}
G  start 201
   PUT dem.tif part 0 -> 200
   (no chunk for 90 s, as if the connection dropped)
   PUT dem.tif part 1 -> 200
   complete 201
H  start 201
   PUT part 0 -> 200
   DELETE (cancel) -> 204
C. start 201
   PUT dem.tif part 0 -> 200
   PUT dem.tif part 1 -> 200
   complete 202: job db3d6b8c-e7b0-4eab-9ee3-accd8425e1e2
   job completed: Published 1 layer to the catalog
D. start 201
   PUT pts.shp part 0 -> 200
   PUT pts.shx part 0 -> 200
   PUT pts.dbf part 0 -> 200
   PUT pts.prj part 0 -> 200
   complete 202: job 315134f6-a867-4b25-9345-4f8ef03e973d
   job completed: Published 1 layer to the catalog
E. start 201
   PUT pts.geojson part 0 -> 200
   complete 202: job f61ecb88-e875-4040-8c55-3d64b4251c87
   job completed: Published 1 layer to the catalog
F  start 201
   PUT multi.gpkg part 0 -> 200
   complete 200
I  fake.tif part 0 -> 400: {'error': 'The file is not a valid TIFF.'}
   abort -> 204
   pts.shp + pts.shx only -> 400: {'error': 'Select the matching .shp, .shx and .dbf files together. Cloudbench will ZIP them automatically.'}
Storage after everything: data, tmp = (394016, 4096)
```

## Files in the bucket (`zakki/`, 34 objects)

| Size (bytes) | Key | From |
|---:|---|---|
| 5 728 166 | `zakki/plain/dem.tif` | 1 |
| 5 728 166 | `zakki/resume/dem.tif` | 2 |
| 5 728 166 | `zakki/cog/sources/db3d6b8c-…/dem.tif` | 4: the source, kept |
| 26 350 | `zakki/cog/dem/dem.tif` | 4: the COG |
| 25 314 | `zakki/cog/dem/dem_3857.tif` | 4: web mosaic |
| 1 558 | `zakki/cog/dem/thumbnail.png` | 4 |
| 2 852 / 267 / 471 / 284 / 178 | `zakki/cog/dem/collection.json`, `styles/default.json`, `AGENTS.md`, `README.md`, `LICENSE.md` | 4: catalog |
| 156 / 116 / 228 / 145 | `zakki/shp/sources/315134f6-…/pts.shp`, `.shx`, `.dbf`, `.prj` | 5: the parts, kept |
| 1 088 | `zakki/shp/sources/315134f6-…/pts.zip` | 5: their ZIP, made in the bucket |
| 605 / 3 122 / 2 171 | `zakki/shp/pts/pts.pmtiles`, `pts.parquet`, `thumbnail.png` | 5: the layer |
| 3 146 / 996 / 589 / 371 / 178 | `zakki/shp/pts/collection.json`, `styles/default.json`, `AGENTS.md`, `README.md`, `LICENSE.md` | 5: catalog |
| 264 | `zakki/geojson/sources/f61ecb88-…/pts.geojson` | 6: the source, kept |
| 606 / 2 956 / 2 171 | `zakki/geojson/pts/pts.pmtiles`, `pts.parquet`, `thumbnail.png` | 6: the layer |
| 3 150 / 996 / 589 / 375 / 178 | `zakki/geojson/pts/collection.json`, `styles/default.json`, `AGENTS.md`, `README.md`, `LICENSE.md` | 6: catalog |
| 229 376 | `zakki/gpkg/sources/115d27ce-…/multi.gpkg` | 7: inspected where it landed |

Nothing from 3 (cancelled) or 8 (refused) is in the bucket. These test files are left in
place: the bucket holds others' data, so nothing is deleted there.

## What this run doesn't cover

- **The browser itself:** the uploads were sent by a script, through the same API the
  dialog uses. The dialog's part is covered by the frontend tests (`s3Multipart.test.ts`,
  `S3UploadDialog.test.tsx`):
  - which files go this way;
  - retries for ~5 minutes;
  - closing the dialog cancels;
  - the layer picker.

  The manual guide's tests G and H with DevTools throttling exercise it by hand.
- **AWS S3:** untested. MinIO and DigitalOcean Spaces both work.
