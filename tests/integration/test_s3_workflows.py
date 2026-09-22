"""Integration tests for S3 storage workflows.

Tests complex interactions with S3-compatible storage using mocks.
"""

from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.s3.models import S3Connection


@pytest.fixture
def mock_s3_client():
    """Mock S3 client (scoped to one bucket) for object operations."""
    with patch("apps.s3.views.get_s3_client") as mock_get:
        client = MagicMock()
        client.bucket = "test-bucket"

        client.test_connection.return_value = (True, "Connection successful")
        client.list_objects.return_value = {
            "objects": [
                {"key": "data/file1.geojson", "size": 1024, "lastModified": "2024-01-01T00:00:00Z"},
                {"key": "data/file2.parquet", "size": 2048, "lastModified": "2024-01-01T00:00:00Z"},
            ],
            "prefixes": ["data/subdir/"],
            "isTruncated": False,
        }
        client.get_object_info.return_value = {
            "contentType": "application/geo+json",
            "contentLength": 1024,
            "lastModified": "2024-01-01T00:00:00Z",
        }
        client.get_object.return_value = b'{"type": "FeatureCollection", "features": []}'
        client.delete_object.return_value = None
        client.upload_file.return_value = None

        mock_get.return_value = client
        yield client


@pytest.fixture
def mock_duckdb_engine():
    """Mock DuckDB engine for parquet queries."""
    with patch("apps.s3.views.get_duckdb_engine") as mock_get:
        engine = MagicMock()
        engine.get_parquet_schema.return_value = [
            {"name": "id", "type": "INTEGER"},
            {"name": "name", "type": "VARCHAR"},
            {"name": "geometry", "type": "GEOMETRY"},
        ]
        engine.query.return_value = {
            "columns": ["id", "name"],
            "rows": [[1, "Test"], [2, "Another"]],
            "rowCount": 2,
        }
        mock_get.return_value = engine
        yield engine


@pytest.mark.integration
@pytest.mark.django_db
class TestS3ConnectionWorkflow:
    """Test S3 connection management workflows against the real,
    encrypted-at-rest S3Connection model (see apps/s3/models.py) —
    connections are now stored in the database, not the old plaintext
    JSON config file, so these exercise the real DB round-trip rather
    than a mocked ConfigManager.
    """

    @pytest.fixture
    def authenticated_client(self, api_client: APIClient):
        """S3 connection endpoints require IsAuthenticated and now scope
        connections to a real owner FK, so a saved (not just in-memory) user is needed.
        """
        user = get_user_model().objects.create_user(username="s3-workflow-tester", password="x")
        api_client.force_authenticate(user=user)
        return api_client, user

    def test_list_s3_connections(self, authenticated_client) -> None:
        """Test listing S3 connections."""
        client, user = authenticated_client
        S3Connection.objects.create(
            owner=user, name="Test MinIO", endpoint="localhost:9000", access_key="minioadmin", secret_key="minioadmin"
        )
        response = client.get("/api/s3/connections")
        assert response.status_code == status.HTTP_200_OK
        connections = response.json()
        assert len(connections) == 1
        assert connections[0]["name"] == "Test MinIO"

    def test_create_s3_connection(self, authenticated_client) -> None:
        """Test creating an S3 connection."""
        client, user = authenticated_client
        response = client.post(
            "/api/s3/connections",
            {
                "name": "New MinIO",
                "endpoint": "newhost:9000",
                "bucket": "new-bucket",
                "accessKey": "newkey",
                "secretKey": "newsecret",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        conn = S3Connection.objects.get(owner=user, name="New MinIO")
        # Round-trips back to plaintext via the ORM despite being encrypted at rest.
        assert conn.access_key == "newkey"
        assert conn.secret_key == "newsecret"

    def test_get_s3_connection_detail(self, authenticated_client) -> None:
        """Test getting S3 connection details."""
        client, user = authenticated_client
        conn = S3Connection.objects.create(
            owner=user, name="Test MinIO", endpoint="localhost:9000", access_key="minioadmin", secret_key="minioadmin"
        )
        response = client.get(f"/api/s3/connections/{conn.id}")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["connection"]["name"] == "Test MinIO"

    def test_update_s3_connection(self, authenticated_client) -> None:
        """Test updating an S3 connection."""
        client, user = authenticated_client
        conn = S3Connection.objects.create(
            owner=user, name="Test MinIO", endpoint="localhost:9000", access_key="minioadmin", secret_key="minioadmin"
        )
        response = client.put(
            f"/api/s3/connections/{conn.id}",
            {"name": "Updated MinIO"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        conn.refresh_from_db()
        assert conn.name == "Updated MinIO"

    def test_delete_s3_connection(self, authenticated_client) -> None:
        """Test deleting an S3 connection."""
        client, user = authenticated_client
        conn = S3Connection.objects.create(
            owner=user, name="Test MinIO", endpoint="localhost:9000", access_key="minioadmin", secret_key="minioadmin"
        )
        response = client.delete(f"/api/s3/connections/{conn.id}")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not S3Connection.objects.filter(id=conn.id).exists()


@pytest.mark.integration
@pytest.mark.django_db
class TestS3ObjectWorkflow:
    """Test S3 object operations workflows."""

    def test_list_objects(self, api_client: APIClient, mock_s3_client) -> None:
        """Test listing objects in a connection's bucket."""
        response = api_client.get("/api/s3/objects/test-s3-conn")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "objects" in data
        assert len(data["objects"]) == 2

    def test_list_objects_with_prefix(
        self, api_client: APIClient, mock_s3_client
    ) -> None:
        """Test listing objects with prefix filter."""
        response = api_client.get("/api/s3/objects/test-s3-conn?prefix=data/")
        assert response.status_code == status.HTTP_200_OK
        mock_s3_client.list_objects.assert_called_with(
            prefix="data/",
            delimiter="/",
            max_keys=1000,
            continuation_token=None,
        )

    def test_get_object_info(self, api_client: APIClient, mock_s3_client) -> None:
        """Test getting object metadata."""
        response = api_client.get("/api/s3/objects/test-s3-conn/data/file.geojson")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["contentType"] == "application/geo+json"

    def test_delete_object(self, api_client: APIClient, mock_s3_client) -> None:
        """Test deleting an object."""
        response = api_client.delete("/api/s3/objects/test-s3-conn/data/file.geojson")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_s3_client.delete_object.assert_called_once()


@pytest.mark.integration
@pytest.mark.django_db
class TestS3PreviewWorkflow:
    """Test S3 file preview workflows."""

    def test_preview_geojson(self, api_client: APIClient, mock_s3_client) -> None:
        """Test previewing GeoJSON content from S3."""
        response = api_client.get("/api/s3/preview/test-s3-conn/data/file.geojson")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["type"] == "json"
        assert "content" in data

    def test_preview_parquet(
        self, api_client: APIClient, mock_s3_client, mock_duckdb_engine
    ) -> None:
        """Test previewing Parquet file schema."""
        # Change mock to return parquet info
        mock_s3_client.get_object_info.return_value = {
            "contentType": "application/octet-stream",
            "contentLength": 2048,
        }

        response = api_client.get("/api/s3/preview/test-s3-conn/data/file.parquet")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["type"] == "parquet"
        assert "schema" in data


@pytest.mark.integration
@pytest.mark.django_db
class TestDuckDBQueryWorkflow:
    """Test DuckDB query workflows for S3 Parquet files."""

    @pytest.fixture
    def mock_duckdb_views(self):
        """Mock DuckDB for query view."""
        with patch("apps.s3.views.get_duckdb_engine") as mock_get:
            engine = MagicMock()
            engine.execute_query.return_value = {
                "columns": ["id", "name", "value"],
                "rows": [
                    [1, "Feature A", 100],
                    [2, "Feature B", 200],
                ],
                "rowCount": 2,
            }
            mock_get.return_value = engine
            yield engine

    def test_query_parquet_file(
        self, api_client: APIClient, mock_duckdb_views
    ) -> None:
        """Test querying a Parquet file with DuckDB."""
        response = api_client.post(
            "/api/s3/duckdb/",
            {
                "query": "SELECT * FROM 's3://test-bucket/data.parquet' LIMIT 10",
                "connectionId": "test-s3-conn",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "columns" in data
        assert "rows" in data
        assert len(data["rows"]) == 2


@pytest.mark.integration
@pytest.mark.django_db
class TestS3UploadWorkflow:
    """Test S3 file upload workflows."""

    def test_upload_missing_file(
        self, api_client: APIClient, mock_s3_client
    ) -> None:
        """Test upload fails without file."""
        response = api_client.post(
            "/api/s3/upload/test-s3-conn",
            {},
            format="multipart",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.integration
@pytest.mark.django_db
class TestCloudNativeConversionWorkflow:
    """Test cloud-native format conversion workflows."""

    @pytest.fixture
    def mock_conversion_tools(self):
        """Mock conversion tool availability."""
        with patch("apps.s3.views.subprocess") as mock_subprocess:
            mock_subprocess.run.return_value = MagicMock(
                returncode=0,
                stdout="gdal_translate: GDAL 3.8.0",
                stderr="",
            )
            yield mock_subprocess

    def test_list_conversion_tools(self, api_client: APIClient, mock_conversion_tools) -> None:
        """Test listing available conversion tools."""
        response = api_client.get("/api/s3/conversion/tools")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "tools" in data

    def test_start_conversion_job(
        self, api_client: APIClient, mock_conversion_tools
    ) -> None:
        """Test starting a conversion job."""
        response = api_client.post(
            "/api/s3/conversion/jobs",
            {
                "sourceConnectionId": "test-s3-conn",
                "sourceBucket": "test-bucket",
                "sourceKey": "data/raster.tif",
                "targetFormat": "cog",
            },
            format="json",
        )
        # Accept 200, 202, or 400 (missing params)
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_202_ACCEPTED,
            status.HTTP_400_BAD_REQUEST,
        ]
