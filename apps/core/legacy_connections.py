"""Import saved connections from the old plaintext config.json files.

Shared by the `0002_import_legacy_connections` data migration (which runs
automatically on deploy, since the container entrypoint runs `migrate`) and
the `migrate_connections` management command (for re-runs and --purge).

Each imported entry is *moved* out of config.json into a backup file next to
it (`config.legacy-connections.json`), so running the import again can never
bring back a connection that was deleted after it was imported. Entries that
fail validation stay in config.json, to be fixed and imported by a re-run.
Every import is recorded as a LegacyConnectionImport row, which is how the
backup files are tracked — and deleted — from the Django admin.

Works with either the real app registry or a migration's historical one,
so it only sets model fields — it never calls methods defined on the
models themselves.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from . import models as schemas
from .config import CONFIG_FILE
from .utilities import file_lock, get_cloudbench_config_path

BACKUP_FILE = "config.legacy-connections.json"

# config.json key -> (app label, model name, Pydantic schema of its entries).
LEGACY_KEYS = {
    "connections": ("cloudbench_connections", "GeoServerConnection", schemas.Connection),
    "pg_services": ("cloudbench_postgres", "PostgresService", schemas.PGService),
    "geonode_connections": ("cloudbench_geonode", "GeoNodeConnection", schemas.GeoNodeConnection),
    "qfieldcloud_connections": (
        "cloudbench_qfieldcloud",
        "QFieldCloudConnection",
        schemas.QFieldCloudConnection,
    ),
    "merginmaps_connections": (
        "cloudbench_mergin",
        "MerginMapsConnection",
        schemas.MerginMapsConnection,
    ),
    "iceberg_connections": (
        "cloudbench_iceberg",
        "IcebergCatalogConnection",
        schemas.IcebergCatalogConnection,
    ),
}


@dataclass
class ImportResult:
    imported: int = 0
    skipped: int = 0
    failed: int = 0


def import_legacy_connections(
    apps,
    *,
    log: Callable[[str], None] = print,
    log_error: Callable[[str], None] = print,
) -> ImportResult:
    """Move every user's legacy connections into their database tables.

    `apps` is an app registry: django.apps.apps, or a migration's `apps`.
    Connection ids are preserved. An entry whose id the user already has in
    the database is only moved to the backup, not imported again.
    """
    from django.conf import settings

    user_model = apps.get_model(settings.AUTH_USER_MODEL)
    import_model = apps.get_model("cloudbench_core", "LegacyConnectionImport")
    result = ImportResult()

    for user in user_model.objects.all():
        config_path = Path(get_cloudbench_config_path(CONFIG_FILE, user))
        if not config_path.exists():
            continue

        # Same lock ConfigManager.save() takes, so a concurrent settings save
        # can't write the moved entries back.
        with file_lock(str(config_path)):
            try:
                data = json.loads(config_path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                log_error(f"Could not read {config_path}: {exc}")
                continue

            record = import_model(owner=user)
            moved = {}
            for key, (app_label, model_name, schema) in LEGACY_KEYS.items():
                model = apps.get_model(app_label, model_name)
                model_fields = {field.name for field in model._meta.get_fields()}
                remaining = []
                for raw in data.get(key, []):
                    try:
                        obj = schema.model_validate(raw)
                    except ValidationError as exc:
                        remaining.append(raw)
                        record.invalid_entries.append(_describe_invalid(key, raw, exc))
                        log_error(
                            f"Left invalid {key} entry {raw.get('name', '')!r} "
                            f"(id {raw.get('id', '')!r}) in {config_path} for user "
                            f"{user.username!r}: {_error_summary(exc)}"
                        )
                        continue

                    moved.setdefault(key, []).append(raw)
                    if model.objects.filter(owner=user, connection_id=obj.id).exists():
                        record.already_present += 1
                        continue

                    fields = {
                        name: getattr(obj, name)
                        for name in schema.model_fields
                        if name != "id" and name in model_fields
                    }
                    model.objects.create(owner=user, connection_id=obj.id, **fields)
                    record.imported += 1
                    log(f"Imported {key} '{obj.name}' for user {user.username!r}")

                if remaining:
                    data[key] = remaining
                else:
                    data.pop(key, None)

            if not moved and not record.invalid_entries:
                continue

            if moved:
                backup_path = config_path.with_name(BACKUP_FILE)
                _write_backup(backup_path, moved)
                _write_json(config_path, data)
                record.backup_path = str(backup_path)
                log(f"Moved imported entries for user {user.username!r} to {backup_path}")
            record.save()

        result.imported += record.imported
        result.skipped += record.already_present
        result.failed += len(record.invalid_entries)

    return result


def delete_backups(records, *, log: Callable[[str], None] = print) -> int:
    """Delete the backup files (plaintext secrets) behind these import records.

    `records` is a LegacyConnectionImport queryset. Every record sharing a
    deleted file is marked, since re-runs append to the same backup file.
    Returns how many files were deleted.
    """
    from django.utils import timezone

    deleted = 0
    paths = {path for path in records.values_list("backup_path", flat=True) if path}
    for path in paths:
        backup = Path(path)
        if backup.exists():
            backup.unlink()
            deleted += 1
            log(f"Deleted {backup}")
        records.model.objects.filter(backup_path=path, backup_deleted_at__isnull=True).update(
            backup_deleted_at=timezone.now()
        )
    return deleted


def _describe_invalid(key: str, raw, exc: ValidationError) -> dict:
    """What an admin needs to find a bad entry — never its values/secrets."""
    raw = raw if isinstance(raw, dict) else {}
    return {
        "key": key,
        "id": str(raw.get("id", "")),
        "name": str(raw.get("name", "")),
        "errors": _error_summary(exc),
    }


def _error_summary(exc: ValidationError) -> str:
    # include_input=False: the default message echoes the whole entry,
    # plaintext password included, into the logs.
    return "; ".join(
        f"{'.'.join(str(part) for part in error['loc']) or 'entry'}: {error['msg']}"
        for error in exc.errors(include_input=False, include_url=False)
    )


def _write_backup(backup_path: Path, moved: dict) -> None:
    """Append moved entries to the backup file, one copy per id."""
    backup = {}
    if backup_path.exists():
        backup = json.loads(backup_path.read_text())
    for key, entries in moved.items():
        existing = backup.setdefault(key, [])
        seen = {entry.get("id") for entry in existing}
        existing.extend(entry for entry in entries if entry.get("id") not in seen)
    _write_json(backup_path, backup)


def _write_json(path: Path, data: dict) -> None:
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(json.dumps(data, indent=2))
    tmp_path.replace(path)
