# Bulk upload: design plan

**Status:** phases 1 and 3 are built (backend core, API and dialog), for one
fixed CloudNativeGIS server; on-demand servers (phase 2) and the polish items
(phase 4) are not. Written against `main` at #177.

## Goal

Today a layer is converted by uploading it through the Upload dialog, one
file (or one shapefile, or one mosaic) at a time. Converting a folder of 50
layers means 50 trips through the dialog.

Bulk upload converts everything in a bucket folder in one go:

1. The user first puts the layers in a folder of the bucket (a plain upload
   with "convert" off, or `aws s3 sync`, or whatever they already do).
2. A **Bulk upload** button, beside **Upload**, opens a dialog.
3. The user picks the folder. CloudBench lists what it finds and which
   conversion each file gets.
4. The user chooses how many conversions run at once - **N processing
   servers**: with 2, two conversions run at a time and the rest wait.
5. CloudBench converts every layer through the same pipeline a single upload
   uses (`CNGProcessingClient`), N at a time, and shows overall and per-file
   progress.

It covers every layer type CloudBench converts: vector (shapefile, GeoPackage,
GeoJSON, FlatGeobuf, KML/KMZ → PMTiles + GeoParquet), raster (GeoTIFF → COG)
and point cloud (LAS/LAZ → COPC).

Non-goals for the first version: mosaics (see below), watching a folder for
new files, scheduled runs.

## What exists today, and what it means for bulk

| Today | Consequence |
|---|---|
| `start_conversion(uploaded_file, key, ...)` in `pmtiles.py`, `cog.py`, `copc.py` takes a Django upload, writes it to `UPLOAD_TEMP_DIR`, stages it in S3 at `<parent>/sources/<job>/<name>`, saves a `CngLiteJob` and starts a thread. | Bulk files are already in the bucket. It needs a second entry point that creates the same job from an S3 key, with no upload and no `UPLOAD_MAX_FILE_SIZE` limit (the bytes never pass through Django). |
| Each job starts its own thread at once. There is no queue and no limit. | Needs a scheduler that keeps at most N jobs running. |
| `CNGProcessingClient` is one step per status, resumable by `resume_interrupted_conversions`. | Reuse it unchanged. Bulk only decides *when* a job starts and *where* it runs. |
| `_publish_source` **moves** a GeoPackage's original from `source_key` into the layer group and deletes it; cancelling a job deletes `source_key`. | A bulk job must not point `source_key` at the user's original, or converting would delete it (see "Source files"). |
| On demand (`CLOUDNATIVEGIS_ON_DEMAND`): a job starts its own server, unless `instance_server` names one of the owner's running servers; `auto_destroy` says whether it is deleted afterwards. Needs `hetzner_server_id` (the server type). | N servers = N server slots, each running one job at a time (see "Servers"). |
| Non-demand: every job uses the one fixed `CLOUDNATIVEGIS_URL`. | There is only one server, so N means *N jobs at once on it*. The dialog says so. |
| A pending GeoPackage job with `layers` null is treated as "awaiting layer selection" (`AWAITING_LAYER_SELECTION`) and left alone on restart. | Bulk GeoPackage jobs look the same until they run. Needs a marker (see "Data model"). |
| Inspecting a GeoPackage reads the staged local copy (`geopackage.read_contents`). | A GeoPackage already in S3 has no local copy. Bulk converts *all* its layers, using CloudNativeGIS's `/api/v1/gpkg/layers` listing that `CNGProcessingClient._layer_names` already does for a GeoPackage uploaded straight to convert. |

CloudNativeGIS needs **no change**: it already converts one source per request
from a presigned URL and uploads results to presigned URLs.

## Scope: which files, which conversion

Chosen by file name, non-recursive by default (a "Include subfolders" option
can be added), skipping what CloudBench itself wrote:

| In the folder | Becomes | Job kind |
|---|---|---|
| `*.zip` containing one shapefile | PMTiles + GeoParquet | `pmtiles` |
| `*.gpkg` | one layer folder per vector layer and raster table, in a group | `pmtiles` + `cog` (two jobs, as a single GeoPackage upload gives) |
| `*.geojson`, `*.fgb`, `*.kml`, `*.kmz` | PMTiles + GeoParquet | `pmtiles` |
| `*.tif`, `*.tiff` (not `*_3857.tif`) | COG, one layer per file | `cog` |
| `*.las`, `*.laz` (not `*.copc.laz`) | COPC | `copc` |

Skipped, and listed with the reason in the preview: everything else, anything
under a `sources/` or a Portolan layer folder (it has a `collection.json`),
CloudBench outputs (`*.pmtiles`, `*.parquet`, `*_3857.tif`, `*.copc.laz`,
`thumbnail.png`), and folders that already hold a published layer.

Loose shapefile parts (`.shp` + `.shx` + `.dbf` ...) are the awkward case: the
pipeline hands CloudNativeGIS a presigned URL for one object, and CloudNativeGIS
only bundles loose parts when given an `s3://` URI. **Version 1 supports
shapefiles as `.zip` only**; loose parts are listed as "zip these first". (A
later version could zip them in CloudBench, which means downloading them.)

**Mosaics are out of scope.** A mosaic is staged on local disk, runs in one go
and cannot be resumed (`apps.s3.mosaic`). Every GeoTIFF in a folder is
therefore its own COG layer; "treat these tiles as one mosaic" can follow once
mosaics work from S3.

## User flow

### 1. The button

**Bulk upload** next to **Upload** in the header (`Header.tsx`), enabled when an
S3 connection or folder is selected, like Upload. It opens
`BulkUploadDialog`, starting in the folder the user was browsing.

### 2. Choose a folder (step 1)

A folder picker over the connection's bucket (lists with
`GET /api/s3/objects/<conn>?prefix=...&delimiter=/`, the same listing the tree
uses). One folder; the preview in step 2 says how many layers it holds.

### 3. Review and options (step 2)

CloudBench lists the folder (`POST /api/s3/bulk/preview/<conn>`) and shows a
table: file, size, the conversion it gets, and whether its target already
exists. Each row can be unticked; unsupported files are greyed out with the
reason. Options:

- **License** (and license URL for "other"), applied to every layer - the same
  choice as the Upload dialog.
- **Where the layers go** (`destination`): the top level of the bucket
  (`<name>/`, where the layers of other uploads are - the dialog's default),
  beside each file (`<folder>/<name>/`), or into a chosen folder. The staged
  copy of each original goes to the `sources/` next to where the layer goes, as
  for a single upload. Which layers already exist is checked at that place, so a
  layer already published at the top level shows as existing and is skipped (or
  replaced, if you say so).
- **If a layer already exists**: *skip* (default), *replace*, or *stop*. Today
  a single upload refuses with `TargetExists` unless confirmed; bulk needs the
  decision up front, so it is one setting for the batch.
- **Processing servers (N)**: 1 to the allowed maximum. See below.
- **On demand**: the same server-type picker, "existing server" list and
  *auto destroy* switch as the Upload dialog (reused as components).

A summary line before starting: "23 layers, 2 at a time. 2 servers will be
started (hel1 · 2 vCPU / 4 GB, 0.0106 EUR/h each) and destroyed when the
batch finishes."

### 4. Progress (step 3)

One overall bar (done / failed / running / waiting), then a row per layer with
its own status and message (what the Upload dialog shows for one job). Failed
rows show their error and a **Retry failed** button. **Cancel** stops waiting
jobs and cancels running ones. The dialog can be closed; the batch keeps
running and shows in the Jobs panel as one expandable entry.

## Servers and concurrency

"N processing servers" means **at most N conversions at a time**.

**On demand** (`apps.s3.bulk_servers`) - each of the N slots is a server running
one layer at a time, started by GeoHosting as the server type picked in the dialog:

- The coordinator starts up to N servers - never more than there are layers
  waiting or running - and gives each queued layer a free, ready one
  (`CngLiteJob.instance_server`). A layer leaves its server running
  (`auto_destroy=False`): the **batch** deletes the servers it started
  (`CngLiteServer.batch`), not the layers.
- A server is deleted as soon as no layer is waiting for one and it isn't
  running one (billing is per started hour); with *Auto destroy* off the servers
  are kept running, and billed, for the user to delete (GeoHosting's page).
  The batch is over once its servers are gone.
- Starting and deleting are GeoHosting's to time out; the coordinator only
  steps - it polls each starting server on every pass and never waits - so a
  restart loses nothing: what is known is in the database. A server is saved
  before GeoHosting is asked for it, with an id of its own, so a restart in
  between asks about it rather than starting another.
- A server that fails to start is replaced, up to `MAX_FAILURES` (2) failures;
  then the batch goes on with the servers it has - or, with none, fails its
  waiting layers ("No server could be started: ...").
- Cancelling doesn't call GeoHosting in the request: the coordinator cancels the
  layers and deletes the servers. A server GeoHosting can't be asked to delete is
  logged and left (its `error` says so) - it doesn't hold the batch up.
- Cost cap: `CLOUDNATIVEGIS_BULK_MAX_SERVERS` (default 5) bounds N.
  Not yet: reusing the user's own running servers for a batch, and a cap across
  batches.

**Non-demand** - there is one fixed server, so N is the number of jobs sent to
it at once. Default 1; the maximum is `CLOUDNATIVEGIS_BULK_MAX_CONCURRENCY`.
Big LAS and raster conversions are memory-hungry, which is why the default is
not "all of them".

## Source files

For a GeoPackage, the pipeline treats `source_key` as a staged copy it owns:
it moves it into the layer group once converted (`_publish_source`), and
cancelling deletes it. Pointing it at the user's original would delete their
file.

**Decision: copy a GeoPackage's original to a staging key first**, with a
server-side S3 copy (`<dest parent>/sources/<job>/<name>`, no download, no
bytes through CloudBench), then run the unchanged pipeline on the copy. The
original is never touched; the cost is one extra copy in `sources/`, cleaned
up once it's moved into the layer group.

Nothing else the pipeline converts (shapefile, GeoTIFF, LAS/LAZ) is ever
moved or deleted - only read, through a presigned URL - so it needs no copy
of its own: it converts where it already is, leaving nothing in `sources/`
at all. A single upload still stages a copy for these too (unchanged, out of
scope here); only bulk's `_start_job` was changed.

### From another bucket

The folder may be in another of the user's registered connections than the
one the layers go into: opened from Kartoza, the dialog's "Read the layers
from" picks Sandbox, and its folders are browsed and converted. The layers
are always published into the connection the dialog was opened from (the
batch's `connection`); the other is read only (`CngLiteBatch.source_connection`,
plus `source_bucket`, kept in case the connection is deleted).

Nothing is copied. Each job is `source_in_place` (with a `source_connection`):
its `source_key` is the original's own key in the source bucket, and
`CNGProcessingClient` presigns the read URL it hands CloudNativeGIS with the
source connection's client (`source_client`), while the result URLs are still
presigned with the destination's. The bytes never pass through CloudBench, and
there is no staging copy under `sources/`.

The pipeline treats `source_key` as a staged copy it owns, so for such a job it
never moves or deletes it (`_publish_source`, and cancelling a GeoPackage
inspection, are guarded by `source_in_place`). A GeoPackage's original is still
kept in its layer group's `source/` folder: streamed across, hashed on the way,
at publish time. The source bucket is only read, so read access is enough.

Requirements and edge cases:

- CloudNativeGIS must be able to reach the source bucket's endpoint, as it
  must the destination's; a private endpoint fails the conversion.
- A deleted source connection fails the jobs not yet started (and a running
  one, when it next needs the source).
- "Beside each file" then means the same path in the destination bucket.

### A VRT of the rasters

A batch may also publish a VRT of its GeoTIFFs (`createVrt`, `vrtName`; the
dialog offers it when the folder holds two or more). The layers stay one COG
collection each; one more collection, `<vrt name>/`, has a `related` link per
layer and, as its only asset, a GDAL VRT of all their data COGs. It is linked
from the root catalog, so it can be browsed, but has no renderable asset: it is
not a Map Explorer layer (`apps.s3.bulk_vrt`).

The VRT file is *beside* the collection folder - `<parent>/<vrt name>.vrt`,
`<parent>` being the folder the layers' folders share (the bucket's top level for
"top level") - so its paths run down into the layers (`<layer>/<layer>.tif`).
Paths through `..` do not open with GDAL's `/vsis3/`, which does not resolve
them (the request is signed as written); the asset's href is `../<vrt name>.vrt`.

It is built once every layer is over (never for a cancelled batch), by the
coordinator: the start of each COG is fetched with a range request (more, if
its header didn't fit) into a scratch folder laid out like the bucket, and
`gdalbuildvrt` is run there, so no pixel is read and no CloudNativeGIS job is
needed. It covers the GeoTIFFs converted in this batch plus those it skipped for
being published already. Rasters unlike the most (CRS, band count, data type) are
left out, each with its reason; nodata may differ, each source keeping its own.

Its state is `CngLiteBatch.vrt` (`pending`, `building`, `done`, `skipped`,
`failed`) and never fails the batch. A retry builds it again, a restart does
too, and building it again over its own folder replaces it (and removes the
first version's file inside the folder); a folder or file holding anything else
is refused. Open question: whether Portolan's validator accepts a collection
with only a metadata asset outside its folder and `related` links.

### Trying on-demand servers on a dev server

- CloudBench: `CLOUDNATIVEGIS_ON_DEMAND=True`, `GEOHOSTING_URL`, `GEOHOSTING_CLIENT_ID`,
  `GEOHOSTING_CLIENT_SECRET`, `CLOUDBENCH_ENCRYPTION_KEY`, and
  `CLOUDNATIVEGIS_BULK_MAX_SERVERS` (keep it at 2 while testing); migrate.
- GeoHosting (`~/Development/GeoHosting`): its web, Celery worker **and beat**
  (`check_servers`) running, a Hetzner token and snapshot, the server types synced
  and enabled, the OAuth application with the `cloudbench` scope - and the
  CloudBench user's username a GeoHosting user.
- Use the cheapest server type and 2 to 3 small layers: watch the *Servers* line,
  GeoHosting's server list and Hetzner's console - the servers started are
  `min(N, layers)`, each runs one layer at a time, and are gone a few minutes
  after the last layer. Then: auto destroy off (servers kept), cancel while they
  start (they are deleted), kill the dev server mid-batch and run
  `python manage.py resume_conversions`, and a type that fails to start.
  Finally check Hetzner for leftovers.

## Data model

New model `CngLiteBatch` (`apps/s3/models/cng_lite_batch.py`):

| Field | Meaning |
|---|---|
| `id`, `owner`, `connection` | as `CngLiteJob` |
| `source_prefix`, `destination_prefix` | the folder chosen, and where layers go |
| `license`, `license_url`, `on_exists` (`skip`/`replace`/`stop`) | applied to every job |
| `concurrency` | N |
| `hetzner_server_id`, `auto_destroy`, `servers` (the `CngLiteServer`s the batch uses) | on demand only |
| `status` | `running`, `completed`, `failed` (every job failed), `partial`, `cancelling`, `cancelled` |
| `created_at`, `completed_at` | |

`CngLiteJob` gets `batch` (nullable FK, `related_name="jobs"`) and a new status
`queued`: created with the batch, waiting for a free slot. A `queued` job is
ignored by `resume_interrupted_conversions` (the batch resumes it) and is not
"awaiting layer selection". `queued` also needs adding to the frontend's job
statuses, next to `verifying`/`deprovisioning`.

All jobs are created when the batch starts, so the Jobs panel shows the whole
queue immediately and a restart loses nothing.

**Migrations:** per `CLAUDE.md`, the maintainer makes them. The plan lists the
fields; nothing here runs `makemigrations`.

## Scheduler

`apps/s3/bulk.py`:

```
start_batch(user, connection_id, options, selected_files) -> CngLiteBatch
    list the folder again (the preview may be stale), apply on_exists,
    create the batch and one CngLiteJob per layer (status queued),
    start the batch's coordinator thread

run_batch(batch_id)                      # one thread per batch
    while queued jobs remain or jobs are running:
        free = concurrency - jobs in flight
        for each queued job, up to `free`:
            give it a server (on demand: a free slot's, or a new one)
            stage its source (server-side copy)
            job.status = pending; run_conversion in its own thread
        wait for a job to finish (poll the DB, as wait_for_job does)
        a failure marks the job failed and the batch carries on
        on_exists == "stop": the first failure cancels the rest
    finish: delete the servers the batch started (if auto destroy),
            set the batch's status from its jobs
```

Rules:

- It reuses `run_conversion` / `CNGProcessingClient` as they are: a job run by
  a batch is indistinguishable from one run by an upload.
- Cancelling a batch sets `cancelling`, marks `queued` jobs `cancelled`, and
  calls `cancel_job` on running ones (which already deprovisions on demand).
- A GeoPackage in a batch becomes the same pair of jobs the single flow makes
  (vector job, then its raster job via `depends_on`); the pair counts as one
  slot and runs in turn (`geopackage_convert._run_in_turn`).
- Restart: `resume_conversions` also resumes batches - `run_batch` is
  idempotent over job statuses: finished jobs are skipped, running ones are
  resumed by `resume_interrupted_conversions`, `queued` ones scheduled.
- One batch per user runs at a time at first (a second is refused or queued),
  so two batches don't each assume the server cap is theirs.

## API

All under `/api/s3/`, owner-scoped like the rest of the S3 API.

| Method and path | Does |
|---|---|
| `POST bulk/preview/<conn>` `{prefix, destination, destinationPrefix, recursive, sourceConnectionId}` | Lists the folder: `{prefix, files: [{key, name, size, kind, target, exists, skipReason}], truncated, limits: {maxConcurrency, onDemand}}`. Reads S3 only. |
| `POST bulk/start/<conn>` `{prefix, files, concurrency, license, licenseUrl, destination, destinationPrefix, onExists, recursive, sourceConnectionId}` | Starts a batch: 202 with the batch. 400 for what can't run (a bad N, nothing chosen, a file that isn't a layer, on-demand servers, a batch already running). |
| `GET bulk/<id>` | The batch with each layer's `status`, `progress`, `message` and `error`. |
| `DELETE bulk/<id>` | Cancels: waiting layers at once, running ones when they can stop. 409 if it isn't running. |
| `POST bulk/<id>/retry` | Queues the failed layers again. 409 if it's running or nothing failed. |
| `GET bulk` | The running batches and those finished in the last 24 h, for the Jobs panel. |

`<conn>` is where the layers go; `prefix` is a folder of `sourceConnectionId`'s
bucket when that is given and another connection (`GET bulk/folders/<conn>`
browses whichever connection it is given). A connection or batch that isn't the
user's - the source included - is a 404. The folder picker uses
the existing `GET objects/<conn>?delimiter=/` listing for its subfolders.

A batch's layers are left out of `GET conversion/jobs`: the Jobs panel shows the
batch as one entry.

The listing and kind detection live in one function (`bulk.classify(key)`) used
by the preview and by `start_batch`, so what the user saw is what runs.

## Frontend

- `BulkUploadDialog.tsx` (three steps above), opened from a new header button.
- With on-demand servers (phase 2), reuse the Upload dialog's server picker,
  existing-server list and auto-destroy warning as shared components rather than
  copying them. Until then the dialog says they aren't supported.
- `api/bulk.ts`: `previewBulk`, `startBulk`, `getBulk`, `cancelBulk`,
  `retryBulk`.
- Jobs panel (`JobsIndicator`): a batch is one entry ("Bulk: 12 of 23 done,
  2 running") that expands to its jobs, and the `queued` status.
- Poll `GET bulk/<id>` every 2 s while the dialog or panel shows a running
  batch, the same pattern as `conversionJob`.

## Failure and edge cases

- **A file disappears or changes between preview and start**: the job fails
  with the S3 error; the batch goes on.
- **Same file name twice** (`a/roads.zip`, `b/roads.zip` with subfolders):
  layer ids are made unique by `unique_layer_id`, as in one upload.
- **Huge folders**: the preview lists at most a cap (e.g. 500 files) and says
  so; creating thousands of jobs at once is a different problem.
- **A folder that is already a Portolan catalog**: refused with a pointer to
  Map Explorer; converting its outputs again is never useful.
- **Server limits reached or GeoHosting down**: the batch starts with what it
  can get, or fails to start, before any job is created, where it can tell.
- **Deleting the connection mid-batch**: jobs fail as they already do
  ("connection deleted"); the batch ends `failed`.

## Phases

1. **Backend core** (no UI) - *done*: `CngLiteBatch`, the `queued` status and `batch`
   FK (migrations by the maintainer), `classify` + preview, `start_batch`,
   the scheduler with non-demand concurrency, cancel and resume. Tests with
   `tests/unit/fake_s3.py`'s `FakeS3` and `converting_cng`, as the pipeline
   tests do: slot limit respected, a failure doesn't stop the batch, cancel,
   restart, every kind classified, on-exists policies.
2. **On-demand servers** - *done*: the server pool above (`bulk_servers.py`), the
   server type and auto destroy in the dialog, the servers line in the progress.
   Tests with a fake GeoHosting in `tests/unit/test_s3_bulk.py`. Still needs a
   real run against a dev GeoHosting (see below), and GeoHosting's reaper (G5)
   before production: a crash between starting and deleting leaves servers.
3. **API and frontend** - *done*: the endpoints, `BulkUploadDialog`, the Jobs panel
   grouping. Component tests like `S3UploadDialog.test.tsx`.
4. **Polish**: retry failed, subfolders, `source_in_place` if wanted, loose
   shapefile parts, mosaics from S3.

Each phase leaves `main` working.

## Open questions

1. ~~Where do converted layers go by default?~~ Decided: the top level of the
   bucket, like other layers. Beside each file, or into one folder, are options.
   (The API without a `destination` still means beside, or a folder if one is
   named, so existing callers keep working.)
2. **Copy the original, or convert it in place?** Within a bucket: copy (version 1). From another bucket: in place (see "From another bucket").
3. **Default and maximum for N**: suggested default 1, maximum 5 servers on
   demand, set by settings. What does GeoHosting's budget allow?
4. **Auto destroy default for a batch**: on, as for a single upload - but a
   batch is exactly when a user may want to keep the servers for the next one.
5. **One batch at a time per user**, or several?
6. **Loose shapefile parts in version 1** - zip them in CloudBench (needs the
   download) or leave them to a later version?
