"""Views for GeoNode integration.

Provides endpoints for:
- GeoNode connection management
- Layer and map listing
- Resource browsing
"""

import shutil
import uuid
from pathlib import Path

import httpx
import requests
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import GeoNodeConnection, get_config
from apps.upload.views import _assemble_file, _get_session
from .client import GeoNodeClient, get_geonode_client
from .remote_service import get_remote_service
from .utilities import (
    RESOURCE_TYPE_DETAIL_REQUEST_MAP
)


class GeoNodeConnectionListView(APIView):
    """List and create GeoNode connections."""

    def get(self, request):
        """List all GeoNode connections."""
        config = get_config(request.user.id)
        connections = config.list_geonode_connections()
        return Response([
            {
                "id": c.id,
                "name": c.name,
                "url": c.url,
                "username": c.username,
            }
            for c in connections
        ])

    def post(self, request):
        """Create a new GeoNode connection."""
        data = request.data
        conn = GeoNodeConnection(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            url=data.get("url", ""),
            username=data.get("username", ""),
            password=data.get("password", ""),
            api_key=data.get("apiKey", ""),
        )

        config = get_config(request.user.id)
        config.add_geonode_connection(conn)

        return Response(
            {
                "id": conn.id,
                "name": conn.name,
                "url": conn.url,
            },
            status=status.HTTP_201_CREATED,
        )


class GeoNodeConnectionTestView(APIView):
    """Test GeoNode connection."""

    def post(self, request):
        """Test connection parameters."""
        data = request.data

        client = GeoNodeClient(
            url=data.get("url", ""),
            username=data.get("username"),
            password=data.get("password"),
            api_key=data.get("apiKey"),
        )

        success, message = client.test_connection()

        if success:
            return Response({"status": "success", "message": message})
        return Response(
            {"status": "error", "message": message},
            status=status.HTTP_400_BAD_REQUEST,
        )


class GeoNodeConnectionDetailView(APIView):
    """Get, update, or delete a GeoNode connection."""

    def get(self, request, conn_id):
        """Get connection details."""
        config = get_config(request.user.id)
        conn = config.get_geonode_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "connection": {
                "id": conn.id,
                "name": conn.name,
                "url": conn.url,
                "username": conn.username,
            }
        })

    def put(self, request, conn_id):
        """Update a connection."""
        config = get_config(request.user.id)
        conn = config.get_geonode_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data
        conn.name = data.get("name", conn.name)
        conn.url = data.get("url", conn.url)
        conn.username = data.get("username", conn.username)
        if "password" in data:
            conn.password = data["password"]
        if "apiKey" in data:
            conn.api_key = data["apiKey"]

        config.update_geonode_connection(conn)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        config = get_config(request.user.id)
        if not config.delete_geonode_connection(conn_id):
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(status=status.HTTP_204_NO_CONTENT)


class GeoNodeResourceListView(APIView):
    """List layers for a connection."""

    def get(self, request, conn_id, resource_type):
        """List all layers."""
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("pageSize", 20))
        category = request.query_params.get("category")
        owner = request.query_params.get("owner")

        try:
            client = get_geonode_client(conn_id, str(request.user.id))
            result = client.list_resources(
                resource_type=resource_type,
                page=page,
                page_size=page_size,
                category=category,
                owner=owner,
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


class GeoNodeResourceDetailView(APIView):
    """Get layer details."""

    def get(self, request, conn_id, resource_type, resource_id):
        """Get layer information."""
        resource_type = RESOURCE_TYPE_DETAIL_REQUEST_MAP.get(
            resource_type, resource_type
        )
        try:
            client = get_geonode_client(conn_id, str(request.user.id))
            resource = client.get_resource(
                resource_type, int(resource_id)
            )
            return Response(
                {resource_type.rstrip("s"): resource.to_dict()}
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return Response(
                    {"error": "Resource not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class GeoNodeUploadCompleteView(APIView):
    """Complete a chunked upload and publish to GeoNode."""

    def post(self, request):
        """Complete the upload.

        Expected body:
        {
            "sessionId": "uuid",
            "connectionId": "uuid",
            "title": "My Dataset",       // optional
            "abstract": "Description"    // optional
        }
        """
        session_id = request.data.get("sessionId")
        conn_id = request.data.get("connectionId")
        title = request.data.get("title")
        abstract = request.data.get("abstract")
        upload_type = request.data.get("uploadType", "dataset")

        if not session_id:
            return Response(
                {"error": "sessionId is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not conn_id:
            return Response(
                {"error": "connectionId is required"},
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

            with open(file_path, "rb") as f:
                data = f.read()

            client = get_geonode_client(conn_id, str(request.user.id))
            if upload_type == "document":
                upload_result = client.upload_document(
                    file=data,
                    filename=session.filename,
                    title=title,
                    abstract=abstract,
                )
            else:
                upload_result = client.upload_dataset(
                    file=data,
                    filename=session.filename,
                    title=title,
                    abstract=abstract,
                )

            return Response(
                {
                    "sessionId": session_id,
                    "filename": session.filename,
                    "fileSize": session.file_size,
                    "published": True,
                    **upload_result,
                },
                status=status.HTTP_201_CREATED,
            )

        except ValueError as e:
            return Response(
                {"error": str(e)}, status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {"error": f"Failed to upload to GeoNode: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        finally:
            upload_dir = Path(session.upload_dir)
            if upload_dir.exists():
                shutil.rmtree(upload_dir, ignore_errors=True)


class GeoNodeRemoteServiceListView(APIView):
    """List and create remote services on a GeoNode instance."""

    def get(self, request, conn_id):
        """Return all remote services from the GeoNode admin."""
        try:
            with get_remote_service(conn_id, str(request.user.id)) as svc:
                services = svc.list_services()
            return Response({"services": [s.to_dict() for s in services]})
        except PermissionError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
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


class GeoNodeRemoteServiceConnectView(APIView):
    """Connect a GeoServer instance as a remote service in GeoNode."""

    def post(self, request, conn_id, geoserver_conn_id):
        """Register the GeoServer connection as a WMS remote service.

        Looks up the GeoServer connection by ID, derives its WMS URL,
        and registers it in GeoNode admin.
        """
        from apps.core.config import get_config as get_core_config

        config = get_core_config(str(request.user.id))
        geoserver_conn = config.get_connection(geoserver_conn_id)
        if not geoserver_conn:
            return Response(
                {"error": "GeoServer connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        base = geoserver_conn.url.rstrip("/")
        wms_url = base if base.endswith("/wms") else f"{base}/wms"

        service_type = request.data.get("type", "WMS")

        try:
            with get_remote_service(conn_id, str(request.user.id)) as svc:
                svc.create_service(
                    base_url=wms_url,
                    service_type=service_type,
                )
            return Response(
                {"status": "created"}, status=status.HTTP_201_CREATED
            )
        except PermissionError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class GeoNodeRemoteServiceResourcesView(APIView):
    """List available resources from a remote service harvest page."""

    def get(self, request, conn_id, service_id):
        """Return resources available to import from the harvest page."""
        try:
            with get_remote_service(conn_id, str(request.user.id)) as svc:
                resources = svc.list_harvest_resources(int(service_id))
            return Response({"resources": resources})
        except PermissionError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
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


class GeoNodeRemoteServiceImportView(APIView):
    """Import resources from a remote service via the harvest page."""

    def post(self, request, conn_id, service_id):
        """Rescan and import resources. Pass resourceIds to import a subset."""
        resource_ids = request.data.get("resourceIds") or None
        try:
            with get_remote_service(conn_id, str(request.user.id)) as svc:
                resources = svc.import_resources(int(service_id), resource_ids)
            return Response({"resources": resources})
        except PermissionError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
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


class GeoNodeRemoteServiceDeleteView(APIView):
    """Delete a remote service from a GeoNode instance."""

    def delete(self, request, conn_id, service_id):
        """Delete a remote service by ID."""
        try:
            with get_remote_service(conn_id, str(request.user.id)) as svc:
                svc.delete_service(int(service_id))
            return Response(status=status.HTTP_204_NO_CONTENT)
        except PermissionError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
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


class GeoNodeTestView(APIView):
    """Test if a URL is reachable and return its HTTP status."""

    def get(self, request, conn_id):
        """Test if a URL is reachable and return its HTTP status."""
        config = get_config(request.user.id)
        conn = config.get_geonode_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        url_check = request.data.get("url", conn.url)
        try:
            response = requests.head(url_check, allow_redirects=True)
            if response.status_code in [200]:
                return Response(
                    {"status": response.status_code, "ok": True}
                )
        except requests.exceptions.ConnectionError:
            pass
        return Response(
            {"error": "Url can't be reached"},
            status=status.HTTP_404_NOT_FOUND
        )


class GeoNodeCategoryListView(APIView):
    """List resource categories."""

    def get(self, request, conn_id):
        """List all categories."""
        try:
            client = get_geonode_client(conn_id, str(request.user.id))
            categories = client.list_categories()
            return Response({"categories": categories})
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
