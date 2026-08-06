"""Views for Mergin Maps integration.

Provides endpoints for:
- Mergin Maps connection management
- Project listing and details
- File and version management
"""

import uuid

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import MerginConnection, get_config

from .client import MerginClient, MerginClientManager, get_mergin_client


class MerginConnectionListView(APIView):
    """List and create Mergin Maps connections."""

    def get(self, request):
        """List all Mergin connections."""
        config = get_config(request.user.id)
        connections = config.list_mergin_connections()
        return Response([
            {
                "id": c.id,
                "name": c.name,
                "url": c.url,
                "username": c.username,
            }
            for c in connections
        ])

    def post(self, request):
        """Create a new Mergin connection."""
        data = request.data
        conn = MerginConnection(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            url=data.get("url", "https://app.merginmaps.com"),
            username=data.get("username", ""),
            password=data.get("password", ""),
            token=data.get("token", ""),
        )

        config = get_config(request.user.id)
        config.add_mergin_connection(conn)

        return Response(
            {
                "id": conn.id,
                "name": conn.name,
                "url": conn.url,
            },
            status=status.HTTP_201_CREATED,
        )


class MerginConnectionTestView(APIView):
    """Test Mergin connection."""

    def post(self, request):
        """Test connection parameters."""
        data = request.data

        client = MerginClient(
            url=data.get("url", "https://app.merginmaps.com"),
            username=data.get("username", ""),
            password=data.get("password"),
            token=data.get("token"),
            user_id=str(request.user.id),
        )

        success, message = client.test_connection()

        if success:
            return Response({"status": "success", "message": message})
        return Response(
            {"status": "error", "message": message},
            status=status.HTTP_400_BAD_REQUEST,
        )


class MerginConnectionDetailView(APIView):
    """Get, update, or delete a Mergin connection."""

    def get(self, request, conn_id):
        """Get connection details."""
        config = get_config(request.user.id)
        conn = config.get_mergin_connection(conn_id)
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
                "username": conn.username,
            }
        })

    def put(self, request, conn_id):
        """Update a connection."""
        config = get_config(request.user.id)
        conn = config.get_mergin_connection(conn_id)
        if not conn:
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data
        conn.name = data.get("name", conn.name)
        conn.url = data.get("url", conn.url)
        conn.username = data.get("username", conn.username)
        if "password" in data:
            conn.password = data["password"]
        if "token" in data:
            conn.token = data["token"]

        config.update_mergin_connection(conn)

        MerginClientManager().remove_client(conn_id)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        config = get_config(request.user.id)
        if not config.delete_mergin_connection(conn_id):
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        MerginClientManager().remove_client(conn_id)

        return Response(status=status.HTTP_204_NO_CONTENT)


class MerginProjectListView(APIView):
    """List projects for a connection."""

    def get(self, request, conn_id):
        """List all projects."""
        namespace = request.query_params.get("namespace")
        flag = request.query_params.get("flag")

        try:
            client = get_mergin_client(conn_id)
            projects = client.list_projects(namespace=namespace, flag=flag)
            return Response({
                "projects": [p.to_dict() for p in projects]
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


class MerginProjectDetailView(APIView):
    """Get project details."""

    def get(self, request, conn_id, namespace, name):
        """Get project information."""
        try:
            client = get_mergin_client(conn_id)
            project = client.get_project(namespace, name)

            if not project:
                return Response(
                    {"error": "Project not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            return Response({"project": project.to_dict()})
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


class MerginProjectFilesView(APIView):
    """List project files."""

    def get(self, request, conn_id, namespace, name):
        """List files in a project."""
        version = request.query_params.get("version")

        try:
            client = get_mergin_client(conn_id)
            files = client.list_project_files(namespace, name, version)
            return Response({"files": files})
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


class MerginProjectVersionsView(APIView):
    """Get project version history."""

    def get(self, request, conn_id, namespace, name):
        """Get version history."""
        try:
            client = get_mergin_client(conn_id)
            versions = client.get_project_versions(namespace, name)
            return Response({"versions": versions})
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
