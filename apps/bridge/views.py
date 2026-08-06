"""Views for PostgreSQL to GeoServer bridge operations.

Provides endpoints for:
- Creating PostGIS datastores in GeoServer from pg_service entries
- Publishing PostgreSQL tables as GeoServer layers
- Listing publishable tables from a pg_service
"""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.geoserver.client import get_geoserver_client
from apps.postgres import schema
from apps.postgres.service import get_service


class BridgePostGISStoreView(APIView):
    """Create PostGIS datastores from pg_service entries."""

    def post(self, request, conn_id):
        """Create a PostGIS datastore in GeoServer from a pg_service.

        Expected body:
        {
            "serviceName": "pg_service_name",
            "workspace": "target_workspace",
            "storeName": "optional_store_name"
        }
        """
        service_name = request.data.get("serviceName")
        workspace = request.data.get("workspace")
        store_name = request.data.get("storeName")

        if not service_name or not workspace:
            return Response(
                {"error": "serviceName and workspace are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get pg_service details
        service = get_service(service_name)
        if not service:
            return Response(
                {"error": f"PostgreSQL service not found: {service_name}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Use service name as store name if not provided
        if not store_name:
            store_name = service_name.replace("-", "_").replace(" ", "_")

        # Build PostGIS connection parameters for GeoServer
        connection_params = {
            "dbtype": "postgis",
            "host": service.host,
            "port": str(service.port),
            "database": service.dbname,
            "user": service.user,
            "passwd": service.password,
            "schema": "public",
            "Expose primary keys": "true",
        }

        try:
            client = get_geoserver_client(conn_id, str(request.user.id))

            # Create the datastore
            client.create_datastore(
                workspace=workspace,
                name=store_name,
                connection_params=connection_params,
                description=f"PostGIS store from pg_service: {service_name}",
                enabled=True,
            )

            return Response(
                {
                    "message": f"PostGIS store '{store_name}' created",
                    "workspace": workspace,
                    "storeName": store_name,
                    "serviceName": service_name,
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class BridgePublishableTablesView(APIView):
    """List tables that can be published as GeoServer layers."""

    def get(self, request, conn_id, workspace, store):
        """List publishable tables from a PostGIS datastore.

        Query params:
        - serviceName: Optional pg_service name to also show schema info
        """
        service_name = request.query_params.get("serviceName")

        try:
            client = get_geoserver_client(conn_id, str(request.user.id))

            # Get available (unpublished) feature types from GeoServer
            available = client.list_available_featuretypes(workspace, store)

            # If service_name provided, enrich with schema info
            tables = []
            for table_name in available:
                table_info = {"name": table_name, "published": False}

                if service_name:
                    try:
                        # Get geometry info from PostGIS
                        pg_tables = schema.list_tables(service_name, "public")
                        for pg_table in pg_tables:
                            if pg_table["name"] == table_name:
                                table_info["geometryColumn"] = pg_table.get("geometryColumn")
                                table_info["geometryType"] = pg_table.get("geometryType")
                                table_info["srid"] = pg_table.get("srid")
                                break
                    except Exception:
                        pass

                tables.append(table_info)

            return Response({
                "tables": tables,
                "workspace": workspace,
                "store": store,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class BridgePublishLayerView(APIView):
    """Publish a PostgreSQL table as a GeoServer layer."""

    def post(self, request, conn_id, workspace, store):
        """Publish a table as a feature type/layer.

        Expected body:
        {
            "tableName": "my_table",
            "layerName": "optional_layer_name",
            "title": "Layer Title",
            "srs": "EPSG:4326"
        }
        """
        table_name = request.data.get("tableName")
        layer_name = request.data.get("layerName", table_name)
        title = request.data.get("title", table_name)
        srs = request.data.get("srs", "EPSG:4326")

        if not table_name:
            return Response(
                {"error": "tableName is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client = get_geoserver_client(conn_id, str(request.user.id))

            # Create the feature type (publishes the layer)
            client.create_featuretype(
                workspace=workspace,
                datastore=store,
                name=layer_name,
                native_name=table_name,
                title=title,
                srs=srs,
            )

            return Response(
                {
                    "message": f"Layer '{layer_name}' published",
                    "workspace": workspace,
                    "store": store,
                    "layer": layer_name,
                    "table": table_name,
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class BridgeBatchPublishView(APIView):
    """Batch publish multiple tables as layers."""

    def post(self, request, conn_id, workspace, store):
        """Batch publish tables as layers.

        Expected body:
        {
            "tables": [
                {"tableName": "table1", "layerName": "layer1", "srs": "EPSG:4326"},
                {"tableName": "table2"}
            ]
        }
        """
        tables = request.data.get("tables", [])

        if not tables:
            return Response(
                {"error": "tables array is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client = get_geoserver_client(conn_id, str(request.user.id))

            results = []
            for table_config in tables:
                table_name = table_config.get("tableName")
                if not table_name:
                    continue

                layer_name = table_config.get("layerName", table_name)
                title = table_config.get("title", table_name)
                srs = table_config.get("srs", "EPSG:4326")

                try:
                    client.create_featuretype(
                        workspace=workspace,
                        datastore=store,
                        name=layer_name,
                        native_name=table_name,
                        title=title,
                        srs=srs,
                    )
                    results.append({
                        "table": table_name,
                        "layer": layer_name,
                        "status": "published",
                    })
                except Exception as e:
                    results.append({
                        "table": table_name,
                        "layer": layer_name,
                        "status": "error",
                        "error": str(e),
                    })

            return Response({
                "workspace": workspace,
                "store": store,
                "results": results,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
