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

## S3 Queries (DuckDB)

| Variable | Description | Default |
|----------|-------------|---------|
| `DUCKDB_MEMORY_LIMIT` | The most memory one query on S3 data may use | `1GB` |

Each query runs on its own connection that can read `s3://` only (no local files,
no `http(s)://` URLs), with only the querying user's S3 credentials.

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
