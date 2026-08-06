"""Integration tests for PostgreSQL workflows.

Tests complex interactions with PostgreSQL services using mocks.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def mock_pg_service():
    """Mock PostgreSQL service functions."""
    with patch("apps.postgres.views.list_services") as mock_list, \
         patch("apps.postgres.views.get_service") as mock_get, \
         patch("apps.postgres.views.write_service") as mock_write, \
         patch("apps.postgres.views.delete_service") as mock_delete:
        # Mock list_services
        mock_list.return_value = ["test_service", "another_service"]

        # Mock get_service
        mock_service = MagicMock()
        mock_service.name = "test_service"
        mock_service.host = "localhost"
        mock_service.port = 5432
        mock_service.dbname = "testdb"
        mock_service.user = "testuser"
        mock_service.password = "testpass"
        mock_service.sslmode = "prefer"
        mock_service.connection_string.return_value = "postgresql://testuser:testpass@localhost:5432/testdb"
        mock_get.return_value = mock_service

        # Mock write_service to not fail
        mock_write.return_value = None

        # Mock delete_service to return True
        mock_delete.return_value = True

        yield {
            "list": mock_list,
            "get": mock_get,
            "write": mock_write,
            "delete": mock_delete,
            "service": mock_service,
        }


@pytest.fixture
def mock_pg_schema():
    """Mock PostgreSQL schema functions."""
    with patch("apps.postgres.views.schema") as mock_schema:
        # Mock list_schemas
        mock_schema.list_schemas.return_value = ["public", "postgis", "test_schema"]

        # Mock list_tables
        mock_schema.list_tables.return_value = [
            {
                "name": "cities",
                "type": "BASE TABLE",
                "geometryColumn": "geom",
                "geometryType": "POINT",
                "srid": 4326,
                "schema": "public",
            },
            {
                "name": "roads",
                "type": "BASE TABLE",
                "geometryColumn": "geom",
                "geometryType": "LINESTRING",
                "srid": 4326,
                "schema": "public",
            },
        ]

        # Mock get_table_columns
        mock_schema.get_table_columns.return_value = [
            {"name": "id", "dataType": "integer", "isNullable": False, "isPrimaryKey": True},
            {"name": "name", "dataType": "character varying", "isNullable": True, "isPrimaryKey": False},
            {"name": "geom", "dataType": "geometry", "isNullable": True, "isPrimaryKey": False, "isGeometry": True, "geometryType": "POINT", "srid": 4326},
        ]

        # Mock get_table_row_count
        mock_schema.get_table_row_count.return_value = 1000

        # Mock get_table_data
        mock_schema.get_table_data.return_value = {
            "columns": ["id", "name", "geom"],
            "rows": [
                [1, "New York", "POINT(-74.006 40.7128)"],
                [2, "Los Angeles", "POINT(-118.2437 34.0522)"],
            ],
            "total": 100,
            "limit": 10,
            "offset": 0,
        }

        # Mock execute_query
        mock_schema.execute_query.return_value = {
            "columns": ["count"],
            "rows": [{"count": 42}],
            "rowCount": 1,
        }

        # Mock test_connection
        mock_schema.test_connection.return_value = (True, "Connected: PostgreSQL 15.3")

        yield mock_schema


@pytest.mark.integration
@pytest.mark.django_db
class TestPostgresServiceWorkflow:
    """Test PostgreSQL service management workflows."""

    def test_list_pg_services(self, api_client: APIClient, mock_pg_service) -> None:
        """Test listing PostgreSQL services from pg_service.conf."""
        response = api_client.get("/api/pg/services")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 2
        assert data[0]["name"] == "test_service"
        assert data[0]["host"] == "localhost"

    def test_create_pg_service(self, api_client: APIClient, mock_pg_service) -> None:
        """Test creating a new PostgreSQL service."""
        # Mock get_service to return None for new service check
        mock_pg_service["get"].return_value = None

        response = api_client.post(
            "/api/pg/services",
            {
                "name": "new_service",
                "host": "newhost",
                "port": 5432,
                "dbname": "newdb",
                "user": "newuser",
                "password": "newpass",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["name"] == "new_service"

    def test_create_pg_service_duplicate(self, api_client: APIClient, mock_pg_service) -> None:
        """Test creating a duplicate service fails."""
        response = api_client.post(
            "/api/pg/services",
            {"name": "test_service", "host": "localhost", "dbname": "db"},
            format="json",
        )
        assert response.status_code == status.HTTP_409_CONFLICT

    def test_get_pg_service_detail(self, api_client: APIClient, mock_pg_service) -> None:
        """Test getting service details."""
        response = api_client.get("/api/pg/services/test_service")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["name"] == "test_service"
        assert "connectionString" in response.json()

    def test_update_pg_service(self, api_client: APIClient, mock_pg_service) -> None:
        """Test updating a service."""
        response = api_client.put(
            "/api/pg/services/test_service",
            {"host": "newhost"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        mock_pg_service["write"].assert_called_once()

    def test_delete_pg_service(self, api_client: APIClient, mock_pg_service) -> None:
        """Test deleting a service."""
        response = api_client.delete("/api/pg/services/test_service")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_pg_service["delete"].assert_called_once_with("test_service")

    def test_pg_service_connection_test(
        self, api_client: APIClient, mock_pg_service, mock_pg_schema
    ) -> None:
        """Test testing a PostgreSQL service connection."""
        response = api_client.post("/api/pg/services/test_service/test")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["success"] is True
        assert "Connected" in response.json()["message"]


@pytest.mark.integration
@pytest.mark.django_db
class TestPostgresSchemaWorkflow:
    """Test PostgreSQL schema browsing workflows."""

    def test_list_schemas(
        self, api_client: APIClient, mock_pg_service, mock_pg_schema
    ) -> None:
        """Test listing schemas in a database."""
        response = api_client.get("/api/pg/services/test_service/schemas")
        assert response.status_code == status.HTTP_200_OK
        assert "schemas" in response.json()
        assert "public" in response.json()["schemas"]

    def test_list_tables(
        self, api_client: APIClient, mock_pg_service, mock_pg_schema
    ) -> None:
        """Test listing tables in a schema."""
        response = api_client.get("/api/pg/services/test_service/schemas/public/tables")
        assert response.status_code == status.HTTP_200_OK
        tables = response.json()["tables"]
        assert len(tables) == 2
        assert tables[0]["name"] == "cities"
        assert tables[0]["geometryType"] == "POINT"

    def test_get_table_detail(
        self, api_client: APIClient, mock_pg_service, mock_pg_schema
    ) -> None:
        """Test getting table details."""
        response = api_client.get(
            "/api/pg/services/test_service/schemas/public/tables/cities"
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["table"] == "cities"
        assert len(data["columns"]) == 3
        assert data["rowCount"] == 1000


@pytest.mark.integration
@pytest.mark.django_db
class TestPostgresQueryWorkflow:
    """Test PostgreSQL query execution workflows."""

    def test_execute_query(
        self, api_client: APIClient, mock_pg_service, mock_pg_schema
    ) -> None:
        """Test executing a SQL query."""
        response = api_client.post(
            "/api/pg/services/test_service/query",
            {"query": "SELECT COUNT(*) FROM cities", "limit": 100},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "columns" in data
        assert "rows" in data

    def test_execute_query_missing_query(
        self, api_client: APIClient, mock_pg_service
    ) -> None:
        """Test executing without query fails."""
        response = api_client.post(
            "/api/pg/services/test_service/query",
            {},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "query is required" in response.json()["error"]

    def test_execute_invalid_query(
        self, api_client: APIClient, mock_pg_service, mock_pg_schema
    ) -> None:
        """Test executing an invalid SQL query."""
        mock_pg_schema.execute_query.side_effect = Exception("syntax error")

        response = api_client.post(
            "/api/pg/services/test_service/query",
            {"query": "INVALID SQL"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Query error" in response.json()["error"]


@pytest.mark.integration
@pytest.mark.django_db
class TestPostgresImportWorkflow:
    """Test data import to PostgreSQL workflows."""

    @pytest.fixture
    def mock_subprocess(self):
        """Mock subprocess for ogr2ogr calls."""
        with patch("apps.postgres.views.subprocess") as mock:
            mock.run.return_value = MagicMock(
                returncode=0,
                stdout="Import complete",
                stderr="",
            )
            yield mock

    def test_import_missing_params(self, api_client: APIClient) -> None:
        """Test import fails without required params."""
        response = api_client.post(
            "/api/pg/import",
            {},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "required" in response.json()["error"]

    def test_import_service_not_found(self, api_client: APIClient, mock_pg_service) -> None:
        """Test import fails for non-existent service."""
        mock_pg_service["get"].return_value = None

        response = api_client.post(
            "/api/pg/import",
            {"serviceName": "nonexistent", "filePath": "/tmp/test.gpkg"},
            format="json",
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "Service not found" in response.json()["error"]


@pytest.mark.integration
@pytest.mark.django_db
class TestPostgresImportCleanup:
    """Tests that /api/pg/import only deletes the uploaded source file once
    the caller signals it's no longer needed via cleanupSource.

    Regression coverage for a bug where a multi-layer file (e.g. a
    GeoPackage) was imported via one request per layer, all sharing the
    same uploaded file path, but the source was deleted after the very
    first layer -- breaking every subsequent layer's import.
    """

    @pytest.fixture
    def authenticated_client(self, api_client: APIClient) -> APIClient:
        """PGImportView requires IsAuthenticated; force_authenticate skips
        the real auth backend so no DB-backed user is needed.
        """
        api_client.force_authenticate(user=get_user_model()())
        return api_client

    @pytest.fixture
    def mock_pg_import_client(self):
        """Mock get_pg_client() as used by PGImportView."""
        with patch("apps.postgres.views.get_pg_client") as mock_get_client:
            mock_service = MagicMock()
            mock_service.host = "localhost"
            mock_service.port = 5432
            mock_service.dbname = "testdb"
            mock_service.user = "testuser"
            mock_service.password = "testpass"
            mock_client = MagicMock()
            mock_client.service = mock_service
            mock_get_client.return_value = mock_client
            yield mock_get_client

    @pytest.fixture
    def uploaded_gpkg(self, tmp_path: Path) -> Path:
        upload_dir = tmp_path / "session-abc"
        upload_dir.mkdir()
        file_path = upload_dir / "combined.gpkg"
        file_path.write_bytes(b"fake gpkg content")
        return file_path

    def test_import_without_cleanup_flag_keeps_file(
        self,
        authenticated_client: APIClient,
        mock_pg_import_client: MagicMock,
        uploaded_gpkg: Path,
    ) -> None:
        """Default behaviour (no cleanupSource) must not delete the source,
        since another layer of the same upload may still need it.
        """
        with patch("apps.postgres.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            response = authenticated_client.post(
                "/api/pg/import",
                {
                    "serviceName": "test_service",
                    "filePath": str(uploaded_gpkg),
                    "sourceLayer": "aoi",
                    "tableName": "aoi",
                },
                format="json",
            )

        assert response.status_code == status.HTTP_200_OK
        assert uploaded_gpkg.exists()

    def test_import_with_cleanup_flag_removes_file(
        self,
        authenticated_client: APIClient,
        mock_pg_import_client: MagicMock,
        uploaded_gpkg: Path,
    ) -> None:
        """cleanupSource=True (the last layer) must remove the whole
        upload dir, including the source file.
        """
        with patch("apps.postgres.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            response = authenticated_client.post(
                "/api/pg/import",
                {
                    "serviceName": "test_service",
                    "filePath": str(uploaded_gpkg),
                    "sourceLayer": "camps",
                    "tableName": "camps",
                    "cleanupSource": True,
                },
                format="json",
            )

        assert response.status_code == status.HTTP_200_OK
        assert not uploaded_gpkg.parent.exists()

    def test_multi_layer_import_sequence(
        self,
        authenticated_client: APIClient,
        mock_pg_import_client: MagicMock,
        uploaded_gpkg: Path,
    ) -> None:
        """Mirrors PGUploadDialog's per-layer loop for a 3-layer GeoPackage."""
        layers = ["aoi", "boundary_lines", "camps"]
        with patch("apps.postgres.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            for i, layer in enumerate(layers):
                response = authenticated_client.post(
                    "/api/pg/import",
                    {
                        "serviceName": "test_service",
                        "filePath": str(uploaded_gpkg),
                        "sourceLayer": layer,
                        "tableName": layer,
                        "cleanupSource": i == len(layers) - 1,
                    },
                    format="json",
                )
                assert response.status_code == status.HTTP_200_OK, (
                    f"layer {layer} failed: {response.json()}"
                )
                if i < len(layers) - 1:
                    assert uploaded_gpkg.exists(), (
                        f"source must survive after layer {layer}"
                    )

        assert not uploaded_gpkg.parent.exists()


@pytest.mark.integration
@pytest.mark.django_db
class TestPostgresBridgeWorkflow:
    """Test PostgreSQL to GeoServer bridge workflows.

    Note: Bridge functionality is tested in test_bridge_workflows.py
    """

    pass
