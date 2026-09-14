"""Views for GeoWebCache management.

Provides endpoints for:
- Listing cached layers
- Seeding tiles
- Truncating tiles
- Managing grid sets
- Disk quota monitoring
"""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import GeoServerError

from .client import get_gwc_client


class GWCLayerListView(APIView):
    """List all GWC layers for a connection."""

    def get(self, _request, conn_id, workspace):
        """List cached layers.

        Filters layers by workspace prefix.
        """
        try:
            client = get_gwc_client(conn_id)
            layers = client.list_layers()

            # Filter by workspace if provided
            if workspace:
                workspace_prefix = f"{workspace}:"
                layers = [layer for layer in layers if layer.startswith(workspace_prefix)]

            return Response({"layers": layers})
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCLayerDetailView(APIView):
    """Get GWC layer details."""

    def get(self, _request, conn_id, workspace, layer):
        """Get cached layer configuration."""
        try:
            client = get_gwc_client(conn_id)
            layer_name = f"{workspace}:{layer}"
            layer_info = client.get_layer(layer_name)
            return Response({"layer": layer_info})
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCSeedView(APIView):
    """Seed tiles for a layer."""

    def post(self, request, conn_id, workspace, layer):
        """Start a seeding task.

        Expected body:
        {
            "gridSet": "EPSG:4326",
            "zoomStart": 0,
            "zoomStop": 10,
            "format": "image/png",
            "threads": 4,
            "type": "seed"  // seed, reseed, or truncate
        }
        """
        try:
            client = get_gwc_client(conn_id)
            layer_name = f"{workspace}:{layer}"

            grid_set = request.data.get("gridSet", "EPSG:4326")
            zoom_start = request.data.get("zoomStart", 0)
            zoom_stop = request.data.get("zoomStop", 10)
            tile_format = request.data.get("format", "image/png")
            threads = request.data.get("threads", 4)
            seed_type = request.data.get("type", "seed")

            result = client.seed_layer(
                layer_name,
                grid_set=grid_set,
                zoom_start=zoom_start,
                zoom_stop=zoom_stop,
                format=tile_format,
                num_threads=threads,
                seed_type=seed_type,
            )

            return Response(result, status=status.HTTP_202_ACCEPTED)
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )

    def get(self, _request, conn_id, workspace, layer):
        """Get seed task status for a layer."""
        try:
            client = get_gwc_client(conn_id)
            layer_name = f"{workspace}:{layer}"
            tasks = client.get_seed_status(layer_name)

            # Parse the long-array-array format
            # Each task is [tilesProcessed, totalTiles, remainingTime, taskId, status]
            formatted_tasks = []
            for task in tasks:
                if len(task) >= 5:
                    formatted_tasks.append({
                        "tilesProcessed": task[0],
                        "totalTiles": task[1],
                        "remainingTime": task[2],
                        "taskId": task[3],
                        "status": task[4],
                    })

            return Response({"tasks": formatted_tasks})
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )

    def delete(self, _request, conn_id, workspace, layer):
        """Kill all running seed tasks for a layer."""
        try:
            client = get_gwc_client(conn_id)
            layer_name = f"{workspace}:{layer}"
            result = client.kill_seed_tasks(layer_name)
            return Response(result)
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCTruncateView(APIView):
    """Truncate tiles for a layer."""

    def delete(self, request, conn_id, workspace, layer):
        """Truncate cached tiles.

        Query params:
        - gridSet: Optional grid set to truncate
        - zoomStart: Optional starting zoom level
        - zoomStop: Optional ending zoom level
        - format: Optional tile format
        """
        try:
            client = get_gwc_client(conn_id)
            layer_name = f"{workspace}:{layer}"

            grid_set = request.query_params.get("gridSet")
            zoom_start = request.query_params.get("zoomStart")
            zoom_stop = request.query_params.get("zoomStop")
            tile_format = request.query_params.get("format")

            result = client.truncate_layer(
                layer_name,
                grid_set=grid_set,
                zoom_start=int(zoom_start) if zoom_start else None,
                zoom_stop=int(zoom_stop) if zoom_stop else None,
                format=tile_format,
            )

            return Response(result)
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCGridSetListView(APIView):
    """List all available grid sets."""

    def get(self, _request, conn_id):
        """List grid sets."""
        try:
            client = get_gwc_client(conn_id)
            gridsets = client.list_gridsets()
            return Response({"gridSets": gridsets})
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCGridSetDetailView(APIView):
    """Get grid set details."""

    def get(self, _request, conn_id, gridset):
        """Get grid set configuration."""
        try:
            client = get_gwc_client(conn_id)
            gs = client.get_gridset(gridset)
            return Response({"gridSet": gs})
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCDiskQuotaView(APIView):
    """Get disk quota information."""

    def get(self, _request, conn_id):
        """Get disk quota configuration and usage."""
        try:
            client = get_gwc_client(conn_id)
            quota = client.get_disk_quota()
            return Response({"diskQuota": quota})
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )


class GWCMassTruncateView(APIView):
    """Mass truncate tiles."""

    def post(self, request, conn_id):
        """Mass truncate tiles.

        Expected body:
        {
            "workspace": "optional_workspace",
            "layer": "optional_layer_pattern"
        }
        """
        try:
            client = get_gwc_client(conn_id)
            workspace = request.data.get("workspace")
            layer = request.data.get("layer")

            result = client.mass_truncate(workspace=workspace, layer=layer)
            return Response(result)
        except GeoServerError as e:
            return Response(
                {"error": e.message}, status=e.status_code or status.HTTP_502_BAD_GATEWAY
            )
