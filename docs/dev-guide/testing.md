# Testing

CloudBench has two test layers: fast **unit tests** that run anywhere, and
**staging browser tests** that drive a real CloudBench through its web UI.

## Unit tests

Run the suite with pytest:

```bash
pytest                 # or: make test  (inside the Docker stack)
```

CI also checks formatting and lint — match it before pushing, formatting only
the files you changed:

```bash
black <files-you-changed>
ruff check .
```

Notes:

- Use `time.monotonic()` for durations and deadlines, `timezone.now()` for
  stored timestamps. Don't patch `time.monotonic` in tests — set the relevant
  timeout setting instead.
- Migrations are made by the maintainer; don't run `makemigrations`.

## Staging browser tests

`tests/staging/` drives staging CloudBench through its real UI with Playwright
— logging in, clicking through the tree, uploading files, and following the S3
on-demand conversions end to end. Everything is discovered from staging itself
(the connections already added, the server sizes in stock); `.env.staging`
holds only switches.

### One-time setup

1. Copy the template and fill it in:

   ```bash
   cp .env.staging.example .env.staging
   ```

2. Capture a login. Either let Playwright log in once:

   ```bash
   .venv/bin/python tests/staging/browser_login.py
   ```

   or, if that's slow, copy the token from your own browser's DevTools
   (localStorage key `token` on the CloudBench origin) into `.staging-token`
   and build the auth file:

   ```bash
   .venv/bin/python tests/staging/token_from_file.py
   ```

   Both write `.staging-auth.json` (git-ignored). The login lasts the working
   day; re-run when it expires.

### Running

```bash
.venv/bin/pytest tests/staging
```

Everything is skipped cleanly when you are not logged in.

### What the tests cover

| Test | Area |
| --- | --- |
| `test_01_smoke` | App loads, connections and tools are discoverable |
| `test_02_geoserver` | GeoServer upload |
| `test_03_postgis` | PostGIS import |
| `test_04_geonode` | GeoNode upload (and the title applied after import) |
| `test_05_s3_on_demand` | GeoTIFF → COG on demand |
| `test_06_s3_invalid_on_demand` | A corrupt file fails cleanly; the server is still deleted |
| `test_07_s3_pmtiles_on_demand` | Vector → PMTiles + GeoParquet |
| `test_08_s3_copc_on_demand` | LAS → COPC |
| `test_09_s3_mosaic_on_demand` | Several tiles → one COG mosaic |
| `test_10_s3_geopackage_on_demand` | Skips: GeoPackage inspect is deferred on demand |

The sample files they upload come from `tests/staging/manual-test-data/` —
regenerate them with GDAL:

```bash
python tests/staging/manual-test-data/generate.py   # add --large for the size tests
```

### Two rules

- **Each on-demand test starts a real Hetzner server** (billed per started
  hour) and deletes it when the job ends. Keep `STAGING_ONDEMAND_MAX_JOBS`
  sane and don't leave runs looping.
- **The tests never delete anything in S3**, not even their own uploads. Runs
  are named with a timestamped prefix (`cbtest_<date>_<time>_…`) so they don't
  collide; clean-up, if any, is done by hand.

## Related

- [Architecture](architecture.md) — the conversion pipeline the S3 tests exercise.
- [On-demand Conversions](../user-guide/on-demand-conversions.md) — the feature
  under test, from the user's side.
