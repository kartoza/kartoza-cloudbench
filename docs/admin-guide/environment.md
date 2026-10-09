# Environment Variables

Complete reference of CloudBench environment variables.

## Django Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Django secret key | Auto-generated |
| `DEBUG` | Enable debug mode | `true` |
| `ALLOWED_HOSTS` | Comma-separated hosts | `localhost,127.0.0.1` |

## Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Database URL | `sqlite:///db.sqlite3` |

Format: `postgres://user:password@host:port/dbname`

## Upload Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `UPLOAD_MAX_FILE_SIZE` | Max upload bytes | `10737418240` (10GB) |
| `UPLOAD_CHUNK_SIZE` | Chunk size bytes | `5242880` (5MB) |
| `UPLOAD_RELAY_IDLE_TIMEOUT` | Seconds without a chunk before an upload to GeoServer/GeoNode fails (a dropped connection can resume within it) | `60` |
| `UPLOAD_RELAY_RESPONSE_TIMEOUT` | Seconds to wait for GeoServer/GeoNode once the whole file is sent | `1800` |
| `UPLOAD_RELAY_SOCKET_DIR` | Where the gunicorn workers pass chunks to each other (local to the container) | `/tmp/cloudbench-upload` |

## Gunicorn

| Variable | Description | Default |
|----------|-------------|---------|
| `GUNICORN_WORKERS` | Worker processes | CPU count × 2 + 1 |
| `GUNICORN_THREADS` | Threads per worker (`gthread`) | `8` |
| `GUNICORN_MAX_REQUESTS` | Recycle a worker after this many requests (a guard against memory leaks); `0` is never. Recycling cuts off the uploads and conversions it runs | `100000` |

Uploads to GeoServer/GeoNode need every worker in **one container** (they meet over
a Unix socket): run more replicas only with sticky sessions per upload.

## Security

| Variable | Description | Default |
|----------|-------------|---------|
| `CSRF_TRUSTED_ORIGINS` | Trusted origins | Empty |
| `CORS_ALLOWED_ORIGINS` | CORS origins | `http://localhost:*` |

## Example .env File

```bash
# Production settings
DEBUG=false
SECRET_KEY=your-very-long-random-secret-key-here
ALLOWED_HOSTS=cloudbench.example.com,www.cloudbench.example.com
DATABASE_URL=postgres://cloudbench:password@localhost:5432/cloudbench

# Upload settings
UPLOAD_MAX_FILE_SIZE=10737418240

# Security
CSRF_TRUSTED_ORIGINS=https://cloudbench.example.com
```
