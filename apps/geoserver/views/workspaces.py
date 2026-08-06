"""Workspace views for GeoServer API."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import get_recurse_param, handle_geoserver_error


class WorkspaceListView(APIView):
    """List and create workspaces."""

    def get(self, request, conn_id):
        """List all workspaces."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            workspaces = client.list_workspaces()
            return Response(workspaces)
        except GeoServerError:
            return Response([])

    def post(self, request, conn_id):
        """Create a new workspace."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            name = request.data.get("name")
            isolated = request.data.get("isolated", False)
            default = request.data.get("default", False)

            if not name:
                return Response(
                    {"error": "name is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.create_workspace(name, isolated=isolated, default=default)
            return Response(
                {"message": f"Workspace {name} created"},
                status=status.HTTP_201_CREATED,
            )
        except GeoServerError as e:


            return handle_geoserver_error(e)


class WorkspaceDetailView(APIView):
    """Get, update, or delete a workspace."""

    def get(self, request, conn_id, workspace):
        """Get workspace details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            ws = client.get_workspace(workspace)
            return Response({"workspace": ws})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def put(self, request, conn_id, workspace):
        """Update a workspace."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            new_name = request.data.get("name")
            isolated = request.data.get("isolated")

            client.update_workspace(workspace, new_name=new_name, isolated=isolated)
            return Response({"message": "Workspace updated"})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def delete(self, request, conn_id, workspace):
        """Delete a workspace."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            recurse = get_recurse_param(request)
            client.delete_workspace(workspace, recurse=recurse)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except GeoServerError as e:
            return handle_geoserver_error(e)
