# Test image for feat/upload-passthrough: the production image with this
# branch's code on top. Same base, system packages, Python dependencies
# (deployment/docker/requirements.txt is unchanged on this branch), entrypoint
# and gunicorn config as production - built without downloading anything.
#
# Needs: ghcr.io/kartoza/kartoza-cloudbench:latest present locally, and the
# frontend built into ./static (cd web && npm run build).
FROM ghcr.io/kartoza/kartoza-cloudbench:latest

# Replace the source rather than copy over it: files this branch deleted
# (apps/geoserver/views/uploads.py, apps/geoserver/tasks.py) must go too.
RUN rm -rf /app/apps /app/cloudbench /app/tui /app/manage.py
COPY pyproject.toml README.md manage.py /app/
COPY apps/ /app/apps/
COPY cloudbench/ /app/cloudbench/
COPY tui/ /app/tui/

# The locally built frontend, over the image's own static/: that keeps
# Maputnik, which a local build doesn't include.
COPY static/ /app/static/

COPY deployment/docker/entrypoint.sh /entrypoint.sh
COPY deployment/docker/gunicorn.conf.py /gunicorn.conf.py
RUN chmod +x /entrypoint.sh
