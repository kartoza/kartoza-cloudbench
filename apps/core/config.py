"""Configuration manager for Kartoza CloudBench.

Provides JSON file-based configuration compatible with the Go backend.
Uses XDG Base Directory specification for config file location.
"""

import json
import os
import tempfile
from pathlib import Path

from .utilities import (
    file_lock, get_cloudbench_data_path
)

# Config directory names
CONFIG_FILE = "config.json"

from .utilities import get_cloudbench_config_path  # noqa: E402
from .models import (
    Config,
    Connection,
    GeoNodeConnection,
    QGISProject, SyncOptions,

    SyncConfiguration, PGService, S3Connection, QFieldCloudConnection,
    MerginMapsConnection, IcebergCatalogConnection
)

__all__ = ["QGISProject", "SyncOptions"]

# Type aliases for cleaner imports in views
IcebergConnection = IcebergCatalogConnection
MerginConnection = MerginMapsConnection


class ConfigManager:
    """Per-user configuration manager.

    Provides load/save functionality with atomic writes and migration support.
    """

    def __init__(self, user_id: str = "default") -> None:
        self._user_id = user_id
        self._config: "Config | None" = None

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
        return get_cloudbench_config_path(CONFIG_FILE, self._user_id)

    def post_process_config(self, config: Config) -> Config:
        """Post process config."""
        return config

    def _load(self) -> Config:
        """Load configuration from disk with file locking."""
        path = self._config_path()

        try:
            with file_lock(path, exclusive=False):
                with open(path) as f:
                    data = json.load(f)
            config = Config.model_validate(data)
        except (json.JSONDecodeError, ValueError, IOError):
            config = Config()

        return self.post_process_config(config)

    # Connection management methods
    def get_connection(self, conn_id: str) -> Connection | None:
        """Get a connection by ID."""
        for conn in self.config.connections:
            if conn.id == conn_id:
                return conn
        return None

    def get_active_connection(self) -> Connection | None:
        """Get the currently active connection."""
        return self.get_connection(self.config.active_connection)

    def add_connection(self, conn: Connection) -> None:
        """Add a new connection."""
        self.config.connections.append(conn)
        self.save()

    def update_connection(self, conn: Connection) -> bool:
        """Update an existing connection."""
        for i, existing in enumerate(self.config.connections):
            if existing.id == conn.id:
                self.config.connections[i] = conn
                self.save()
                return True
        return False

    def remove_connection(self, conn_id: str) -> None:
        """Remove a connection by ID."""
        self.config.connections = [c for c in self.config.connections if
                                   c.id != conn_id]
        if self.config.active_connection == conn_id:
            self.config.active_connection = ""
        self.save()

    def set_active_connection(self, conn_id: str) -> None:
        """Set the active connection."""
        self.config.active_connection = conn_id
        self.save()

    def list_connections(self) -> list[Connection]:
        """List all connections."""
        return list(self.config.connections)

    # S3 connection management
    def list_s3_connections(self) -> list[S3Connection]:
        """List all S3 connections."""
        return list(self.config.s3_connections)

    def get_s3_connection(self, conn_id: str) -> S3Connection | None:
        """Get an S3 connection by ID."""
        for conn in self.config.s3_connections:
            if conn.id == conn_id:
                return conn
        return None

    def add_s3_connection(self, conn: S3Connection) -> None:
        """Add a new S3 connection."""
        self.config.s3_connections.append(conn)
        self.save()

    def update_s3_connection(self, conn: S3Connection) -> bool:
        """Update an existing S3 connection."""
        for i, existing in enumerate(self.config.s3_connections):
            if existing.id == conn.id:
                self.config.s3_connections[i] = conn
                self.save()
                return True
        return False

    def remove_s3_connection(self, conn_id: str) -> None:
        """Remove an S3 connection by ID."""
        self.config.s3_connections = [c for c in self.config.s3_connections if
                                      c.id != conn_id]
        self.save()

    def delete_s3_connection(self, conn_id: str) -> bool:
        """Delete an S3 connection by ID. Returns True if found."""
        original_len = len(self.config.s3_connections)
        self.config.s3_connections = [c for c in self.config.s3_connections if
                                      c.id != conn_id]
        if len(self.config.s3_connections) < original_len:
            self.save()
            return True
        return False

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
        self.config.sync_configs = [c for c in self.config.sync_configs if
                                    c.id != config_id]
        self.save()

    # PostgreSQL service state management
    def list_pg_services(self) -> list[PGService]:
        return list(self.config.pg_services)

    def get_pg_service(self, name: str) -> PGService | None:
        for svc in self.config.pg_services:
            if svc.name == name:
                return svc
        return None

    def add_pg_service(self, svc: PGService) -> None:
        self.config.pg_services.append(svc)
        self.save()

    def update_pg_service(self, svc: PGService) -> bool:
        for i, s in enumerate(self.config.pg_services):
            if s.name == svc.name:
                self.config.pg_services[i] = svc
                self.save()
                return True
        return False

    def delete_pg_service(self, name: str) -> bool:
        before = len(self.config.pg_services)
        self.config.pg_services = [s for s in self.config.pg_services if s.name != name]
        if len(self.config.pg_services) < before:
            self.save()
            return True
        return False

    # QFieldCloud connection management
    def list_qfieldcloud_connections(self) -> list[QFieldCloudConnection]:
        """List all QFieldCloud connections."""
        return list(self.config.qfieldcloud_connections)

    def get_qfieldcloud_connection(self,
                                   conn_id: str) -> QFieldCloudConnection | None:
        """Get a QFieldCloud connection by ID."""
        for conn in self.config.qfieldcloud_connections:
            if conn.id == conn_id:
                return conn
        return None

    def add_qfieldcloud_connection(self, conn: QFieldCloudConnection) -> None:
        """Add a new QFieldCloud connection."""
        self.config.qfieldcloud_connections.append(conn)
        self.save()

    def update_qfieldcloud_connection(self,
                                      conn: QFieldCloudConnection) -> bool:
        """Update an existing QFieldCloud connection."""
        for i, existing in enumerate(self.config.qfieldcloud_connections):
            if existing.id == conn.id:
                self.config.qfieldcloud_connections[i] = conn
                self.save()
                return True
        return False

    def remove_qfieldcloud_connection(self, conn_id: str) -> None:
        """Remove a QFieldCloud connection by ID."""
        self.config.qfieldcloud_connections = [
            c for c in self.config.qfieldcloud_connections if c.id != conn_id
        ]
        self.save()

    def delete_qfieldcloud_connection(self, conn_id: str) -> bool:
        """Delete a QFieldCloud connection by ID. Returns True if found."""
        original_len = len(self.config.qfieldcloud_connections)
        self.config.qfieldcloud_connections = [
            c for c in self.config.qfieldcloud_connections if c.id != conn_id
        ]
        if len(self.config.qfieldcloud_connections) < original_len:
            self.save()
            return True
        return False

    # Mergin Maps connection management
    def list_mergin_connections(self) -> list[MerginMapsConnection]:
        """List all Mergin Maps connections."""
        return list(self.config.merginmaps_connections)

    def get_mergin_connection(self,
                              conn_id: str) -> MerginMapsConnection | None:
        """Get a Mergin Maps connection by ID."""
        for conn in self.config.merginmaps_connections:
            if conn.id == conn_id:
                return conn
        return None

    def add_mergin_connection(self, conn: MerginMapsConnection) -> None:
        """Add a new Mergin Maps connection."""
        self.config.merginmaps_connections.append(conn)
        self.save()

    def update_mergin_connection(self, conn: MerginMapsConnection) -> bool:
        """Update an existing Mergin Maps connection."""
        for i, existing in enumerate(self.config.merginmaps_connections):
            if existing.id == conn.id:
                self.config.merginmaps_connections[i] = conn
                self.save()
                return True
        return False

    def remove_mergin_connection(self, conn_id: str) -> None:
        """Remove a Mergin Maps connection by ID."""
        self.config.merginmaps_connections = [
            c for c in self.config.merginmaps_connections if c.id != conn_id
        ]
        self.save()

    def delete_mergin_connection(self, conn_id: str) -> bool:
        """Delete a Mergin Maps connection by ID. Returns True if found."""
        original_len = len(self.config.merginmaps_connections)
        self.config.merginmaps_connections = [
            c for c in self.config.merginmaps_connections if c.id != conn_id
        ]
        if len(self.config.merginmaps_connections) < original_len:
            self.save()
            return True
        return False

    # GeoNode connection management
    def list_geonode_connections(self) -> list[GeoNodeConnection]:
        """List all GeoNode connections."""
        return list(self.config.geonode_connections)

    def get_geonode_connection(self, conn_id: str) -> GeoNodeConnection | None:
        """Get a GeoNode connection by ID."""
        for conn in self.config.geonode_connections:
            if conn.id == conn_id:
                return conn
        return None

    def add_geonode_connection(self, conn: GeoNodeConnection) -> None:
        """Add a new GeoNode connection."""
        self.config.geonode_connections.append(conn)
        self.save()

    def update_geonode_connection(self, conn: GeoNodeConnection) -> bool:
        """Update an existing GeoNode connection."""
        for i, existing in enumerate(self.config.geonode_connections):
            if existing.id == conn.id:
                self.config.geonode_connections[i] = conn
                self.save()
                return True
        return False

    def remove_geonode_connection(self, conn_id: str) -> None:
        """Remove a GeoNode connection by ID."""
        self.config.geonode_connections = [
            c for c in self.config.geonode_connections if c.id != conn_id
        ]
        self.save()

    def delete_geonode_connection(self, conn_id: str) -> bool:
        """Delete a GeoNode connection by ID. Returns True if found."""
        original_len = len(self.config.geonode_connections)
        self.config.geonode_connections = [
            c for c in self.config.geonode_connections if c.id != conn_id
        ]
        if len(self.config.geonode_connections) < original_len:
            self.save()
            return True
        return False

    # Iceberg connection management
    def list_iceberg_connections(self) -> list[IcebergCatalogConnection]:
        """List all Iceberg connections."""
        return list(self.config.iceberg_connections)

    def get_iceberg_connection(self,
                               conn_id: str) -> IcebergCatalogConnection | None:
        """Get an Iceberg connection by ID."""
        for conn in self.config.iceberg_connections:
            if conn.id == conn_id:
                return conn
        return None

    def add_iceberg_connection(self, conn: IcebergCatalogConnection) -> None:
        """Add a new Iceberg connection."""
        self.config.iceberg_connections.append(conn)
        self.save()

    def update_iceberg_connection(
            self, conn: IcebergCatalogConnection
    ) -> bool:
        """Update an existing Iceberg connection."""
        for i, existing in enumerate(self.config.iceberg_connections):
            if existing.id == conn.id:
                self.config.iceberg_connections[i] = conn
                self.save()
                return True
        return False

    def remove_iceberg_connection(self, conn_id: str) -> None:
        """Remove an Iceberg connection by ID."""
        self.config.iceberg_connections = [
            c for c in self.config.iceberg_connections if c.id != conn_id
        ]
        self.save()

    def delete_iceberg_connection(self, conn_id: str) -> bool:
        """Delete an Iceberg connection by ID. Returns True if found."""
        original_len = len(self.config.iceberg_connections)
        self.config.iceberg_connections = [
            c for c in self.config.iceberg_connections if c.id != conn_id
        ]
        if len(self.config.iceberg_connections) < original_len:
            self.save()
            return True
        return False


def get_config(user_id: "str | int" = "default") -> ConfigManager:
    """Get a ConfigManager for the given user."""
    return ConfigManager(str(user_id))


def get_qgis_projects_dir(user_id: "str | int" = "default") -> Path:
    """Get the directory for storing uploaded QGIS projects.

    Uses XDG_DATA_HOME/kartoza-cloudbench/qgis-projects/
    """
    return get_cloudbench_data_path("qgis-projects", user_id)


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
