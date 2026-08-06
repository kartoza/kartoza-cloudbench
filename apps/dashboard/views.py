"""Views for dashboard monitoring.

Provides endpoints for:
- Overall system status
- Connection health monitoring
- Server statistics
"""

import platform
import sys
from datetime import datetime

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import get_config
from apps.geoserver.client import get_geoserver_client


class DashboardView(APIView):
    """Get overall dashboard data."""

    def get(self, request):
        """Get dashboard summary with server status."""
        import time

        config = get_config(request.user.id)
        servers = []
        online_count = 0
        offline_count = 0
        total_layers = 0
        total_stores = 0
        alert_servers = []

        # Check each GeoServer connection
        for conn in config.list_connections():
            start_time = time.time()
            server_status = {
                "connectionId": conn.id,
                "connectionName": conn.name,
                "url": conn.url,
                "online": False,
                "responseTimeMs": 0,
                "memoryUsed": 0,
                "memoryFree": 0,
                "memoryTotal": 0,
                "memoryUsedPct": 0,
                "cpuLoad": 0,
                "workspaceCount": 0,
                "layerCount": 0,
                "dataStoreCount": 0,
                "coverageCount": 0,
                "styleCount": 0,
            }

            try:
                client = get_geoserver_client(conn.id, str(request.user.id))

                # Get workspace count as connectivity check
                workspaces = client.list_workspaces()
                response_time = int((time.time() - start_time) * 1000)
                workspace_count = len(workspaces)

                # Count layers, stores, styles across workspaces (limit for performance)
                layer_count = 0
                datastore_count = 0
                coverage_count = 0
                style_count = 0

                for ws in workspaces[:5]:
                    ws_name = ws.get("name")
                    if ws_name:
                        try:
                            layers = client.list_layers(ws_name)
                            layer_count += len(layers)
                            datastores = client.list_datastores(ws_name)
                            datastore_count += len(datastores)
                            coverages = client.list_coveragestores(ws_name)
                            coverage_count += len(coverages)
                            styles = client.list_styles(ws_name)
                            style_count += len(styles)
                        except Exception:
                            pass

                server_status.update({
                    "online": True,
                    "responseTimeMs": response_time,
                    "workspaceCount": workspace_count,
                    "layerCount": layer_count,
                    "dataStoreCount": datastore_count,
                    "coverageCount": coverage_count,
                    "styleCount": style_count,
                })

                online_count += 1
                total_layers += layer_count
                total_stores += datastore_count + coverage_count

            except Exception as e:
                server_status["error"] = str(e)
                offline_count += 1
                alert_servers.append(server_status.copy())

            servers.append(server_status)

        return Response({
            "servers": servers,
            "onlineCount": online_count,
            "offlineCount": offline_count,
            "totalLayers": total_layers,
            "totalStores": total_stores,
            "alertServers": alert_servers,
            "pingIntervalSecs": 30,  # Default refresh interval
        })


class DashboardServerView(APIView):
    """Get server status information."""

    def get(self, request):
        """Get server status."""
        return Response({
            "server": {
                "python": sys.version,
                "platform": platform.platform(),
                "hostname": platform.node(),
            },
            "status": "running",
            "timestamp": datetime.utcnow().isoformat(),
        })


class DashboardConnectionsView(APIView):
    """Get connection health status."""

    def get(self, request):
        """Get status of all connections."""
        config = get_config(request.user.id)
        connections = []

        # Check GeoServer connections
        for conn in config.list_connections():
            try:
                client = get_geoserver_client(conn.id, str(request.user.id))
                # Try to get version as health check
                about = client.get_about()
                connections.append({
                    "id": conn.id,
                    "name": conn.name,
                    "type": "geoserver",
                    "url": conn.url,
                    "status": "healthy",
                    "version": about.get("about", {}).get("resource", [{}])[0].get("Version"),
                })
            except Exception as e:
                connections.append({
                    "id": conn.id,
                    "name": conn.name,
                    "type": "geoserver",
                    "url": conn.url,
                    "status": "error",
                    "error": str(e),
                })

        # S3 connections
        for conn in config.list_s3_connections():
            connections.append({
                "id": conn.id,
                "name": conn.name,
                "type": "s3",
                "endpoint": conn.endpoint,
                "status": "unknown",  # Would need to test each
            })

        return Response({
            "connections": connections,
            "timestamp": datetime.utcnow().isoformat(),
        })


class DashboardGeoServerView(APIView):
    """Get GeoServer-specific statistics."""

    def get(self, request, conn_id):
        """Get GeoServer statistics."""
        try:
            client = get_geoserver_client(conn_id, str(request.user.id))

            # Get counts
            workspaces = client.list_workspaces()

            total_layers = 0
            total_styles = 0
            total_datastores = 0

            for ws in workspaces:
                ws_name = ws.get("name")
                if ws_name:
                    try:
                        layers = client.list_layers(ws_name)
                        total_layers += len(layers)

                        styles = client.list_styles(ws_name)
                        total_styles += len(styles)

                        datastores = client.list_datastores(ws_name)
                        total_datastores += len(datastores)
                    except Exception:
                        pass

            return Response({
                "connectionId": conn_id,
                "workspaces": len(workspaces),
                "layers": total_layers,
                "styles": total_styles,
                "datastores": total_datastores,
                "timestamp": datetime.utcnow().isoformat(),
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
