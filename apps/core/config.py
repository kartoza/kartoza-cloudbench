"""Configuration manager for Kartoza CloudBench.

Saved connections (GeoServer, PostgreSQL, GeoNode, QFieldCloud, Mergin Maps,
Iceberg) are stored in the database, one table per type with secrets
encrypted at rest — see apps.core.db.ConnectionModel. Everything else
(settings, sync configs, saved queries, QGIS projects) is still a per-user
JSON file, located via the XDG Base Directory specification.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

from apps.connections.models import GeoServerConnection
from apps.geonode.models import GeoNodeConnection as GeoNodeConnectionModel
from apps.iceberg.models import IcebergCatalogConnection as IcebergCatalogConnectionModel
from apps.mergin.models import MerginMapsConnection as MerginMapsConnectionModel
from apps.postgres.models import PostgresService
from apps.qfieldcloud.models import QFieldCloudConnection as QFieldCloudConnectionModel

from .db import ConnectionModel
from .models import (
    Config,
    Connection,
    GeoNodeConnection,
    IcebergCatalogConnection,
    MerginMapsConnection,
    PGService,
    QFieldCloudConnection,
    QGISProject,
    SyncConfiguration,
    SyncOptions,
)
from .utilities import file_lock, get_cloudbench_config_path, get_cloudbench_data_path

if TYPE_CHECKING:
    from django.contrib.auth.models import User

# Config directory names
CONFIG_FILE = "config.json"

__all__ = ["QGISProject", "SyncOptions"]

# Type aliases for cleaner imports in views
IcebergConnection = IcebergCatalogConnection
MerginConnection = MerginMapsConnection


class ConfigManager:
    """Per-user configuration manager.

    Provides load/save functionality with atomic writes and migration support.
    """

    def __init__(self, user: "User") -> None:
        self._user = user
        self._config: Config | None = None

    @property
    def config(self) -> Config:
        """Get the current configuration, loading if necessary."""
        if self._config is None:
            self._config = self._load()
        return self._config

    def reload(self) -> Config:
        """Force reload configuration from disk."""
        self._config = self._load()
        return self._config

    def save(self) -> None:
        """Save configuration to disk atomically with file locking."""
        if self._config is None:
            return

        path = self._config_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)

        with file_lock(path):
            tmp_path = path + ".tmp"
            with open(tmp_path, "w") as f:
                json.dump(self._config.model_dump(by_alias=True), f, indent=2)
            os.replace(tmp_path, path)

    def _config_path(self) -> str:
        """Get the path to the config file."""
        return get_cloudbench_config_path(CONFIG_FILE, self._user)

    def post_process_config(self, config: Config) -> Config:
        """Post process config."""
        return config

    def _load(self) -> Config:
        """Load configuration from disk with file locking."""
        path = self._config_path()

        try:
            with file_lock(path, exclusive=False), open(path) as f:
                data = json.load(f)
            config = Config.model_validate(data)
        except (OSError, json.JSONDecodeError, ValueError):
            config = Config()

        return self.post_process_config(config)

    # Generic connection storage, one table per connection type.
    def _rows(self, model: type[ConnectionModel]):
        return model.objects.filter(owner=self._user)

    def _list(self, model: type[ConnectionModel]) -> list:
        return [row.to_schema() for row in self._rows(model)]

    def _get(self, model: type[ConnectionModel], conn_id: str):
        row = self._rows(model).filter(connection_id=conn_id).first()
        return row.to_schema() if row else None

    def _add(self, model: type[ConnectionModel], obj) -> None:
        row = model(owner=self._user)
        row.apply_schema(obj)
        row.save()

    def _update(self, model: type[ConnectionModel], obj, **lookup) -> bool:
        row = self._rows(model).filter(**(lookup or {"connection_id": obj.id})).first()
        if row is None:
            return False
        row.apply_schema(obj)
        row.save()
        return True

    def _delete(self, model: type[ConnectionModel], **lookup) -> bool:
        deleted, _ = self._rows(model).filter(**lookup).delete()
        return deleted > 0

    # Connection management methods
    def get_connection(self, conn_id: str) -> Connection | None:
        """Get a connection by ID."""
        return self._get(GeoServerConnection, conn_id)

    def get_active_connection(self) -> Connection | None:
        """Get the currently active connection."""
        return self.get_connection(self.config.active_connection)

    def add_connection(self, conn: Connection) -> None:
        """Add a new connection."""
        self._add(GeoServerConnection, conn)

    def update_connection(self, conn: Connection) -> bool:
        """Update an existing connection."""
        return self._update(GeoServerConnection, conn)

    def remove_connection(self, conn_id: str) -> None:
        """Remove a connection by ID."""
        self._delete(GeoServerConnection, connection_id=conn_id)
        if self.config.active_connection == conn_id:
            self.config.active_connection = ""
            self.save()

    def set_active_connection(self, conn_id: str) -> None:
        """Set the active connection."""
        self.config.active_connection = conn_id
        self.save()

    def list_connections(self) -> list[Connection]:
        """List all connections."""
        return self._list(GeoServerConnection)

    # Sync config management
    def get_sync_config(self, config_id: str) -> SyncConfiguration | None:
        """Get a sync configuration by ID."""
        for cfg in self.config.sync_configs:
            if cfg.id == config_id:
                return cfg
        return None

    def add_sync_config(self, cfg: SyncConfiguration) -> None:
        """Add a new sync configuration."""
        self.config.sync_configs.append(cfg)
        self.save()

    def update_sync_config(self, cfg: SyncConfiguration) -> bool:
        """Update an existing sync configuration."""
        for i, existing in enumerate(self.config.sync_configs):
            if existing.id == cfg.id:
                self.config.sync_configs[i] = cfg
                self.save()
                return True
        return False

    def remove_sync_config(self, config_id: str) -> None:
        """Remove a sync configuration by ID."""
        self.config.sync_configs = [c for c in self.config.sync_configs if c.id != config_id]
        self.save()

    # PostgreSQL service state management (looked up by name, not id)
    def list_pg_services(self) -> list[PGService]:
        return self._list(PostgresService)

    def get_pg_service(self, name: str) -> PGService | None:
        row = self._rows(PostgresService).filter(name=name).first()
        return row.to_schema() if row else None

    def add_pg_service(self, svc: PGService) -> None:
        self._add(PostgresService, svc)

    def update_pg_service(self, svc: PGService) -> bool:
        return self._update(PostgresService, svc, name=svc.name)

    def delete_pg_service(self, name: str) -> bool:
        return self._delete(PostgresService, name=name)

    # QFieldCloud connection management
    def list_qfieldcloud_connections(self) -> list[QFieldCloudConnection]:
        """List all QFieldCloud connections."""
        return self._list(QFieldCloudConnectionModel)

    def get_qfieldcloud_connection(self, conn_id: str) -> QFieldCloudConnection | None:
        """Get a QFieldCloud connection by ID."""
        return self._get(QFieldCloudConnectionModel, conn_id)

    def add_qfieldcloud_connection(self, conn: QFieldCloudConnection) -> None:
        """Add a new QFieldCloud connection."""
        self._add(QFieldCloudConnectionModel, conn)

    def update_qfieldcloud_connection(self, conn: QFieldCloudConnection) -> bool:
        """Update an existing QFieldCloud connection."""
        return self._update(QFieldCloudConnectionModel, conn)

    def remove_qfieldcloud_connection(self, conn_id: str) -> None:
        """Remove a QFieldCloud connection by ID."""
        self.delete_qfieldcloud_connection(conn_id)

    def delete_qfieldcloud_connection(self, conn_id: str) -> bool:
        """Delete a QFieldCloud connection by ID. Returns True if found."""
        return self._delete(QFieldCloudConnectionModel, connection_id=conn_id)

    # Mergin Maps connection management
    def list_mergin_connections(self) -> list[MerginMapsConnection]:
        """List all Mergin Maps connections."""
        return self._list(MerginMapsConnectionModel)

    def get_mergin_connection(self, conn_id: str) -> MerginMapsConnection | None:
        """Get a Mergin Maps connection by ID."""
        return self._get(MerginMapsConnectionModel, conn_id)

    def add_mergin_connection(self, conn: MerginMapsConnection) -> None:
        """Add a new Mergin Maps connection."""
        self._add(MerginMapsConnectionModel, conn)

    def update_mergin_connection(self, conn: MerginMapsConnection) -> bool:
        """Update an existing Mergin Maps connection."""
        return self._update(MerginMapsConnectionModel, conn)

    def remove_mergin_connection(self, conn_id: str) -> None:
        """Remove a Mergin Maps connection by ID."""
        self.delete_mergin_connection(conn_id)

    def delete_mergin_connection(self, conn_id: str) -> bool:
        """Delete a Mergin Maps connection by ID. Returns True if found."""
        return self._delete(MerginMapsConnectionModel, connection_id=conn_id)

    # GeoNode connection management
    def list_geonode_connections(self) -> list[GeoNodeConnection]:
        """List all GeoNode connections."""
        return self._list(GeoNodeConnectionModel)

    def get_geonode_connection(self, conn_id: str) -> GeoNodeConnection | None:
        """Get a GeoNode connection by ID."""
        return self._get(GeoNodeConnectionModel, conn_id)

    def add_geonode_connection(self, conn: GeoNodeConnection) -> None:
        """Add a new GeoNode connection."""
        self._add(GeoNodeConnectionModel, conn)

    def update_geonode_connection(self, conn: GeoNodeConnection) -> bool:
        """Update an existing GeoNode connection."""
        return self._update(GeoNodeConnectionModel, conn)

    def remove_geonode_connection(self, conn_id: str) -> None:
        """Remove a GeoNode connection by ID."""
        self.delete_geonode_connection(conn_id)

    def delete_geonode_connection(self, conn_id: str) -> bool:
        """Delete a GeoNode connection by ID. Returns True if found."""
        return self._delete(GeoNodeConnectionModel, connection_id=conn_id)

    # Iceberg connection management
    def list_iceberg_connections(self) -> list[IcebergCatalogConnection]:
        """List all Iceberg connections."""
        return self._list(IcebergCatalogConnectionModel)

    def get_iceberg_connection(self, conn_id: str) -> IcebergCatalogConnection | None:
        """Get an Iceberg connection by ID."""
        return self._get(IcebergCatalogConnectionModel, conn_id)

    def add_iceberg_connection(self, conn: IcebergCatalogConnection) -> None:
        """Add a new Iceberg connection."""
        self._add(IcebergCatalogConnectionModel, conn)

    def update_iceberg_connection(self, conn: IcebergCatalogConnection) -> bool:
        """Update an existing Iceberg connection."""
        return self._update(IcebergCatalogConnectionModel, conn)

    def remove_iceberg_connection(self, conn_id: str) -> None:
        """Remove an Iceberg connection by ID."""
        self.delete_iceberg_connection(conn_id)

    def delete_iceberg_connection(self, conn_id: str) -> bool:
        """Delete an Iceberg connection by ID. Returns True if found."""
        return self._delete(IcebergCatalogConnectionModel, connection_id=conn_id)


def get_config(user: "User") -> ConfigManager:
    """Get a ConfigManager for the given user."""
    return ConfigManager(user)


def get_qgis_projects_dir(user: "User") -> Path:
    """Get the directory for storing uploaded QGIS projects.

    Uses XDG_DATA_HOME/kartoza-cloudbench/qgis-projects/
    """
    return get_cloudbench_data_path("qgis-projects", user)


def get_cache_dir() -> Path:
    """Get the cache directory for temporary files.

    Uses CLOUDBENCH_DATA_FOLDER when set so files are on a shared volume
    accessible by Celery workers running in separate containers.
    """
    data_folder = os.environ.get("CLOUDBENCH_DATA_FOLDER")
    if data_folder:
        cache_dir = Path(data_folder) / "cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir
    return Path(tempfile.gettempdir())
