# Deployment

Docker Compose setup for running Kartoza CloudBench standalone (no
GeoHosting required). Run everything from inside this directory.

## Quick start

```bash
cp .template.env .env   # fill in ADMIN_USERNAME/PASSWORD, DJANGO_SECRET_KEY, CLOUDBENCH_ENCRYPTION_KEY, etc.
cp docker-compose.override.template.yml docker-compose.override.yml
make up                 # picks up docker-compose.override.yml automatically (dev mode)
```

`CLOUDBENCH_ENCRYPTION_KEY` is required by the production settings — without
it `django` crash-loops on startup. Generate one with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

It encrypts stored connection credentials, so keep it stable: changing it
makes previously saved credentials unreadable.

Open `http://localhost:${HTTP_PORT}` (default `8000`) and sign in with
`ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env` — that superuser is created
automatically on first boot by `docker/entrypoint.sh`. The first boot takes a
little while (migrations and `collectstatic` run before Gunicorn starts), so
the URL won't respond immediately — wait for `READY` in `make logs`, or for
`docker compose ps` to show `django` as `healthy`.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base stack — `django` (Gunicorn) and `cloudnativegis-processing`, no source mounts |
| `docker-compose.override.yml` | Your local dev override (gitignored). Copy `docker-compose.override.template.yml` to create it |
| `docker-compose.override.template.yml` | Tracked template for the dev override — source mounts, `django` built from the `prod` Dockerfile target, plus `vite`/`dev` services for the frontend dev server and PyCharm remote debugging (profile `dev`) |
| `docker-compose.override.devcontainer.yml` | Used only by `.devcontainer/devcontainer.json`, not combined with the file above — see the root README's Dev Container section |
| `.template.env` | Template for `.env` — admin credentials, `DJANGO_SECRET_KEY`, `CLOUDBENCH_ENCRYPTION_KEY`, CloudNativeGIS settings, optional GeoHosting integration vars |
| `docker/Dockerfile` | `prod` target: Python/Gunicorn, builds the Vite/React frontend in-place |
| `docker/Dockerfile-vscode` | Devcontainer image, layered on top of an already-built `prod` image |
| `docker/Dockerfile-dev` | SSH-accessible image for a PyCharm remote interpreter, also layered on `prod` |
| `docker/entrypoint.sh` | Runs migrations, `collectstatic`, and creates the admin superuser on container start |
| `image-index.yml` | Image build metadata |

Django serves everything directly — static files via WhiteNoise
(`whitenoise.middleware.WhiteNoiseMiddleware`, see `cloudbench/settings/base.py`)
and the API/SPA via Gunicorn — there's no reverse proxy in front of it in
this stack.

## Services (dev mode — `make up`)

- **django** — `http://localhost:${HTTP_PORT:-8000}`, source-mounted, autoreload
- **cloudnativegis-processing** — PMTiles/GeoParquet/COG conversion service, internal only (no published port), reached by `django`/`dev` at `http://cloudnativegis-processing:8000`
- **vite** *(opt-in, `make dev`)* — `http://localhost:5173`, frontend dev server (`npm install && npm run dev`), proxies `/api` to `dev`
- **dev** *(opt-in, `make dev`)* — SSH on `:8091`, manually-run Django dev server on `:8090` — see PyCharm remote interpreter setup. `make dev` also starts `cloudnativegis-processing`

In dev mode without `make dev` running, use the `django` URL directly —
it serves the production-built `static/` bundle, which isn't rebuilt
automatically unless you also run `vite`.

## Make targets

Run from inside `deployment/`:

| Target | Description |
|--------|-------------|
| `make build` | Rebuild the `django` image after a dependency change |
| `make up` | Start the full stack in dev mode (source-mounted) |
| `make up-prod` | Start the base compose file only, no source mounts |
| `make dev` | Start the SSH debug container, Vite and `cloudnativegis-processing` |
| `make down` | Stop everything |
| `make logs` | Follow logs from all services |
| `make logs-vite` | Follow logs from the `vite` service only |
| `make shell` | Open a Django shell inside the `django` container |
| `make shell-vite` | Open a shell inside the `vite` container |
| `make migrate` | Run migrations inside the `django` container |
| `make collectstatic` | Collect static files inside the `django` container |
| `make test` | Run tests inside the `django` container |
| `make image` | Print the image tag |

These are also runnable directly with `docker compose <command>` if you
prefer.

## CloudNativeGIS

S3's PMTiles/GeoParquet/COG conversion uses [CloudNativeGIS](https://github.com/kartoza/CloudNativeGIS)
— see [S3 upload details](../docs/user-guide/uploads.md#s3-cloud-native-options).
It ships in `docker-compose.yml` as the `cloudnativegis-processing` service
(`ghcr.io/kartoza/cloudnativegis-processing`), so it starts with the rest of
the stack and needs no extra setup. It has no published port; `django` reaches
it over the compose network.

Settings in `.env`:

- `CLOUDNATIVEGIS_URL` — leave blank to use the bundled service
  (`http://cloudnativegis-processing:8000`); set it only to point at an
  external CloudNativeGIS instance instead.
- `CLOUDNATIVEGIS_PROCESSING_TAG` — image tag of the bundled service
  (default `0.0.2`, the first to also produce GeoParquet for vector layers;
  older tags still work, publishing PMTiles only).
- `CLOUDNATIVEGIS_API_TOKEN` — shared secret. Django sends it as a bearer
  token, and the bundled service receives it as `LITE_API_TOKEN`. Leave blank
  to disable auth.
- `CLOUDNATIVEGIS_MAX_DOWNLOAD_SIZE` — max source file size in bytes the
  service will download (default `524288000`, 500MB).
- `CLOUDNATIVEGIS_CONVERSION_TIMEOUT` / `CLOUDNATIVEGIS_POLL_INTERVAL` — how
  long to wait for a conversion and how often to poll it.

To check it's reachable from Django:

```bash
docker compose exec django curl -s http://cloudnativegis-processing:8000/health
```

Run `python manage.py migrate` in the Cloudbench backend after updating to
create the PMTiles conversion-job table (the normal container entrypoint also
runs migrations). Keep Cloudbench running during conversions — restarting its
server interrupts in-flight background jobs.
