"""Coverage views for GeoServer API."""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import handle_geoserver_error


class CoverageListView(APIView):
    """List coverages in a coverage store."""

    def get(self, request, conn_id, workspace, store):
        """List all coverages."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            coverages = client.list_coverages(workspace, store)
            return Response(coverages)
        except GeoServerError:
            return Response([])


class CoverageDetailView(APIView):
    """Get coverage details."""

    def get(self, request, conn_id, workspace, store, coverage):
        """Get coverage details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            cov = client.get_coverage(workspace, store, coverage)
            return Response({"coverage": cov})
        except GeoServerError as e:
            return handle_geoserver_error(e)
