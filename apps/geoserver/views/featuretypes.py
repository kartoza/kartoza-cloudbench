"""Feature type views for GeoServer API."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from ..client import get_geoserver_client
from .base import get_recurse_param, handle_geoserver_error


class FeatureTypeListView(APIView):
    """List and create feature types in a data store."""

    def get(self, request, conn_id, workspace, store):
        """List all feature types."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            featuretypes = client.list_featuretypes(workspace, store)
            return Response(featuretypes)
        except GeoServerError:
            return Response([])

    def post(self, request, conn_id, workspace, store):
        """Publish a feature type."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            name = request.data.get("name")
            native_name = request.data.get("nativeName", name)
            title = request.data.get("title", name)
            srs = request.data.get("srs", "EPSG:4326")

            if not name:
                return Response(
                    {"error": "name is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.create_featuretype(workspace, store, name, native_name, title, srs)
            return Response(
                {"message": f"Feature type {name} published"},
                status=status.HTTP_201_CREATED,
            )
        except GeoServerError as e:
            return handle_geoserver_error(e)


class FeatureTypeDetailView(APIView):
    """Get or delete a feature type."""

    def get(self, request, conn_id, workspace, store, featuretype):
        """Get feature type details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            ft = client.get_featuretype(workspace, store, featuretype)
            return Response({"featureType": ft})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def delete(self, request, conn_id, workspace, store, featuretype):
        """Delete a feature type."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            recurse = get_recurse_param(request)
            client.delete_featuretype(workspace, store, featuretype, recurse=recurse)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except GeoServerError as e:
            return handle_geoserver_error(e)
