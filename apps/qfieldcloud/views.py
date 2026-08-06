"""Views for QFieldCloud integration.

Provides endpoints for:
- QFieldCloud connection management
- Project listing and details
- File management
"""

import uuid

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import QFieldCloudConnection, get_config

from .client import QFieldCloudClient, QFieldCloudClientManager, get_qfieldcloud_client


class QFieldCloudConnectionListView(APIView):
    """List and create QFieldCloud connections."""

    def get(self, request):
        """List all QFieldCloud connections."""
        config = get_config(request.user.id)
        connections = config.list_qfieldcloud_connections()
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
        """Create a new QFieldCloud connection."""
        data = request.data
        conn = QFieldCloudConnection(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            url=data.get("url", "https://app.qfield.cloud"),
            username=data.get("username", ""),
            password=data.get("password", ""),
            token=data.get("token", ""),
        )

        config = get_config(request.user.id)
        config.add_qfieldcloud_connection(conn)

        return Response(
            {
                "id": conn.id,
                "name": conn.name,
                "url": conn.url,
            },
            status=status.HTTP_201_CREATED,
        )


class QFieldCloudConnectionTestView(APIView):
    """Test QFieldCloud connection."""

    def post(self, request):
        """Test connection parameters."""
        data = request.data

        client = QFieldCloudClient(
            url=data.get("url", "https://app.qfield.cloud"),
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


class QFieldCloudConnectionDetailView(APIView):
    """Get, update, or delete a QFieldCloud connection."""

    def get(self, request, conn_id):
        """Get connection details."""
        config = get_config(request.user.id)
        conn = config.get_qfieldcloud_connection(conn_id)
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
        conn = config.get_qfieldcloud_connection(conn_id)
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

        config.update_qfieldcloud_connection(conn)

        QFieldCloudClientManager().remove_client(conn_id)

        return Response({"status": "updated"})

    def delete(self, request, conn_id):
        """Delete a connection."""
        config = get_config(request.user.id)
        if not config.delete_qfieldcloud_connection(conn_id):
            return Response(
                {"error": "Connection not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        QFieldCloudClientManager().remove_client(conn_id)

        return Response(status=status.HTTP_204_NO_CONTENT)


class QFieldCloudProjectListView(APIView):
    """List projects for a connection."""

    def get(self, request, conn_id):
        """List all projects."""
        try:
            client = get_qfieldcloud_client(conn_id)
            projects = client.list_projects()
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


class QFieldCloudProjectDetailView(APIView):
    """Get project details."""

    def get(self, request, conn_id, project_id):
        """Get project information."""
        try:
            client = get_qfieldcloud_client(conn_id)
            project = client.get_project(project_id)

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


class QFieldCloudProjectFilesView(APIView):
    """List project files."""

    def get(self, request, conn_id, project_id):
        """List files in a project."""
        try:
            client = get_qfieldcloud_client(conn_id)
            files = client.list_project_files(project_id)
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


class QFieldCloudProjectStatusView(APIView):
    """Get project sync status."""

    def get(self, request, conn_id, project_id):
        """Get project status."""
        try:
            client = get_qfieldcloud_client(conn_id)
            status_info = client.get_project_status(project_id)
            return Response({"status": status_info})
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
