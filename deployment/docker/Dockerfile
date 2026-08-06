# Stage 1: Build Vite/React frontend
FROM node:20-alpine AS frontend

WORKDIR /build/web
COPY web/ ./

ENV VITE_API_BASE=/api

RUN npm install && npm run build


# Stage 2: Production Django image
FROM python:3.12-slim-bookworm AS prod

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
        curl \
        gdal-bin \
        libgdal-dev \
        python3-gdal \
        postgis && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy application source then install dependencies
COPY pyproject.toml README.md ./
COPY apps/ ./apps/
COPY cloudbench/ ./cloudbench/
COPY tui/ ./tui/
COPY manage.py ./

COPY deployment/docker/requirements.txt /requirements.txt
RUN pip install --upgrade pip && pip install -r /requirements.txt

# Copy pre-built frontend into static/
COPY --from=frontend /build/static/ ./static/

EXPOSE 8000

COPY deployment/docker/entrypoint.sh /entrypoint.sh
COPY deployment/docker/gunicorn.conf.py /gunicorn.conf.py
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "cloudbench.wsgi:application", "--config", "/gunicorn.conf.py"]