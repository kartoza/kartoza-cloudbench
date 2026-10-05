"""Tests for importing legacy config.json connections into the database.

Covers the shared importer, the `0002_import_legacy_connections` data
migration that runs it on deploy, `manage.py migrate_connections`, and the
LegacyConnectionImport admin that tracks the backup files.
"""

import importlib
import json
from pathlib import Path

import pytest
from django.contrib.admin.sites import site
from django.core.management import call_command
from django.test import RequestFactory

from apps.connections.models import GeoServerConnection
from apps.core.config import CONFIG_FILE, get_config
from apps.core.legacy_connections import BACKUP_FILE
from apps.core.models import LegacyConnectionImport
from apps.core.utilities import get_cloudbench_config_path
from apps.iceberg.models import IcebergCatalogConnection
from apps.postgres.models import PostgresService

LEGACY_CONFIG = {
    "theme": "dark",
    "connections": [
        {
            "id": "conn_20260101120000",
            "name": "Prod GeoServer",
            "url": "http://gs.test/geoserver",
            "username": "admin",
            "password": "geoserver",
            "is_active": True,
        }
    ],
    "pg_services": [{"id": "geohosting_3", "name": "gis", "host": "db.test", "password": "pw"}],
    "iceberg_connections": [
        {"id": "iceberg_1", "name": "Lake", "url": "http://lake.test", "secret_key": "s3cr3t"}
    ],
    "geonode_connections": [],
}
BROKEN_ENTRY = {"id": "bad", "name": "No url", "password": "leak-me-not"}


@pytest.fixture
def legacy_user(config_manager, django_user_model):
    """A user with an old-style config.json holding connections.

    config_manager is requested only for its isolated CLOUDBENCH_DATA_FOLDER.
    """
    user = django_user_model.objects.create(username="alice")
    path = _config_path(user)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(LEGACY_CONFIG))
    return user


def _config_path(user) -> Path:
    return Path(get_cloudbench_config_path(CONFIG_FILE, user))


def _read(path: Path) -> dict:
    return json.loads(path.read_text())


def _run_data_migration():
    from django.apps import apps

    migration = importlib.import_module("apps.core.migrations.0002_import_legacy_connections")
    migration.import_connections(apps, None)


@pytest.mark.unit
@pytest.mark.django_db
class TestImport:
    def test_imports_every_type_with_ids_preserved(self, legacy_user):
        call_command("migrate_connections")

        manager = get_config(legacy_user)
        conn = manager.get_connection("conn_20260101120000")
        assert conn.name == "Prod GeoServer"
        assert conn.password == "geoserver"
        assert conn.is_active is True
        assert manager.get_pg_service("gis").id == "geohosting_3"
        assert manager.get_iceberg_connection("iceberg_1").secret_key == "s3cr3t"
        # Non-connection settings are untouched and still read from the file.
        assert manager.config.theme == "dark"

    def test_moves_imported_entries_to_backup(self, legacy_user):
        call_command("migrate_connections")

        config = _read(_config_path(legacy_user))
        assert config == {"theme": "dark"}
        backup = _read(_config_path(legacy_user).with_name(BACKUP_FILE))
        assert backup["connections"] == LEGACY_CONFIG["connections"]
        assert backup["pg_services"] == LEGACY_CONFIG["pg_services"]

    def test_rerun_does_not_bring_back_deleted_connection(self, legacy_user):
        call_command("migrate_connections")
        get_config(legacy_user).remove_connection("conn_20260101120000")

        call_command("migrate_connections")

        assert not GeoServerConnection.objects.filter(owner=legacy_user).exists()
        assert PostgresService.objects.filter(owner=legacy_user).count() == 1

    def test_already_present_is_moved_not_duplicated(self, legacy_user):
        GeoServerConnection.objects.create(
            owner=legacy_user,
            connection_id="conn_20260101120000",
            name="Pushed",
            url="u",
            username="a",
        )

        call_command("migrate_connections")

        assert GeoServerConnection.objects.get(owner=legacy_user).name == "Pushed"
        record = LegacyConnectionImport.objects.get(owner=legacy_user)
        assert (record.imported, record.already_present) == (2, 1)
        assert "connections" not in _read(_config_path(legacy_user))

    def test_records_import_for_the_admin(self, legacy_user):
        call_command("migrate_connections")

        record = LegacyConnectionImport.objects.get(owner=legacy_user)
        assert record.imported == 3
        assert record.invalid_entries == []
        assert record.backup_path == str(_config_path(legacy_user).with_name(BACKUP_FILE))
        assert record.backup_deleted_at is None

    def test_invalid_entry_stays_in_config_without_leaking_secrets(self, legacy_user, capsys):
        broken = {**LEGACY_CONFIG, "connections": [BROKEN_ENTRY, *LEGACY_CONFIG["connections"]]}
        _config_path(legacy_user).write_text(json.dumps(broken))

        call_command("migrate_connections")

        assert GeoServerConnection.objects.filter(owner=legacy_user).count() == 1
        assert _read(_config_path(legacy_user))["connections"] == [BROKEN_ENTRY]
        (invalid,) = LegacyConnectionImport.objects.get(owner=legacy_user).invalid_entries
        assert (invalid["key"], invalid["id"], invalid["name"]) == ("connections", "bad", "No url")
        assert "url: Field required" in invalid["errors"]
        out = capsys.readouterr()
        assert "leak-me-not" not in out.out + out.err
        assert "leak-me-not" not in json.dumps(invalid)

    def test_fixed_entry_imported_by_rerun_into_same_backup(self, legacy_user):
        broken = {**LEGACY_CONFIG, "connections": [BROKEN_ENTRY]}
        _config_path(legacy_user).write_text(json.dumps(broken))
        call_command("migrate_connections")

        fixed = {**BROKEN_ENTRY, "url": "http://fixed.test", "username": "a"}
        _config_path(legacy_user).write_text(json.dumps({"connections": [fixed]}))
        call_command("migrate_connections")

        assert get_config(legacy_user).get_connection("bad").url == "http://fixed.test"
        backup = _read(_config_path(legacy_user).with_name(BACKUP_FILE))
        assert [c["id"] for c in backup["connections"]] == ["bad"]
        assert len(backup["pg_services"]) == 1
        assert LegacyConnectionImport.objects.filter(owner=legacy_user).count() == 2

    def test_nothing_to_import_records_nothing(self, config_manager, django_user_model):
        user = django_user_model.objects.create(username="settings-only")
        path = _config_path(user)
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"theme": "dark"}))

        call_command("migrate_connections")

        assert not LegacyConnectionImport.objects.exists()
        assert not path.with_name(BACKUP_FILE).exists()


@pytest.mark.unit
@pytest.mark.django_db
class TestDeleteBackups:
    def test_purge_deletes_backup_and_marks_record(self, legacy_user):
        call_command("migrate_connections", purge=True)

        assert not _config_path(legacy_user).with_name(BACKUP_FILE).exists()
        assert LegacyConnectionImport.objects.get(owner=legacy_user).backup_deleted_at
        assert IcebergCatalogConnection.objects.filter(owner=legacy_user).exists()

    def test_admin_action_deletes_backup(self, legacy_user, admin_user):
        call_command("migrate_connections")
        model_admin = site._registry[LegacyConnectionImport]
        request = RequestFactory().post("/")
        request.user = admin_user
        model_admin.message_user = lambda *_args, **_kwargs: None

        model_admin.delete_backup_files(request, LegacyConnectionImport.objects.all())

        assert not _config_path(legacy_user).with_name(BACKUP_FILE).exists()
        assert LegacyConnectionImport.objects.get(owner=legacy_user).backup_deleted_at


@pytest.mark.unit
@pytest.mark.django_db
class TestImportDataMigration:
    """The data migration that runs the same import automatically on deploy."""

    def test_imports_and_keeps_backup(self, legacy_user):
        _run_data_migration()

        assert get_config(legacy_user).get_connection("conn_20260101120000") is not None
        backup = _read(_config_path(legacy_user).with_name(BACKUP_FILE))
        assert backup["connections"] == LEGACY_CONFIG["connections"]

    def test_command_after_migration_finds_nothing_left(self, legacy_user, capsys):
        _run_data_migration()
        call_command("migrate_connections")

        assert "0 imported, 0 already present, 0 invalid" in capsys.readouterr().out
