"""Unit tests for configuration management.

Tests the ConfigManager singleton and all connection types.
"""

import json
import os

import pytest

from apps.core.config import (
    Config,
    ConfigManager,
    Connection,
    GeoNodeConnection,
    IcebergCatalogConnection,
    MerginMapsConnection,
    QFieldCloudConnection,
    QGISProject,
    S3Connection,
    SyncConfiguration,
    SyncOptions,
    get_cache_dir,
    get_config,
    get_qgis_projects_dir,
)
from apps.core.models import PGService, SavedQuery


class TestConnection:
    """Tests for GeoServer Connection model."""

    def test_connection_creation(self) -> None:
        """Test creating a connection with required fields."""
        conn = Connection(
            name="Test Server",
            url="http://localhost:8080/geoserver",
            username="admin",
            password="geoserver",
        )
        assert conn.name == "Test Server"
        assert conn.url == "http://localhost:8080/geoserver"
        assert conn.username == "admin"
        assert conn.password == "geoserver"
        assert conn.is_active is False
        assert conn.id.startswith("conn_")

    def test_connection_with_custom_id(self) -> None:
        """Test creating a connection with custom ID."""
        conn = Connection(
            id="custom-id",
            name="Test Server",
            url="http://localhost:8080/geoserver",
            username="admin",
            password="geoserver",
        )
        assert conn.id == "custom-id"

    def test_connection_serialization(self) -> None:
        """Test connection serialization to dict."""
        conn = Connection(
            id="test-id",
            name="Test Server",
            url="http://localhost:8080/geoserver",
            username="admin",
            password="geoserver",
            is_active=True,
        )
        data = conn.model_dump()
        assert data["id"] == "test-id"
        assert data["name"] == "Test Server"
        assert data["is_active"] is True


class TestS3Connection:
    """Tests for S3 Connection model."""

    def test_s3_connection_creation(self) -> None:
        """Test creating an S3 connection."""
        conn = S3Connection(
            name="MinIO",
            endpoint="localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
        )
        assert conn.name == "MinIO"
        assert conn.endpoint == "localhost:9000"
        assert conn.use_ssl is False
        assert conn.path_style is True
        assert conn.id.startswith("s3_")

    def test_s3_connection_with_ssl(self) -> None:
        """Test S3 connection with SSL enabled."""
        conn = S3Connection(
            name="AWS S3",
            endpoint="s3.amazonaws.com",
            access_key="AKIAEXAMPLE",
            secret_key="secretkey",
            use_ssl=True,
            path_style=False,
            region="us-east-1",
        )
        assert conn.use_ssl is True
        assert conn.path_style is False
        assert conn.region == "us-east-1"


class TestGeoNodeConnection:
    """Tests for GeoNode Connection model."""

    def test_geonode_connection_creation(self) -> None:
        """Test creating a GeoNode connection."""
        conn = GeoNodeConnection(
            name="My GeoNode",
            url="http://localhost:8000",
            username="admin",
            password="admin",
        )
        assert conn.name == "My GeoNode"
        assert conn.id.startswith("geonode_")
        assert conn.api_key == ""

    def test_geonode_connection_with_api_key(self) -> None:
        """Test GeoNode connection with API key."""
        conn = GeoNodeConnection(
            name="GeoNode API",
            url="http://localhost:8000",
            api_key="test-api-key",
        )
        assert conn.api_key == "test-api-key"
        assert conn.username == ""


class TestIcebergConnection:
    """Tests for Iceberg Connection model."""

    def test_iceberg_connection_creation(self) -> None:
        """Test creating an Iceberg connection."""
        conn = IcebergCatalogConnection(
            name="Iceberg Catalog",
            url="http://localhost:8181",
            warehouse="s3://warehouse",
        )
        assert conn.name == "Iceberg Catalog"
        assert conn.id.startswith("iceberg_")
        assert conn.warehouse == "s3://warehouse"

    def test_iceberg_connection_with_credentials(self) -> None:
        """Test Iceberg connection with S3 credentials."""
        conn = IcebergCatalogConnection(
            name="Iceberg Catalog",
            url="http://localhost:8181",
            warehouse="s3://warehouse",
            s3_endpoint="http://localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
        )
        assert conn.s3_endpoint == "http://localhost:9000"
        assert conn.access_key == "minioadmin"


class TestQFieldCloudConnection:
    """Tests for QFieldCloud Connection model."""

    def test_qfieldcloud_connection_creation(self) -> None:
        """Test creating a QFieldCloud connection."""
        conn = QFieldCloudConnection(
            name="QFieldCloud",
            username="testuser",
            token="test-token",
        )
        assert conn.name == "QFieldCloud"
        assert conn.url == "https://app.qfield.cloud"
        assert conn.id.startswith("qfieldcloud_")


class TestMerginMapsConnection:
    """Tests for Mergin Maps Connection model."""

    def test_mergin_connection_creation(self) -> None:
        """Test creating a Mergin Maps connection."""
        conn = MerginMapsConnection(
            name="Mergin Maps",
            username="testuser",
            token="test-token",
        )
        assert conn.name == "Mergin Maps"
        assert conn.url == "https://app.merginmaps.com"
        assert conn.id.startswith("mergin_")


class TestSyncConfiguration:
    """Tests for Sync Configuration model."""

    def test_sync_config_creation(self) -> None:
        """Test creating a sync configuration."""
        options = SyncOptions(
            workspaces=True,
            layers=True,
            datastore_strategy="skip",
        )
        config = SyncConfiguration(
            name="Test Sync",
            source_id="source-conn",
            destination_ids=["dest-conn-1", "dest-conn-2"],
            options=options,
        )
        assert config.name == "Test Sync"
        assert config.source_id == "source-conn"
        assert len(config.destination_ids) == 2
        assert config.options.workspaces is True


class TestConfig:
    """Tests for main Config model."""

    def test_config_default_values(self) -> None:
        """Test Config model default values."""
        config = Config()
        assert config.connections == []
        assert config.s3_connections == []
        assert config.geonode_connections == []
        assert config.active_connection == ""
        assert config.theme == "default"
        assert config.ping_interval_secs == 60

    def test_config_with_connections(self) -> None:
        """Test Config model with connections."""
        conn = Connection(
            name="Test",
            url="http://localhost:8080/geoserver",
            username="admin",
            password="pass",
        )
        config = Config(connections=[conn])
        assert len(config.connections) == 1
        assert config.connections[0].name == "Test"


class TestConfigManager:
    """Tests for the per-user ConfigManager."""

    def test_users_are_isolated(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test that each user gets their own config."""
        config_manager.add_connection(sample_connection)
        other = ConfigManager("other-user")
        assert other.list_connections() == []
        assert len(ConfigManager("test-user").list_connections()) == 1

    def test_add_connection(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test adding a connection."""
        config_manager.add_connection(sample_connection)
        assert len(config_manager.list_connections()) == 1
        assert config_manager.list_connections()[0].name == sample_connection.name

    def test_get_connection(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test getting a connection by ID."""
        config_manager.add_connection(sample_connection)
        conn = config_manager.get_connection(sample_connection.id)
        assert conn is not None
        assert conn.id == sample_connection.id

    def test_get_nonexistent_connection(self, config_manager: ConfigManager) -> None:
        """Test getting a nonexistent connection."""
        conn = config_manager.get_connection("nonexistent")
        assert conn is None

    def test_update_connection(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test updating a connection."""
        config_manager.add_connection(sample_connection)
        sample_connection.name = "Updated Name"
        result = config_manager.update_connection(sample_connection)
        assert result is True
        conn = config_manager.get_connection(sample_connection.id)
        assert conn is not None
        assert conn.name == "Updated Name"

    def test_remove_connection(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test removing a connection."""
        config_manager.add_connection(sample_connection)
        config_manager.remove_connection(sample_connection.id)
        assert len(config_manager.list_connections()) == 0

    def test_set_active_connection(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test setting active connection."""
        config_manager.add_connection(sample_connection)
        config_manager.set_active_connection(sample_connection.id)
        assert config_manager.config.active_connection == sample_connection.id

    def test_add_s3_connection(
        self, config_manager: ConfigManager, sample_s3_connection: S3Connection
    ) -> None:
        """Test adding an S3 connection."""
        config_manager.add_s3_connection(sample_s3_connection)
        assert len(config_manager.list_s3_connections()) == 1

    def test_config_persistence(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test that config is persisted to disk."""
        config_manager.add_connection(sample_connection)
        config_path = config_manager._config_path()
        assert os.path.exists(config_path)

        with open(config_path) as f:
            data = json.load(f)
        assert len(data["connections"]) == 1

    def test_config_reload(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        """Test reloading config from disk."""
        config_manager.add_connection(sample_connection)

        # A new manager for the same user loads what was saved to disk
        new_manager = ConfigManager("test-user")
        assert len(new_manager.list_connections()) == 1


class TestPGService:
    """Tests for PostgreSQL service management."""

    def test_pg_service_creation(self) -> None:
        """Test creating a PG service with defaults."""
        svc = PGService(name="test_service")
        assert svc.name == "test_service"
        assert svc.host == "localhost"
        assert svc.port == 5432
        assert svc.is_active is False

    def test_add_and_get_pg_service(self, config_manager: ConfigManager) -> None:
        """Test adding and retrieving a PG service."""
        config_manager.add_pg_service(PGService(name="test_service", dbname="gis"))
        svc = config_manager.get_pg_service("test_service")
        assert svc is not None
        assert svc.dbname == "gis"
        assert len(config_manager.list_pg_services()) == 1

    def test_update_pg_service(self, config_manager: ConfigManager) -> None:
        """Test updating a PG service."""
        config_manager.add_pg_service(PGService(name="test_service"))
        assert config_manager.update_pg_service(PGService(name="test_service", host="db")) is True
        svc = config_manager.get_pg_service("test_service")
        assert svc is not None
        assert svc.host == "db"
        assert config_manager.update_pg_service(PGService(name="missing")) is False

    def test_delete_pg_service(self, config_manager: ConfigManager) -> None:
        """Test deleting a PG service."""
        config_manager.add_pg_service(PGService(name="test_service"))
        assert config_manager.delete_pg_service("test_service") is True
        assert config_manager.get_pg_service("test_service") is None
        assert config_manager.delete_pg_service("test_service") is False


class TestSavedQuery:
    """Tests for saved queries."""

    def test_saved_query_creation(self) -> None:
        """Test creating a saved query."""
        query = SavedQuery(
            name="Test Query",
            service_name="test_service",
            definition={"table": "users", "columns": ["id", "name"]},
        )
        assert query.name == "Test Query"
        assert query.service_name == "test_service"
        assert "table" in query.definition


class TestQGISProject:
    """Tests for QGIS project tracking."""

    def test_qgis_project_creation(self) -> None:
        """Test creating a QGIS project entry."""
        project = QGISProject(
            name="test_project.qgz",
            path="/path/to/project.qgz",
            title="Test Project",
        )
        assert project.name == "test_project.qgz"
        assert project.title == "Test Project"


CONNECTION_KINDS = [
    (
        "qfieldcloud",
        lambda: QFieldCloudConnection(id="q1", name="Q", username="u", token="t"),
    ),
    ("mergin", lambda: MerginMapsConnection(id="m1", name="M", username="u", token="t")),
    (
        "geonode",
        lambda: GeoNodeConnection(id="g1", name="G", url="http://gn.test", api_key="k"),
    ),
    (
        "iceberg",
        lambda: IcebergCatalogConnection(id="i1", name="I", url="http://ic.test", warehouse="w"),
    ),
]


class TestConnectionCrud:
    """Add/list/get/update/remove/delete for the non-GeoServer connection kinds."""

    @pytest.mark.parametrize(
        ("kind", "factory"), CONNECTION_KINDS, ids=[k for k, _ in CONNECTION_KINDS]
    )
    def test_lifecycle(self, config_manager: ConfigManager, kind: str, factory) -> None:
        conn = factory()
        getattr(config_manager, f"add_{kind}_connection")(conn)
        assert len(getattr(config_manager, f"list_{kind}_connections")()) == 1
        assert getattr(config_manager, f"get_{kind}_connection")(conn.id).name == conn.name
        assert getattr(config_manager, f"get_{kind}_connection")("missing") is None

        conn.name = "Renamed"
        assert getattr(config_manager, f"update_{kind}_connection")(conn) is True
        assert getattr(config_manager, f"get_{kind}_connection")(conn.id).name == "Renamed"
        other = factory()
        other.id = "other"
        assert getattr(config_manager, f"update_{kind}_connection")(other) is False

        assert getattr(config_manager, f"delete_{kind}_connection")("missing") is False
        assert getattr(config_manager, f"delete_{kind}_connection")(conn.id) is True
        getattr(config_manager, f"add_{kind}_connection")(conn)
        getattr(config_manager, f"remove_{kind}_connection")(conn.id)
        assert getattr(config_manager, f"list_{kind}_connections")() == []

    def test_s3_lifecycle(
        self, config_manager: ConfigManager, sample_s3_connection: S3Connection
    ) -> None:
        config_manager.add_s3_connection(sample_s3_connection)
        assert config_manager.get_s3_connection(sample_s3_connection.id) is not None
        assert config_manager.get_s3_connection("missing") is None
        sample_s3_connection.name = "Renamed"
        assert config_manager.update_s3_connection(sample_s3_connection) is True
        other = sample_s3_connection.model_copy(update={"id": "other"})
        assert config_manager.update_s3_connection(other) is False
        assert config_manager.delete_s3_connection("missing") is False
        assert config_manager.delete_s3_connection(sample_s3_connection.id) is True
        config_manager.add_s3_connection(sample_s3_connection)
        config_manager.remove_s3_connection(sample_s3_connection.id)
        assert config_manager.list_s3_connections() == []

    def test_sync_config_lifecycle(self, config_manager: ConfigManager) -> None:
        cfg = SyncConfiguration(
            name="S", source_id="a", destination_ids=["b"], options=SyncOptions()
        )
        config_manager.add_sync_config(cfg)
        assert config_manager.get_sync_config(cfg.id).name == "S"
        assert config_manager.get_sync_config("missing") is None
        cfg.name = "S2"
        assert config_manager.update_sync_config(cfg) is True
        assert config_manager.update_sync_config(cfg.model_copy(update={"id": "x"})) is False
        config_manager.remove_sync_config(cfg.id)
        assert config_manager.get_sync_config(cfg.id) is None

    def test_active_connection_cleared_on_remove(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        config_manager.add_connection(sample_connection)
        config_manager.set_active_connection(sample_connection.id)
        assert config_manager.get_active_connection().id == sample_connection.id
        config_manager.remove_connection(sample_connection.id)
        assert config_manager.config.active_connection == ""
        assert config_manager.get_active_connection() is None

    def test_corrupt_config_file_falls_back_to_defaults(
        self, config_manager: ConfigManager
    ) -> None:
        path = config_manager._config_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write("{not json")
        assert ConfigManager("test-user").config.connections == []

    def test_reload_and_unsaved_save(
        self, config_manager: ConfigManager, sample_connection: Connection
    ) -> None:
        config_manager.add_connection(sample_connection)
        assert len(config_manager.reload().connections) == 1
        ConfigManager("fresh-user").save()  # nothing loaded -> nothing written


class TestConfigHelpers:
    def test_get_config_is_per_user(self, config_manager: ConfigManager) -> None:
        assert get_config(7)._user_id == "7"

    def test_cache_dir_uses_data_folder(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("CLOUDBENCH_DATA_FOLDER", str(tmp_path))
        assert get_cache_dir() == tmp_path / "cache"
        monkeypatch.delenv("CLOUDBENCH_DATA_FOLDER")
        assert get_cache_dir().exists()

    def test_qgis_projects_dir(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("CLOUDBENCH_DATA_FOLDER", str(tmp_path))
        assert str(get_qgis_projects_dir("u1")).startswith(str(tmp_path / "u1"))
