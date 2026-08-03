"""Views for PostgreSQL/PostGIS integration.

Provides endpoints for:
- Managing pg_service.conf entries
- Schema browsing
- Table data viewing
- Query execution
- Data import via ogr2ogr
"""

import subprocess
import time
from pathlib import Path

from celery.result import AsyncResult
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import PGService
from apps.upload.views import _assemble_file, _get_session

from .client import (
    add_pg_service,
    delete_pg_service,
    get_pg_client,
    list_pg_services,
    update_pg_service,
)
from .tasks import run_raster_import, run_vector_import


# === PostgreSQL Services ===


class PGServiceListView(APIView):
    """List and create PostgreSQL services."""

    def get(self, request):
        """List all PostgreSQL services."""
        return Response([
            {
                "name": svc.name,
                "host": svc.host,
                "port": svc.port,
                "dbname": svc.dbname,
                "user": svc.user,
                "sslmode": svc.sslmode,
            }
            for svc in list_pg_services(str(request.user.id))
        ])

    def post(self, request):
        """Create a new PostgreSQL service."""
        name = request.data.get("name")
        if not name:
            return Response(
                {"error": "name is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        user_id = str(request.user.id)
        try:
            get_pg_client(name, user_id)
            return Response(
                {"error": f"Service '{name}' already exists"},
                status=status.HTTP_409_CONFLICT,
            )
        except ValueError:
            pass

        service = PGService(
            name=name,
            host=request.data.get("host", "localhost"),
            port=int(request.data.get("port", 5432)),
            dbname=request.data.get("dbname", ""),
            user=request.data.get("user", ""),
            password=request.data.get("password", ""),
            sslmode=request.data.get("sslmode", ""),
        )
        add_pg_service(service, user_id)

        return Response(
            {"name": service.name, "host": service.host, "port": service.port,
             "dbname": service.dbname, "user": service.user},
            status=status.HTTP_201_CREATED,
        )


class PGServiceDetailView(APIView):
    """Get, update, or delete a PostgreSQL service."""

    def get(self, request, name):
        """Get service details."""
        try:
            client = get_pg_client(name, str(request.user.id))
        except ValueError:
            return Response(
                {"error": "Service not found"}, status=status.HTTP_404_NOT_FOUND
            )
        service = client.service
        return Response({
            "name": service.name,
            "host": service.host,
            "port": service.port,
            "dbname": service.dbname,
            "user": service.user,
            "sslmode": service.sslmode,
            "connectionString": service.connection_string(),
        })

    def put(self, request, name):
        """Update a service."""
        user_id = str(request.user.id)
        try:
            client = get_pg_client(name, user_id)
        except ValueError:
            return Response(
                {"error": "Service not found"}, status=status.HTTP_404_NOT_FOUND
            )
        data = request.data
        updated = client.service.model_copy(update={
            k: (int(data[k]) if k == "port" else data[k])
            for k in ("host", "port", "dbname", "user", "password", "sslmode")
            if k in data
        })
        update_pg_service(updated, user_id)
        return Response({
            "name": updated.name,
            "host": updated.host,
            "port": updated.port,
            "dbname": updated.dbname,
            "user": updated.user,
        })

    def delete(self, request, name):
        """Delete a service."""
        if not delete_pg_service(name, str(request.user.id)):
            return Response(
                {"error": "Service not found"}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class PGServiceTestView(APIView):
    """Test a PostgreSQL service connection."""

    def get(self, request, name):
        """Test connection to a service."""
        try:
            client = get_pg_client(name, str(request.user.id))
        except ValueError:
            return Response(
                {"error": "Service not found"}, status=status.HTTP_404_NOT_FOUND
            )
        success, message = client.test_connection()
        if not success:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response({"success": success, "message": message})

    def post(self, request, name):
        """Test connection to a service."""
        try:
            client = get_pg_client(name, str(request.user.id))
        except ValueError:
            return Response(
                {"error": "Service not found"}, status=status.HTTP_404_NOT_FOUND
            )
        success, message = client.test_connection()
        return Response({"success": success, "message": message})


# === Stats ===


class PGSchemaStatsView(APIView):
    """Get statistics for a specific schema."""

    def get(self, request, service_name, schema_name):
        try:
            stats = get_pg_client(service_name, str(request.user.id)).get_schema_stats(schema_name)
            return Response(stats)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class PGServiceStatsView(APIView):
    """Get server statistics for a PostgreSQL service."""

    def get(self, request, name):
        try:
            stats = get_pg_client(name, str(request.user.id)).get_stats()
            return Response(stats)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

class PGDatabaseNameListView(APIView):
    """List database names for a PostgreSQL service."""

    def get(self, request, service_name):
        try:
            databases = get_pg_client(service_name, str(request.user.id)).list_databases()
            return Response(databases)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class PGSchemaNameListView(APIView):
    """List schema names for a given database (lightweight, for dropdowns)."""

    def get(self, request, service_name, database_name):
        try:
            names = get_pg_client(service_name, str(request.user.id)).list_schema_names(database_name)
            return Response(names)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class PGSchemaListView(APIView):
    """List schemas in a database."""

    def get(self, request, service_name):
        """List all schemas."""
        try:
            schemas = get_pg_client(service_name, str(request.user.id)).list_schemas()
            return Response({"schemas": schemas})
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class PGTableListView(APIView):
    """List tables in a schema."""

    def get(self, request, service_name, schema_name):
        """List all tables in a schema."""
        try:
            tables = get_pg_client(service_name, str(request.user.id)).list_tables(schema_name)
            return Response({"tables": tables})
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class PGTableDetailView(APIView):
    """Get table details including columns."""

    def get(self, request, service_name, schema_name, table_name):
        """Get table columns and metadata."""
        try:
            client = get_pg_client(service_name, str(request.user.id))
            columns = client.get_table_columns(schema_name, table_name)
            row_count = client.get_table_row_count(schema_name, table_name)
            return Response({
                "schema": schema_name,
                "table": table_name,
                "columns": columns,
                "rowCount": row_count,
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class PGTableDataView(APIView):
    """Get table data with pagination."""

    def get(self, request, service_name, schema_name, table_name):
        """Get paginated table data.

        Query params:
        - limit: Number of rows (default 100)
        - offset: Number of rows to skip (default 0)
        - orderBy: Column to order by
        """
        try:
            limit = int(request.query_params.get("limit", 100))
            offset = int(request.query_params.get("offset", 0))
            order_by = request.query_params.get("orderBy")

            data = get_pg_client(service_name, str(request.user.id)).get_table_data(
                schema_name, table_name, limit, offset, order_by
            )

            return Response(data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Database error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


# === Query Execution ===


class PGQueryView(APIView):
    """Execute SQL queries."""

    def post(self, request, service_name):
        """Execute a SQL query.

        Expected body:
        {
            "query": "SELECT * FROM my_table",
            "limit": 1000
        }
        """
        query = request.data.get("query")
        if not query:
            return Response(
                {"error": "query is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        limit = request.data.get("limit", 1000)

        try:
            t0 = time.monotonic()
            result = get_pg_client(service_name, str(request.user.id)).execute_query(query, limit=limit)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            return Response({
                "success": True,
                "sql": query,
                "result": {
                    "columns": result["columns"],
                    "rows": result["rows"],
                    "row_count": result["rowCount"],
                    "duration_ms": elapsed_ms,
                },
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response(
                {"error": f"Query error: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


# === Data Import ===

_CELERY_STATE_MAP = {
    "PENDING": "pending",
    "STARTED": "running",
    "SUCCESS": "completed",
    "FAILURE": "failed",
}


class PGImportView(APIView):
    """Import data to PostgreSQL via ogr2ogr."""

    def post(self, request):
        service_name = request.data.get("serviceName")
        file_path = request.data.get("filePath")
        target_schema = request.data.get("schema", "public")
        table_name = request.data.get("tableName")
        source_layer = request.data.get("sourceLayer")
        srid = request.data.get("srid")
        overwrite = request.data.get("overwrite", False)
        cleanup_source = bool(request.data.get("cleanupSource", False))

        if not service_name or not file_path:
            return Response(
                {"error": "serviceName and filePath are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            service = get_pg_client(service_name, str(request.user.id)).service
        except ValueError:
            return Response(
                {"error": f"Service not found: {service_name}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not Path(file_path).exists():
            return Response(
                {"error": f"File not found: {file_path}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pg_conn = f"PG:host={service.host} port={service.port} dbname={service.dbname} user={service.user} password={service.password}"
        cmd = ["ogr2ogr", "-f", "PostgreSQL", pg_conn, file_path]
        cmd.append("-overwrite" if overwrite else "-append")

        if table_name:
            cmd.extend(["-nln", f"{target_schema}.{table_name}"])
        if source_layer:
            cmd.append(source_layer)
        if srid:
            cmd.extend(["-t_srs", f"EPSG:{srid}"])

        result = run_vector_import(cmd, file_path, delete_source=cleanup_source)
        if result.get("status") == "completed":
            return Response({"status": "completed"}, status=status.HTTP_200_OK)
        return Response(
            {"status": "failed", "error": result.get("error", "")},
            status=status.HTTP_400_BAD_REQUEST,
        )


class PGImportStatusView(APIView):
    """Get import job status."""

    def get(self, request, job_id):
        result = AsyncResult(job_id)
        job_status = _CELERY_STATE_MAP.get(result.state, result.state.lower())

        resp: dict = {"id": job_id, "status": job_status}

        if result.state == "SUCCESS" and isinstance(result.result, dict):
            if result.result.get("status") == "failed":
                resp["status"] = "failed"
                resp["error"] = result.result.get("error", "")
        elif result.state == "FAILURE":
            resp["error"] = str(result.result)

        return Response(resp)


class PGImportRasterView(APIView):
    """Import raster data to PostgreSQL via raster2pgsql."""

    def post(self, request):
        service_name = request.data.get("serviceName")
        file_path = request.data.get("filePath")
        target_schema = request.data.get("schema", "public")
        table_name = request.data.get("tableName")
        srid = request.data.get("srid", 4326)
        tile_size = request.data.get("tileSize", "100x100")

        if not service_name or not file_path or not table_name:
            return Response(
                {"error": "serviceName, filePath, and tableName are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            service = get_pg_client(service_name, str(request.user.id)).service
        except ValueError:
            return Response(
                {"error": f"Service not found: {service_name}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not Path(file_path).exists():
            return Response(
                {"error": f"File not found: {file_path}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raster_cmd = [
            "raster2pgsql",
            "-s", str(srid),
            "-I", "-C", "-M",
            "-t", tile_size,
            file_path,
            f"{target_schema}.{table_name}",
        ]
        conn_params = {
            "host": service.host,
            "port": service.port,
            "user": service.user,
            "password": service.password,
            "dbname": service.dbname,
        }

        result = run_raster_import(raster_cmd, conn_params, file_path)
        if result.get("status") == "completed":
            return Response({"status": "completed"}, status=status.HTTP_200_OK)
        return Response(
            {"status": "failed", "error": result.get("error", "")},
            status=status.HTTP_400_BAD_REQUEST,
        )


class PGDetectLayersView(APIView):
    """Detect layers in a file for import."""

    def post(self, request):
        """Detect layers in a geospatial file.

        Expected body:
        {
            "filePath": "/path/to/file.gpkg"
        }
        """
        file_path = request.data.get("filePath")
        if not file_path:
            return Response(
                {"error": "filePath is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        if not Path(file_path).exists():
            return Response(
                {"error": f"File not found: {file_path}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Use ogrinfo to list layers
            result = subprocess.run(
                ["ogrinfo", "-so", "-al", file_path],
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                return Response(
                    {"error": f"ogrinfo failed: {result.stderr}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Parse output to extract layer names
            layers = []
            for line in result.stdout.split("\n"):
                if line.startswith("Layer name:"):
                    layer_name = line.split(":", 1)[1].strip()
                    layers.append(layer_name)

            return Response({"layers": layers, "file": file_path})

        except FileNotFoundError:
            return Response(
                {"error": "ogrinfo not found. Please install GDAL."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except Exception as e:
            return Response(
                {"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class OGR2OGRStatusView(APIView):
    """Check ogr2ogr and raster2pgsql availability and capabilities."""

    def get(self, request):
        def run(cmd):
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                return r.returncode == 0, r.stdout + r.stderr
            except FileNotFoundError:
                return False, ""

        # ogr2ogr version
        ogr_available, ogr_out = run(["ogr2ogr", "--version"])
        ogr_version = ogr_out.strip().split("\n")[0] if ogr_available else ""

        # raster2pgsql version
        raster_available, raster_out = run(["raster2pgsql", "-?"])
        raster_version = ""
        if raster_available:
            for line in raster_out.split("\n"):
                if "RELEASE" in line or "version" in line.lower():
                    raster_version = line.strip()
                    break

        # Supported formats via ogrinfo
        supported_formats: list[str] = []
        vector_extensions: dict[str, str] = {}
        raster_extensions: dict[str, str] = {}
        supported_extensions: dict[str, str] = {}

        if ogr_available:
            _, fmt_out = run(["ogrinfo", "--formats"])
            for line in fmt_out.split("\n"):
                line = line.strip()
                if not line or line.startswith("Supported Formats"):
                    continue
                supported_formats.append(line)

            # Common vector formats
            vector_extensions = {
                ".gpkg": "GeoPackage",
                ".shp": "ESRI Shapefile",
                ".geojson": "GeoJSON",
                ".json": "GeoJSON",
                ".kml": "KML",
                ".csv": "CSV",
                ".gml": "GML",
                ".sqlite": "SQLite",
                ".dxf": "DXF",
            }
            # Common raster formats
            raster_extensions = {
                ".tif": "GeoTIFF",
                ".tiff": "GeoTIFF",
                ".png": "PNG",
                ".jpg": "JPEG",
                ".jpeg": "JPEG",
                ".img": "HFA",
                ".vrt": "VRT",
                ".nc": "NetCDF",
                ".asc": "AAIGrid",
            }
            supported_extensions = {**vector_extensions, **raster_extensions}

        return Response({
            "available": ogr_available,
            "version": ogr_version,
            "raster_available": raster_available,
            "raster_version": raster_version,
            "supported_formats": supported_formats,
            "supported_extensions": supported_extensions,
            "vector_extensions": vector_extensions,
            "raster_extensions": raster_extensions,
        })


class PGUploadCompleteView(APIView):
    """Assemble a chunked upload for PG import — file is kept for detect-layers."""

    def post(self, request):
        """Assemble uploaded chunks and return the file path.

        Expected body:
        {
            "sessionId": "uuid"
        }
        """
        session_id = request.data.get("sessionId")
        if not session_id:
            return Response(
                {"error": "sessionId is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = _get_session(session_id)
        if not session:
            return Response(
                {"error": "Upload session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not session.is_complete():
            missing = session.total_chunks - len(session.received_chunks)
            return Response(
                {"error": f"Upload incomplete. Missing {missing} chunks."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            file_path = _assemble_file(session)
            return Response({
                "sessionId": session_id,
                "filename": session.filename,
                "fileSize": session.file_size,
                "path": str(file_path),
            })
        except Exception as e:
            return Response(
                {"error": f"Failed to assemble file: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

