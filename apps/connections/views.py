"""Views for connections app - GeoServer connection CRUD."""

import httpx
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import Connection, get_config
from apps.core.managers import make_client
from apps.core.permissions import missing, refusal
from apps.geoserver.client import GeoServerClient

from .serializers import ConnectionResponseSerializer, ConnectionSerializer


def test_geoserver_connection(
    url: str, username: str, password: str, permissions: bool = True
) -> tuple[bool, str, dict]:
    """Test a GeoServer connection, and that its user may do what CloudBench does.

    With `permissions`, a user who can log in but may not read or write
    through the REST API is refused, saying which (GeoServerClient.
    check_permissions); `info` then holds them as "permissions".

    Returns:
        Tuple of (success, message, server_info)
    """
    try:
        # Ensure URL ends properly
        base_url = url.rstrip("/")
        if not base_url.endswith("/geoserver") and "/geoserver" not in base_url:
            base_url += "/geoserver"

        # Try to get server version
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{base_url}/rest/about/version.json",
                auth=httpx.BasicAuth(username, password),
            )

            if response.status_code == 200:
                data = response.json()
                version_info = data.get("about", {}).get("resource", [])
                geoserver_version = None
                for resource in version_info:
                    if resource.get("@name") == "GeoServer":
                        geoserver_version = resource.get("Version", "Unknown")
                        break

                info = {"version": geoserver_version}
                if not permissions:
                    return True, "Connection successful", info
                return _with_permissions(base_url, username, password, info)
            elif response.status_code == 401:
                return False, "Authentication failed - invalid credentials", {}
            elif response.status_code == 403:
                # Logged in, but the REST API is for administrators only (by
                # default): say which permissions this user lacks.
                if permissions:
                    return _with_permissions(base_url, username, password, {})
                return False, "Access forbidden - check user permissions", {}
            elif response.status_code == 404:
                return False, "GeoServer REST API not found at this URL", {}
            elif response.status_code == 503:
                server_header = response.headers.get("server", "").lower()
                if "nginx" in server_header:
                    return False, "Service unavailable - nginx proxy cannot reach GeoServer", {}
                return False, "Service unavailable - GeoServer may be starting up", {}
            else:
                return False, f"Connection failed with status {response.status_code}", {}

    except httpx.ConnectError:
        return False, "Domain not found or host unreachable - check the URL", {}
    except httpx.TimeoutException:
        return False, "Connection timed out", {}
    except Exception as e:
        return False, f"Connection error: {str(e)}", {}


def _with_permissions(base_url, username, password, info) -> tuple[bool, str, dict]:
    connection = Connection(
        id="test", name="test", url=base_url, username=username, password=password
    )
    checked = GeoServerClient(connection).check_permissions()
    info["permissions"] = [p.to_dict() for p in checked]
    if missing(checked):
        return False, refusal("This user", missing(checked)), info
    return True, "Connection successful", info


def _refused(url: str, username: str, password: str) -> Response | None:
    """A 400 if these settings can't connect, or their user may not do what CloudBench does.

    A connection is only saved once it works: one that can't, or can't
    write through the REST API, would just fail later, in every upload,
    workspace or style it's used for.
    """
    success, message, info = test_geoserver_connection(url, username, password)
    if success:
        return None
    return Response(
        {"error": message, "permissions": info.get("permissions", [])},
        status=status.HTTP_400_BAD_REQUEST,
    )


class ConnectionListView(APIView):
    """List all connections or create a new one."""

    def get(self, request):
        """List all GeoServer connections."""
        config_manager = get_config(request.user)
        connections = config_manager.list_connections()
        serializer = ConnectionResponseSerializer(connections, many=True)
        return Response(serializer.data)

    def post(self, request):
        """Create a new GeoServer connection."""
        serializer = ConnectionSerializer(data=request.data)
        config_manager = get_config(request.user)
        if serializer.is_valid():
            conn = serializer.create(serializer.validated_data)
            refused = _refused(conn.url, conn.username, conn.password)
            if refused:
                return refused
            config_manager.add_connection(conn)

            response_serializer = ConnectionResponseSerializer(conn)
            return Response(response_serializer.data, status=status.HTTP_201_CREATED)

        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)


class ConnectionTestView(APIView):
    """Test a connection without saving it."""

    def post(self, request):
        """Test connection credentials.

        Expected body:
        {
            "url": "http://localhost:8080/geoserver",
            "username": "admin",
            "password": "geoserver"
        }
        """
        url = request.data.get("url")
        username = request.data.get("username")
        password = request.data.get("password")

        if not all([url, username, password]):
            return Response(
                {"error": "url, username, and password are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        success, message, info = test_geoserver_connection(url, username, password)

        return Response(
            {
                "success": success,
                "message": message,
                "info": info,
            }
        )


class ConnectionDetailView(APIView):
    """Get, update, or delete a specific connection."""

    def get(self, request, conn_id):
        """Get a specific connection by ID."""
        config_manager = get_config(request.user)
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return Response({"error": "Connection not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = ConnectionResponseSerializer(conn)
        return Response(serializer.data)

    def put(self, request, conn_id):
        """Update a connection."""
        config_manager = get_config(request.user)
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return Response({"error": "Connection not found"}, status=status.HTTP_404_NOT_FOUND)

        saved = (conn.url, conn.username, conn.password)
        serializer = ConnectionSerializer(conn, data=request.data, partial=True)
        if serializer.is_valid():
            updated_conn = serializer.update(conn, serializer.validated_data)
            # Renaming needs no re-test.
            if (updated_conn.url, updated_conn.username, updated_conn.password) != saved:
                refused = _refused(updated_conn.url, updated_conn.username, updated_conn.password)
                if refused:
                    return refused
            config_manager.update_connection(updated_conn)

            response_serializer = ConnectionResponseSerializer(updated_conn)
            return Response(response_serializer.data)

        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, conn_id):
        """Delete a connection."""
        config_manager = get_config(request.user)
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return Response({"error": "Connection not found"}, status=status.HTTP_404_NOT_FOUND)

        config_manager.remove_connection(conn_id)

        return Response(status=status.HTTP_204_NO_CONTENT)


class ConnectionTestExistingView(APIView):
    """Test an existing saved connection."""

    def _test(self, request, conn_id, permissions=True):
        config_manager = get_config(request.user)
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return Response({"error": "Connection not found"}, status=status.HTTP_404_NOT_FOUND)
        success, message, info = test_geoserver_connection(
            conn.url, conn.username, conn.password, permissions
        )
        return success, message, info

    def get(self, request, conn_id):
        # Whether it's reachable (the tree asks): its permissions are the POST's.
        success, message, info = self._test(request, conn_id, permissions=False)
        if not success:
            return Response({"error": "Url can't be reached"}, status=status.HTTP_404_NOT_FOUND)
        else:
            return Response({"status": 200, "ok": True})

    def post(self, request, conn_id):
        success, message, info = self._test(request, conn_id)
        return Response({"success": success, "message": message, "info": info})


class ConnectionInfoView(APIView):
    """Get detailed server information for a connection."""

    def get(self, request, conn_id):
        """Get GeoServer server information."""
        config_manager = get_config(request.user)
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return Response({"error": "Connection not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            client = make_client(conn.url, conn.username, conn.password)

            # Get server version
            version_response = client.get("/rest/about/version.json")
            version_data = version_response.json() if version_response.status_code == 200 else {}

            # Get manifest (detailed component versions)
            manifest_response = client.get("/rest/about/manifest.json")
            manifest_data = manifest_response.json() if manifest_response.status_code == 200 else {}

            # Get status
            status_response = client.get("/rest/about/status.json")
            status_data = status_response.json() if status_response.status_code == 200 else {}

            return Response(
                {
                    "version": version_data,
                    "manifest": manifest_data,
                    "status": status_data,
                }
            )

        except Exception as e:
            return Response(
                {"error": f"Failed to get server info: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
