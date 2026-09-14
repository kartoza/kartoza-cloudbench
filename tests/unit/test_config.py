"""Unit tests for configuration management.

Tests the ConfigManager singleton and all connection types.
"""

import json
import os

from apps.core.config import (
    Config,
    ConfigManager,
    Connection,
    GeoNodeConnection,
    IcebergCatalogConnection,
    MerginMapsConnection,
    PGServiceState,
    QFieldCloudConnection,
    QGISProject,
    S3Connection,
    SavedQuery,
    SyncConfiguration,
    SyncOptions,
)


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
    """Tests for ConfigManager singleton."""

    def test_singleton_pattern(self, config_manager: ConfigManager) -> None:
        """Test that ConfigManager is a singleton."""
        manager1 = ConfigManager()
        manager2 = ConfigManager()
        assert manager1 is manager2

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

        # Reset and reload
        ConfigManager._instance = None
        new_manager = ConfigManager()
        assert len(new_manager.list_connections()) == 1


class TestPGServiceState:
    """Tests for PostgreSQL service state."""

    def test_pg_service_state_creation(self) -> None:
        """Test creating PG service state."""
        state = PGServiceState(name="test_service")
        assert state.name == "test_service"
        assert state.is_parsed is False

    def test_set_pg_service_parsed(self, config_manager: ConfigManager) -> None:
        """Test setting PG service parsed state."""
        config_manager.set_pg_service_parsed("test_service", True)
        state = config_manager.get_pg_service_state("test_service")
        assert state is not None
        assert state.is_parsed is True


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
