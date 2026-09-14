# Docker Deployment

CloudBench can be deployed using Docker and Docker Compose.

## Quick Start

```bash
docker compose up -d
```

## Docker Compose

```yaml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "8080:8080"
    environment:
      - DEBUG=false
      - SECRET_KEY=${SECRET_KEY}
      - DATABASE_URL=postgres://postgres:postgres@db:5432/cloudbench
    depends_on:
      - db

  db:
    image: postgis/postgis:16-3.4
    environment:
      - POSTGRES_DB=cloudbench
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Building the Image

```bash
docker build -t ghcr.io/kartoza/kartoza-cloudbench:latest .
```

## Environment Variables

Pass environment variables via:

```bash
docker run -e SECRET_KEY=xxx -e DEBUG=false ghcr.io/kartoza/kartoza-cloudbench
```

Or use an env file:

```bash
docker run --env-file .env ghcr.io/kartoza/kartoza-cloudbench
```
