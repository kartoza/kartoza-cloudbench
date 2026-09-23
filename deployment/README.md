# Deployment

Docker Compose setup for running Kartoza CloudBench standalone (no
GeoHosting required). Run everything from inside this directory.

## Quick start

```bash
cp .template.env .env   # fill in ADMIN_USERNAME/PASSWORD, DJANGO_SECRET_KEY, etc.
cp docker-compose.override.template.yml docker-compose.override.yml
make up                 # picks up docker-compose.override.yml automatically (dev mode)
```

Open `http://localhost:${HTTP_PORT}` (default `8000`) and sign in with
`ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env` — that superuser is created
automatically on first boot by `docker/entrypoint.sh`.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base stack — `django` (Gunicorn), no source mounts |
| `docker-compose.override.yml` | Your local dev override (gitignored). Copy `docker-compose.override.template.yml` to create it |
| `docker-compose.override.template.yml` | Tracked template for the dev override — source mounts, `django` built from the `prod` Dockerfile target, plus `vite`/`dev` services for the frontend dev server and PyCharm remote debugging (profile `dev`) |
| `docker-compose.override.devcontainer.yml` | Used only by `.devcontainer/devcontainer.json`, not combined with the file above — see the root README's Dev Container section |
| `.template.env` | Template for `.env` — admin credentials, `DJANGO_SECRET_KEY`, optional GeoHosting integration vars |
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
- **vite** *(opt-in, `make dev`)* — `http://localhost:5173`, frontend dev server (`npm install && npm run dev`), proxies `/api` to `dev`
- **dev** *(opt-in, `make dev`)* — SSH on `:8091`, manually-run Django dev server on `:8090` — see PyCharm remote interpreter setup

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
| `make dev` | Start the SSH debug container and Vite |
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

S3's PMTiles conversion uses [CloudNativeGIS](https://github.com/kartoza/CloudNativeGIS),
which runs as a separate service — see
[S3 upload details](../docs/user-guide/uploads.md#s3-cloud-native-options).
Point Cloudbench at wherever it's deployed:

- `CLOUDNATIVEGIS_URL` — base URL of the CloudNativeGIS instance.
- `CLOUDNATIVEGIS_API_TOKEN` — bearer token sent on every request, if the
  instance requires one (see `CloudNativeGIS/lite/README.md`).
- `CLOUDNATIVEGIS_CONVERSION_TIMEOUT` / `CLOUDNATIVEGIS_POLL_INTERVAL` — how
  long to wait for a conversion and how often to poll it.

Run `python manage.py migrate` in the Cloudbench backend after updating to
create the PMTiles conversion-job table (the normal container entrypoint also
runs migrations). Keep Cloudbench running during conversions — restarting its
server interrupts in-flight background jobs.
