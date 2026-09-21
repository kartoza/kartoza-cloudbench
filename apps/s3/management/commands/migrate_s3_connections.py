"""One-time data migration: import S3 connections from the old plaintext
config.json files into the new encrypted apps.s3.models.S3Connection table.

The old storage (apps.core.config.ConfigManager) has been removed for S3
connections — this only reads the raw JSON directly, so it still works
even though the Pydantic model/field it used to populate no longer exist.

Usage: python manage.py migrate_s3_connections
"""

import json
import uuid
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.core.utilities import get_cloudbench_config_path
from apps.s3.models import S3Connection

User = get_user_model()


class Command(BaseCommand):
    help = "Import S3 connections from old plaintext config.json files into the database."

    def handle(self, *args, **options):
        imported = 0
        skipped = 0

        for user in User.objects.all():
            config_path = Path(get_cloudbench_config_path("config.json", str(user.id)))
            if not config_path.exists():
                continue

            try:
                data = json.loads(config_path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                self.stderr.write(f"Could not read {config_path}: {exc}")
                continue

            for raw in data.get("s3_connections", []):
                name = raw.get("name", "")
                if S3Connection.objects.filter(owner=user, name=name).exists():
                    skipped += 1
                    continue

                kwargs = {
                    "owner": user,
                    "name": name,
                    "endpoint": raw.get("endpoint", ""),
                    "access_key": raw.get("access_key", ""),
                    "secret_key": raw.get("secret_key", ""),
                    "region": raw.get("region", ""),
                    "use_ssl": raw.get("use_ssl", True),
                    "path_style": raw.get("path_style", True),
                    "is_active": raw.get("is_active", False),
                }
                # Preserve the old id when it's a real UUID (how the app has
                # always generated them) so existing bookmarked URLs/saved
                # frontend state referencing a connection id keep working.
                try:
                    kwargs["id"] = uuid.UUID(raw.get("id", ""))
                except (TypeError, ValueError):
                    pass

                S3Connection.objects.create(**kwargs)
                imported += 1
                self.stdout.write(f"Imported '{name}' for user {user.username!r}")

        self.stdout.write(self.style.SUCCESS(f"Done: {imported} imported, {skipped} already present."))
