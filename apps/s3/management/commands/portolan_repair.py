"""Bring published layers' metadata up to what publishing writes now.

Rewrites each layer's collection.json where it differs from what a layer
published today would carry (see portolan_verify.repair_metadata): the
providers - the hosting organisation (PORTOLAN_HOST_NAME) as producer
too, the uploader as processor - and the style's file:size/file:checksum.
Data files are never touched: a layer whose GeoParquet isn't spatially
ordered has to be converted again.

Usage:
    python manage.py portolan_repair --dry-run
    python manage.py portolan_repair --connection Sandbox --folder semarang
"""

import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.s3 import portolan, portolan_verify
from apps.s3.client import get_s3_client
from apps.s3.models import S3Connection


class Command(BaseCommand):
    help = "Update published layers' collection.json to what publishing writes now."

    def add_arguments(self, parser):
        parser.add_argument("--connection", help="Only this S3 connection (id or name).")
        parser.add_argument("--folder", help="Only this layer folder (e.g. semarang).")
        parser.add_argument(
            "--dry-run", action="store_true", help="Report what would change; write nothing."
        )

    def handle(self, *_args, connection=None, folder=None, dry_run=False, **_options):
        connections = S3Connection.objects.all()
        if connection:
            try:
                by_id = S3Connection.objects.filter(id=uuid.UUID(connection))
            except ValueError:
                by_id = S3Connection.objects.none()
            connections = S3Connection.objects.filter(name=connection) or by_id
            if not connections:
                raise CommandError(f"No S3 connection {connection!r}.")

        verb = "WOULD FIX" if dry_run else "FIXED    "
        unreadable = 0
        for conn in connections:
            owner = get_user_model().objects.get(pk=conn.owner_id)
            client = get_s3_client(str(conn.id), owner)
            folders = [layer["folder"] for layer in portolan_verify.catalog_layers(client)]
            if folder:
                folders = [folder]
            changed = False
            for layer_folder in folders:
                label = f"{conn.name}/{layer_folder}"
                changes = portolan_verify.repair_metadata(client, layer_folder, dry_run)
                if changes is None:
                    self.stderr.write(f"UNREADABLE {label}: collection.json is missing or invalid")
                    unreadable += 1
                elif changes:
                    self.stdout.write(f"{verb}  {label}: {', '.join(changes)}")
                    changed = True
                else:
                    self.stdout.write(self.style.SUCCESS(f"OK         {label}"))
            if changed and not dry_run:
                # So anything keyed on catalog.json's ETag (the STAC API's
                # cache) picks the changes up.
                portolan.touch_root_catalog(client)

        if unreadable:
            raise CommandError(f"{unreadable} layer(s) couldn't be read.")
