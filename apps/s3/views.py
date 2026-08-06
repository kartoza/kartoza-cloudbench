"""Views for S3 storage management.

Provides endpoints for:
- S3 connection management
- Bucket listing
- Object browsing
- File preview and proxy
- DuckDB queries
- Format conversion
"""

import json
import mimetypes
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from django.http import HttpResponse, StreamingHttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import S3Connection, get_config

from .client import S3Client, S3ClientManager, get_s3_client
from .duckdb import get_duckdb_engine


# ============================================================================
# S3 Connection Views
# ============================================================================


class S3ConnectionListView(APIView):
    """List and create S3 connections."""

    def get(self, request):
        """List all S3 connections."""
        config = get_config(request.user.id)
        connections = config.list_s3_connections()
        return Response([
            {
                "id": c.id,
                "name": c.name,
                "endpoint": c.endpoint,
                "region": c.region,
                "useSsl": c.use_ssl,
                "pathStyle": c.path_style,
            }
            for c in connections
        ])

    def post(self, request):
        """Create a new S3 connection."""
        data = request.data
        conn = S3Connection(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            endpoint=data.get("endpoint", ""),
            access_key=data.get("accessKey", ""),
            secret_key=data.get("secretKey", ""),
            region=data.get("region", "us-east-1"),
            use_ssl=data.get("useSsl", True),
            path_style=data.get("pathStyle", True),
        )

        config = get_config(request.user.id)
        config.add_s3_connection(conn)

        return Response(
            {
                "id": conn.id,
                "name": conn.name,
                "endpoint": conn.endpoint,
            },
            status=status.HTTP_201_CREATED,
        )


class S3ConnectionTestView(APIView):
    """Test S3 connection without saving."""

    def post(self, request):
        """Test connection parameters."""
        data = request.data

        client = S3Client(
            endpoint=data.get("endpoint", ""),
            access_key=data.get("accessKey", ""),
            secret_key=data.get("secretKey", ""),
            region=data.get("region", "us-east-1"),
            use_ssl=data.get("useSsl", True),
            path_style=data.get("pathStyle", True),
            user_id=str(request.user.id),
        )

        success, message = client.test_connection()

        if success:
            return Response({"status": "success", "message": message})
        return Response(
            {"status": "error", "message": message},
            status=status.HTTP_400_BAD_REQUEST,
        )


class S3ConnectionDetailView(APIView):
    """Get, update, or delete an S3 connection."""

    def get(self, request, conn_id):
        """Get connection details."""
        config = get_config(request.user.id)
        conn = config.get_s3_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "connection": {
                "id": conn.id,
                "name": conn.name,
                "endpoint": conn.endpoint,
                "region": conn.region,
                "useSsl": conn.use_ssl,
                "pathStyle": conn.path_style,
            }
        })

    def put(self, request, conn_id):
        """Update a connection."""
        config = get_config(request.user.id)
        conn = config.get_s3_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data
        conn.name = data.get("name", conn.name)
        conn.endpoint = data.get("endpoint", conn.endpoint)
        if "accessKey" in data:
            conn.access_key = data["accessKey"]
        if "secretKey" in data:
            conn.secret_key = data["secretKey"]
        conn.region = data.get("region", conn.region)
        conn.use_ssl = data.get("useSsl", conn.use_ssl)
        conn.path_style = data.get("pathStyle", conn.path_style)

        config.update_s3_connection(conn)

        # Clear cached client
        S3ClientManager().remove_client(conn_id)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        config = get_config(request.user.id)
        if not config.delete_s3_connection(conn_id):
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Clear cached client
        S3ClientManager().remove_client(conn_id)

        return Response(status=status.HTTP_204_NO_CONTENT)


class S3ConnectionTestExistingView(APIView):
    """Test an existing S3 connection."""

    def post(self, request, conn_id):
        """Test the connection."""
        try:
            client = get_s3_client(conn_id)
            success, message = client.test_connection()

            if success:
                return Response({"status": "success", "message": message})
            return Response(
                {"status": "error", "message": message},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )


# ============================================================================
# Bucket and Object Views
# ============================================================================


class S3BucketListView(APIView):
    """List buckets for a connection."""

    def get(self, request, conn_id):
        """List all accessible buckets."""
        try:
            client = get_s3_client(conn_id)
            buckets = client.list_buckets()
            return Response({
                "buckets": [b.to_dict() for b in buckets]
            })
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class S3ObjectListView(APIView):
    """List objects in a bucket."""

    def get(self, request, conn_id, bucket):
        """List objects with optional prefix."""
        prefix = request.query_params.get("prefix", "")
        delimiter = request.query_params.get("delimiter", "/")
        max_keys = int(request.query_params.get("maxKeys", "1000"))
        continuation_token = request.query_params.get("continuationToken")

        try:
            client = get_s3_client(conn_id)
            result = client.list_objects(
                bucket=bucket,
                prefix=prefix,
                delimiter=delimiter,
                max_keys=max_keys,
                continuation_token=continuation_token,
            )
            return Response(result)
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class S3ObjectDetailView(APIView):
    """Get object details or delete object."""

    def get(self, request, conn_id, bucket, key):
        """Get object metadata."""
        try:
            client = get_s3_client(conn_id)
            info = client.get_object_info(bucket, key)
            return Response(info)
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    def delete(self, request, conn_id, bucket, key):
        """Delete an object."""
        try:
            client = get_s3_client(conn_id)
            client.delete_object(bucket, key)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


# ============================================================================
# Preview and Proxy Views
# ============================================================================


class S3PreviewView(APIView):
    """Preview file content."""

    def get(self, request, conn_id, bucket, key):
        """Preview file content based on type."""
        try:
            client = get_s3_client(conn_id)
            info = client.get_object_info(bucket, key)
            content_type = info.get("contentType", "application/octet-stream")
            size = info.get("contentLength", 0)

            # Determine preview type
            preview_type = "unknown"
            if content_type.startswith("text/"):
                preview_type = "text"
            elif content_type.startswith("image/"):
                preview_type = "image"
            elif content_type in ("application/json", "application/geo+json"):
                preview_type = "json"
            elif key.endswith(".parquet") or key.endswith(".geoparquet"):
                preview_type = "parquet"
            elif key.endswith(".csv"):
                preview_type = "csv"

            # For text/json, fetch content
            content = None
            if preview_type in ("text", "json") and size < 1024 * 1024:  # 1MB limit
                data = client.get_object(bucket, key)
                content = data.decode("utf-8", errors="replace")
                if preview_type == "json":
                    try:
                        content = json.loads(content)
                    except json.JSONDecodeError:
                        pass

            # For parquet, get schema
            schema = None
            if preview_type == "parquet":
                engine = get_duckdb_engine()
                s3_path = f"s3://{bucket}/{key}"
                schema = engine.get_parquet_schema(s3_path, conn_id)

            return Response({
                "type": preview_type,
                "contentType": content_type,
                "size": size,
                "content": content,
                "schema": schema,
            })
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class S3ProxyView(APIView):
    """Proxy S3 object content."""

    def get(self, request, conn_id, bucket, key):
        """Stream object content."""
        try:
            client = get_s3_client(conn_id)
            info = client.get_object_info(bucket, key)
            content_type = info.get("contentType", "application/octet-stream")

            # Stream the content
            stream = client.get_object_stream(bucket, key)

            def generate():
                for chunk in stream.iter_chunks():
                    yield chunk

            response = StreamingHttpResponse(
                generate(),
                content_type=content_type,
            )
            response["Content-Length"] = info.get("contentLength", 0)

            # Set filename for downloads
            filename = key.split("/")[-1]
            response["Content-Disposition"] = f'inline; filename="{filename}"'

            return response
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class S3GeoJSONView(APIView):
    """Get GeoJSON from spatial files."""

    def get(self, request, conn_id, bucket, key):
        """Convert spatial file to GeoJSON."""
        bbox = request.query_params.get("bbox")
        limit = int(request.query_params.get("limit", "1000"))

        try:
            client = get_s3_client(conn_id)
            s3_path = f"s3://{bucket}/{key}"

            # Parse bbox if provided
            bbox_tuple = None
            if bbox:
                parts = [float(x) for x in bbox.split(",")]
                if len(parts) == 4:
                    bbox_tuple = tuple(parts)

            engine = get_duckdb_engine()

            if key.endswith(".parquet") or key.endswith(".geoparquet"):
                geojson = engine.query_geoparquet(
                    s3_path,
                    conn_id,
                    bbox=bbox_tuple,
                    limit=limit,
                )
                return Response(geojson)

            # For other formats, use ogr2ogr if available
            return Response(
                {"error": "Format not supported for GeoJSON conversion"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


# ============================================================================
# DuckDB Query View
# ============================================================================


class S3DuckDBQueryView(APIView):
    """Execute DuckDB queries on S3 data."""

    def post(self, request):
        """Execute a DuckDB query.

        Expected body:
        {
            "connectionId": "s3-conn-id",
            "query": "SELECT * FROM read_parquet('s3://bucket/file.parquet')",
            "limit": 1000
        }
        """
        conn_id = request.data.get("connectionId")
        query = request.data.get("query")
        limit = request.data.get("limit", 1000)

        if not query:
            return Response(
                {"error": "Query is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            engine = get_duckdb_engine()
            result = engine.execute_query(query, conn_id, limit)
            return Response(result)
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


# ============================================================================
# Conversion Views
# ============================================================================


@dataclass
class ConversionJob:
    """Conversion job tracking."""

    id: str
    status: str  # pending, running, completed, failed
    source_path: str
    target_path: str
    format: str
    progress: float = 0.0
    error: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: str = ""


class ConversionJobManager:
    """Manager for conversion jobs."""

    _instance: "ConversionJobManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "ConversionJobManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._jobs: dict[str, ConversionJob] = {}
        return cls._instance

    def create_job(
        self,
        source_path: str,
        target_path: str,
        format: str,
    ) -> ConversionJob:
        """Create a new conversion job."""
        with self._lock:
            job = ConversionJob(
                id=str(uuid.uuid4()),
                status="pending",
                source_path=source_path,
                target_path=target_path,
                format=format,
            )
            self._jobs[job.id] = job
            return job

    def get_job(self, job_id: str) -> ConversionJob | None:
        """Get a job by ID."""
        return self._jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        status: str | None = None,
        progress: float | None = None,
        error: str | None = None,
    ) -> None:
        """Update job status."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                if status:
                    job.status = status
                    if status in ("completed", "failed"):
                        job.completed_at = datetime.utcnow().isoformat()
                if progress is not None:
                    job.progress = progress
                if error:
                    job.error = error


class S3ConversionToolsView(APIView):
    """Check available conversion tools."""

    def get(self, request):
        """Check which conversion tools are available."""
        tools = {}

        # Check ogr2ogr
        try:
            result = subprocess.run(
                ["ogr2ogr", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            tools["ogr2ogr"] = {
                "available": result.returncode == 0,
                "version": result.stdout.strip() if result.returncode == 0 else None,
            }
        except (FileNotFoundError, subprocess.TimeoutExpired):
            tools["ogr2ogr"] = {"available": False}

        # Check raster2pgsql
        try:
            result = subprocess.run(
                ["raster2pgsql", "-G"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            tools["raster2pgsql"] = {
                "available": True,
                "version": None,
            }
        except (FileNotFoundError, subprocess.TimeoutExpired):
            tools["raster2pgsql"] = {"available": False}

        # Check tippecanoe
        try:
            result = subprocess.run(
                ["tippecanoe", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            tools["tippecanoe"] = {
                "available": result.returncode == 0,
                "version": result.stderr.strip() if result.returncode == 0 else None,
            }
        except (FileNotFoundError, subprocess.TimeoutExpired):
            tools["tippecanoe"] = {"available": False}

        return Response({"tools": tools})


class S3ConversionJobsView(APIView):
    """Create and manage conversion jobs."""

    def post(self, request):
        """Create a new conversion job.

        Expected body:
        {
            "connectionId": "s3-conn-id",
            "sourceBucket": "source-bucket",
            "sourceKey": "path/to/file.gpkg",
            "targetBucket": "target-bucket",
            "targetKey": "path/to/output.parquet",
            "format": "parquet"
        }
        """
        conn_id = request.data.get("connectionId")
        source_bucket = request.data.get("sourceBucket")
        source_key = request.data.get("sourceKey")
        target_bucket = request.data.get("targetBucket")
        target_key = request.data.get("targetKey")
        format = request.data.get("format", "parquet")

        if not all([conn_id, source_bucket, source_key, target_bucket, target_key]):
            return Response(
                {"error": "Missing required parameters"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_path = f"s3://{source_bucket}/{source_key}"
        target_path = f"s3://{target_bucket}/{target_key}"

        manager = ConversionJobManager()
        job = manager.create_job(source_path, target_path, format)

        # Start conversion in background
        # TODO: Implement actual conversion with ogr2ogr

        return Response(
            {
                "jobId": job.id,
                "status": job.status,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def get(self, request, job_id=None):
        """Get job status."""
        if not job_id:
            return Response(
                {"error": "Job ID required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        manager = ConversionJobManager()
        job = manager.get_job(job_id)

        if not job:
            return Response(
                {"error": "Job not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "error": job.error,
            "createdAt": job.created_at,
            "completedAt": job.completed_at,
        })


class S3UploadView(APIView):
    """Upload files to S3."""

    def post(self, request, conn_id, bucket):
        """Upload a file to S3.

        Expects multipart/form-data with:
        - file: The file to upload
        - key: Optional key path (defaults to filename)
        """
        if "file" not in request.FILES:
            return Response(
                {"error": "No file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        uploaded_file = request.FILES["file"]
        key = request.data.get("key", uploaded_file.name)

        # Determine content type
        content_type = uploaded_file.content_type
        if not content_type or content_type == "application/octet-stream":
            content_type, _ = mimetypes.guess_type(key)

        try:
            client = get_s3_client(conn_id)
            result = client.put_object(
                bucket=bucket,
                key=key,
                body=uploaded_file.read(),
                content_type=content_type,
            )
            return Response({
                "key": key,
                "etag": result.get("etag"),
                "bucket": bucket,
            }, status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class S3PresignedURLView(APIView):
    """Generate presigned URLs."""

    def post(self, request, conn_id, bucket, key):
        """Generate a presigned URL for an object."""
        expiration = request.data.get("expiration", 3600)
        method = request.data.get("method", "get_object")

        try:
            client = get_s3_client(conn_id)
            url = client.generate_presigned_url(
                bucket=bucket,
                key=key,
                expiration=expiration,
                method=method,
            )
            return Response({"url": url})
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
