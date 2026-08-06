"""Coverage store views for GeoServer API."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import get_recurse_param, handle_geoserver_error


class CoverageStoreListView(APIView):
    """List and create coverage stores in a workspace."""

    def get(self, request, conn_id, workspace):
        """List all coverage stores."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            stores = client.list_coveragestores(workspace)
            return Response(stores)
        except GeoServerError:
            return Response([])

    def post(self, request, conn_id, workspace):
        """Create a new coverage store."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            name = request.data.get("name")
            store_type = request.data.get("type", "GeoTIFF")
            url = request.data.get("url")
            description = request.data.get("description", "")
            enabled = request.data.get("enabled", True)

            if not name:
                return Response(
                    {"error": "name is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.create_coveragestore(
                workspace, name, store_type, url, description, enabled
            )
            return Response(
                {"message": f"Coverage store {name} created"},
                status=status.HTTP_201_CREATED,
            )
        except GeoServerError as e:
            return handle_geoserver_error(e)


class CoverageStoreDetailView(APIView):
    """Get, update, or delete a coverage store."""

    def get(self, request, conn_id, workspace, store):
        """Get coverage store details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            cs = client.get_coveragestore(workspace, store)
            return Response({"coverageStore": cs})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def put(self, request, conn_id, workspace, store):
        """Update a coverage store."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            description = request.data.get("description")
            enabled = request.data.get("enabled")
            url = request.data.get("url")

            # Build update payload
            payload = {"coverageStore": {"name": store}}
            if description is not None:
                payload["coverageStore"]["description"] = description
            if enabled is not None:
                payload["coverageStore"]["enabled"] = enabled
            if url is not None:
                payload["coverageStore"]["url"] = url

            response = client._request(
                "PUT",
                f"/rest/workspaces/{workspace}/coveragestores/{store}.json",
                json=payload,
            )
            if response.status_code >= 400:
                raise GeoServerError(
                    f"Failed to update coverage store: {response.text}",
                    status_code=response.status_code,
                )
            return Response({"message": "Coverage store updated"})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def delete(self, request, conn_id, workspace, store):
        """Delete a coverage store."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            recurse = get_recurse_param(request)
            client.delete_coveragestore(workspace, store, recurse=recurse)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except GeoServerError as e:
            return handle_geoserver_error(e)
