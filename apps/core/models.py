import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T", bound=BaseModel)


def _new_id(prefix: str):
    """Default-id factory: `<prefix>_<random hex>`.

    Ids used to be `<prefix>_<timestamp to the second>`, which collided when
    two connections were created within the same second.
    """
    return lambda: f"{prefix}_{uuid.uuid4().hex}"


class Connection(BaseModel):
    """GeoServer connection configuration."""

    id: str = Field(default_factory=_new_id("conn"))
    name: str
    url: str
    username: str
    password: str
    is_active: bool = False


class SyncOptions(BaseModel):
    """Sync configuration options."""

    workspaces: bool = True
    datastores: bool = True
    coveragestores: bool = True
    layers: bool = True
    styles: bool = True
    layergroups: bool = True
    workspace_filter: list[str] = Field(default_factory=list)
    datastore_strategy: str = "skip"  # "skip", "same_connection", "geopackage_copy"


class SyncConfiguration(BaseModel):
    """Saved sync configuration."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    source_id: str
    destination_ids: list[str] = Field(default_factory=list)
    options: SyncOptions = Field(default_factory=SyncOptions)
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    last_synced_at: str | None = None


class PGService(BaseModel):
    """PostgreSQL service configuration (pg_service.conf entry)."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    host: str = "localhost"
    port: int = 5432
    dbname: str = ""
    user: str = ""
    password: str = ""
    sslmode: str = ""
    options: dict[str, str] = Field(default_factory=dict)
    is_active: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "host": self.host,
            "port": self.port,
            "dbname": self.dbname,
            "user": self.user,
            "password": self.password,
            "sslmode": self.sslmode,
            "options": self.options,
        }

    def connection_string(self, include_password: bool = False) -> str:
        parts = [f"host={self.host}", f"port={self.port}"]
        if self.dbname:
            parts.append(f"dbname={self.dbname}")
        if self.user:
            parts.append(f"user={self.user}")
        if include_password and self.password:
            parts.append(f"password={self.password}")
        if self.sslmode:
            parts.append(f"sslmode={self.sslmode}")
        return " ".join(parts)

    def dsn(self, include_password: bool = False) -> str:
        auth = self.user
        if include_password and self.password:
            auth = f"{self.user}:{self.password}"
        dsn = f"postgresql://{auth}@{self.host}:{self.port}"
        if self.dbname:
            dsn += f"/{self.dbname}"
        return dsn


class QGISProject(BaseModel):
    """QGIS project file tracking."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    path: str
    title: str = ""
    lastModified: str = ""
    size: int = 0


class GeoNodeConnection(BaseModel):
    """GeoNode instance connection configuration."""

    id: str = Field(default_factory=_new_id("geonode"))
    name: str
    url: str
    username: str = ""
    password: str = ""
    api_key: str = ""
    is_active: bool = False


class QFieldCloudConnection(BaseModel):
    """QFieldCloud instance connection configuration."""

    id: str = Field(default_factory=_new_id("qfieldcloud"))
    name: str
    url: str = "https://app.qfield.cloud"
    username: str = ""
    password: str = ""
    token: str = ""
    is_active: bool = False


class MerginMapsConnection(BaseModel):
    """Mergin Maps server connection configuration."""

    id: str = Field(default_factory=_new_id("mergin"))
    name: str
    url: str = "https://app.merginmaps.com"
    username: str
    password: str = ""
    token: str = ""
    is_active: bool = False


class IcebergCatalogConnection(BaseModel):
    """Apache Iceberg REST Catalog connection."""

    id: str = Field(default_factory=_new_id("iceberg"))
    name: str
    url: str
    warehouse: str = ""
    token: str = ""
    client_id: str = ""
    client_secret: str = ""
    prefix: str = ""
    s3_endpoint: str = ""
    access_key: str = ""
    secret_key: str = ""
    region: str = ""
    jupyter_url: str = ""
    is_active: bool = False


class SavedQuery(BaseModel):
    """Saved visual query definition."""

    name: str
    service_name: str
    definition: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str | None = None


class Config(BaseModel):
    """Main application configuration (the per-user config.json).

    Saved connections are no longer part of this — they live in the
    database (see apps.core.db.ConnectionModel).
    """

    active_connection: str = ""
    last_local_path: str = Field(default_factory=lambda: str(Path.home()))
    theme: str = "default"
    sync_configs: list[SyncConfiguration] = Field(default_factory=list)
    ping_interval_secs: int = 60
    saved_queries: list[SavedQuery] = Field(default_factory=list)
    qgis_projects: list[QGISProject] = Field(default_factory=list)

    class Config:
        """Pydantic configuration."""

        # Allow extra fields for forward compatibility. This also keeps the
        # legacy connection lists (e.g. "connections", "pg_services") intact
        # in an old config.json until `manage.py migrate_connections` has
        # imported them into the database.
        extra = "allow"


# -------------------------------
# PROVIDERS
# -------------------------------
class ProviderConfig(BaseModel):
    """Configuration for a single provider type."""

    id: str
    name: str
    description: str
    enabled: bool = True
    experimental: bool = False


class ProvidersConfig(BaseModel):
    """Main providers configuration."""

    providers: list[ProviderConfig] = Field(default_factory=list)

    class Config:
        """Pydantic configuration."""

        extra = "allow"


# Django discovers an app's models through its `models` module; this one is
# otherwise Pydantic schemas, so the core Django model lives in db.py.
from .db import LegacyConnectionImport  # noqa: E402, F401
