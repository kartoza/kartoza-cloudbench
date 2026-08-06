"""Views for Terria 3D viewer integration.

Provides endpoints for:
- Exporting GeoServer layers as Terria catalog items
- Proxy for CORS-restricted requests
- Terria catalog JSON generation
"""

import httpx
from typing import Any

from django.http import HttpResponse, StreamingHttpResponse
from django.urls import reverse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import get_config
from apps.geoserver.client import get_geoserver_client


def generate_terria_item(
    layer: dict[str, Any],
    geoserver_url: str,
    workspace: str,
) -> dict[str, Any]:
    """Generate a Terria catalog item for a layer.

    Args:
        layer: Layer information from GeoServer
        geoserver_url: Base GeoServer URL
        workspace: Workspace name

    Returns:
        Terria catalog item dictionary
    """
    layer_name = layer.get("name", "")
    layer_title = layer.get("title", layer_name)

    # Build WMS URL
    wms_url = f"{geoserver_url}/{workspace}/wms"

    return {
        "type": "wms",
        "name": layer_title,
        "id": f"{workspace}:{layer_name}",
        "url": wms_url,
        "layers": layer_name,
        "parameters": {
            "transparent": True,
            "format": "image/png",
        },
        "info": [
            {"name": "Workspace", "content": workspace},
            {"name": "Layer", "content": layer_name},
        ],
    }


def generate_terria_group(
    name: str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate a Terria catalog group.

    Args:
        name: Group name
        items: List of catalog items

    Returns:
        Terria catalog group dictionary
    """
    return {
        "type": "group",
        "name": name,
        "members": items,
    }


class TerriaConnectionCatalogView(APIView):
    """Export entire GeoServer connection as Terria catalog."""

    def get(self, request, conn_id):
        """Export all layers from a connection.

        Returns a Terria catalog JSON with all workspaces and layers.
        """
        try:
            config = get_config(request.user.id)
            conn = config.get_connection(conn_id)
            if not conn:
                return Response(
                    {"error": "Connection not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            client = get_geoserver_client(conn_id, str(request.user.id))

            # Get all workspaces and their layers
            workspaces = client.list_workspaces()
            workspace_groups = []

            for ws in workspaces:
                ws_name = ws.get("name")
                if not ws_name:
                    continue

                try:
                    layers = client.list_layers(ws_name)
                    items = [
                        generate_terria_item(layer, conn.url, ws_name)
                        for layer in layers
                    ]

                    if items:
                        workspace_groups.append(
                            generate_terria_group(ws_name, items)
                        )
                except Exception:
                    pass

            catalog = {
                "catalog": [
                    generate_terria_group(conn.name, workspace_groups)
                ],
                "homeCamera": {
                    "north": 90,
                    "east": 180,
                    "south": -90,
                    "west": -180,
                },
            }

            return Response(catalog)
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


class TerriaWorkspaceCatalogView(APIView):
    """Export a workspace as Terria catalog."""

    def get(self, request, conn_id, workspace):
        """Export all layers from a workspace."""
        try:
            config = get_config(request.user.id)
            conn = config.get_connection(conn_id)
            if not conn:
                return Response(
                    {"error": "Connection not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            client = get_geoserver_client(conn_id, str(request.user.id))

            layers = client.list_layers(workspace)
            items = [
                generate_terria_item(layer, conn.url, workspace)
                for layer in layers
            ]

            catalog = {
                "catalog": [
                    generate_terria_group(workspace, items)
                ],
            }

            return Response(catalog)
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


class TerriaLayerCatalogView(APIView):
    """Export a single layer as Terria catalog item."""

    def get(self, request, conn_id, workspace, layer):
        """Export a single layer."""
        try:
            config = get_config(request.user.id)
            conn = config.get_connection(conn_id)
            if not conn:
                return Response(
                    {"error": "Connection not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            client = get_geoserver_client(conn_id, str(request.user.id))

            layer_info = client.get_layer(workspace, layer)
            if not layer_info:
                return Response(
                    {"error": "Layer not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            item = generate_terria_item(layer_info, conn.url, workspace)

            return Response(item)
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


class TerriaProxyView(APIView):
    """Proxy requests for CORS-restricted resources."""

    def get(self, request):
        """Proxy a GET request.

        Query params:
        - url: Target URL to proxy
        """
        target_url = request.query_params.get("url")
        if not target_url:
            return Response(
                {"error": "URL parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Forward the request
            client = httpx.Client(timeout=30.0)
            response = client.get(target_url)

            # Stream the response
            def generate():
                for chunk in response.iter_bytes():
                    yield chunk

            proxy_response = StreamingHttpResponse(
                generate(),
                content_type=response.headers.get("content-type", "application/octet-stream"),
            )

            # Copy relevant headers
            if "content-length" in response.headers:
                proxy_response["Content-Length"] = response.headers["content-length"]

            # Add CORS headers
            proxy_response["Access-Control-Allow-Origin"] = "*"

            return proxy_response
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class TerriaInitView(APIView):
    """Get Terria initialization configuration."""

    def get(self, request):
        """Get Terria init JSON."""
        config = get_config(request.user.id)
        connections = config.list_connections()

        # Build init config with all connections as catalog sources
        catalog_members = []

        for conn in connections:
            catalog_members.append({
                "type": "group",
                "name": conn.name,
                "description": f"GeoServer at {conn.url}",
                "isOpen": False,
                "url": reverse("terria-connection-catalog", kwargs={"conn_id": conn.id}),
            })

        init_config = {
            "homeCamera": {
                "north": 90,
                "east": 180,
                "south": -90,
                "west": -180,
            },
            "catalog": catalog_members,
            "baseMaps": {
                "defaultBaseMapId": "basemap-positron",
                "previewBaseMapId": "basemap-positron",
            },
        }

        return Response(init_config)
