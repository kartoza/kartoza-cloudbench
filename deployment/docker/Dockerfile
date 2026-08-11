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

# cloudbench.settings.production logs to a file here (DJANGO_LOG_FILE
# overrides the path) — the directory has to exist before Django's
# LOGGING config tries to open it, or every management command
# (including entrypoint.sh's own migrate step) fails immediately.
RUN mkdir -p /var/log/cloudbench

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


# Stage 3: VSCode devcontainer image — prod image plus dev tooling and a
# non-root user, so the container can be attached to directly instead of
# just run. The real source tree is bind-mounted over /app at runtime (see
# deployment/docker-compose.override.devcontainer.yml), this layer only
# needs to provide the tools.
FROM prod AS vscode

# Node 20/npm for running the Vite dev server (web/) directly inside the
# devcontainer — matches what the `frontend` build stage above uses
# (node:20-alpine); some deps (e.g. resium) require >=20 and Debian
# bookworm's own apt package is stuck on Node 18, which npm install warns
# about (EBADENGINE) and could break the dev server in subtler ways later.
# git is needed too — the `prod` stage never installs it, but VS Code's
# postCreateCommand and Source Control panel both need it.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates sudo git && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN pip install -e ".[dev]" 2>/dev/null || pip install -e .

ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Pre-create and chown mount points for the named volumes in
# docker-compose.override.devcontainer.yml. Docker seeds a brand-new named
# volume from whatever's already at that path in the image on first mount —
# if nothing here creates these dirs, Docker auto-creates them as root at
# mount time, and every management command that writes there (collectstatic,
# the providers/connections config store under CLOUDBENCH_DATA_FOLDER) then
# fails with PermissionError under the non-root user below. A *new* volume
# name alone doesn't fix this — it has to be owned correctly at the source.
RUN mkdir -p /app/staticfiles /app/media /home/web/cloudbench_data && \
    chown -R $USER_UID:$USER_GID /app/staticfiles /app/media /home/web/cloudbench_data

USER $USERNAME