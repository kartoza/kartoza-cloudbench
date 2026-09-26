"""API tests for connection management endpoints.

Note: URL patterns in this project do NOT use trailing slashes.
"""

from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.s3.models import S3Connection


@pytest.fixture
def api_client(authenticated_api_client: APIClient) -> APIClient:
    """These endpoints require authentication, so use the logged-in client."""
    return authenticated_api_client


@pytest.mark.django_db
@pytest.mark.api
class TestGeoServerConnectionsAPI:
    """Tests for GeoServer connections endpoints."""

    def test_list_connections_empty(self, api_client: APIClient) -> None:
        """Test listing connections when empty."""
        response = api_client.get("/api/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_connection(self, api_client: APIClient) -> None:
        """Test creating a new GeoServer connection."""
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
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["name"] == "Test GeoServer"
        assert "id" in data

    def test_get_connection(self, api_client: APIClient) -> None:
        """Test getting a specific connection."""
        # Create first
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Get
        response = api_client.get(f"/api/connections/{conn_id}")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["id"] == conn_id

    def test_update_connection(self, api_client: APIClient) -> None:
        """Test updating a connection."""
        # Create first
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Update
        response = api_client.put(
            f"/api/connections/{conn_id}",
            {
                "name": "Updated GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "newpassword",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["name"] == "Updated GeoServer"

    def test_delete_connection(self, api_client: APIClient) -> None:
        """Test deleting a connection."""
        # Create first
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Delete
        response = api_client.delete(f"/api/connections/{conn_id}")
        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify deleted
        response = api_client.get(f"/api/connections/{conn_id}")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_get_nonexistent_connection(self, api_client: APIClient) -> None:
        """Test getting a nonexistent connection."""
        response = api_client.get("/api/connections/nonexistent")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_create_connection_validation(self, api_client: APIClient) -> None:
        """Test connection creation validation."""
        # Missing required fields
        response = api_client.post(
            "/api/connections",
            {"name": "Test"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
@pytest.mark.api
class TestS3ConnectionsAPI:
    """Tests for S3 connections endpoints."""

    @pytest.fixture
    def api_client(self, api_client: APIClient) -> APIClient:
        """S3 connection endpoints require IsAuthenticated and scope
        connections to a real owner FK, so a saved user is needed.
        """
        user = get_user_model().objects.create_user(username="s3-api-tester", password="x")
        api_client.force_authenticate(user=user)
        return api_client

    def test_list_s3_connections_empty(self, api_client: APIClient) -> None:
        """Test listing S3 connections when empty."""
        response = api_client.get("/api/s3/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_s3_connection(self, api_client: APIClient) -> None:
        """Test creating a new S3 connection."""
        response = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "accessKey": "minioadmin",
                "secretKey": "minioadmin",
                "useSSL": False,
                "pathStyle": True,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["name"] == "Test MinIO"
        assert data["bucket"] == "test-bucket"
        assert "id" in data

    def test_create_s3_connection_requires_bucket(self, api_client: APIClient) -> None:
        """A connection can't be created without a bucket."""
        response = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "accessKey": "minioadmin",
                "secretKey": "minioadmin",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_contact_email_is_saved_updated_and_cleared(self, api_client: APIClient) -> None:
        """The optional contact email round-trips; blank on edit clears it."""
        conn_id = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "contactEmail": " data@example.org ",
            },
            format="json",
        ).json()["id"]

        def contact_email():
            detail = api_client.get(f"/api/s3/connections/{conn_id}").json()
            return detail["connection"]["contactEmail"]

        assert contact_email() == "data@example.org"
        assert api_client.get("/api/s3/connections").json()[0]["contactEmail"] == (
            "data@example.org"
        )

        # An edit that doesn't mention it leaves it alone...
        api_client.put(f"/api/s3/connections/{conn_id}", {"name": "Renamed"}, format="json")
        assert contact_email() == "data@example.org"
        # ...while an explicit blank clears it (falling back to the server default).
        api_client.put(f"/api/s3/connections/{conn_id}", {"contactEmail": ""}, format="json")
        assert contact_email() == ""

    def test_invalid_contact_email_is_rejected(self, api_client: APIClient) -> None:
        payload = {"name": "Test MinIO", "endpoint": "localhost:9000", "bucket": "b"}
        response = api_client.post(
            "/api/s3/connections", {**payload, "contactEmail": "not-an-email"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        conn_id = api_client.post("/api/s3/connections", payload, format="json").json()["id"]
        response = api_client.put(
            f"/api/s3/connections/{conn_id}", {"contactEmail": "nope@"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_s3_connection(self, api_client: APIClient) -> None:
        """Test deleting an S3 connection."""
        # Create first
        create_response = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "accessKey": "minioadmin",
                "secretKey": "minioadmin",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Delete
        response = api_client.delete(f"/api/s3/connections/{conn_id}")
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_test_connection_falls_back_to_saved_keys(self, api_client: APIClient) -> None:
        """Testing an edited connection may omit the keys: the saved ones are used."""
        conn_id = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "accessKey": "saved-key",
                "secretKey": "saved-secret",
            },
            format="json",
        ).json()["id"]

        with patch("apps.s3.views.S3Client") as client_cls:
            client_cls.return_value.test_connection.return_value = (True, "ok")
            response = api_client.post(
                "/api/s3/connections/test",
                {
                    "connectionId": conn_id,
                    "endpoint": "localhost:9001",
                    "bucket": "other-bucket",
                    "secretKey": "retyped-secret",
                },
                format="json",
            )

        assert response.status_code == status.HTTP_200_OK
        kwargs = client_cls.call_args.kwargs
        # Edited fields are tested as typed; only the omitted key comes from the DB.
        assert (kwargs["endpoint"], kwargs["bucket"]) == ("localhost:9001", "other-bucket")
        assert (kwargs["access_key"], kwargs["secret_key"]) == ("saved-key", "retyped-secret")

    def test_test_connection_rejects_another_users_connection(self, api_client: APIClient) -> None:
        """connectionId can't be used to borrow someone else's saved keys."""
        other = get_user_model().objects.create_user(username="someone-else", password="x")
        conn = S3Connection.objects.create(
            owner=other,
            name="theirs",
            endpoint="localhost:9000",
            bucket="b",
            access_key="k",
            secret_key="s",
        )
        response = api_client.post(
            "/api/s3/connections/test",
            {"connectionId": str(conn.id), "endpoint": "localhost:9000", "bucket": "b"},
            format="json",
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
@pytest.mark.api
class TestGeoNodeConnectionsAPI:
    """Tests for GeoNode connections endpoints."""

    def test_list_geonode_connections(self, api_client: APIClient) -> None:
        """Test listing GeoNode connections."""
        response = api_client.get("/api/geonode/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_geonode_connection(self, api_client: APIClient) -> None:
        """Test creating a GeoNode connection."""
        response = api_client.post(
            "/api/geonode/connections",
            {
                "name": "Test GeoNode",
                "url": "http://localhost:8000",
                "username": "admin",
                "password": "admin",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
@pytest.mark.api
class TestIcebergConnectionsAPI:
    """Tests for Iceberg connections endpoints."""

    def test_list_iceberg_connections(self, api_client: APIClient) -> None:
        """Test listing Iceberg connections."""
        response = api_client.get("/api/iceberg/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_iceberg_connection(self, api_client: APIClient) -> None:
        """Test creating an Iceberg connection."""
        response = api_client.post(
            "/api/iceberg/connections",
            {
                "name": "Test Iceberg",
                "url": "http://localhost:8181",
                "warehouse": "s3://warehouse",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
@pytest.mark.api
class TestQFieldCloudConnectionsAPI:
    """Tests for QFieldCloud connections endpoints."""

    def test_list_qfieldcloud_connections(self, api_client: APIClient) -> None:
        """Test listing QFieldCloud connections."""
        response = api_client.get("/api/qfieldcloud/connections")
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
@pytest.mark.api
class TestMerginConnectionsAPI:
    """Tests for Mergin Maps connections endpoints."""

    def test_list_mergin_connections(self, api_client: APIClient) -> None:
        """Test listing Mergin Maps connections."""
        response = api_client.get("/api/mergin/connections")
        assert response.status_code == status.HTTP_200_OK
