"""Data store views for GeoServer API."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError
from apps.postgres.client import get_pg_client
from .base import get_recurse_param, handle_geoserver_error
from ..client import get_geoserver_client


class DataStoreListView(APIView):
    """List and create data stores in a workspace."""

    def get(self, request, conn_id, workspace):
        """List all data stores."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            datastores = client.list_datastores(workspace)
            return Response(datastores)
        except GeoServerError:
            return Response([])

    def post(self, request, conn_id, workspace):
        """Create a new data store."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            name = request.data.get("name")
            connection_params = request.data.get("connectionParameters", {})
            description = request.data.get("description", "")
            enabled = request.data.get("enabled", True)

            if not name:
                return Response(
                    {"error": "name is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not connection_params:
                return Response(
                    {"error": "connectionParameters is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            client.create_datastore(
                workspace, name, connection_params, description, enabled
            )
            return Response(
                {"message": f"Data store {name} created"},
                status=status.HTTP_201_CREATED,
            )
        except GeoServerError as e:
            return handle_geoserver_error(e)


class DataStoreDetailView(APIView):
    """Get, update, or delete a data store."""

    def get(self, request, conn_id, workspace, store):
        """Get data store details."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            ds = client.get_datastore(workspace, store)
            return Response(ds)
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def put(self, request, conn_id, workspace, store):
        """Update a data store."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            # For updates, we need to rebuild connection parameters
            connection_params = request.data.get("connectionParameters")
            description = request.data.get("description")
            enabled = request.data.get("enabled")

            # Build update payload
            payload = {"dataStore": {"name": store}}
            if connection_params:
                entries = [{"@key": k, "$": v} for k, v in
                           connection_params.items()]
                payload["dataStore"]["connectionParameters"] = {
                    "entry": entries}
            if description is not None:
                payload["dataStore"]["description"] = description
            if enabled is not None:
                payload["dataStore"]["enabled"] = enabled

            client._request(
                "PUT",
                f"/rest/workspaces/{workspace}/datastores/{store}.json",
                json=payload,
            )
            return Response({"message": "Data store updated"})
        except GeoServerError as e:
            return handle_geoserver_error(e)

    def delete(self, request, conn_id, workspace, store):
        """Delete a data store."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            recurse = get_recurse_param(request)
            client.delete_datastore(workspace, store, recurse=recurse)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except GeoServerError as e:
            return handle_geoserver_error(e)


class DataStoreAvailableView(APIView):
    """List available (unpublished) feature types in a data store."""

    def get(self, request, conn_id, workspace, store):
        """List available feature types."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
            available = client.list_available_featuretypes(workspace, store)
            return Response({"available": available})
        except GeoServerError:
            return Response({"available": []})


class DataStorePublishView(APIView):
    """Publish (import) feature types from a PostGIS datastore as layers."""

    def post(self, request, conn_id, workspace, store):
        """Publish selected feature types.

        Expected body:
        {
            "featureTypes": ["table1", "table2"],
            "srs": "EPSG:4326"  // optional
        }
        """
        feature_types = request.data.get("featureTypes", [])
        srs = request.data.get("srs", "EPSG:4326")

        if not feature_types:
            return Response(
                {"error": "featureTypes is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client = get_geoserver_client(conn_id, str(request.user.id))
        except GeoServerError as e:
            return handle_geoserver_error(e)

        published = []
        errors = []

        for name in feature_types:
            try:
                client.create_featuretype(
                    workspace, store, name, native_name=name, srs=srs
                )
                published.append(name)
            except GeoServerError as e:
                errors.append({"name": name, "error": str(e.message)})

        response_status = (
            status.HTTP_201_CREATED if published else status.HTTP_400_BAD_REQUEST
        )
        return Response({"published": published, "errors": errors}, status=response_status)


class DataStoreConnectPGView(APIView):
    """Create a GeoServer data store from an existing PostgreSQL service connection."""

    def post(self, request, conn_id, workspace, pg_conn_id):
        """Create a data store using credentials from a saved PG service.

        The data store name defaults to the PG service name (pg_conn_id).
        An optional 'schema' field in the request body overrides the default 'public'.
        """
        user_id = str(request.user.id)

        try:
            pg_client = get_pg_client(pg_conn_id, user_id)
        except ValueError:
            return Response(
                {"error": f"PostgreSQL service '{pg_conn_id}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        service = pg_client.service
        name = request.data.get("name") or service.name
        database = request.data.get("database") or service.dbname
        schema = request.data.get("schema", "public")
        description = request.data.get("description", "")
        enabled = request.data.get("enabled", True)

        connection_params = {
            "dbtype": "postgis",
            "host": service.host,
            "port": str(service.port),
            "database": database,
            "schema": schema,
            "user": service.user,
            "passwd": service.password,
        }

        try:
            gs_client = get_geoserver_client(conn_id, user_id)
            gs_client.create_datastore(
                workspace, name, connection_params, description, enabled
            )
            return Response(
                {"message": f"Data store '{name}' created"},
                status=status.HTTP_201_CREATED,
            )
        except GeoServerError as e:
            return handle_geoserver_error(e)
