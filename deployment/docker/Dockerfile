# Maputnik style editor (git submodule at ./maputnik) — built separately
# since vanilla Maputnik needs Node 22+, newer than the main frontend
# requires. Its output is copied into web/public/maputnik/ below, so
# Vite's own build bundles it into ./static/ same-origin as the app (see
# web/src/components/MapExplorer/StyleEditorDialog.tsx). Requires the
# submodule to be checked out on the host before `docker build` runs:
#   git submodule update --init maputnik
WORKDIR /src
COPY maputnik/ ./
COPY deployment/maputnik-patches/cloudbench.patch /tmp/cloudbench.patch
RUN git apply /tmp/cloudbench.patch
RUN npm install && npm run build

FROM python:3.12-slim-bookworm AS prod

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
        curl \
        ca-certificates \
        gdal-bin \
        libgdal-dev \
        python3-gdal \
        postgis && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p /var/log/cloudbench

# Copy application source then install dependencies
COPY pyproject.toml README.md ./
COPY apps/ ./apps/
COPY cloudbench/ ./cloudbench/
COPY tui/ ./tui/
COPY manage.py ./

COPY deployment/docker/requirements.txt /requirements.txt
RUN pip install --upgrade pip && pip install -r /requirements.txt

# Build the frontend in-place — outputs straight to ./static/ (see
# web/vite.config.ts: build.outDir: '../static'). web/ itself is dropped
# afterward: only the compiled static/ output is needed at runtime, and
# keeping node_modules around would bloat the image for no reason.
COPY web/ ./web/
COPY --from=maputnik-build /src/dist ./web/public/maputnik
ENV VITE_API_BASE=/api
RUN cd web && npm install && npm run build && cd .. && rm -rf web

EXPOSE 8000

COPY deployment/docker/entrypoint.sh /entrypoint.sh
COPY deployment/docker/gunicorn.conf.py /gunicorn.conf.py
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "cloudbench.wsgi:application", "--config", "/gunicorn.conf.py"]
