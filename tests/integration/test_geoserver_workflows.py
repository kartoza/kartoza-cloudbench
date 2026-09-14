"""Integration tests for GeoServer workflows.

These tests verify complex interactions with GeoServer.
Uses mocked client to test API endpoints without a running server.
"""

from unittest.mock import MagicMock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def mock_geoserver_for_workspace():
    """Mock GeoServerClient for workspace operations."""
    with patch("apps.geoserver.views.workspaces.get_geoserver_client") as mock:
        client = MagicMock()
        client.list_workspaces.return_value = [
            {"name": "cite", "href": "http://localhost:8080/geoserver/rest/workspaces/cite"},
            {"name": "test", "href": "http://localhost:8080/geoserver/rest/workspaces/test"},
        ]
        client.get_workspace.return_value = {
            "name": "test",
            "isolated": False,
        }
        client.create_workspace.return_value = None
        client.update_workspace.return_value = None
        client.delete_workspace.return_value = None
        mock.return_value = client
        yield client


@pytest.fixture
def mock_geoserver_for_layers():
    """Mock GeoServerClient for layer operations."""
    with patch("apps.geoserver.views.layers.get_geoserver_client") as mock:
        client = MagicMock()
        client.list_layers.return_value = [
            {"name": "roads", "href": "http://localhost:8080/geoserver/rest/layers/roads"},
            {"name": "buildings", "href": "http://localhost:8080/geoserver/rest/layers/buildings"},
        ]
        client.get_layer.return_value = {
            "name": "roads",
            "type": "VECTOR",
            "enabled": True,
            "queryable": True,
        }
        mock.return_value = client
        yield client


@pytest.fixture
def setup_test_connection(api_client: APIClient):
    """Create a test connection for use in tests."""
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


@pytest.mark.integration
@pytest.mark.django_db
class TestGeoServerConnectionWorkflow:
    """Test GeoServer connection management workflows."""

    def test_full_connection_lifecycle(self, api_client: APIClient) -> None:
        """Test complete connection lifecycle: create, use, delete."""
        # Create connection
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Integration Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        conn_id = create_response.json()["id"]

        # Verify connection exists
        get_response = api_client.get(f"/api/connections/{conn_id}")
        assert get_response.status_code == status.HTTP_200_OK
        assert get_response.json()["name"] == "Integration Test GeoServer"

        # Delete connection
        delete_response = api_client.delete(f"/api/connections/{conn_id}")
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

        # Verify deletion
        verify_response = api_client.get(f"/api/connections/{conn_id}")
        assert verify_response.status_code == status.HTTP_404_NOT_FOUND

    def test_multiple_connections_workflow(self, api_client: APIClient) -> None:
        """Test managing multiple GeoServer connections."""
        # Create two connections
        conn1_response = api_client.post(
            "/api/connections",
            {
                "name": "GeoServer 1",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "pass1",
            },
            format="json",
        )
        conn2_response = api_client.post(
            "/api/connections",
            {
                "name": "GeoServer 2",
                "url": "http://localhost:8081/geoserver",
                "username": "admin",
                "password": "pass2",
            },
            format="json",
        )

        assert conn1_response.status_code == status.HTTP_201_CREATED
        assert conn2_response.status_code == status.HTTP_201_CREATED

        conn1_id = conn1_response.json()["id"]
        conn2_id = conn2_response.json()["id"]

        # List should show both
        list_response = api_client.get("/api/connections")
        connections = list_response.json()
        assert len(connections) >= 2

        # Clean up
        api_client.delete(f"/api/connections/{conn1_id}")
        api_client.delete(f"/api/connections/{conn2_id}")


@pytest.mark.integration
@pytest.mark.django_db
class TestGeoServerWorkspaceWorkflow:
    """Test GeoServer workspace management workflows."""

    def test_workspace_list(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test listing workspaces."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/workspaces/{conn_id}")
        assert response.status_code == status.HTTP_200_OK
        assert len(response.json()) == 2
        assert response.json()[0]["name"] == "cite"

    def test_workspace_create(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test creating a workspace."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/workspaces/{conn_id}",
            {"name": "new_workspace", "isolated": False},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert "created" in response.json()["message"]
        mock_geoserver_for_workspace.create_workspace.assert_called_once_with(
            "new_workspace", isolated=False, default=False
        )

    def test_workspace_create_missing_name(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test creating a workspace without name fails."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/workspaces/{conn_id}",
            {"isolated": False},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "name is required" in response.json()["error"]

    def test_workspace_get_detail(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test getting workspace details."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/workspaces/{conn_id}/test")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["workspace"]["name"] == "test"

    def test_workspace_update(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test updating a workspace."""
        conn_id = setup_test_connection
        response = api_client.put(
            f"/api/workspaces/{conn_id}/test",
            {"isolated": True},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        mock_geoserver_for_workspace.update_workspace.assert_called_once()

    def test_workspace_delete(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test deleting a workspace."""
        conn_id = setup_test_connection
        response = api_client.delete(f"/api/workspaces/{conn_id}/test")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_geoserver_for_workspace.delete_workspace.assert_called_once_with("test", recurse=False)

    def test_workspace_delete_recursive(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_workspace
    ) -> None:
        """Test deleting a workspace recursively."""
        conn_id = setup_test_connection
        response = api_client.delete(f"/api/workspaces/{conn_id}/test?recurse=true")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_geoserver_for_workspace.delete_workspace.assert_called_once_with("test", recurse=True)


@pytest.mark.integration
@pytest.mark.django_db
class TestGeoServerLayerWorkflow:
    """Test GeoServer layer management workflows."""

    def test_layer_listing(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_layers
    ) -> None:
        """Test listing layers from GeoServer."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/layers/{conn_id}/cite")
        assert response.status_code == status.HTTP_200_OK
        assert len(response.json()) == 2
        assert response.json()[0]["name"] == "roads"

    def test_layer_detail(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_layers
    ) -> None:
        """Test getting layer details."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/layers/{conn_id}/cite/roads")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["layer"]["name"] == "roads"
        assert response.json()["layer"]["type"] == "VECTOR"


@pytest.mark.integration
@pytest.mark.django_db
@pytest.mark.slow
class TestGeoServerUploadWorkflow:
    """Test file upload to GeoServer workflows."""

    @pytest.fixture
    def mock_geoserver_for_uploads(self):
        """Mock GeoServerClient for upload operations."""
        with patch("apps.geoserver.views.uploads.get_geoserver_client") as mock:
            client = MagicMock()
            client.upload_shapefile.return_value = None
            client.upload_geotiff.return_value = None
            client.upload_geopackage.return_value = None
            mock.return_value = client
            yield client

    def test_shapefile_upload_missing_name(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_uploads
    ) -> None:
        """Test shapefile upload fails without name."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/upload/shapefile/{conn_id}/test",
            {},
            format="multipart",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "name is required" in response.json()["error"]

    def test_geotiff_upload_missing_file(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_uploads
    ) -> None:
        """Test GeoTIFF upload fails without file."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/upload/geotiff/{conn_id}/test",
            {"name": "test_raster"},
            format="multipart",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "file is required" in response.json()["error"]


@pytest.mark.integration
@pytest.mark.django_db
class TestGeoServerStyleWorkflow:
    """Test GeoServer style management workflows."""

    @pytest.fixture
    def mock_geoserver_for_styles(self):
        """Mock GeoServerClient for style operations."""
        with patch("apps.geoserver.views.styles.get_geoserver_client") as mock:
            client = MagicMock()
            client.list_styles.return_value = [
                {"name": "point", "href": "http://localhost:8080/geoserver/rest/styles/point"},
            ]
            client.get_style.return_value = {"name": "point", "format": "sld"}
            client.get_style_content.return_value = ("<sld/>", "sld")
            client.create_style.return_value = None
            client.update_style_content.return_value = None
            client.delete_style.return_value = None
            mock.return_value = client
            yield client

    def test_style_list(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_styles
    ) -> None:
        """Test listing styles."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/styles/{conn_id}/cite")
        assert response.status_code == status.HTTP_200_OK
        assert len(response.json()) == 1
        assert response.json()[0]["name"] == "point"

    def test_style_create(
        self,
        api_client: APIClient,
        setup_test_connection,
        mock_geoserver_for_styles,
        sample_sld_style: str,
    ) -> None:
        """Test creating a style."""
        conn_id = setup_test_connection
        response = api_client.post(
            f"/api/styles/{conn_id}/cite",
            {"name": "new_style", "content": sample_sld_style, "format": "sld"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        mock_geoserver_for_styles.create_style.assert_called_once()

    def test_style_get_detail(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_styles
    ) -> None:
        """Test getting style details."""
        conn_id = setup_test_connection
        response = api_client.get(f"/api/styles/{conn_id}/cite/point")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["style"]["name"] == "point"
        assert response.json()["content"] == "<sld/>"

    def test_style_update(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_styles
    ) -> None:
        """Test updating a style."""
        conn_id = setup_test_connection
        response = api_client.put(
            f"/api/styles/{conn_id}/cite/point",
            {"content": "<new-sld/>", "format": "sld"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        mock_geoserver_for_styles.update_style_content.assert_called_once()

    def test_style_delete(
        self, api_client: APIClient, setup_test_connection, mock_geoserver_for_styles
    ) -> None:
        """Test deleting a style."""
        conn_id = setup_test_connection
        response = api_client.delete(f"/api/styles/{conn_id}/cite/point")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_geoserver_for_styles.delete_style.assert_called_once()
