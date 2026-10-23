# Upload passthrough to S3

**Branch:** `feat/s3-upload-passthrough`, on top of `feat/upload-passthrough` (see
[Upload passthrough](upload-passthrough.md) for GeoServer and GeoNode).

## Summary

- **What changed:** uploads to an S3 connection go up in 5 MB chunks that CloudBench
  passes on to the bucket as the parts of an S3 multipart upload. Nothing is written to
  CloudBench's disk; only one chunk is in memory.
- **Covered:**
  - plain uploads;
  - shapefiles (their ZIP is made in the bucket);
  - conversions to COG, COPC and PMTiles;
  - mosaics (every tile's header is read in the bucket with GDAL `/vsis3/`);
  - GeoPackage inspection (its layers are read in the bucket the same way).
- **What users get:**
  - files up to 10 GB, no longer capped at 2 GB by the ingress;
  - a dropped connection is retried for about 5 minutes, since S3 keeps the parts;
  - closing the dialog cancels the upload.
- **Still staged on disk:**
  - the style editor's small saves;
  - GeoPackage datasets to GeoNode (see [Upload passthrough](upload-passthrough.md)).
- **Tested:**
  - unit, API and frontend tests;
  - MinIO through 4 gunicorn workers;
  - DigitalOcean Spaces (GeoHosting's bucket) with the production image's GDAL 3.6.
  AWS itself is untested.
- **Also fixed:** the disk-staged upload endpoints (`/api/upload/chunk`, cancel, the
  PostGIS and GeoNode GeoPackage assemble) now take only the user's own sessions that
  stage on disk. Before, any user could send chunks to any session.
- **To decide:** see [To discuss with the senior](#to-discuss-with-the-senior). The points
  are a model for the session state, a bucket lifecycle rule for abandoned uploads, and
  GeoPackages to GeoNode.

## Problem

An upload to an S3 connection was one multipart form POST. Django spooled the file to the
container's `/tmp` (anything over 2.5 MB, Django's default), then:

- a plain upload read it whole into memory (`uploaded_file.read()`) to `put_object` it;
- a conversion copied it again into the job's folder (`UPLOAD_TEMP_DIR`, on the data
  volume: 10 GiB on GeoHosting), then uploaded that to the bucket.

So a big file took its size twice on CloudBench's disks and, for a plain upload, its
whole size in RAM. And as one request it was capped by the ingress
(`proxy-body-size: 2G`), with no resume: a dropped connection meant starting over.

## How it works now

The browser sends the file in chunks; CloudBench passes each one on to the bucket as one
part of an **S3 multipart upload**, as it arrives. Nothing is written to disk, and only
the one chunk (5 MB) is in memory.

```
browser ── PUT chunk n ──▶ any gunicorn worker ── UploadPart n+1 ──▶ bucket
browser ── POST complete ─▶ any worker ── ListParts, CompleteMultipartUpload ──▶ bucket
                                         └─ conversion: CngLiteJob, started
```

Unlike the relay to GeoServer/GeoNode, nothing has to stay open between the chunks: S3
keeps the parts. So:

- **No relay or socket**: any worker takes any chunk, in any order. The state is an
  `UploadSession` row, and the parts' ETags are asked of S3 (`ListParts`) at the end.
- **Resume for minutes, not seconds**: the browser retries a failed chunk for about 5
  minutes (1, 2, 4, 8, 15, then 30 s at a time). A chunk sent again replaces its part.
- **No 2G cap**: every request is one chunk. The limit is `UPLOAD_MAX_FILE_SIZE` (10 GB).
  Chunks grow past 5 MB only for a file of over 10 000 of them (S3's part limit).
- **A conversion's source goes straight to its job's source key**
  (`<folder>/sources/<job id>/<file>`; the session id becomes the job's id), and the job
  starts once the file is all in. CloudNativeGIS reads it from there, as before.

### What's read or rewritten, in the bucket

Some uploads need their file read, or rewritten, before they're published. That's done
where the file landed, never on CloudBench's disk:

- **A GeoPackage to convert** goes to its source key, and its layers and raster tables
  are read there with GDAL's `/vsis3/` (`S3Client.gdal_path`), signed with the
  connection's keys: only the pages holding its `gpkg_*` tables are fetched (120 KB of a
  49 MB GeoPackage). The job waits for the layers to be picked, as before. An unreadable
  GeoPackage is deleted, with its job.
- **A shapefile's parts** (`.shp` with `.shx`, `.dbf`...) are uploaded one multipart
  upload each, into a sources folder, checked by name before anything is sent
  (`pmtiles.shapefile_components`, as for a staged one). Completing the `.shp`
  completes its parts, and their ZIP is written into the bucket: each part streamed from
  S3 into a new multipart upload. A plain upload keeps only the ZIP (at the key's
  `.zip`); a conversion keeps the parts beside it, as `upload_raw_components` did.
- **A shapefile ZIP to convert** is read in the bucket with range requests (a seekable
  file over `GetObject` ranges), checked (`pmtiles.zip_sidecars`) and rewritten to its
  source key, its files named after the job; the ZIP uploaded is then dropped.
- **A mosaic's tiles** are uploaded one multipart upload each, into the job's sources
  folder, each checked to start as a TIFF. Completing the first tile completes the others.
  Every tile's header is then read where it landed (`gdalinfo` on `/vsis3/`, the bytes of
  the header only), and `mosaic.check_tiles` refuses tiles that don't agree (CRS, bands,
  data types, nodata), naming the odd one out; the tiles are then deleted. `run_mosaic`
  reads each header there again for the tile's date, and no longer stages the tiles: they
  are already where CloudNativeGIS reads them. Only its small item mirror
  (`items.parquet`, a few KB) is written to the job's folder and uploaded, as before.
- **A GeoPackage's source asset** (`cng_lite._publish_source`) is hashed by streaming it
  from the bucket, for its `file:checksum` and `file:size`.
- **GDAL's errors** reach the user without the `/vsis3/` path they name (the bucket and
  the object's key): `multipart.gdal_reason` keeps the reason, naming the file.

Memory stays bounded: a 5 MB part being written, and 1 MB reads.

### Endpoints

`POST /api/s3/multipart/{connId}` starts; `PUT …/{sessionId}/parts/{n}` sends a chunk;
`POST …/{sessionId}/complete` joins them (and starts a conversion); `GET` / `DELETE
…/{sessionId}` give the chunks received, or abort. See the [API reference](api.md).

### Checked before any data is sent

The connection, the size limit, the file type for a conversion, the license and server,
and whether the conversion's layer folder exists (`409`, so the dialog asks to replace).
A conversion's first chunk must start as its file type does (TIFF, `LASF`). At the end,
CloudBench checks the object's size in the bucket.

### What the session row holds

There's no model for this yet, so the `UploadSession` fields are reused (no migration):

| Field | For an S3 upload |
|---|---|
| `connection_id` | the S3 connection |
| `store_name` | the object key |
| `upload_dir` | `s3-multipart:<UploadId>` |
| `workspace` | the kind of upload: empty (plain), `shapefile` (a plain one's `.shp`), `part` (a shapefile's other parts), `inspect` (a GeoPackage), `pmtiles-shapefile`, or the conversion (`cog`, `copc`, `pmtiles`) |
| `received_chunks`, `completed`, `error` | as for any upload |

The disk-staged endpoints (`/api/upload/chunk`, `/session/...`, GeoNode's and the PostGIS
import's assemble) now take only the user's own sessions that stage on disk. Before, a
relayed upload's session would have been written (and assembled) in the process's working
folder, and any user could send chunks to any session.

### Cancel and abandoned uploads

Closing the dialog cancels the upload: CloudBench aborts it (a `.shp` with its parts), and
S3 drops what it has. An
upload left incomplete (a closed tab) is aborted when the same user starts another one
more than a day later.

## What's covered, and what's still staged on disk

| Upload | Now |
|---|---|
| A plain upload of one file | straight into the bucket |
| GeoTIFF → COG | straight to its source key |
| LAS/LAZ → COPC | straight to its source key |
| GeoJSON / FlatGeobuf / KML / KMZ → PMTiles | straight to its source key |
| Shapefile parts (`.shp` + `.shx`, `.dbf`...), plain | straight into the bucket, zipped there |
| Shapefile (parts, or a `.zip`) → PMTiles | straight into the bucket, zipped (or rewritten) there |
| GeoPackage → PMTiles/COG | straight to its source key, its contents read there |
| Mosaic (several GeoTIFFs) | straight into the bucket, every tile's header read there |
| A layer style saved by the style editor | the old endpoint (small file) |

## Testing

- Unit and API tests (`tests/unit/test_s3_multipart.py`) against a fake bucket: a plain
  upload in any order with a chunk sent twice, sizes and places of chunks, missing chunks,
  a COG conversion end to end, the file-type checks, `409` over an existing layer, the size
  limit, cancel, abandoned uploads, ownership, and the disk-staged endpoints refusing it;
  a shapefile's parts zipped (plain and converted), checked first, and cancelled together;
  a shapefile ZIP rewritten with range requests, or refused and dropped; a GeoPackage read
  where it landed, an unreadable one dropped, a non-GeoPackage refused; a mosaic's tiles
  checked in the bucket, refused and dropped when they don't agree; `run_mosaic` reading
  tiles already in the bucket without staging them; GDAL's errors without their path.
- Frontend tests: which uploads go straight to the bucket, retries, abort on cancel and
  on failure (`web/src/api/s3Multipart.test.ts`), and the dialog using it
  (`S3UploadDialog.test.tsx`).
- Against a real MinIO, through 4 gunicorn workers: a 23 MB file in 5 chunks sent out of
  order (one twice) arrived intact (SHA-256 matched); cancel left no open multipart
  upload; a COG conversion put its source on its source key and started its job; a
  non-TIFF first chunk was refused; the data folder stayed the same size, byte for byte.
  Then a shapefile's parts (plain, and to PMTiles), a shapefile ZIP to PMTiles, and a
  GeoPackage's inspection: each ZIP right and the GeoPackage's layers and raster table
  read in the bucket; only the database grew in the data folder.
- Against **DigitalOcean Spaces** (GeoHosting's bucket, `fra1`), with the production
  image: `apps.s3.multipart`'s calls (two parts sent out of order, `ListParts`,
  `CompleteMultipartUpload`, then an abort) gave back the file byte for byte, and left no
  open upload. Then, through `apps.s3.multipart` itself: a GeoPackage's contents read in
  the bucket with the image's GDAL 3.6, and a shapefile's parts zipped there (the ZIP
  opens in GDAL). Then the whole set through the test stack, under a test folder
  (`tests/upload-test/TEST_REPORT_s3_upload_passthrough.md`): plain, resume after 90 s, cancel, COG,
  shapefile (parts, plain and to PMTiles, and ZIP), GeoJSON, GeoPackage (inspected,
  converted, picker closed, unreadable), mosaic (and tiles that don't agree), and
  replacing a layer. CloudBench's data folder grew only in `db.sqlite3` (job rows), and
  `/tmp` not at all. **AWS** itself is untested.

### Reading in the bucket instead of on disk: what was tried first

Tried with the production image (GDAL 3.6.2), against MinIO and DigitalOcean Spaces:

| Try | MinIO | Spaces |
|---|---|---|
| GeoPackage contents (`read_contents`) via `/vsicurl/` + presigned GET (the TODO's way) | fails | fails |
| GeoPackage contents via `/vsis3/`, signed with the connection's keys | works | works |
| Shapefile parts read where they are (`/vsis3/…/x.shp` finds its `.shx`/`.dbf`) | works | works |
| Shapefile parts zipped in the bucket (read from S3, written as a multipart upload) | works | works |

Reading a 49 MB GeoPackage's contents over `/vsis3/` downloaded 120 KB (7 range
requests), not the file.

## To discuss with the senior

1. **The session row reuses `UploadSession` fields** (table above). A small model for S3
   uploads would be clearer, but needs a migration from the maintainer.
2. **Abandoned uploads** are aborted lazily (the user's next upload, after a day).
   Suggest also a bucket lifecycle rule (`AbortIncompleteMultipartUpload`, e.g. 2 days),
   which aborts them whatever happens to CloudBench.
3. **DigitalOcean Spaces** works for the multipart upload and for reading with `/vsis3/`
   (see Testing). The test files were left under `cloudbench-test/s3read/` in the bucket.
4. **GeoPackage datasets to GeoNode** are still staged too: see
   [Upload passthrough](upload-passthrough.md#open-question-geopackage-datasets-to-geonode).
