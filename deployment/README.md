# Deployment

Docker Compose setup for running Kartoza CloudBench standalone (no
GeoHosting required). Run everything from inside this directory.

## Quick start

```bash
cp .template.env .env   # fill in ADMIN_USERNAME/PASSWORD, DJANGO_SECRET_KEY, etc.
make up                 # picks up docker-compose.override.yml automatically (dev mode)
```

Open `http://localhost:${HTTP_PORT}` (default `8080` in dev mode) and sign
in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env` — that superuser is
created automatically on first boot by `docker/entrypoint.sh`.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base stack — `django` (Gunicorn) + `nginx`, no source mounts |
| `docker-compose.override.yml` | Your local dev override (gitignored). Copy `docker-compose.override.template.yml` to create it |
| `docker-compose.override.template.yml` | Tracked template for the dev override — source mounts, `django` built from the `prod` Dockerfile target, plus a `vite` service for the frontend dev server |
| `docker-compose.override.devcontainer.yml` | Used only by `.devcontainer/devcontainer.json`, not combined with the file above — see the root README's Dev Container section |
| `.template.env` | Template for `.env` — admin credentials, `DJANGO_SECRET_KEY`, optional GeoHosting integration vars |
| `docker/Dockerfile` | Multi-stage build: `frontend` (builds `web/` with Node), `prod` (Python/Gunicorn), `vscode` (`prod` + Node, for the devcontainer) |
| `docker/entrypoint.sh` | Runs migrations, `collectstatic`, and creates the admin superuser on container start |
| `nginx/sites-enabled/` | Nginx site config, serves static/media and proxies to `django` |
| `image-index.yml` | Image build metadata |

## Services (dev mode — `make up`)

- **django** — `http://localhost:8000`, source-mounted, autoreload
- **nginx** — `http://localhost:${HTTP_PORT:-8080}`, fronts `django`
- **vite** — `http://localhost:5173`, frontend dev server (`npm install && npm run dev`), proxies `/api` to `django`

In dev mode, use the `vite` URL (`:5173`) directly for the React UI —
`nginx` only serves the production-built `static/` bundle, which isn't
rebuilt automatically while `vite` is running.

## Make targets

Run from inside `deployment/`:

| Target | Description |
|--------|-------------|
| `make build` | Rebuild the `django` image after a dependency change |
| `make up` | Start the full stack in dev mode (source-mounted) |
| `make up-prod` | Start the base compose file only, no source mounts |
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
