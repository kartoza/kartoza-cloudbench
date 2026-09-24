"""Views for S3 storage management.

Provides endpoints for:
- S3 connection management (each connection is scoped to one bucket)
- Object browsing
- File preview and proxy
- DuckDB queries
- Format conversion
"""

import contextlib
import json
import mimetypes
import subprocess
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import PurePosixPath

import httpx
from django.conf import settings
from django.core.exceptions import ValidationError
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import portolan
from .client import S3Client, S3ClientManager, get_s3_client
from .cng_lite import expire_stalled_job
from .cog import (
    start_conversion as start_cog_conversion,
)
from .cog import (
    start_geopackage_conversion as start_cog_geopackage_conversion,
)
from .duckdb import get_duckdb_engine
from .models import CngLiteJob, LayerCollection, S3Connection
from .pmtiles import (
    cancel_geopackage_inspection,
    inspect_geopackage,
    prepare_shapefile,
    start_geopackage_conversion,
)
from .pmtiles import (
    start_conversion as start_pmtiles_conversion,
)

# ============================================================================
# S3 Connection Views
# ============================================================================


def _get_owned_connection(request, conn_id):
    """Looks up a connection owned by the requesting user, or None."""
    try:
        return S3Connection.objects.filter(owner=request.user, id=conn_id).first()
    except (ValueError, ValidationError):
        return None


class S3ConnectionListView(APIView):
    """List and create S3 connections.

    A connection is scoped to exactly one bucket (see S3Connection).
    """

    def get(self, request):
        """List all S3 connections."""
        connections = S3Connection.objects.filter(owner=request.user)
        return Response(
            [
                {
                    "id": str(c.id),
                    "name": c.name,
                    "endpoint": c.endpoint,
                    "bucket": c.bucket,
                    "region": c.region,
                    "useSSL": c.use_ssl,
                    "pathStyle": c.path_style,
                }
                for c in connections
            ]
        )

    def post(self, request):
        """Create a new S3 connection."""
        data = request.data
        bucket = data.get("bucket", "").strip()
        if not bucket:
            return Response(
                {"error": "Bucket is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        conn = S3Connection.objects.create(
            owner=request.user,
            name=data.get("name", ""),
            endpoint=data.get("endpoint", ""),
            bucket=bucket,
            access_key=data.get("accessKey", ""),
            secret_key=data.get("secretKey", ""),
            region=data.get("region", "us-east-1"),
            use_ssl=data.get("useSSL", True),
            path_style=data.get("pathStyle", True),
        )

        return Response(
            {
                "id": str(conn.id),
                "name": conn.name,
                "endpoint": conn.endpoint,
                "bucket": conn.bucket,
            },
            status=status.HTTP_201_CREATED,
        )


class S3ConnectionTestView(APIView):
    """Test S3 connection without saving."""

    def post(self, request):
        """Test connection parameters."""
        data = request.data
        bucket = data.get("bucket", "").strip()
        if not bucket:
            return Response(
                {"status": "error", "message": "Bucket is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        access_key = data.get("accessKey") or ""
        secret_key = data.get("secretKey") or ""
        # Editing a saved connection: the dialog never receives its keys, so
        # it leaves them out unless retyped — fall back to the saved ones.
        conn_id = data.get("connectionId")
        if conn_id and not (access_key and secret_key):
            saved = _get_owned_connection(request, conn_id)
            if not saved:
                return Response(
                    {"error": "Connection not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            access_key = access_key or saved.access_key
            secret_key = secret_key or saved.secret_key

        client = S3Client(
            endpoint=data.get("endpoint", ""),
            bucket=bucket,
            access_key=access_key,
            secret_key=secret_key,
            region=data.get("region", "us-east-1"),
            use_ssl=data.get("useSSL", True),
            path_style=data.get("pathStyle", True),
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
        conn = _get_owned_connection(request, conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "connection": {
                    "id": str(conn.id),
                    "name": conn.name,
                    "endpoint": conn.endpoint,
                    "bucket": conn.bucket,
                    "region": conn.region,
                    "useSSL": conn.use_ssl,
                    "pathStyle": conn.path_style,
                }
            }
        )

    def put(self, request, conn_id):
        """Update a connection."""
        conn = _get_owned_connection(request, conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data
        conn.name = data.get("name", conn.name)
        conn.endpoint = data.get("endpoint", conn.endpoint)
        if data.get("bucket", "").strip():
            conn.bucket = data["bucket"].strip()
        # The edit dialog never receives the existing accessKey/secretKey back
        # from the API, so it always submits them as "" unless the user
        # retypes them. Treat blank as "leave unchanged" instead of wiping
        # the credential.
        if data.get("accessKey"):
            conn.access_key = data["accessKey"]
        if data.get("secretKey"):
            conn.secret_key = data["secretKey"]
        conn.region = data.get("region", conn.region)
        conn.use_ssl = data.get("useSSL", conn.use_ssl)
        conn.path_style = data.get("pathStyle", conn.path_style)
        conn.save()

        # Clear cached client
        S3ClientManager().remove_client(conn_id, request.user)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        conn = _get_owned_connection(request, conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        conn.delete()

        # Clear cached client
        S3ClientManager().remove_client(conn_id, request.user)

        return Response(status=status.HTTP_204_NO_CONTENT)


class S3ConnectionTestExistingView(APIView):
    """Test an existing S3 connection."""

    def post(self, request, conn_id):
        """Test the connection."""
        try:
            client = get_s3_client(conn_id, request.user)
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
# Object Views
# ============================================================================


class S3ObjectListView(APIView):
    """List objects in a connection's bucket."""

    def get(self, request, conn_id):
        """List objects with optional prefix."""
        prefix = request.query_params.get("prefix", "")
        delimiter = request.query_params.get("delimiter", "/")
        max_keys = int(request.query_params.get("maxKeys", "1000"))
        continuation_token = request.query_params.get("continuationToken")

        try:
            client = get_s3_client(conn_id, request.user)
            result = client.list_objects(
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

    def get(self, request, conn_id, key):
        """Get object metadata."""
        try:
            client = get_s3_client(conn_id, request.user)
            info = client.get_object_info(key)
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

    def delete(self, request, conn_id, key):
        """Delete an object, or every object under it if `key` is a folder prefix."""
        try:
            client = get_s3_client(conn_id, request.user)
            if key.endswith("/"):
                client.delete_prefix(key)
            else:
                client.delete_object(key)
            portolan.prune_root_catalog(client, key)
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

    def get(self, request, conn_id, key):
        """Preview file content based on type."""
        try:
            client = get_s3_client(conn_id, request.user)
            info = client.get_object_info(key)
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
                data = client.get_object(key)
                content = data.decode("utf-8", errors="replace")
                if preview_type == "json":
                    with contextlib.suppress(json.JSONDecodeError):
                        content = json.loads(content)

            # For parquet, get schema
            schema = None
            if preview_type == "parquet":
                engine = get_duckdb_engine()
                s3_path = f"s3://{client.bucket}/{key}"
                schema = engine.get_parquet_schema(s3_path, conn_id, request.user)

            return Response(
                {
                    "type": preview_type,
                    "contentType": content_type,
                    "size": size,
                    "content": content,
                    "schema": schema,
                }
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


class S3ProxyView(APIView):
    """Proxy S3 object content."""

    def get(self, request, conn_id, key):
        """Stream object content."""
        try:
            client = get_s3_client(conn_id, request.user)
            info = client.get_object_info(key)
            content_type = info.get("contentType", "application/octet-stream")

            # Stream the content
            stream = client.get_object_stream(key)

            def generate():
                yield from stream.iter_chunks()

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

    def get(self, request, conn_id, key):
        """Convert spatial file to GeoJSON."""
        bbox = request.query_params.get("bbox")
        limit = int(request.query_params.get("limit", "1000"))

        try:
            client = get_s3_client(conn_id, request.user)
            s3_path = f"s3://{client.bucket}/{key}"

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
                    user=request.user,
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
            result = engine.execute_query(query, conn_id, limit, user=request.user)
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
    _jobs: dict[str, ConversionJob]

    def __new__(cls) -> "ConversionJobManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._jobs = {}
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

    def get(self, _request):
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

        tools["cloudnativegis"] = {"available": False, "tool": "CloudNativeGIS"}
        cloudnativegis_url = getattr(settings, "CLOUDNATIVEGIS_URL", "").rstrip("/")
        if cloudnativegis_url:
            try:
                response = httpx.get(
                    f"{cloudnativegis_url}/health",
                    timeout=2.0,
                    follow_redirects=False,
                )
                tools["cloudnativegis"]["available"] = response.status_code == 200
            except (httpx.HTTPError, httpx.InvalidURL):
                pass

        # COG conversion runs inside the CloudNativeGIS Lite container, not locally.
        tools["gdal"] = {
            "available": tools["cloudnativegis"]["available"],
            "tool": "GDAL (via CloudNativeGIS)",
        }

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

        try:
            conversion_id = uuid.UUID(job_id)
        except ValueError:
            return Response({"error": "Job not found"}, status=status.HTTP_404_NOT_FOUND)
        cng_lite_job = CngLiteJob.objects.filter(
            pk=conversion_id, owner_id=request.user.username
        ).first()
        if cng_lite_job:
            expire_stalled_job(cng_lite_job)
            return Response(cng_lite_job.to_dict())

        manager = ConversionJobManager()
        job = manager.get_job(job_id)

        if not job:
            return Response(
                {"error": "Job not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "id": job.id,
                "status": job.status,
                "progress": job.progress,
                "error": job.error,
                "createdAt": job.created_at,
                "completedAt": job.completed_at,
            }
        )


class S3UploadView(APIView):
    """Upload files to S3."""

    def post(self, request, conn_id):
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
        companion_files = request.FILES.getlist("companions")
        key = request.data.get("key", uploaded_file.name)

        # Determine content type
        content_type = uploaded_file.content_type
        if not content_type or content_type == "application/octet-stream":
            content_type, _ = mimetypes.guess_type(key)

        try:
            client = get_s3_client(conn_id, request.user)
            target_format = request.data.get("targetFormat")
            license_id = request.data.get("license") or portolan.DEFAULT_LICENSE
            if str(request.data.get("convert", "false")).lower() == "true" and target_format in (
                "pmtiles",
                "cog",
            ):
                try:
                    if target_format == "pmtiles":
                        job = start_pmtiles_conversion(
                            uploaded_file,
                            key,
                            conn_id,
                            request.user,
                            companion_files,
                            license_id,
                        )
                        message = "File accepted for CloudNativeGIS conversion"
                    else:
                        if companion_files:
                            return Response(
                                {"error": "COG conversion accepts a single file."},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        job = start_cog_conversion(
                            uploaded_file, key, conn_id, request.user, license_id
                        )
                        message = "File accepted for CloudNativeGIS conversion"
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                return Response(
                    {
                        "success": True,
                        "message": message,
                        "key": job.output_key,
                        "size": job.input_size,
                        "conversionJobId": str(job.id),
                    },
                    status=status.HTTP_202_ACCEPTED,
                )
            upload_size = uploaded_file.size
            if companion_files:
                with tempfile.TemporaryFile() as archive:
                    try:
                        prepare_shapefile(
                            uploaded_file,
                            archive,
                            PurePosixPath(uploaded_file.name).stem,
                            companion_files,
                        )
                    except ValueError as exc:
                        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                    upload_size = archive.tell()
                    archive.seek(0)
                    key = str(PurePosixPath(key).with_suffix(".zip"))
                    result = client.put_object(
                        key=key, body=archive, content_type="application/zip"
                    )
            else:
                result = client.put_object(
                    key=key,
                    body=uploaded_file.read(),
                    content_type=content_type,
                )
            return Response(
                {
                    "key": key,
                    "etag": result.get("etag"),
                    "bucket": client.bucket,
                    "success": True,
                    "message": "File uploaded to S3",
                    "size": upload_size,
                },
                status=status.HTTP_201_CREATED,
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


class S3GeoPackageInspectView(APIView):
    """Stage a GeoPackage upload and report its contents, before conversion starts."""

    def post(self, request, conn_id):
        if "file" not in request.FILES:
            return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)
        uploaded_file = request.FILES["file"]
        key = request.data.get("key", uploaded_file.name)
        license_id = request.data.get("license") or portolan.DEFAULT_LICENSE
        try:
            job, layers, raster_tables = inspect_geopackage(
                uploaded_file, key, conn_id, request.user, license_id
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except httpx.HTTPError as exc:
            return Response(
                {"error": f"Could not inspect the GeoPackage: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(
            {
                "jobId": str(job.id),
                "layers": layers,
                "rasterTables": raster_tables,
                "key": job.output_key,
            }
        )


class S3GeoPackageConvertView(APIView):
    """Confirm which layers/tables to convert for a previously-inspected GeoPackage job."""

    def post(self, request, job_id):
        layers = request.data.get("layers")
        target_format = request.data.get("format", "pmtiles")
        try:
            if target_format == "cog":
                job = start_cog_geopackage_conversion(job_id, request.user, layers)
            else:
                job = start_geopackage_conversion(job_id, request.user, layers)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "success": True,
                "message": "File accepted for CloudNativeGIS conversion",
                "key": job.output_key,
                "size": job.input_size,
                "conversionJobId": str(job.id),
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def delete(self, request, job_id):
        """Cancel a previously-inspected GeoPackage job, removing its staged S3 upload."""
        try:
            cancel_geopackage_inspection(job_id, request.user)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class S3LayerCollectionListView(APIView):
    """List the current user's layer collections (one per GeoPackage upload)."""

    def get(self, request):
        connection_id = request.query_params.get("connectionId")
        bucket = request.query_params.get("bucket")
        collections = LayerCollection.objects.filter(owner_id=request.user.username)
        if connection_id:
            collections = collections.filter(connection_id=connection_id)
        if bucket:
            collections = collections.filter(bucket=bucket)
        return Response([collection.to_dict() for collection in collections])


class S3LayerCollectionDetailView(APIView):
    """A single layer collection with its full layer list."""

    def get(self, request, collection_id):
        collection = LayerCollection.objects.filter(
            pk=collection_id, owner_id=request.user.username
        ).first()
        if not collection:
            return Response({"error": "Collection not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(collection.to_dict(include_items=True))


class S3PresignedURLView(APIView):
    """Generate presigned URLs."""

    def post(self, request, conn_id, key):
        """Generate a presigned URL for an object."""
        expiration = request.data.get("expiration", 3600)
        method = request.data.get("method", "get_object")

        try:
            client = get_s3_client(conn_id, request.user)
            url = client.generate_presigned_url(
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
