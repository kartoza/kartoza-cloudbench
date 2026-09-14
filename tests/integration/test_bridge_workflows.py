"""Integration tests for PostgreSQL-GeoServer bridge workflows.

Tests creating PostGIS stores and publishing layers.
"""

from unittest.mock import MagicMock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def setup_test_connection(api_client: APIClient):
    """Create a test GeoServer connection for use in tests."""
    response = api_client.post(
        "/api/connections",
        {
            "name": "Test GeoServer",
            "url": "http://localhost:8080/geoserver",
            "username": "admin",
            "password": "geoserver",
        },
        format="json",
    )
    conn_id = response.json().get("id")
    yield conn_id
    # Cleanup
    if conn_id:
        api_client.delete(f"/api/connections/{conn_id}")


@pytest.fixture
def mock_pg_service():
    """Mock PostgreSQL service."""
    with patch("apps.bridge.views.get_service") as mock_get:
        service = MagicMock()
        service.name = "test_service"
        service.host = "localhost"
        service.port = 5432
        service.dbname = "testdb"
        service.user = "testuser"
        service.password = "testpass"
        mock_get.return_value = service
        yield service


@pytest.fixture
def mock_geoserver_client():
    """Mock GeoServer client for bridge operations."""
    with patch("apps.bridge.views.get_geoserver_client") as mock_get:
        client = MagicMock()
        client.create_datastore.return_value = None
        client.list_available_featuretypes.return_value = [
            "cities",
            "roads",
            "buildings",
        ]
        client.create_featuretype.return_value = None
        mock_get.return_value = client
        yield client


@pytest.fixture
def mock_pg_schema():
    """Mock PostgreSQL schema functions."""
    with patch("apps.bridge.views.schema") as mock_schema:
        mock_schema.list_tables.return_value = [
            {
                "name": "cities",
                "geometryColumn": "geom",
                "geometryType": "POINT",
                "srid": 4326,
            },
            {
                "name": "roads",
                "geometryColumn": "geom",
                "geometryType": "LINESTRING",
                "srid": 4326,
            },
        ]
        yield mock_schema


@pytest.mark.integration
@pytest.mark.django_db
class TestBridgePostGISStoreWorkflow:
    """Test creating PostGIS stores from pg_service entries."""

    def test_create_postgis_store(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_pg_service,
        mock_geoserver_client,
    ) -> None:
        """Test creating a PostGIS store in GeoServer from PG service."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/postgis-store",
            {
                "serviceName": "test_service",
                "workspace": "cite",
                "storeName": "test_postgis",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["storeName"] == "test_postgis"
        mock_geoserver_client.create_datastore.assert_called_once()

    def test_create_postgis_store_auto_name(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_pg_service,
        mock_geoserver_client,
    ) -> None:
        """Test creating a PostGIS store with auto-generated name."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/postgis-store",
            {
                "serviceName": "test_service",
                "workspace": "cite",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["storeName"] == "test_service"

    def test_create_postgis_store_missing_params(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_pg_service,
    ) -> None:
        """Test creating a PostGIS store without required params."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/postgis-store",
            {},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "required" in response.json()["error"]

    def test_create_postgis_store_service_not_found(
        self,
        api_client: APIClient,
        setup_test_connection,
    ) -> None:
        """Test creating a PostGIS store with non-existent service."""
        with patch("apps.bridge.views.get_service") as mock_get:
            mock_get.return_value = None
            conn_id = setup_test_connection
            response = api_client.post(
                f"/api/bridge/{conn_id}/postgis-store",
                {
                    "serviceName": "nonexistent",
                    "workspace": "cite",
                },
                format="json",
            )
            assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.integration
@pytest.mark.django_db
class TestBridgePublishableTablesWorkflow:
    """Test listing publishable tables."""

    def test_list_publishable_tables(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_geoserver_client,
    ) -> None:
        """Test listing available tables from a datastore."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/bridge/{conn_id}/cite/postgis_store/tables")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "tables" in data
        assert len(data["tables"]) == 3
        assert data["tables"][0]["name"] == "cities"

    def test_list_publishable_tables_with_schema_info(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_geoserver_client,
        mock_pg_schema,
    ) -> None:
        """Test listing tables with enriched schema info."""
        conn_id = setup_test_connection
        response = api_client.get(
            f"/api/bridge/{conn_id}/cite/postgis_store/tables?serviceName=test_service"
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        # Cities should have geometry info from mock
        cities = next(t for t in data["tables"] if t["name"] == "cities")
        assert cities["geometryType"] == "POINT"


@pytest.mark.integration
@pytest.mark.django_db
class TestBridgePublishLayerWorkflow:
    """Test publishing PostgreSQL tables as GeoServer layers."""

    def test_publish_layer(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_geoserver_client,
    ) -> None:
        """Test publishing a table as a GeoServer layer."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/cite/postgis_store/publish",
            {
                "tableName": "cities",
                "layerName": "cities_layer",
                "title": "Cities Layer",
                "srs": "EPSG:4326",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["layer"] == "cities_layer"
        mock_geoserver_client.create_featuretype.assert_called_once_with(
            workspace="cite",
            datastore="postgis_store",
            name="cities_layer",
            native_name="cities",
            title="Cities Layer",
            srs="EPSG:4326",
        )

    def test_publish_layer_auto_name(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_geoserver_client,
    ) -> None:
        """Test publishing a table with auto-generated layer name."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/cite/postgis_store/publish",
            {"tableName": "cities"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["layer"] == "cities"

    def test_publish_layer_missing_table(
        self,
        api_client: APIClient,
        setup_test_connection,
    ) -> None:
        """Test publishing without table name fails."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/cite/postgis_store/publish",
            {},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_batch_publish(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_geoserver_client,
    ) -> None:
        """Test batch publishing multiple tables."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/cite/postgis_store/publish/batch",
            {
                "tables": [
                    {"tableName": "cities", "layerName": "cities_layer"},
                    {"tableName": "roads"},
                ]
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data["results"]) == 2
        assert data["results"][0]["status"] == "published"

    def test_batch_publish_empty(
        self,
        api_client: APIClient,
        setup_test_connection,
    ) -> None:
        """Test batch publishing with empty list fails."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/bridge/{conn_id}/cite/postgis_store/publish/batch",
            {"tables": []},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
