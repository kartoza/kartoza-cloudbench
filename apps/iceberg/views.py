"""Views for Apache Iceberg integration.

Provides endpoints for:
- Iceberg catalog connection management
- Namespace and table browsing
- Table metadata
"""

import uuid

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import IcebergConnection, get_config

from .client import IcebergClient, IcebergClientManager, get_iceberg_client


class IcebergConnectionListView(APIView):
    """List and create Iceberg connections."""

    def get(self, request):
        """List all Iceberg connections."""
        config = get_config(request.user.id)
        connections = config.list_iceberg_connections()
        return Response([
            {
                "id": c.id,
                "name": c.name,
                "url": c.url,
                "warehouse": c.warehouse,
            }
            for c in connections
        ])

    def post(self, request):
        """Create a new Iceberg connection."""
        data = request.data
        conn = IcebergConnection(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            url=data.get("url", ""),
            warehouse=data.get("warehouse", ""),
            token=data.get("token", ""),
            client_id=data.get("clientId", ""),
            client_secret=data.get("clientSecret", ""),
        )

        config = get_config(request.user.id)
        config.add_iceberg_connection(conn)

        return Response(
            {
                "id": conn.id,
                "name": conn.name,
                "url": conn.url,
            },
            status=status.HTTP_201_CREATED,
        )


class IcebergConnectionTestView(APIView):
    """Test Iceberg connection."""

    def post(self, request):
        """Test connection parameters."""
        data = request.data

        credentials = None
        if data.get("clientId") and data.get("clientSecret"):
            credentials = {
                "client_id": data.get("clientId"),
                "client_secret": data.get("clientSecret"),
            }

        client = IcebergClient(
            url=data.get("url", ""),
            warehouse=data.get("warehouse", ""),
            token=data.get("token"),
            credentials=credentials,
            user_id=str(request.user.id),
        )

        success, message = client.test_connection()

        if success:
            return Response({"status": "success", "message": message})
        return Response(
            {"status": "error", "message": message},
            status=status.HTTP_400_BAD_REQUEST,
        )


class IcebergConnectionDetailView(APIView):
    """Get, update, or delete an Iceberg connection."""

    def get(self, request, conn_id):
        """Get connection details."""
        config = get_config(request.user.id)
        conn = config.get_iceberg_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "connection": {
                "id": conn.id,
                "name": conn.name,
                "url": conn.url,
                "warehouse": conn.warehouse,
            }
        })

    def put(self, request, conn_id):
        """Update a connection."""
        config = get_config(request.user.id)
        conn = config.get_iceberg_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data
        conn.name = data.get("name", conn.name)
        conn.url = data.get("url", conn.url)
        conn.warehouse = data.get("warehouse", conn.warehouse)
        if "token" in data:
            conn.token = data["token"]
        if "clientId" in data:
            conn.client_id = data["clientId"]
        if "clientSecret" in data:
            conn.client_secret = data["clientSecret"]

        config.update_iceberg_connection(conn)

        IcebergClientManager().remove_client(conn_id)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        config = get_config(request.user.id)
        if not config.delete_iceberg_connection(conn_id):
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        IcebergClientManager().remove_client(conn_id)

        return Response(status=status.HTTP_204_NO_CONTENT)


class IcebergConfigView(APIView):
    """Get catalog configuration."""

    def get(self, request, conn_id):
        """Get catalog config."""
        try:
            client = get_iceberg_client(conn_id)
            config = client.get_config(request.user.id)
            return Response({"config": config})
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class IcebergNamespaceListView(APIView):
    """List namespaces for a connection."""

    def get(self, request, conn_id):
        """List all namespaces."""
        parent = request.query_params.get("parent")
        parent_list = parent.split(".") if parent else None

        try:
            client = get_iceberg_client(conn_id)
            namespaces = client.list_namespaces(parent=parent_list)
            return Response({
                "namespaces": [ns.to_dict() for ns in namespaces]
            })
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    def post(self, request, conn_id):
        """Create a namespace."""
        namespace = request.data.get("namespace", [])
        properties = request.data.get("properties", {})

        if isinstance(namespace, str):
            namespace = namespace.split(".")

        try:
            client = get_iceberg_client(conn_id)
            ns = client.create_namespace(namespace, properties)
            return Response(
                {"namespace": ns.to_dict()},
                status=status.HTTP_201_CREATED,
            )
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class IcebergNamespaceDetailView(APIView):
    """Get namespace details."""

    def get(self, request, conn_id, namespace):
        """Get namespace information."""
        namespace_list = namespace.split(".")

        try:
            client = get_iceberg_client(conn_id)
            ns = client.get_namespace(namespace_list)

            if not ns:
                return Response(
                    {"error": "Namespace not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            return Response({"namespace": ns.to_dict()})
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class IcebergTableListView(APIView):
    """List tables in a namespace."""

    def get(self, request, conn_id, namespace):
        """List all tables."""
        namespace_list = namespace.split(".")

        try:
            client = get_iceberg_client(conn_id)
            tables = client.list_tables(namespace_list)
            return Response({
                "tables": [t.to_dict() for t in tables]
            })
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class IcebergTableDetailView(APIView):
    """Get table details."""

    def get(self, request, conn_id, namespace, table):
        """Get table information."""
        namespace_list = namespace.split(".")

        try:
            client = get_iceberg_client(conn_id)
            tbl = client.get_table(namespace_list, table)

            if not tbl:
                return Response(
                    {"error": "Table not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            return Response({"table": tbl.to_dict()})
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class IcebergTableMetadataView(APIView):
    """Get full table metadata."""

    def get(self, request, conn_id, namespace, table):
        """Get table metadata including schema."""
        namespace_list = namespace.split(".")

        try:
            client = get_iceberg_client(conn_id)
            metadata = client.get_table_metadata(namespace_list, table)
            return Response({"metadata": metadata})
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
