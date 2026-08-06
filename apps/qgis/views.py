"""Views for QGIS project management.

Provides endpoints for:
- Listing and managing QGIS project files
- Publishing SQL views as GeoServer layers
"""

import os
import uuid
from datetime import datetime
from pathlib import Path

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import QGISProject, get_config, get_qgis_projects_dir
from apps.geoserver.client import get_geoserver_client


class QGISProjectListView(APIView):
    """List and upload QGIS projects."""

    def get(self, request):
        """List all QGIS projects."""
        config = get_config(request.user.id)
        projects = config.config.qgis_projects

        return Response([
            {
                "id": p.id,
                "name": p.name,
                "path": p.path,
                "title": p.title,
                "lastModified": p.lastModified,
                "size": p.size,
            }
            for p in projects
        ])

    def post(self, request):
        """Upload a new QGIS project file."""
        if "file" not in request.FILES:
            return Response(
                {"error": "No file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        uploaded_file = request.FILES["file"]
        name = request.data.get("name", uploaded_file.name)

        # Validate file extension
        if not name.endswith((".qgs", ".qgz")):
            return Response(
                {"error": "Only .qgs and .qgz files are supported"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Save file to projects directory
        projects_dir = get_qgis_projects_dir(request.user.id)
        project_id = str(uuid.uuid4())
        file_path = projects_dir / f"{project_id}_{name}"

        with open(file_path, "wb") as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)

        # Create project record
        project = QGISProject(
            id=project_id,
            name=name,
            path=str(file_path),
            title=request.data.get("title", name),
            lastModified=datetime.utcnow().isoformat(),
            size=uploaded_file.size,
        )

        config = get_config(request.user.id)
        config.config.qgis_projects.append(project)
        config.save()

        return Response(
            {
                "id": project.id,
                "name": project.name,
                "path": project.path,
            },
            status=status.HTTP_201_CREATED,
        )


class QGISProjectDetailView(APIView):
    """Get, update, or delete a QGIS project."""

    def get(self, request, project_id):
        """Get project details."""
        config = get_config(request.user.id)

        for project in config.config.qgis_projects:
            if project.id == project_id:
                return Response({
                    "project": {
                        "id": project.id,
                        "name": project.name,
                        "path": project.path,
                        "title": project.title,
                        "lastModified": project.lastModified,
                        "size": project.size,
                    }
                })

        return Response(
            {"error": "Project not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    def delete(self, request, project_id):
        """Delete a project."""
        config = get_config(request.user.id)

        for i, project in enumerate(config.config.qgis_projects):
            if project.id == project_id:
                # Remove file
                try:
                    if os.path.exists(project.path):
                        os.remove(project.path)
                except Exception:
                    pass

                # Remove from config
                config.config.qgis_projects.pop(i)
                config.save()
                return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(
            {"error": "Project not found"},
            status=status.HTTP_404_NOT_FOUND,
        )


class SQLViewPublishView(APIView):
    """Publish SQL views as GeoServer layers."""

    def post(self, request):
        """Publish a SQL view as a GeoServer layer.

        Expected body:
        {
            "connectionId": "geoserver-conn-id",
            "workspace": "myworkspace",
            "datastore": "mydatastore",
            "layerName": "my_view_layer",
            "sql": "SELECT * FROM my_table WHERE ...",
            "geometryColumn": "geom",
            "geometryType": "Point",
            "srid": 4326,
            "keyColumn": "id"
        }
        """
        conn_id = request.data.get("connectionId")
        workspace = request.data.get("workspace")
        datastore = request.data.get("datastore")
        layer_name = request.data.get("layerName")
        sql = request.data.get("sql")
        geometry_column = request.data.get("geometryColumn", "geom")
        geometry_type = request.data.get("geometryType", "Geometry")
        srid = request.data.get("srid", 4326)
        key_column = request.data.get("keyColumn", "")

        if not all([conn_id, workspace, datastore, layer_name, sql]):
            return Response(
                {"error": "Missing required parameters"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client = get_geoserver_client(conn_id, str(request.user.id))

            # Create SQL view feature type
            feature_type = {
                "featureType": {
                    "name": layer_name,
                    "nativeName": layer_name,
                    "namespace": {
                        "name": workspace,
                    },
                    "title": layer_name,
                    "srs": f"EPSG:{srid}",
                    "metadata": {
                        "entry": [
                            {
                                "@key": "JDBC_VIRTUAL_TABLE",
                                "virtualTable": {
                                    "name": layer_name,
                                    "sql": sql,
                                    "escapeSql": False,
                                    "keyColumn": key_column,
                                    "geometry": {
                                        "name": geometry_column,
                                        "type": geometry_type,
                                        "srid": srid,
                                    },
                                },
                            }
                        ]
                    },
                }
            }

            # Create the feature type
            response = client.client.post(
                f"/rest/workspaces/{workspace}/datastores/{datastore}/featuretypes",
                json=feature_type,
            )
            response.raise_for_status()

            return Response(
                {
                    "layerName": layer_name,
                    "workspace": workspace,
                    "status": "created",
                },
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
                status=status.HTTP_400_BAD_REQUEST,
            )


class SQLViewValidateView(APIView):
    """Validate a SQL view definition."""

    def post(self, request):
        """Validate a SQL query for use as a view.

        Expected body:
        {
            "serviceName": "pg-service-name",
            "sql": "SELECT * FROM my_table WHERE ..."
        }
        """
        service_name = request.data.get("serviceName")
        sql = request.data.get("sql")

        if not service_name or not sql:
            return Response(
                {"error": "serviceName and sql are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from apps.postgres.schema import execute_query

            # Try to execute with LIMIT 1 to validate
            test_sql = f"SELECT * FROM ({sql}) AS _validation_query LIMIT 1"
            result = execute_query(service_name, test_sql, limit=1)

            # Check for geometry columns
            geometry_columns = []
            for col in result.get("columns", []):
                col_lower = col.lower()
                if col_lower in ("geom", "geometry", "the_geom", "wkb_geometry"):
                    geometry_columns.append(col)

            return Response({
                "valid": True,
                "columns": result.get("columns", []),
                "geometryColumns": geometry_columns,
                "rowCount": result.get("rowCount", 0),
            })
        except Exception as e:
            return Response({
                "valid": False,
                "error": str(e),
            })
