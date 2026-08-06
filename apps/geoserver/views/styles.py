"""Style views for GeoServer API."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import handle_geoserver_error


class StyleListView(APIView):
    """List and create styles in a workspace."""

    def get(self, request, conn_id, workspace):
        """List all styles."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            styles = client.list_styles(workspace)
            return Response(styles)
        except GeoServerError:
            return Response([])

    def post(self, request, conn_id, workspace):
        """Create a new style."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            name = request.data.get("name")
            content = request.data.get("content")
            style_format = request.data.get("format", "sld")

            if not name or not content:
                return Response(
                    {"error": "name and content are required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.create_style(name, content, style_format, workspace)
            return Response(
                {"message": f"Style {name} created"},
                status=status.HTTP_201_CREATED,
            )
        except GeoServerError as e:
            return handle_geoserver_error(e)


class StyleDetailView(APIView):
    """Get, update, or delete a style."""

    def get(self, request, conn_id, workspace, style):
        """Get style details and content."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            style_info = client.get_style(style, workspace)
            content, style_format = client.get_style_content(style, workspace)
            return Response({
                "style": style_info,
                "content": content,
                "format": style_format,
            })
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def put(self, request, conn_id, workspace, style):
        """Update style content."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            content = request.data.get("content")
            style_format = request.data.get("format", "sld")

            if not content:
                return Response(
                    {"error": "content is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.update_style_content(style, content, style_format, workspace)
            return Response({"message": "Style updated"})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def delete(self, request, conn_id, workspace, style):
        """Delete a style."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            purge = request.query_params.get("purge", "false").lower() == "true"
            client.delete_style(style, workspace, purge=purge)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except GeoServerError as e:
            return handle_geoserver_error(e)
