"""Views for GeoNode integration.

Provides endpoints for:
- GeoNode connection management
- Layer and map listing
- Resource browsing
"""

import logging
import shutil
import subprocess
import uuid
from pathlib import Path

import httpx
from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import GeoNodeConnection, get_config
from apps.upload.views import _assemble_file, _staged_session

from .client import GeoNodeClient, apply_metadata_later, get_geonode_client
from .remote_service import get_remote_service
from .utilities import RESOURCE_TYPE_DETAIL_REQUEST_MAP

logger = logging.getLogger(__name__)


def _api_key(data) -> str:
    """The GeoNode API token from a request body.

    The connection dialog sends it as ``token``; older callers sent ``apiKey``.
    Accept either so the token isn't silently dropped (which left token auth
    unauthenticated).
    """
    return data.get("apiKey") or data.get("token") or ""


def _gpkg_layers(path: Path) -> list[str]:
    """The layer names in a GeoPackage, in file order (empty for a non-gpkg)."""
    if path.suffix.lower() != ".gpkg":
        return []
    result = subprocess.run(
        ["ogrinfo", "-so", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or "ogrinfo failed to read the GeoPackage")
    layers = []
    for line in result.stdout.splitlines():
        # ogrinfo lists layers as "1: name (Geometry Type)".
        line = line.strip()
        if line and line[0].isdigit() and ":" in line:
            name = line.split(":", 1)[1].strip()
            name = name.rsplit(" (", 1)[0].strip()
            if name:
                layers.append(name)
    return layers


def _extract_gpkg_layer(source: Path, layer: str, dest: Path) -> None:
    """Write a single-layer GeoPackage holding just ``layer`` from ``source``.

    GeoNode's importer takes a whole GeoPackage with no way to choose a layer,
    and 500s when the layers disagree on CRS. Uploading one extracted layer at
    a time keeps every upload single-layer and single-CRS.
    """
    result = subprocess.run(
        ["ogr2ogr", "-f", "GPKG", str(dest), str(source), layer],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or f"Could not extract layer {layer!r}")


class GeoNodeConnectionListView(APIView):
    """List and create GeoNode connections."""

    def get(self, request):
        """List all GeoNode connections."""
        config = get_config(request.user)
        connections = config.list_geonode_connections()
        return Response(
            [
                {
                    "id": c.id,
                    "name": c.name,
                    "url": c.url,
                    "username": c.username,
                }
                for c in connections
            ]
        )

    def post(self, request):
        """Create a new GeoNode connection."""
        data = request.data
        conn = GeoNodeConnection(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            url=data.get("url", ""),
            username=data.get("username", ""),
            password=data.get("password", ""),
            api_key=_api_key(data),
        )

        config = get_config(request.user)
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
            api_key=_api_key(data) or None,
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
        config = get_config(request.user)
        conn = config.get_geonode_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "connection": {
                    "id": conn.id,
                    "name": conn.name,
                    "url": conn.url,
                    "username": conn.username,
                }
            }
        )

    def put(self, request, conn_id):
        """Update a connection."""
        config = get_config(request.user)
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
        if "apiKey" in data or "token" in data:
            conn.api_key = _api_key(data)

        config.update_geonode_connection(conn)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        config = get_config(request.user)
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
            client = get_geonode_client(conn_id, request.user)
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
        resource_type = RESOURCE_TYPE_DETAIL_REQUEST_MAP.get(resource_type, resource_type)
        try:
            client = get_geonode_client(conn_id, request.user)
            resource = client.get_resource(resource_type, int(resource_id))
            return Response({resource_type.rstrip("s"): resource.to_dict()})
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


class GeoNodeUploadDetectLayersView(APIView):
    """List the layers of a GeoPackage staged for GeoNode, for the layer picker.

    GeoPackage datasets are the one GeoNode upload staged on CloudBench's
    disk (through /api/upload/init and /chunk) instead of relayed: reading
    their layers and splitting them takes the whole file. Everything else
    goes through /api/upload/relay. A single-layer GeoPackage returns its
    one layer and needs no picker.
    """

    def post(self, request):
        session = _staged_session(request, request.data.get("sessionId") or "")
        if not session:
            return Response({"error": "Upload session not found"}, status=status.HTTP_404_NOT_FOUND)
        if not session.is_complete():
            missing = session.total_chunks - len(session.received_chunks)
            return Response(
                {"error": f"Upload incomplete. Missing {missing} chunks."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            file_path = _assemble_file(session)
            return Response({"filename": session.filename, "layers": _gpkg_layers(file_path)})
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class GeoNodeUploadCompleteView(APIView):
    """Publish a GeoPackage staged for GeoNode, one dataset per chosen layer.

    Expected body: {"sessionId", "connectionId", "title"?, "abstract"?,
    "sourceLayers"?: [...]} (all layers when not given).
    """

    def post(self, request):
        conn_id = request.data.get("connectionId")
        title = request.data.get("title") or None
        abstract = request.data.get("abstract") or None
        if not conn_id:
            return Response(
                {"error": "connectionId is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        session = _staged_session(request, request.data.get("sessionId") or "")
        if not session:
            return Response({"error": "Upload session not found"}, status=status.HTTP_404_NOT_FOUND)
        if not session.filename.lower().endswith(".gpkg"):
            return Response(
                {"error": "Only GeoPackage datasets are staged; upload others through the relay"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not session.is_complete():
            missing = session.total_chunks - len(session.received_chunks)
            return Response(
                {"error": f"Upload incomplete. Missing {missing} chunks."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            file_path = _assemble_file(session)
            client = get_geonode_client(conn_id, request.user)
            # GeoNode's importer takes no layer choice and 500s on layers of
            # unlike CRS: a GeoPackage of several layers goes one extracted
            # layer at a time.
            layers = _gpkg_layers(file_path)
            requested = request.data.get("sourceLayers") or request.data.get("sourceLayer")
            if isinstance(requested, str):
                requested = [requested]
            if len(layers) <= 1:
                datasets = [self._upload(client, file_path, title, abstract)]
                chosen = layers
            else:
                chosen = [layer for layer in (requested or layers) if layer in layers]
                if not chosen:
                    return Response(
                        {
                            "error": "None of the requested layers are in the GeoPackage",
                            "layers": layers,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                datasets = []
                for layer in chosen:
                    dest = file_path.parent / f"{file_path.stem}__{layer}.gpkg"
                    _extract_gpkg_layer(file_path, layer, dest)
                    one_title = title if len(chosen) == 1 else None
                    datasets.append(
                        {"layer": layer, **self._upload(client, dest, one_title, abstract)}
                    )
            return Response(
                {
                    "sessionId": str(session.session_id),
                    "filename": session.filename,
                    "fileSize": session.file_size,
                    "published": True,
                    "layers": chosen,
                    "datasets": datasets,
                    **datasets[0],
                },
                status=status.HTTP_201_CREATED,
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response(
                {"error": f"Failed to upload to GeoNode: {e}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        finally:
            shutil.rmtree(session.upload_dir, ignore_errors=True)

    @staticmethod
    def _upload(client, path: Path, title, abstract) -> dict:
        """Send one GeoPackage to GeoNode, streamed from disk."""
        with path.open("rb") as f:
            result = client.upload_dataset(
                iter(lambda: f.read(1024 * 1024), b""),
                path.name,
                path.stat().st_size,
                settings.UPLOAD_RELAY_RESPONSE_TIMEOUT,
                title=title,
                abstract=abstract,
            )
        if (title or abstract) and result.get("execution_id"):
            apply_metadata_later(client, result["execution_id"], title, abstract)
        return result


class GeoNodeRemoteServiceListView(APIView):
    """List and create remote services on a GeoNode instance."""

    def get(self, request, conn_id):
        """Return all remote services from the GeoNode admin."""
        try:
            with get_remote_service(conn_id, request.user) as svc:
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

        config = get_core_config(request.user)
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
            with get_remote_service(conn_id, request.user) as svc:
                svc.create_service(
                    base_url=wms_url,
                    service_type=service_type,
                )
            return Response({"status": "created"}, status=status.HTTP_201_CREATED)
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
            with get_remote_service(conn_id, request.user) as svc:
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
            with get_remote_service(conn_id, request.user) as svc:
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
            with get_remote_service(conn_id, request.user) as svc:
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
        config = get_config(request.user)
        conn = config.get_geonode_connection(conn_id)
        if not conn:
            return Response({"error": "Connection not found"}, status=status.HTTP_404_NOT_FOUND)

        url_check = request.data.get("url", conn.url)
        try:
            response = httpx.head(url_check, follow_redirects=True, timeout=10)
            if response.status_code in [200]:
                return Response({"status": response.status_code, "ok": True})
        except httpx.TransportError:
            pass
        return Response({"error": "Url can't be reached"}, status=status.HTTP_404_NOT_FOUND)


class GeoNodeCategoryListView(APIView):
    """List resource categories."""

    def get(self, request, conn_id):
        """List all categories."""
        try:
            client = get_geonode_client(conn_id, request.user)
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
