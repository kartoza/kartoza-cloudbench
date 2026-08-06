import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T", bound=BaseModel)


class Connection(BaseModel):
    """GeoServer connection configuration."""

    id: str = Field(
        default_factory=lambda: f"conn_{datetime.now().strftime('%Y%m%d%H%M%S')}")
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


class S3Connection(BaseModel):
    """S3-compatible storage connection configuration."""

    id: str = Field(
        default_factory=lambda: f"s3_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    name: str
    endpoint: str
    access_key: str
    secret_key: str
    region: str = ""
    use_ssl: bool = False
    path_style: bool = True  # True for MinIO, False for AWS S3
    is_active: bool = False


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

    id: str = Field(
        default_factory=lambda: f"geonode_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    name: str
    url: str
    username: str = ""
    password: str = ""
    api_key: str = ""
    is_active: bool = False


class QFieldCloudConnection(BaseModel):
    """QFieldCloud instance connection configuration."""

    id: str = Field(
        default_factory=lambda: f"qfieldcloud_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    name: str
    url: str = "https://app.qfield.cloud"
    username: str = ""
    password: str = ""
    token: str = ""
    is_active: bool = False


class MerginMapsConnection(BaseModel):
    """Mergin Maps server connection configuration."""

    id: str = Field(
        default_factory=lambda: f"mergin_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    name: str
    url: str = "https://app.merginmaps.com"
    username: str
    password: str = ""
    token: str = ""
    is_active: bool = False


class IcebergCatalogConnection(BaseModel):
    """Apache Iceberg REST Catalog connection."""

    id: str = Field(
        default_factory=lambda: f"iceberg_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
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
    """Main application configuration."""

    connections: list[Connection] = Field(default_factory=list)
    active_connection: str = ""
    last_local_path: str = Field(default_factory=lambda: str(Path.home()))
    theme: str = "default"
    sync_configs: list[SyncConfiguration] = Field(default_factory=list)
    ping_interval_secs: int = 60
    pg_services: list[PGService] = Field(default_factory=list)
    saved_queries: list[SavedQuery] = Field(default_factory=list)
    s3_connections: list[S3Connection] = Field(default_factory=list)
    qgis_projects: list[QGISProject] = Field(default_factory=list)
    geonode_connections: list[GeoNodeConnection] = Field(default_factory=list)
    qfieldcloud_connections: list[QFieldCloudConnection] = Field(
        default_factory=list
    )
    iceberg_connections: list[IcebergCatalogConnection] = Field(
        default_factory=list
    )
    merginmaps_connections: list[MerginMapsConnection] = Field(
        default_factory=list
    )

    class Config:
        """Pydantic configuration."""

        # Allow extra fields for forward compatibility
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
