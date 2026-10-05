"""Import saved connections from the old per-user config.json files.

Runs automatically on deploy (the container entrypoint runs `migrate`), so
no one needs a shell on the server. Imported entries are moved into a
`config.legacy-connections.json` backup next to each config.json; every
import is recorded as a LegacyConnectionImport, shown in the Django admin
with an action that deletes the backups. Invalid entries stay in
config.json and are listed there too; after fixing them, re-run with
`manage.py migrate_connections`.
"""

from django.db import migrations

from apps.core.legacy_connections import import_legacy_connections


def import_connections(apps, _schema_editor):
    result = import_legacy_connections(apps)
    print(
        f"\n  Legacy connections: {result.imported} imported, "
        f"{result.skipped} already present, {result.failed} invalid."
    )


class Migration(migrations.Migration):
    dependencies = [
        ("cloudbench_core", "0001_initial"),
        ("cloudbench_connections", "0001_initial"),
        ("cloudbench_geonode", "0001_initial"),
        ("cloudbench_iceberg", "0001_initial"),
        ("cloudbench_mergin", "0001_initial"),
        ("cloudbench_postgres", "0001_initial"),
        ("cloudbench_qfieldcloud", "0001_initial"),
    ]

    operations = [migrations.RunPython(import_connections, migrations.RunPython.noop)]
