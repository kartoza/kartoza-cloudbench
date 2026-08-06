"""GeoServer REST API client.

Provides a comprehensive Python client for the GeoServer REST API.
"""

import re
from typing import Any
from xml.etree import ElementTree as ET

import httpx

from apps.core.config import Connection
from apps.core.exceptions import GeoServerError
from apps.core.managers import make_client


class GeoServerClient:
    """Client for GeoServer REST API operations."""

    def __init__(self, connection: Connection):
        """Initialize GeoServer client.

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
        """Make an HTTP request to GeoServer.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            path: API path (will be prefixed with /rest)
            **kwargs: Additional arguments passed to httpx

        Returns:
            httpx.Response

        Raises:
            GeoServerError: If the request fails
        """
        # Ensure path starts with /rest
        if not path.startswith("/rest"):
            path = f"/rest{path}"

        try:
            response = self._client.request(method, path, **kwargs)
            return response
        except httpx.HTTPError as e:
            raise GeoServerError(f"HTTP error: {str(e)}")

    def _get_json(self, path: str, **kwargs: Any) -> dict[str, Any]:
        """Make a GET request and return JSON response."""
        response = self._request("GET", path, **kwargs)
        if response.status_code == 404:
            raise GeoServerError("Resource not found", status_code=404)
        if response.status_code >= 400:
            raise GeoServerError(
                f"Request failed: {response.text}", status_code=response.status_code
            )
        return response.json()

    # === Workspaces ===

    def list_workspaces(self) -> list[dict[str, Any]]:
        """List all workspaces.

        Returns:
            List of workspace dictionaries with name and href
        """
        data = self._get_json("/rest/workspaces.json")
        workspaces = data.get("workspaces", {})
        if not workspaces:
            return []
        return workspaces.get("workspace", [])

    def get_workspace(self, name: str) -> dict[str, Any]:
        """Get workspace details.

        Args:
            name: Workspace name

        Returns:
            Workspace details dictionary
        """
        data = self._get_json(f"/rest/workspaces/{name}.json")
        return data.get("workspace", {})

    def create_workspace(
        self,
        name: str,
        isolated: bool = False,
        default: bool = False,
    ) -> None:
        """Create a new workspace.

        Args:
            name: Workspace name
            isolated: Whether workspace is isolated
            default: Whether to set as default workspace
        """
        if not re.match(r"^[A-Za-z0-9_\-]+$", name):
            raise GeoServerError(
                "Workspace name must contain only letters, numbers, underscores, and hyphens",
                status_code=400,
            )
        payload = {"workspace": {"name": name, "isolated": isolated}}
        response = self._request(
            "POST",
            "/rest/workspaces.json",
            json=payload,
            params={"default": str(default).lower()} if default else None,
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to create workspace: {response.text}",
                status_code=response.status_code,
            )

    def update_workspace(
        self,
        name: str,
        new_name: str | None = None,
        isolated: bool | None = None,
    ) -> None:
        """Update a workspace.

        Args:
            name: Current workspace name
            new_name: New workspace name (optional)
            isolated: Whether workspace is isolated (optional)
        """
        payload: dict[str, Any] = {"workspace": {}}
        if new_name:
            payload["workspace"]["name"] = new_name
        if isolated is not None:
            payload["workspace"]["isolated"] = isolated

        response = self._request("PUT", f"/rest/workspaces/{name}.json", json=payload)
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to update workspace: {response.text}",
                status_code=response.status_code,
            )

    def delete_workspace(self, name: str, recurse: bool = False) -> None:
        """Delete a workspace.

        Args:
            name: Workspace name
            recurse: Delete all contained resources
        """
        response = self._request(
            "DELETE",
            f"/rest/workspaces/{name}",
            params={"recurse": str(recurse).lower()},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to delete workspace: {response.text}",
                status_code=response.status_code,
            )

    # === Data Stores ===

    def list_datastores(self, workspace: str) -> list[dict[str, Any]]:
        """List all data stores in a workspace.

        Args:
            workspace: Workspace name

        Returns:
            List of data store dictionaries
        """
        data = self._get_json(f"/rest/workspaces/{workspace}/datastores.json")
        datastores = data.get("dataStores", {})
        if not datastores:
            return []
        return datastores.get("dataStore", [])

    def get_datastore(self, workspace: str, name: str) -> dict[str, Any]:
        """Get data store details.

        Args:
            workspace: Workspace name
            name: Data store name

        Returns:
            Data store details dictionary
        """
        data = self._get_json(f"/rest/workspaces/{workspace}/datastores/{name}.json")
        return data.get("dataStore", {})

    def create_datastore(
        self,
        workspace: str,
        name: str,
        connection_params: dict[str, str],
        description: str = "",
        enabled: bool = True,
    ) -> None:
        """Create a new data store.

        Args:
            workspace: Workspace name
            name: Data store name
            connection_params: Connection parameters (dbtype, host, port, database, user, passwd, schema)
            description: Store description
            enabled: Whether store is enabled
        """
        # Format connection parameters
        entries = [{"@key": k, "$": v} for k, v in connection_params.items()]

        payload = {
            "dataStore": {
                "name": name,
                "description": description,
                "enabled": enabled,
                "connectionParameters": {"entry": entries},
            }
        }

        response = self._request(
            "POST",
            f"/rest/workspaces/{workspace}/datastores.json",
            json=payload,
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to create datastore: {response.text}",
                status_code=response.status_code,
            )

    def delete_datastore(
        self, workspace: str, name: str, recurse: bool = False
    ) -> None:
        """Delete a data store.

        Args:
            workspace: Workspace name
            name: Data store name
            recurse: Delete all contained layers
        """
        response = self._request(
            "DELETE",
            f"/rest/workspaces/{workspace}/datastores/{name}",
            params={"recurse": str(recurse).lower()},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to delete datastore: {response.text}",
                status_code=response.status_code,
            )

    # === Coverage Stores ===

    def list_coveragestores(self, workspace: str) -> list[dict[str, Any]]:
        """List all coverage stores in a workspace.

        Args:
            workspace: Workspace name

        Returns:
            List of coverage store dictionaries
        """
        data = self._get_json(f"/rest/workspaces/{workspace}/coveragestores.json")
        stores = data.get("coverageStores", {})
        if not stores:
            return []
        return stores.get("coverageStore", [])

    def get_coveragestore(self, workspace: str, name: str) -> dict[str, Any]:
        """Get coverage store details.

        Args:
            workspace: Workspace name
            name: Coverage store name

        Returns:
            Coverage store details dictionary
        """
        data = self._get_json(
            f"/rest/workspaces/{workspace}/coveragestores/{name}.json"
        )
        return data.get("coverageStore", {})

    def create_coveragestore(
        self,
        workspace: str,
        name: str,
        store_type: str = "GeoTIFF",
        url: str | None = None,
        description: str = "",
        enabled: bool = True,
    ) -> None:
        """Create a new coverage store.

        Args:
            workspace: Workspace name
            name: Coverage store name
            store_type: Store type (GeoTIFF, WorldImage, etc.)
            url: URL to coverage data
            description: Store description
            enabled: Whether store is enabled
        """
        payload = {
            "coverageStore": {
                "name": name,
                "type": store_type,
                "enabled": enabled,
            }
        }
        if description:
            payload["coverageStore"]["description"] = description
        if url:
            payload["coverageStore"]["url"] = url

        response = self._request(
            "POST",
            f"/rest/workspaces/{workspace}/coveragestores.json",
            json=payload,
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to create coveragestore: {response.text}",
                status_code=response.status_code,
            )

    def delete_coveragestore(
        self, workspace: str, name: str, recurse: bool = False
    ) -> None:
        """Delete a coverage store.

        Args:
            workspace: Workspace name
            name: Coverage store name
            recurse: Delete all contained coverages
        """
        response = self._request(
            "DELETE",
            f"/rest/workspaces/{workspace}/coveragestores/{name}",
            params={"recurse": str(recurse).lower()},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to delete coveragestore: {response.text}",
                status_code=response.status_code,
            )

    # === Feature Types ===

    def list_featuretypes(self, workspace: str, datastore: str) -> list[dict[str, Any]]:
        """List all feature types in a data store.

        Args:
            workspace: Workspace name
            datastore: Data store name

        Returns:
            List of feature type dictionaries
        """
        data = self._get_json(
            f"/rest/workspaces/{workspace}/datastores/{datastore}/featuretypes.json"
        )
        featuretypes = data.get("featureTypes", {})
        if not featuretypes:
            return []
        return featuretypes.get("featureType", [])

    def get_featuretype(
        self, workspace: str, datastore: str, name: str
    ) -> dict[str, Any]:
        """Get feature type details.

        Args:
            workspace: Workspace name
            datastore: Data store name
            name: Feature type name

        Returns:
            Feature type details dictionary
        """
        data = self._get_json(
            f"/rest/workspaces/{workspace}/datastores/{datastore}/featuretypes/{name}.json"
        )
        return data.get("featureType", {})

    def create_featuretype(
        self,
        workspace: str,
        datastore: str,
        name: str,
        native_name: str | None = None,
        title: str | None = None,
        srs: str = "EPSG:4326",
    ) -> None:
        """Create/publish a feature type.

        Args:
            workspace: Workspace name
            datastore: Data store name
            name: Feature type name
            native_name: Native table name (defaults to name)
            title: Layer title
            srs: Coordinate reference system
        """
        payload = {
            "featureType": {
                "name": name,
                "nativeName": native_name or name,
                "title": title or name,
                "srs": srs,
            }
        }

        response = self._request(
            "POST",
            f"/rest/workspaces/{workspace}/datastores/{datastore}/featuretypes.json",
            json=payload,
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to create featuretype: {response.text}",
                status_code=response.status_code,
            )

    def delete_featuretype(
        self, workspace: str, datastore: str, name: str, recurse: bool = False
    ) -> None:
        """Delete a feature type.

        Args:
            workspace: Workspace name
            datastore: Data store name
            name: Feature type name
            recurse: Delete the layer as well
        """
        response = self._request(
            "DELETE",
            f"/rest/workspaces/{workspace}/datastores/{datastore}/featuretypes/{name}",
            params={"recurse": str(recurse).lower()},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to delete featuretype: {response.text}",
                status_code=response.status_code,
            )

    # === Coverages ===

    def list_coverages(self, workspace: str, coveragestore: str) -> list[dict[str, Any]]:
        """List all coverages in a coverage store.

        Args:
            workspace: Workspace name
            coveragestore: Coverage store name

        Returns:
            List of coverage dictionaries
        """
        data = self._get_json(
            f"/rest/workspaces/{workspace}/coveragestores/{coveragestore}/coverages.json"
        )
        coverages = data.get("coverages", {})
        if not coverages:
            return []
        return coverages.get("coverage", [])

    def get_coverage(
        self, workspace: str, coveragestore: str, name: str
    ) -> dict[str, Any]:
        """Get coverage details.

        Args:
            workspace: Workspace name
            coveragestore: Coverage store name
            name: Coverage name

        Returns:
            Coverage details dictionary
        """
        data = self._get_json(
            f"/rest/workspaces/{workspace}/coveragestores/{coveragestore}/coverages/{name}.json"
        )
        return data.get("coverage", {})

    # === Layers ===

    def list_layers(self, workspace: str | None = None) -> list[dict[str, Any]]:
        """List all layers, optionally filtered by workspace.

        Args:
            workspace: Optional workspace name to filter by

        Returns:
            List of layer dictionaries
        """
        if workspace:
            data = self._get_json(f"/rest/workspaces/{workspace}/layers.json")
        else:
            data = self._get_json("/rest/layers.json")

        layers = data.get("layers", {})
        if not layers:
            return []
        return layers.get("layer", [])

    def get_layer(self, workspace: str, name: str) -> dict[str, Any]:
        """Get layer details.

        Args:
            workspace: Workspace name
            name: Layer name

        Returns:
            Layer details dictionary
        """
        data = self._get_json(f"/rest/workspaces/{workspace}/layers/{name}.json")
        return data.get("layer", {})

    def update_layer(
        self,
        workspace: str,
        name: str,
        enabled: bool | None = None,
        advertised: bool | None = None,
        queryable: bool | None = None,
        default_style: str | None = None,
    ) -> None:
        """Update layer properties.

        Args:
            workspace: Workspace name
            name: Layer name
            enabled: Whether layer is enabled
            advertised: Whether layer is advertised in capabilities
            queryable: Whether layer supports queries
            default_style: Default style name
        """
        payload: dict[str, Any] = {"layer": {}}

        if enabled is not None:
            payload["layer"]["enabled"] = enabled
        if advertised is not None:
            payload["layer"]["advertised"] = advertised
        if queryable is not None:
            payload["layer"]["queryable"] = queryable
        if default_style:
            payload["layer"]["defaultStyle"] = {"name": default_style}

        response = self._request(
            "PUT",
            f"/rest/workspaces/{workspace}/layers/{name}.json",
            json=payload,
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to update layer: {response.text}",
                status_code=response.status_code,
            )

    def delete_layer(self, workspace: str, name: str, recurse: bool = False) -> None:
        """Delete a layer.

        Args:
            workspace: Workspace name
            name: Layer name
            recurse: Delete underlying resource
        """
        response = self._request(
            "DELETE",
            f"/rest/workspaces/{workspace}/layers/{name}",
            params={"recurse": str(recurse).lower()},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to delete layer: {response.text}",
                status_code=response.status_code,
            )

    def get_layer_feature_count(self, workspace: str, layer: str) -> int:
        """Get the feature count for a vector layer via WFS.

        Args:
            workspace: Workspace name
            layer: Layer name

        Returns:
            Number of features in the layer
        """
        # Use WFS GetFeature with resultType=hits
        response = self._request(
            "GET",
            f"/wfs",
            params={
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": f"{workspace}:{layer}",
                "resultType": "hits",
            },
        )

        if response.status_code == 200:
            # Parse XML response to get numberMatched
            try:
                root = ET.fromstring(response.text)
                # WFS 2.0 returns numberMatched attribute
                count = root.get("numberMatched")
                if count:
                    return int(count)
            except (ET.ParseError, ValueError):
                pass

        return 0

    # === Styles ===

    def list_styles(self, workspace: str | None = None) -> list[dict[str, Any]]:
        """List all styles, optionally filtered by workspace.

        Args:
            workspace: Optional workspace name to filter by

        Returns:
            List of style dictionaries
        """
        if workspace:
            data = self._get_json(f"/rest/workspaces/{workspace}/styles.json")
        else:
            data = self._get_json("/rest/styles.json")

        styles = data.get("styles", {})
        if not styles:
            return []
        return styles.get("style", [])

    def get_style(self, name: str, workspace: str | None = None) -> dict[str, Any]:
        """Get style details.

        Args:
            name: Style name
            workspace: Optional workspace name

        Returns:
            Style details dictionary
        """
        if workspace:
            data = self._get_json(f"/rest/workspaces/{workspace}/styles/{name}.json")
        else:
            data = self._get_json(f"/rest/styles/{name}.json")
        return data.get("style", {})

    def get_style_content(
        self, name: str, workspace: str | None = None
    ) -> tuple[str, str]:
        """Get style content (SLD/CSS).

        Args:
            name: Style name
            workspace: Optional workspace name

        Returns:
            Tuple of (content, format) where format is 'sld' or 'css'
        """
        # First get style metadata to determine format
        style = self.get_style(name, workspace)
        style_format = style.get("format", "sld")

        # Map format to file extension
        ext_map = {
            "sld": "sld",
            "css": "css",
            "mbstyle": "json",
        }
        ext = ext_map.get(style_format, "sld")

        # Build path
        if workspace:
            path = f"/rest/workspaces/{workspace}/styles/{name}.{ext}"
        else:
            path = f"/rest/styles/{name}.{ext}"

        response = self._request("GET", path)
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to get style content: {response.text}",
                status_code=response.status_code,
            )

        return response.text, style_format

    def create_style(
        self,
        name: str,
        content: str,
        style_format: str = "sld",
        workspace: str | None = None,
    ) -> None:
        """Create a new style.

        Args:
            name: Style name
            content: Style content (SLD or CSS)
            style_format: Style format ('sld' or 'css')
            workspace: Optional workspace name
        """
        # First create the style entry
        payload = {
            "style": {
                "name": name,
                "format": style_format,
            }
        }

        if workspace:
            path = f"/rest/workspaces/{workspace}/styles.json"
        else:
            path = "/rest/styles.json"

        response = self._request("POST", path, json=payload)
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to create style: {response.text}",
                status_code=response.status_code,
            )

        # Then upload the style content
        self.update_style_content(name, content, style_format, workspace)

    def update_style_content(
        self,
        name: str,
        content: str,
        style_format: str = "sld",
        workspace: str | None = None,
    ) -> None:
        """Update style content.

        Args:
            name: Style name
            content: New style content
            style_format: Style format ('sld' or 'css')
            workspace: Optional workspace name
        """
        # Determine content type
        content_type_map = {
            "sld": "application/vnd.ogc.sld+xml",
            "css": "application/vnd.geoserver.geocss+css",
            "mbstyle": "application/vnd.geoserver.mbstyle+json",
        }
        content_type = content_type_map.get(style_format, "application/vnd.ogc.sld+xml")

        # Build path
        ext_map = {"sld": "sld", "css": "css", "mbstyle": "json"}
        ext = ext_map.get(style_format, "sld")

        if workspace:
            path = f"/rest/workspaces/{workspace}/styles/{name}.{ext}"
        else:
            path = f"/rest/styles/{name}.{ext}"

        response = self._request(
            "PUT",
            path,
            content=content.encode("utf-8"),
            headers={"Content-Type": content_type},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to update style content: {response.text}",
                status_code=response.status_code,
            )

    def delete_style(
        self, name: str, workspace: str | None = None, purge: bool = False
    ) -> None:
        """Delete a style.

        Args:
            name: Style name
            workspace: Optional workspace name
            purge: Purge style file from disk
        """
        if workspace:
            path = f"/rest/workspaces/{workspace}/styles/{name}"
        else:
            path = f"/rest/styles/{name}"

        response = self._request(
            "DELETE",
            path,
            params={"purge": str(purge).lower()},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to delete style: {response.text}",
                status_code=response.status_code,
            )

    # === Layer Groups ===

    def list_layergroups(self, workspace: str | None = None) -> list[dict[str, Any]]:
        """List all layer groups, optionally filtered by workspace.

        Args:
            workspace: Optional workspace name to filter by

        Returns:
            List of layer group dictionaries
        """
        if workspace:
            data = self._get_json(f"/rest/workspaces/{workspace}/layergroups.json")
        else:
            data = self._get_json("/rest/layergroups.json")

        groups = data.get("layerGroups", {})
        if not groups:
            return []
        return groups.get("layerGroup", [])

    def get_layergroup(self, name: str, workspace: str | None = None) -> dict[str, Any]:
        """Get layer group details.

        Args:
            name: Layer group name
            workspace: Optional workspace name

        Returns:
            Layer group details dictionary
        """
        if workspace:
            data = self._get_json(f"/rest/workspaces/{workspace}/layergroups/{name}.json")
        else:
            data = self._get_json(f"/rest/layergroups/{name}.json")
        return data.get("layerGroup", {})

    # === Layer Styles ===

    def get_layer_styles(self, workspace: str, layer: str) -> dict[str, Any]:
        """Get styles associated with a layer.

        Args:
            workspace: Workspace name
            layer: Layer name

        Returns:
            Dictionary with defaultStyle (string) and additionalStyles (list of strings)
        """
        layer_data = self.get_layer(workspace, layer)

        # Extract default style name (GeoServer returns {name, href} object)
        default_style_obj = layer_data.get("defaultStyle", {})
        default_style = default_style_obj.get("name", "") if isinstance(default_style_obj, dict) else ""

        # Extract additional style names
        styles_obj = layer_data.get("styles", {})
        style_list = styles_obj.get("style", []) if isinstance(styles_obj, dict) else []
        additional_styles = [
            s.get("name", "") if isinstance(s, dict) else s
            for s in style_list
            if s
        ]

        return {
            "defaultStyle": default_style,
            "additionalStyles": additional_styles,
        }

    def update_layer_styles(
        self,
        workspace: str,
        layer: str,
        default_style: str,
        additional_styles: list[str] | None = None,
    ) -> None:
        """Update layer style associations.

        Args:
            workspace: Workspace name
            layer: Layer name
            default_style: Default style name
            additional_styles: List of additional style names
        """
        payload: dict[str, Any] = {
            "layer": {
                "defaultStyle": {"name": default_style},
            }
        }

        if additional_styles:
            payload["layer"]["styles"] = {
                "style": [{"name": s} for s in additional_styles]
            }

        response = self._request(
            "PUT",
            f"/rest/workspaces/{workspace}/layers/{layer}.json",
            json=payload,
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to update layer styles: {response.text}",
                status_code=response.status_code,
            )

    # === Layer Metadata ===

    def get_layer_metadata(self, workspace: str, layer: str) -> dict[str, Any]:
        """Get layer metadata including bounding box.

        Args:
            workspace: Workspace name
            layer: Layer name

        Returns:
            Layer metadata dictionary
        """
        layer_data = self.get_layer(workspace, layer)

        # Get resource details for bounding box
        resource = layer_data.get("resource", {})
        resource_class = resource.get("@class", "")
        resource_href = resource.get("href", "")

        # Determine if this is a featuretype or coverage
        bbox = None
        if "featureType" in resource_class and resource_href:
            # Extract path from href and fetch feature type
            # href looks like: http://server/geoserver/rest/workspaces/ws/datastores/ds/featuretypes/ft.json
            try:
                ft_response = self._client.get(resource_href)
                if ft_response.status_code == 200:
                    ft_data = ft_response.json().get("featureType", {})
                    bbox = ft_data.get("nativeBoundingBox") or ft_data.get("latLonBoundingBox")
            except Exception:
                pass
        elif "coverage" in resource_class and resource_href:
            try:
                cov_response = self._client.get(resource_href)
                if cov_response.status_code == 200:
                    cov_data = cov_response.json().get("coverage", {})
                    bbox = cov_data.get("nativeBoundingBox") or cov_data.get("latLonBoundingBox")
            except Exception:
                pass

        return {
            "name": layer_data.get("name"),
            "type": layer_data.get("type"),
            "enabled": layer_data.get("enabled"),
            "advertised": layer_data.get("advertised"),
            "queryable": layer_data.get("queryable"),
            "defaultStyle": layer_data.get("defaultStyle", {}),
            "bbox": bbox,
            "resource": resource,
        }

    # === File Uploads ===

    def upload_shapefile(
        self,
        workspace: str,
        datastore: str,
        data: bytes,
        charset: str = "UTF-8",
    ) -> None:
        """Upload a shapefile ZIP to create a data store.

        Args:
            workspace: Workspace name
            datastore: Data store name to create
            data: ZIP file bytes containing shapefile
            charset: Character encoding
        """
        response = self._request(
            "PUT",
            f"/rest/workspaces/{workspace}/datastores/{datastore}/file.shp",
            content=data,
            headers={"Content-Type": "application/zip"},
            params={"charset": charset},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to upload shapefile: {response.text}",
                status_code=response.status_code,
            )

    def upload_geotiff(
        self,
        workspace: str,
        coveragestore: str,
        data: bytes,
    ) -> None:
        """Upload a GeoTIFF to create a coverage store.

        Args:
            workspace: Workspace name
            coveragestore: Coverage store name to create
            data: GeoTIFF file bytes
        """
        response = self._request(
            "PUT",
            f"/rest/workspaces/{workspace}/coveragestores/{coveragestore}/file.geotiff",
            content=data,
            headers={"Content-Type": "image/tiff"},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to upload GeoTIFF: {response.text}",
                status_code=response.status_code,
            )

    def upload_geopackage(
        self,
        workspace: str,
        datastore: str,
        data: bytes,
    ) -> None:
        """Upload a GeoPackage to create a data store.

        Args:
            workspace: Workspace name
            datastore: Data store name to create
            data: GeoPackage file bytes
        """
        response = self._request(
            "PUT",
            f"/rest/workspaces/{workspace}/datastores/{datastore}/file.gpkg",
            content=data,
            headers={"Content-Type": "application/geopackage+sqlite3"},
        )
        if response.status_code >= 400:
            raise GeoServerError(
                f"Failed to upload GeoPackage: {response.text}",
                status_code=response.status_code,
            )

    # === Available (Unpublished) Feature Types ===

    def list_available_featuretypes(
        self, workspace: str, datastore: str
    ) -> list[str]:
        """List available (unpublished) feature types in a data store.

        Args:
            workspace: Workspace name
            datastore: Data store name

        Returns:
            List of unpublished feature type names
        """
        response = self._request(
            "GET",
            f"/rest/workspaces/{workspace}/datastores/{datastore}/featuretypes.json",
            params={"list": "available"},
        )

        if response.status_code == 200:
            data = response.json()
            feature_type_names = data.get("list", {}).get("string", [])
            # Handle single string case (GeoServer returns string instead of list for single item)
            if isinstance(feature_type_names, str):
                return [feature_type_names]
            return feature_type_names

        return []


class GeoServerClientManager:
    """Manager for GeoServer clients, scoped per user."""

    def __init__(self, user_id: str = "default") -> None:
        self._user_id = user_id

    def get_client(self, connection_id: str) -> GeoServerClient:
        """Get a GeoServer client for the given connection.

        Args:
            connection_id: Connection ID

        Returns:
            GeoServerClient instance

        Raises:
            ValueError: If connection not found
        """
        from apps.core.config import get_config

        conn = get_config(self._user_id).get_connection(connection_id)
        if not conn:
            raise ValueError(f"GeoServer connection not found: {connection_id}")

        return GeoServerClient(conn)


def get_geoserver_client(conn_id: str, user_id: str = "default") -> GeoServerClient:
    """Get a GeoServer client for a connection.

    Args:
        conn_id: Connection ID
        user_id: User ID for config scoping

    Returns:
        GeoServerClient instance

    Raises:
        GeoServerError: If connection not found
    """
    manager = GeoServerClientManager(user_id)
    return manager.get_client(conn_id)
