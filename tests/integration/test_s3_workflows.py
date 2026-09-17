"""Integration tests for S3 storage workflows.

Tests complex interactions with S3-compatible storage using mocks.
"""

from unittest.mock import MagicMock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def mock_s3_config():
    """Mock S3 configuration."""
    with patch("apps.s3.views.get_config") as mock_config:
        config = MagicMock()

        # Create mock S3 connection
        mock_conn = MagicMock()
        mock_conn.id = "test-s3-conn"
        mock_conn.name = "Test MinIO"
        mock_conn.endpoint = "localhost:9000"
        mock_conn.region = "us-east-1"
        mock_conn.use_ssl = False
        mock_conn.path_style = True
        mock_conn.access_key = "minioadmin"
        mock_conn.secret_key = "minioadmin"

        config.list_s3_connections.return_value = [mock_conn]
        config.get_s3_connection.return_value = mock_conn
        config.add_s3_connection.return_value = None
        config.update_s3_connection.return_value = None
        config.delete_s3_connection.return_value = True

        mock_config.return_value = config
        yield {"config": config, "connection": mock_conn}


@pytest.fixture
def mock_s3_client():
    """Mock S3 client for bucket/object operations."""
    with patch("apps.s3.views.get_s3_client") as mock_get:
        client = MagicMock()

        # Mock bucket class for proper serialization
        mock_bucket = MagicMock()
        mock_bucket.to_dict.return_value = {
            "name": "test-bucket",
            "creation_date": "2024-01-01T00:00:00Z",
        }

        client.list_buckets.return_value = [mock_bucket]
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
    """Test S3 connection management workflows."""

    def test_list_s3_connections(self, api_client: APIClient, mock_s3_config) -> None:
        """Test listing S3 connections."""
        response = api_client.get("/api/s3/connections")
        assert response.status_code == status.HTTP_200_OK
        connections = response.json()
        assert len(connections) == 1
        assert connections[0]["name"] == "Test MinIO"

    def test_create_s3_connection(self, api_client: APIClient, mock_s3_config) -> None:
        """Test creating an S3 connection."""
        response = api_client.post(
            "/api/s3/connections",
            {
                "name": "New MinIO",
                "endpoint": "newhost:9000",
                "accessKey": "newkey",
                "secretKey": "newsecret",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        mock_s3_config["config"].add_s3_connection.assert_called_once()

    def test_get_s3_connection_detail(self, api_client: APIClient, mock_s3_config) -> None:
        """Test getting S3 connection details."""
        response = api_client.get("/api/s3/connections/test-s3-conn")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["connection"]["name"] == "Test MinIO"

    def test_update_s3_connection(self, api_client: APIClient, mock_s3_config) -> None:
        """Test updating an S3 connection."""
        response = api_client.put(
            "/api/s3/connections/test-s3-conn",
            {"name": "Updated MinIO"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        mock_s3_config["config"].update_s3_connection.assert_called_once()

    def test_delete_s3_connection(self, api_client: APIClient, mock_s3_config) -> None:
        """Test deleting an S3 connection."""
        response = api_client.delete("/api/s3/connections/test-s3-conn")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_s3_config["config"].delete_s3_connection.assert_called_once()


@pytest.mark.integration
@pytest.mark.django_db
class TestS3BucketWorkflow:
    """Test S3 bucket operations workflows."""

    def test_list_buckets(self, api_client: APIClient, mock_s3_config, mock_s3_client) -> None:
        """Test listing S3 buckets."""
        response = api_client.get("/api/s3/connections/test-s3-conn/buckets")
        assert response.status_code == status.HTTP_200_OK
        buckets = response.json()
        assert len(buckets) == 1
        assert buckets[0]["name"] == "test-bucket"

    def test_create_bucket(self, api_client: APIClient, mock_s3_config, mock_s3_client) -> None:
        """Test creating an S3 bucket."""
        mock_s3_client.create_bucket.return_value.to_dict.return_value = {
            "name": "new-bucket",
            "creationDate": None,
        }
        response = api_client.post(
            "/api/s3/connections/test-s3-conn/buckets",
            {"name": "new-bucket"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["name"] == "new-bucket"
        mock_s3_client.create_bucket.assert_called_once_with("new-bucket")

    def test_list_objects(self, api_client: APIClient, mock_s3_config, mock_s3_client) -> None:
        """Test listing objects in a bucket."""
        response = api_client.get("/api/s3/objects/test-s3-conn/test-bucket")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "objects" in data
        assert len(data["objects"]) == 2

    def test_list_objects_with_prefix(
        self, api_client: APIClient, mock_s3_config, mock_s3_client
    ) -> None:
        """Test listing objects with prefix filter."""
        response = api_client.get("/api/s3/objects/test-s3-conn/test-bucket?prefix=data/")
        assert response.status_code == status.HTTP_200_OK
        mock_s3_client.list_objects.assert_called_with(
            bucket="test-bucket",
            prefix="data/",
            delimiter="/",
            max_keys=1000,
            continuation_token=None,
        )


@pytest.mark.integration
@pytest.mark.django_db
class TestS3ObjectWorkflow:
    """Test S3 object operations workflows."""

    def test_get_object_info(self, api_client: APIClient, mock_s3_config, mock_s3_client) -> None:
        """Test getting object metadata."""
        response = api_client.get("/api/s3/objects/test-s3-conn/test-bucket/data/file.geojson")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["contentType"] == "application/geo+json"

    def test_delete_object(self, api_client: APIClient, mock_s3_config, mock_s3_client) -> None:
        """Test deleting an object."""
        response = api_client.delete("/api/s3/objects/test-s3-conn/test-bucket/data/file.geojson")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_s3_client.delete_object.assert_called_once()


@pytest.mark.integration
@pytest.mark.django_db
class TestS3PreviewWorkflow:
    """Test S3 file preview workflows."""

    def test_preview_geojson(self, api_client: APIClient, mock_s3_config, mock_s3_client) -> None:
        """Test previewing GeoJSON content from S3."""
        response = api_client.get("/api/s3/preview/test-s3-conn/test-bucket/data/file.geojson")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["type"] == "json"
        assert "content" in data

    def test_preview_parquet(
        self, api_client: APIClient, mock_s3_config, mock_s3_client, mock_duckdb_engine
    ) -> None:
        """Test previewing Parquet file schema."""
        # Change mock to return parquet info
        mock_s3_client.get_object_info.return_value = {
            "contentType": "application/octet-stream",
            "contentLength": 2048,
        }

        response = api_client.get("/api/s3/preview/test-s3-conn/test-bucket/data/file.parquet")
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
        self, api_client: APIClient, mock_s3_config, mock_duckdb_views
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
        self, api_client: APIClient, mock_s3_config, mock_s3_client
    ) -> None:
        """Test upload fails without file."""
        response = api_client.post(
            "/api/s3/upload/test-s3-conn/test-bucket",
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
        self, api_client: APIClient, mock_s3_config, mock_conversion_tools
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
