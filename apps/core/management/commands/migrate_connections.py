"""Import saved connections from the old plaintext config.json files into
their encrypted database tables.

This already runs automatically once on deploy, as the
`cloudbench_core.0002_import_legacy_connections` data migration. Imported
entries are moved into a `config.legacy-connections.json` backup next to
each config.json, so a re-run only picks up what's left — e.g. an invalid
entry that has since been fixed — and never brings back a connection
deleted after it was imported. Each run is recorded as a
LegacyConnectionImport, visible in the Django admin.

--purge deletes the backup files (and the plaintext secrets in them), the
same as the admin's "Delete backup files" action. S3 has its own
`migrate_s3_connections`.

Usage: python manage.py migrate_connections [--purge]
"""

from django.apps import apps
from django.core.management.base import BaseCommand

from apps.core.legacy_connections import delete_backups, import_legacy_connections
from apps.core.models import LegacyConnectionImport


class Command(BaseCommand):
    help = "Import saved connections from old plaintext config.json files into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--purge",
            action="store_true",
            help="Delete the backup files of imported connections afterwards.",
        )

    def handle(self, *_args, purge=False, **_options):
        result = import_legacy_connections(apps, log=self.stdout.write, log_error=self.stderr.write)
        self.stdout.write(
            self.style.SUCCESS(
                f"Done: {result.imported} imported, {result.skipped} already present, "
                f"{result.failed} invalid."
            )
        )
        if purge:
            pending = LegacyConnectionImport.objects.filter(backup_deleted_at__isnull=True)
            deleted = delete_backups(pending, log=self.stdout.write)
            self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} backup files."))
