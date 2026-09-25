"""Regenerate vector layers published before cng-lite produced GeoParquet.

Such layers carry only a PMTiles file, so their Portolan collection has no
GeoParquet "data" asset. Each is re-run through the normal conversion
pipeline from its original source (still kept in S3 under sources/), as a
new CngLiteJob, which rewrites the layer's folder exactly as a fresh
upload would.

Usage:
    python manage.py portolan_backfill --dry-run
    python manage.py portolan_backfill --connection Sandbox
"""

import contextlib
import uuid
from pathlib import PurePosixPath

from botocore.exceptions import ClientError
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.s3 import pmtiles, portolan
from apps.s3.client import get_s3_client
from apps.s3.models import CngLiteJob, S3Connection


def _exists(s3_client, key):
    try:
        s3_client.get_object_info(key)
        return True
    except ClientError:
        return False


def _output_keys(job):
    return [item["key"] for item in job.output_keys or []] or [job.output_key]


class Command(BaseCommand):
    help = "Re-run vector layers that lack a GeoParquet data file so they gain one."

    def add_arguments(self, parser):
        parser.add_argument("--connection", help="Only this S3 connection (id or name).")
        parser.add_argument(
            "--dry-run", action="store_true", help="List what would be regenerated, and stop."
        )

    def handle(self, *_args, connection=None, dry_run=False, **_options):
        jobs = CngLiteJob.objects.filter(kind=pmtiles.KIND, status="completed")
        if connection:
            connections = S3Connection.objects.filter(name=connection)
            with contextlib.suppress(ValueError):  # not a UUID: match by name only
                connections = connections or S3Connection.objects.filter(id=uuid.UUID(connection))
            if not connections:
                raise CommandError(f"No S3 connection {connection!r}.")
            jobs = jobs.filter(connection_id__in=[str(conn.id) for conn in connections])

        # Newest first: when several uploads published into the same layer
        # folder, only the latest one reflects what's there now.
        seen = set()
        planned = []
        for job in jobs.order_by("-created_at"):
            folders = {str(PurePosixPath(key).parent) for key in _output_keys(job)}
            fresh = {folder for folder in folders if (job.connection_id, folder) not in seen}
            seen.update((job.connection_id, folder) for folder in folders)
            if not fresh or any(key.endswith(".parquet") for key in _output_keys(job)):
                continue

            owner = get_user_model().objects.filter(username=job.owner_id).first()
            if owner is None:
                continue
            try:
                s3_client = get_s3_client(job.connection_id, owner)
            except ValueError:
                continue
            # Only Portolan layer folders still in the bucket — this also
            # skips older bare-.pmtiles outputs from before layer folders.
            live = sorted(f for f in fresh if _exists(s3_client, f"{f}/collection.json"))
            if not live:
                continue
            if not job.source_key or not _exists(s3_client, job.source_key):
                self.stderr.write(f"Skipping {', '.join(live)}: source {job.source_key} is gone.")
                continue
            layers = job.layers
            if layers:
                # Don't resurrect GeoPackage layers deleted since the upload.
                base = str(PurePosixPath(job.output_key).parent)
                prefix = "" if base in ("", ".") else f"{base}/"
                layers = [
                    name for name in layers if f"{prefix}{portolan.sanitize_layer_id(name)}" in live
                ]
            planned.append((job, live, layers))

        if not planned:
            self.stdout.write("Nothing to backfill.")
            return
        for job, live, _ in planned:
            self.stdout.write(f"{job.bucket}: {', '.join(live)}  (from {job.source_key})")
        if dry_run:
            return

        for job, live, layers in planned:
            backfill = CngLiteJob.objects.create(
                kind=job.kind,
                owner_id=job.owner_id,
                connection_id=job.connection_id,
                bucket=job.bucket,
                source_name=job.source_name,
                source_key=job.source_key,
                output_key=job.output_key,
                input_size=job.input_size,
                layers=layers,
                license=job.license,
                message="Backfilling GeoParquet",
            )
            pmtiles.run_conversion(backfill.id, create_collection=False)
            backfill.refresh_from_db()
            if backfill.status != "completed":
                self.stderr.write(f"Failed {', '.join(live)}: {backfill.error}")
            elif not any(key.endswith(".parquet") for key in _output_keys(backfill)):
                self.stderr.write(
                    f"Re-ran {', '.join(live)}, but CloudNativeGIS returned no GeoParquet — "
                    "is CLOUDNATIVEGIS_URL pointing at a processing build that produces it?"
                )
            else:
                self.stdout.write(self.style.SUCCESS(f"Backfilled {', '.join(live)}"))
