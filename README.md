# Kartoza CloudBench

A comprehensive cloud-native geospatial data management platform with TUI (Terminal User Interface) and Web UI for managing GeoServer, PostgreSQL/PostGIS, S3 storage, and more.

![Python Version](https://img.shields.io/badge/Python-3.12+-3776ab?style=flat&logo=python)
![Django](https://img.shields.io/badge/Django-5.1+-092E20?style=flat&logo=django)
![License](https://img.shields.io/badge/License-MIT-green.svg)

## Features

### TUI (Terminal User Interface)
- **Textual-based interface** - Modern Python TUI with rich widgets
- **Connection manager** - Store and manage multiple GeoServer connections with credentials
- **GeoServer hierarchy browser** - Navigate workspaces, data stores, coverage stores, layers, styles, and layer groups
- **CRUD operations** - Create, edit, and delete workspaces, data stores, and coverage stores
- **Vim-style navigation** - Use familiar j/k keys for navigation

### Web UI
- **Modern React interface** - Beautiful Chakra UI-based web application
- **Tree browser** - Hierarchical view of all GeoServer resources
- **Layer metadata editing** - Comprehensive metadata management including title, abstract, keywords, and attribution
- **GeoWebCache management** - Seed, reseed, and truncate cached tiles with real-time progress
- **Map preview** - Interactive map preview with WMS/WMTS support using MapLibre GL
- **Server synchronization** - Replicate resources between GeoServer instances
- **Chunked file upload** - Upload large geospatial files with progress tracking
- **S3 Storage integration** - Browse and manage cloud-native geospatial data
- **PostgreSQL/PostGIS** - Direct database connections via pg_service.conf
- **QGIS Projects** - Manage and preview QGIS Server projects
- **Terria/Cesium 3D** - 3D globe visualization support

## Installation

### Using Nix (recommended)

```bash
# Enter development shell
nix develop

# Run the web server
python manage.py runserver 8080

# Run the TUI
python -m tui
```

### From source

```bash
git clone https://github.com/kartoza/kartoza-cloudbench.git
cd kartoza-cloudbench

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -e .

# Run database migrations
python manage.py migrate

# Build frontend
cd web && npm install && npm run build && cd ..

# Run the web server
python manage.py runserver 8080
```

### Dev Container (VSCode)

Just *Reopen in Container* (or `Dev Containers: Rebuild and Reopen in
Container` from the command palette) — `deployment/.env` is created from
`deployment/.template.env` automatically on first open if it doesn't
already exist (`initializeCommand`, runs before the container starts).
Edit it afterward if you need non-default admin credentials or a real
`DJANGO_SECRET_KEY`. This builds the `vscode` target from
`deployment/docker/Dockerfile`, bind-mounts the repo into the container, and
attaches to the `django` service — Python, GDAL/PostGIS, and Node are all
preinstalled, `pip install -e ".[dev]"` and `npm install` (for `web/`) run
automatically on first create.

Two services come up alongside each other, mirroring the same split
GeoHosting's own devcontainer uses: `django` (which VS Code attaches to —
`python manage.py runserver`, port 8000) and `vite` (`npm install && npm
run dev`, port 5173), both published to the host automatically. No manual
`npm run dev` needed — just wait for `vite`'s first-run dependency
pre-bundle to finish (see note below).

Visit `http://localhost:8000/` (**not** `0.0.0.0:8000` — Django's
`ALLOWED_HOSTS` check rejects that Host header with a 400, and some
browsers block navigating to `0.0.0.0` outright). It redirects to
`http://localhost:5173/` for the actual UI once Vite is running.

**First load after a fresh `npm install` can take 30s–2min and looks like
a blank/hanging tab** — this is expected, not a bug. Vite has to
pre-bundle every dependency (Cesium, MapLibre, Chakra UI, CodeMirror, ...)
with esbuild the first time it runs against a given `node_modules`; while
that's happening the dev server can't yet respond to `/@vite/client` or
`/src/main.tsx`, which is exactly what a genuine hang would also look
like. Check `docker compose logs -f vite` — if it's still printing
`ready in Nms` from startup with no errors since, it's just working; give
it a minute rather than restarting anything. This only happens once per
`node_modules` (fresh clone, or after `node_modules` gets reinstalled) —
normal restarts afterward are fast.

### Development

```bash
nix develop  # Enter development shell with all dependencies

# Run Django development server
python manage.py runserver 8080

# Run TUI
python -m tui

# Run tests
pytest

# Lint code
ruff check .
```

## Quick Start

1. **Start the server**:
   ```bash
   python manage.py runserver 8080
   ```

2. **Open the web UI**: Visit http://localhost:8080

3. **Add a GeoServer connection**: Click the + button next to "GeoServer Connections"

4. **Browse and manage**: Navigate workspaces, upload data, preview layers

## Architecture

```
kartoza-cloudbench/
├── apps/                    # Django applications
│   ├── geoserver/          # GeoServer REST API client
│   ├── postgres/           # PostgreSQL/PostGIS integration
│   ├── s3/                 # S3/MinIO storage
│   ├── upload/             # Chunked file uploads
│   ├── preview/            # Layer preview sessions
│   ├── gwc/                # GeoWebCache management
│   ├── sync/               # Server synchronization
│   └── ...
├── cloudbench/             # Django project settings
├── tui/                    # Textual TUI application
├── web/                    # React frontend
│   └── src/
│       ├── api/            # API client modules
│       ├── components/     # React components
│       └── stores/         # Zustand state stores
└── static/                 # Compiled frontend assets
```

## Deployment

CloudBench is fully standalone — it does not require any other platform
to run. 

## Embedding in Another Website

CloudBench can optionally be embedded inside another web application via
iframe, with single sign-on so the visiting user never sees CloudBench's
own login screen. This is off by default — CloudBench runs fully
standalone unless you configure it.

### What CloudBench needs

Set these in `deployment/.env` (see `deployment/.template.env`):

| Variable | Purpose |
|----------|---------|
| `CLOUDBENCH_SERVICE_TOKEN` | Shared secret between CloudBench and the other website's backend. Used two ways: the other website's backend sends it as `Authorization: Bearer <token>` when calling CloudBench's bridge endpoints, and it's also the HMAC key CloudBench uses to sign/verify SSO tokens. Blank by default — the bridge endpoints refuse all requests until this is set. |
| `CLOUDBENCH_FRAME_ANCESTORS` | Comma-separated list of origins allowed to embed CloudBench in an iframe, e.g. `https://example.com`. Enforced via a `Content-Security-Policy: frame-ancestors` header (`apps/core/middleware.py`) — without this, browsers refuse to render the iframe at all. Blank means only CloudBench's own origin can embed itself. |
| `CLOUDBENCH_SSO_TOKEN_MAX_AGE` | How long a minted SSO token stays valid, in seconds (default 12 hours). After it expires, a fresh token must be minted — there's no refresh mechanism. |

CloudBench exposes two endpoints for this, both gated behind
`CLOUDBENCH_SERVICE_TOKEN` (`apps/core/geohosting_bridge.py`,
`apps/core/sso_auth.py`):

- `POST /api/geohosting/sso-token/` — given `{"owner_user_id": "<id>"}`,
  returns `{"token": "<signed-token>"}`. `owner_user_id` is an opaque
  string the other website picks — CloudBench has no user database of
  its own, so this id is just the key under which that user's
  connections/settings are stored.
- `POST` / `DELETE /api/geohosting/instances/` (optional) — lets the
  other website pre-populate or remove a GeoServer/GeoNode/PostGIS
  connection for a given `owner_user_id`, so the embedded CloudBench
  opens with that connection already configured instead of empty.

### What the other website needs

1. **A backend-to-backend call to mint the token.** The other website's
   *server* (never client-side JS) calls
   `POST https://<cloudbench-host>/api/geohosting/sso-token/` with
   `Authorization: Bearer <CLOUDBENCH_SERVICE_TOKEN>` and the logged-in
   user's id as `owner_user_id`. `CLOUDBENCH_SERVICE_TOKEN` must stay
   server-side secret — never ship it to the browser.
2. **An iframe pointed at CloudBench with the token as a URL param**,
   e.g. `<iframe src="https://<cloudbench-host>/?token=<signed-token>">`.
   CloudBench's frontend (`web/src/api/ssoBootstrap.ts`) picks the
   `token` param up on load, stores it the same way a normal login would,
   and strips it from the URL — no other frontend integration needed.
3. **Its own origin listed in `CLOUDBENCH_FRAME_ANCESTORS`** on the
   CloudBench side, or the browser blocks the iframe outright.
4. **A fresh token per session/page load**, since tokens expire after
   `CLOUDBENCH_SSO_TOKEN_MAX_AGE` — mint a new one each time the iframe
   is (re)loaded rather than trying to reuse one.
5. *(Optional)* Call the instances endpoint above after provisioning a
   GeoServer/GeoNode/PostGIS instance for a user, so it shows up
   pre-configured the first time they open the embedded CloudBench.

## Configuration

### Environment Variables

```bash
# Django settings
SECRET_KEY=your-secret-key
DEBUG=true
ALLOWED_HOSTS=localhost,127.0.0.1

# Database (optional - defaults to SQLite)
DATABASE_URL=postgres://user:pass@localhost/cloudbench
```

### PostgreSQL Services

PostgreSQL connections are configured via `~/.pg_service.conf`:

```ini
[mydb]
host=localhost
port=5432
dbname=geodata
user=postgres
password=secret
```

## Supported File Types

| Type | Extensions | Upload Target |
|------|------------|---------------|
| Shapefile | `.shp`, `.zip` | Data Store |
| GeoPackage | `.gpkg` | Data Store |
| GeoTIFF | `.tif`, `.tiff` | Coverage Store |
| GeoJSON | `.geojson`, `.json` | Data Store |
| SLD Style | `.sld` | Styles |
| CSS Style | `.css` | Styles |

## API Endpoints

The REST API is available under `/api/`:

- `/api/auth/login/` - Standalone login (username/password → auth token)
- `/api/connections` - GeoServer connections
- `/api/workspaces/<conn_id>` - Workspaces
- `/api/datastores/<conn_id>/<workspace>` - Data stores
- `/api/layers/<conn_id>/<workspace>` - Layers
- `/api/styles/<conn_id>/<workspace>` - Styles
- `/api/upload/init` - Initialize chunked upload
- `/api/preview/` - Start layer preview session
- `/api/pg/services` - PostgreSQL services

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Made with 💗 by [Kartoza](https://kartoza.com) | [Donate](https://github.com/sponsors/kartoza) | [GitHub](https://github.com/kartoza/kartoza-cloudbench)
