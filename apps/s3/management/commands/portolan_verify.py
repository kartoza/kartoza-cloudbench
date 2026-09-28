"""Check published layers' files against their recorded checksums.

Re-reads every file that a layer's collection.json records a file:checksum
for, and reports any whose bytes no longer match — e.g. a data file
overwritten directly in the bucket without re-publishing. Exits non-zero
if any layer fails, so it can run from cron or CI.

With --record, a layer published before checksums existed gets them
recorded from its files as they are now (catching changes from then on);
layers that already have checksums are only verified.

Usage:
    python manage.py portolan_verify
    python manage.py portolan_verify --connection Sandbox --folder semarang
    python manage.py portolan_verify --record
"""

import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.s3 import portolan_verify
from apps.s3.client import get_s3_client
from apps.s3.models import S3Connection


class Command(BaseCommand):
    help = "Verify published layers' files against the checksums in their collection.json."

    def add_arguments(self, parser):
        parser.add_argument("--connection", help="Only this S3 connection (id or name).")
        parser.add_argument("--folder", help="Only this layer folder (e.g. semarang).")
        parser.add_argument(
            "--record",
            action="store_true",
            help="Record checksums for layers that have none, from their current files.",
        )

    def handle(self, *_args, connection=None, folder=None, record=False, **_options):
        connections = S3Connection.objects.all()
        if connection:
            try:
                by_id = S3Connection.objects.filter(id=uuid.UUID(connection))
            except ValueError:
                by_id = S3Connection.objects.none()
            connections = S3Connection.objects.filter(name=connection) or by_id
            if not connections:
                raise CommandError(f"No S3 connection {connection!r}.")

        failed = 0
        for conn in connections:
            owner = get_user_model().objects.get(pk=conn.owner_id)
            client = get_s3_client(str(conn.id), owner)
            layers = portolan_verify.catalog_layers(client)
            if folder:
                layers = [layer for layer in layers if layer["folder"] == folder] or [
                    {"folder": folder, "title": folder}
                ]
            for layer in layers:
                result = portolan_verify.verify_layer(client, layer["folder"], layer["title"])
                if record and result["status"] == portolan_verify.UNVERIFIABLE:
                    result = portolan_verify.record_checksums(client, layer["folder"])
                    if result["status"] == portolan_verify.OK:
                        self.stdout.write(
                            f"RECORDED    {conn.name}/{result['folder']} "
                            f"({len(result['files'])} files, from their current contents)"
                        )
                        continue
                failed += self._report(conn, result)

        if failed:
            raise CommandError(f"{failed} layer(s) failed verification.")

    def _report(self, conn, result):
        """Print one layer's result; return 1 if it failed."""
        label = f"{conn.name}/{result['folder']}"
        status = result["status"]
        if status == portolan_verify.OK:
            self.stdout.write(
                self.style.SUCCESS(f"OK          {label} ({len(result['files'])} files)")
            )
            return 0
        if status == portolan_verify.UNVERIFIABLE:
            self.stdout.write(
                f"UNVERIFIED  {label} (no checksums recorded; re-publish, or run with --record)"
            )
            return 0
        if status == portolan_verify.UNREADABLE:
            self.stderr.write(f"UNREADABLE  {label}: collection.json is missing or invalid")
            return 1
        self.stderr.write(f"MISMATCH    {label}")
        for file in result["files"]:
            if file["status"] != portolan_verify.OK:
                self.stderr.write(f"    {file['status']:8} {file['key']}")
        return 1
