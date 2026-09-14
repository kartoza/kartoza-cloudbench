"""Layer views for GeoServer API."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import get_recurse_param, handle_geoserver_error


class LayerListView(APIView):
    """List layers in a workspace."""

    def get(self, request, conn_id, workspace):
        """List all layers."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            layers = client.list_layers(workspace)
            return Response(layers)
        except GeoServerError:
            return Response([])


class LayerDetailView(APIView):
    """Get, update, or delete a layer."""

    def get(self, request, conn_id, workspace, layer):
        """Get layer details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            lyr = client.get_layer(workspace, layer)
            return Response({"layer": lyr})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def put(self, request, conn_id, workspace, layer):
        """Update layer properties."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            enabled = request.data.get("enabled")
            advertised = request.data.get("advertised")
            queryable = request.data.get("queryable")
            default_style = request.data.get("defaultStyle")

            client.update_layer(
                workspace,
                layer,
                enabled=enabled,
                advertised=advertised,
                queryable=queryable,
                default_style=default_style,
            )
            return Response({"message": "Layer updated"})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def delete(self, request, conn_id, workspace, layer):
        """Delete a layer."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            recurse = get_recurse_param(request)
            client.delete_layer(workspace, layer, recurse=recurse)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except GeoServerError as e:
            return handle_geoserver_error(e)


class LayerCountView(APIView):
    """Get feature count for a layer."""

    def get(self, request, conn_id, workspace, layer):
        """Get layer feature count."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            count = client.get_layer_feature_count(workspace, layer)
            return Response({"count": count})
        except GeoServerError as e:
            return handle_geoserver_error(e)


class LayerMetadataView(APIView):
    """Get layer metadata including bounding box."""

    def get(self, request, conn_id, workspace, layer):
        """Get layer metadata."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            metadata = client.get_layer_metadata(workspace, layer)
            return Response(metadata)
        except GeoServerError as e:
            return handle_geoserver_error(e)


class LayerStylesView(APIView):
    """Get or update layer style associations."""

    def get(self, request, conn_id, workspace, layer):
        """Get layer styles."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            styles = client.get_layer_styles(workspace, layer)
            return Response(styles)
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def put(self, request, conn_id, workspace, layer):
        """Update layer styles."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            default_style = request.data.get("defaultStyle")
            additional_styles = request.data.get("additionalStyles", [])

            if not default_style:
                return Response(
                    {"error": "defaultStyle is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.update_layer_styles(workspace, layer, default_style, additional_styles)
            return Response({"message": "Styles updated"})
        except GeoServerError as e:
            return handle_geoserver_error(e)
