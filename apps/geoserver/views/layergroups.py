"""Layer group views for GeoServer API."""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import handle_geoserver_error


class LayerGroupListView(APIView):
    """List layer groups in a workspace."""

    def get(self, request, conn_id, workspace):
        """List all layer groups."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            groups = client.list_layergroups(workspace)
            return Response(groups)
        except GeoServerError:
            return Response([])


class LayerGroupDetailView(APIView):
    """Get layer group details."""

    def get(self, request, conn_id, workspace, layergroup):
        """Get layer group details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            group = client.get_layergroup(layergroup, workspace)
            return Response({"layerGroup": group})
        except GeoServerError as e:
            return handle_geoserver_error(e)
