# CloudBench — notes for Claude

## Working conventions

- CI runs `ruff check .` and `black --check .`. Format with **black**, only the
  files you changed — never `ruff format`, never whole directories.
- Don't run `makemigrations`; the maintainer makes migrations themselves.
- Don't commit unless asked.
- Use `time.monotonic()` for deadlines/durations, `timezone.now()` for
  timestamps that are stored. In tests, don't patch `time.monotonic` (it's the
  global function); set the timeout setting instead.

## CloudNativeGIS conversions (`apps/s3/cng_lite.py`)

A conversion is a `CngLiteJob` run by `CNGProcessingClient`, one step per
status, so a restart carries on from wherever its status says
(`resume_interrupted_conversions`). Requests to CloudNativeGIS and GeoHosting
are logged in `CngLiteJobLog` (sensitive values redacted).

Two modes, chosen by `CLOUDNATIVEGIS_ON_DEMAND`:

- **Non-demand**: every job runs on the fixed `CLOUDNATIVEGIS_URL` /
  `CLOUDNATIVEGIS_API_TOKEN`.
- **On-demand**: each job gets its own Hetzner server, started and deleted by
  GeoHosting (`~/Development/GeoHosting`) through its OAuth-protected API
  (`apps/core/geohosting.py`, `GeoHostingClient`).

```
[PENDING]
   ▼
[PROVISIONING]  CngLiteJob.provision()
   non-demand: url/token from settings
   on-demand:  POST GeoHosting /servers/ {job_id, username, hetzner_server_id}
                 400 account not linked / type not enabled ───→ error
                 409 "being deleted" → wait, POST again
               poll GET /servers/<job_id>/ (no deadline — GeoHosting decides)
                 provisioning → wait
                 failed ──────────────────────────────────────→ error
                 404 / deleted → POST again
                 ready → url + token of its server
   wait_until_healthy(): GET {url}/health, max 600s ──────────→ error
   ▼
[PUSHING]       POST to cng-lite, with a presigned URL to the source
[POLLING]       GET /api/v1/jobs/<id>
[DOWNLOADING]   result files
[PUBLISHING]    upload to S3 + Portolan catalog
   ▼
finish_job(outcome)   ◄── an error at any step (outcome = completed / failed)
   non-demand: straight to the final status
   on-demand:  [DEPROVISIONING] (outcome saved)
                 DELETE GeoHosting /servers/<job_id>/
                   204 → done
                   202 → token cleared, poll GET until deleted / 404
                 a failed delete is only logged; the outcome stands
   ▼
[COMPLETED] / [FAILED]   (completed_at set)
```

Cancelling (`DELETE /api/s3/conversion/jobs/<id>`, `cng_lite.cancel_job`):
allowed while pending … downloading (not once publishing). The job goes
`CANCELLING`; whatever runs it stops at its next `update_job`/poll
(`JobCancelled`), then `finish_job(CANCELLED)` — deprovisioning on demand.
Jobs depending on it (a GeoPackage's raster job) are cancelled with it; a
restart finishes a `CANCELLING` job as `CANCELLED`.

| | Non-demand | On-demand |
|---|---|---|
| `is_valid()` | `CLOUDNATIVEGIS_URL` set | GeoHosting configured (`GEOHOSTING_URL`, client id/secret) |
| `health()` / `availability()` | `GET {CLOUDNATIVEGIS_URL}/health` | GeoHosting's `/healthy/` OK **and** one of `/server-types/` in stock (`available`, from Hetzner's `server_types[].locations[].available`) |
| Tools API `cloudnativegis` | `onDemand: false`, `servers: []` | `onDemand: true`, `servers`: the enabled types |
| Server type | — | picked in the upload dialog (`hetznerServerId`, required); saved as `hetzner_server_id`, its specs in `hetzner_server_specification` |
| Provisioning | URL/token from settings | POST, poll until `ready` |
| `/health` wait | max 600s (`CLOUDNATIVEGIS_PROVISIONING_TIMEOUT`, hardcoded) | same (normally instant: GeoHosting already checked it) |
| Finishing | straight to completed/failed | deprovisioning, then completed/failed |

Resuming after a restart:

| Status | Carries on with |
|---|---|
| `pending` / `provisioning` | `provision()` again (on-demand: same server for the same job) |
| `pushing` … `publishing` | `wait_until_healthy()`, then that step |
| `deprovisioning` | deleting the server only, then `outcome` (mosaics too) |
| any other active mosaic | failed via `finish_job`, which still deletes its server |

Timeouts on the on-demand server's start/delete are GeoHosting's job, not
CloudBench's: CloudBench polls until GeoHosting says ready/failed/deleted.

## On-demand servers: plan and status

GeoHosting side (`django_project/geohosting_controller/`):

| # | Work | Status |
|---|---|---|
| G1 | `HetznerClient` as a service (`connections/hetzner.py`) | done |
| G2 | `EncryptedCharField`, `HetznerServer` catalog (admin "Sync from Hetzner"), `HetznerServerInstance`, `CloudBenchLog`, admin | done |
| G3 | `start()` / `remove()`, Celery tasks `spin_up_server` / `delete_server` | done |
| G4 | API `POST /servers/`, `GET` / `DELETE /servers/<job_id>/` (OAuth scope `cloudbench` only) | done |
| G5 | Reaper (Celery beat) for stuck/forgotten servers | deferred — **required before production** |
| G6 | Tests for G1–G4 | written, not run |

CloudBench side:

| # | Work | Status |
|---|---|---|
| C1 | `CngLiteJobLog` model + read-only admin inline; logs push (always), poll (done/failed/404/error), download (failures) | done |
| C2 | `GeoHostingClient.create_server` / `get_server` / `delete_server`, logged as target `geohosting` | done |
| C3 | On-demand `CngLiteJob.provision()` (no CloudBench-side deadline) | done |
| C4 | `DEPROVISIONING` status, `outcome` field, `CngLiteJob.deprovision()`, `finish_job()`; mosaic uses it; frontend treats `deprovisioning` as active | done |
| C5 | Resume `provisioning` (server gone → ask again) and `deprovisioning` | done |
| C6 | Tests (`test_core_geohosting.py`, `test_s3_on_demand_provision.py`, `test_s3_deprovision.py`, `test_s3_cng_lite_job_log.py`) | written, not run |

Decisions:

- Auth: CloudBench uses an OAuth client-credentials token, scope `cloudbench`,
  which GeoHosting only grants the Application whose client id is
  `CLOUDBENCH_OAUTH_CLIENT_ID`. OAuth only, no session.
- The job's owner username must be a GeoHosting user (400 otherwise).
- Asynchronous: POST answers 202, Celery spins the server up, CloudBench polls.
- The cng-lite token is stored encrypted on both sides and cleared once the
  server is deleted.
- Server type: the user picks one of GeoHosting's enabled x86 `HetznerServer`s
  (by id) in the upload dialog; it's required on demand. Only that one is
  started — out of stock fails the job, no fallback.
- `HetznerServer` sync: a changed price/currency is a new row (no unique
  constraint), taking over `enable` from the old one; the old row is kept.
- No CloudBench-side timeout for starting/deleting a server, and no stale
  handling there: GeoHosting handles it.
- GeoHosting never waits for Hetzner inside a task: `spin_up_server` /
  `delete_server` only create/delete the server and save Hetzner's
  `action_id`; the beat task `check_servers` (every 10 s) carries each
  provisioning/deleting instance on (action done → cng-lite up → ready;
  deletion done → deleted), with `START_TIMEOUT` (10 min) and
  `PICKUP_TIMEOUT` (5 min). A worker restart loses nothing.

Still to do:

- Run the tests on both sides (migrations are made: CloudBench `s3` up to
  `0017` - main's `0015_cnglitejob_verifying_status`, then this branch's
  `0016` outcome/deprovisioning and `0017` hetzner_server_id; the
  cancelling/cancelled statuses still need one - GeoHosting
  `geohosting_controller` `0002`, plus `action_id`).
- Rebuild the frontend bundle (`make build-frontend`): the one in `static/`
  predates the per-step statuses and the server picker.
- G5 reaper (its max server age is undecided, e.g. 7 hours).

Deferred:

- Internal/private network to the cng servers (public IP for now).
- A limit on how many servers (and how much cost) can run at once.
- One server for both of a GeoPackage's jobs (vector + raster).
- Inspecting a GeoPackage in on-demand mode.
- (Optional) listing `cryptography` in GeoHosting's `requirements.txt`.
