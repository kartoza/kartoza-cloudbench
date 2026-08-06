"""GeoWebCache REST API client.

Provides operations for tile cache management including seeding and truncation.
"""

from typing import Any

import httpx

from apps.core.config import Connection
from apps.core.exceptions import GeoServerError
from apps.core.managers import make_client


class GWCClient:
    """Client for GeoWebCache REST API operations."""

    def __init__(self, connection: Connection):
        """Initialize GWC client.

        Args:
            connection: GeoServer connection configuration
        """
        self.connection = connection
        self._client = make_client(
            connection.url,
            connection.username,
            connection.password,
        )

    def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Make an HTTP request to GeoWebCache.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            path: API path (will be prefixed with /gwc/rest)
            **kwargs: Additional arguments passed to httpx

        Returns:
            httpx.Response

        Raises:
            GeoServerError: If the request fails
        """
        # Ensure path starts with /gwc/rest
        if not path.startswith("/gwc/rest"):
            path = f"/gwc/rest{path}"

        try:
            response = self._client.request(method, path, **kwargs)
            return response
        except httpx.HTTPError as e:
            raise GeoServerError(f"GWC HTTP error: {str(e)}")

    def _get_json(self, path: str, **kwargs: Any) -> dict[str, Any]:
        """Make a GET request and return JSON response."""
        response = self._request("GET", path, **kwargs)
        if response.status_code == 404:
            raise GeoServerError("GWC resource not found", status_code=404)
        if response.status_code >= 400:
            raise GeoServerError(
                f"GWC request failed: {response.text}", status_code=response.status_code
            )
        return response.json()

    # === Layers ===

    def list_layers(self) -> list[dict[str, Any]]:
        """List all cached layers.

        Returns:
            List of layer names
        """
        data = self._get_json("/gwc/rest/layers.json")
        return data.get("layers", [])

    def get_layer(self, layer_name: str) -> dict[str, Any]:
        """Get cached layer details.

        Args:
            layer_name: Full layer name (workspace:layer)

        Returns:
            Layer configuration dictionary
        """
        # URL encode the layer name (replace : with %3A)
        encoded_name = layer_name.replace(":", "%3A")
        data = self._get_json(f"/gwc/rest/layers/{encoded_name}.json")
        return data.get("GeoServerLayer", {})

    # === Seeding ===

    def seed_layer(
        self,
        layer_name: str,
        grid_set: str = "EPSG:4326",
        zoom_start: int = 0,
        zoom_stop: int = 10,
        format: str = "image/png",
        num_threads: int = 4,
        seed_type: str = "seed",
    ) -> dict[str, Any]:
        """Start a seeding task for a layer.

        Args:
            layer_name: Full layer name (workspace:layer)
            grid_set: Grid set name (e.g., EPSG:4326, EPSG:900913)
            zoom_start: Starting zoom level
            zoom_stop: Ending zoom level
            format: Tile format (image/png, image/jpeg, etc.)
            num_threads: Number of seeding threads
            seed_type: Type of operation (seed, reseed, truncate)

        Returns:
            Task ID dictionary
        """
        encoded_name = layer_name.replace(":", "%3A")

        payload = {
            "seedRequest": {
                "name": layer_name,
                "gridSetId": grid_set,
                "zoomStart": zoom_start,
                "zoomStop": zoom_stop,
                "format": format,
                "type": seed_type,
                "threadCount": num_threads,
            }
        }

        response = self._request(
            "POST",
            f"/gwc/rest/seed/{encoded_name}.json",
            json=payload,
        )

        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to start seed task: {response.text}",
                status_code=response.status_code,
            )

        return {"status": "started", "layer": layer_name}

    def truncate_layer(
        self,
        layer_name: str,
        grid_set: str | None = None,
        zoom_start: int | None = None,
        zoom_stop: int | None = None,
        format: str | None = None,
    ) -> dict[str, Any]:
        """Truncate (delete) tiles for a layer.

        Args:
            layer_name: Full layer name (workspace:layer)
            grid_set: Optional grid set to truncate
            zoom_start: Optional starting zoom level
            zoom_stop: Optional ending zoom level
            format: Optional tile format to truncate

        Returns:
            Status dictionary
        """
        encoded_name = layer_name.replace(":", "%3A")

        seed_request: dict[str, Any] = {
            "name": layer_name,
            "type": "truncate",
        }

        if grid_set:
            seed_request["gridSetId"] = grid_set
        if zoom_start is not None:
            seed_request["zoomStart"] = zoom_start
        if zoom_stop is not None:
            seed_request["zoomStop"] = zoom_stop
        if format:
            seed_request["format"] = format

        payload = {"seedRequest": seed_request}

        response = self._request(
            "POST",
            f"/gwc/rest/seed/{encoded_name}.json",
            json=payload,
        )

        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to truncate tiles: {response.text}",
                status_code=response.status_code,
            )

        return {"status": "truncated", "layer": layer_name}

    def get_seed_status(self, layer_name: str) -> list[dict[str, Any]]:
        """Get running seed tasks for a layer.

        Args:
            layer_name: Full layer name (workspace:layer)

        Returns:
            List of running task statuses
        """
        encoded_name = layer_name.replace(":", "%3A")
        data = self._get_json(f"/gwc/rest/seed/{encoded_name}.json")
        return data.get("long-array-array", [])

    def kill_seed_tasks(self, layer_name: str) -> dict[str, Any]:
        """Kill all running seed tasks for a layer.

        Args:
            layer_name: Full layer name (workspace:layer)

        Returns:
            Status dictionary
        """
        encoded_name = layer_name.replace(":", "%3A")

        response = self._request(
            "POST",
            f"/gwc/rest/seed/{encoded_name}",
            params={"kill_all": "running"},
        )

        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to kill seed tasks: {response.text}",
                status_code=response.status_code,
            )

        return {"status": "killed", "layer": layer_name}

    # === Grid Sets ===

    def list_gridsets(self) -> list[dict[str, Any]]:
        """List all available grid sets.

        Returns:
            List of grid set names
        """
        data = self._get_json("/gwc/rest/gridsets.json")
        return data.get("gridSets", [])

    def get_gridset(self, name: str) -> dict[str, Any]:
        """Get grid set details.

        Args:
            name: Grid set name

        Returns:
            Grid set configuration dictionary
        """
        data = self._get_json(f"/gwc/rest/gridsets/{name}.json")
        return data.get("gridSet", {})

    # === Disk Quota ===

    def get_disk_quota(self) -> dict[str, Any]:
        """Get disk quota configuration and usage.

        Returns:
            Disk quota information
        """
        data = self._get_json("/gwc/rest/diskquota.json")
        return data.get("gwcQuotaConfiguration", {})

    def get_disk_usage(self) -> dict[str, Any]:
        """Get current disk usage statistics.

        Returns:
            Disk usage information
        """
        # Try to get disk quota which includes usage
        try:
            return self.get_disk_quota()
        except GeoServerError:
            return {"enabled": False, "usage": "unknown"}

    # === Masstruncate ===

    def mass_truncate(
        self,
        workspace: str | None = None,
        layer: str | None = None,
    ) -> dict[str, Any]:
        """Mass truncate tiles.

        Args:
            workspace: Optional workspace to truncate
            layer: Optional layer pattern to truncate

        Returns:
            Status dictionary
        """
        params = {}
        if workspace:
            params["workspace"] = workspace
        if layer:
            params["layer"] = layer

        response = self._request(
            "POST",
            "/gwc/rest/masstruncate",
            params=params,
        )

        if response.status_code >= 400:
            raise GeoServerError(
                f"Mass truncate failed: {response.text}",
                status_code=response.status_code,
            )

        return {"status": "truncated"}


def get_gwc_client(conn_id: str) -> GWCClient:
    """Get a GWC client for a connection.

    Args:
        conn_id: Connection ID

    Returns:
        GWCClient instance

    Raises:
        GeoServerError: If connection not found
    """
    from apps.core.config import config_manager

    conn = config_manager.get_connection(conn_id)
    if not conn:
        raise GeoServerError(f"Connection not found: {conn_id}", status_code=404)

    return GWCClient(conn)
