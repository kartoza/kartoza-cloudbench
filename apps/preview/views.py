"""Views for layer preview functionality.

Provides endpoints for:
- Starting a preview session
- Getting layer information
- Getting layer metadata from GeoServer
"""

import uuid
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.geoserver.client import get_geoserver_client


@dataclass
class PreviewSession:
    """Represents an active preview session."""

    id: str
    conn_id: str
    workspace: str
    layer_name: str
    store_name: Optional[str] = None
    store_type: Optional[str] = None
    layer_type: str = "vector"
    use_cache: bool = False
    grid_set: Optional[str] = None
    tile_format: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)


class PreviewSessionManager:
    """Thread-safe manager for preview sessions."""

    _instance: "PreviewSessionManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "PreviewSessionManager":
        """Singleton pattern for session manager."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._sessions: dict[str, PreviewSession] = {}
        return cls._instance

    def create_session(
        self,
        conn_id: str,
        workspace: str,
        layer_name: str,
        store_name: Optional[str] = None,
        store_type: Optional[str] = None,
        layer_type: str = "vector",
        use_cache: bool = False,
        grid_set: Optional[str] = None,
        tile_format: Optional[str] = None,
    ) -> PreviewSession:
        """Create a new preview session."""
        with self._lock:
            session_id = str(uuid.uuid4())

            session = PreviewSession(
                id=session_id,
                conn_id=conn_id,
                workspace=workspace,
                layer_name=layer_name,
                store_name=store_name,
                store_type=store_type,
                layer_type=layer_type,
                use_cache=use_cache,
                grid_set=grid_set,
                tile_format=tile_format,
            )

            self._sessions[session_id] = session
            return session

    def get_session(self, session_id: str) -> Optional[PreviewSession]:
        """Get a preview session by ID."""
        with self._lock:
            return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> None:
        """Delete a preview session."""
        with self._lock:
            self._sessions.pop(session_id, None)


# Global session manager
session_manager = PreviewSessionManager()


class StartPreviewView(APIView):
    """Start a layer preview session."""

    def post(self, request):
        """Create a new preview session.

        Expected body:
        {
            "connId": "conn_123",
            "workspace": "topp",
            "layerName": "states",
            "storeName": "states_shapefile",
            "storeType": "shapefile",
            "layerType": "vector",
            "useCache": false,
            "gridSet": "EPSG:900913",
            "tileFormat": "image/png"
        }
        """
        conn_id = request.data.get("connId")
        workspace = request.data.get("workspace")
        layer_name = request.data.get("layerName")
        store_name = request.data.get("storeName")
        store_type = request.data.get("storeType")
        layer_type = request.data.get("layerType", "vector")
        use_cache = request.data.get("useCache", False)
        grid_set = request.data.get("gridSet")
        tile_format = request.data.get("tileFormat")

        if not conn_id or not workspace or not layer_name:
            return Response(
                {"error": "connId, workspace, and layerName are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = session_manager.create_session(
            conn_id=conn_id,
            workspace=workspace,
            layer_name=layer_name,
            store_name=store_name,
            store_type=store_type,
            layer_type=layer_type,
            use_cache=use_cache,
            grid_set=grid_set,
            tile_format=tile_format,
        )

        # Return the preview URL pointing to our API
        # The frontend expects to fetch /api/layer and /api/metadata from this URL
        preview_url = reverse("preview_layer", kwargs={"session_id": session.id}).removesuffix("/api/layer")

        return Response(
            {"url": preview_url},
            status=status.HTTP_201_CREATED,
        )


class PreviewLayerView(APIView):
    """Get layer information for a preview session."""

    def get(self, request, session_id):
        """Get layer info for the preview.

        Returns layer configuration needed by MapPreview component.
        """
        session = session_manager.get_session(session_id)
        if not session:
            return Response(
                {"error": "Preview session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            # Get the GeoServer URL from the connection
            client = get_geoserver_client(session.conn_id, str(request.user.id))
            geoserver_url = client.connection.url.rstrip("/")

            return Response({
                "name": session.layer_name,
                "workspace": session.workspace,
                "store_name": session.store_name or "",
                "store_type": session.store_type or "datastore",
                "geoserver_url": geoserver_url,
                "type": session.layer_type,
                "use_cache": session.use_cache,
                "grid_set": session.grid_set,
                "tile_format": session.tile_format,
            })
        except Exception as e:
            return Response(
                {"error": f"Failed to get layer info: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class PreviewMetadataView(APIView):
    """Get layer metadata for a preview session."""

    def get(self, request, session_id):
        """Get layer metadata from GeoServer.

        Returns bounds and other metadata for the MapPreview component.
        """
        session = session_manager.get_session(session_id)
        if not session:
            return Response(
                {"error": "Preview session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            client = get_geoserver_client(session.conn_id, str(request.user.id))

            # Use the client's get_layer_metadata method
            layer_meta = client.get_layer_metadata(session.workspace, session.layer_name)

            # Format for frontend - ensure boolean defaults (not None)
            metadata = {
                "layer_enabled": layer_meta.get("enabled") if layer_meta.get("enabled") is not None else True,
                "layer_queryable": layer_meta.get("queryable") if layer_meta.get("queryable") is not None else True,
                "layer_advertised": layer_meta.get("advertised") if layer_meta.get("advertised") is not None else True,
            }

            # Get default style name
            default_style = layer_meta.get("defaultStyle", {})
            if isinstance(default_style, dict):
                metadata["default_style"] = default_style.get("name", "")

            # Get bounding box
            bbox = layer_meta.get("bbox")
            if bbox:
                metadata["latlon_bbox"] = {
                    "minx": bbox.get("minx", -180),
                    "miny": bbox.get("miny", -90),
                    "maxx": bbox.get("maxx", 180),
                    "maxy": bbox.get("maxy", 90),
                }

            # Get resource info for title/abstract
            resource = layer_meta.get("resource", {})
            if resource:
                resource_href = resource.get("href", "")
                if resource_href:
                    try:
                        # Fetch resource details
                        response = client._client.get(resource_href)
                        if response.status_code == 200:
                            data = response.json()
                            # Try featureType first, then coverage
                            ft = data.get("featureType", {})
                            cov = data.get("coverage", {})
                            resource_data = ft or cov

                            if resource_data:
                                metadata["layer_title"] = resource_data.get("title", "")
                                metadata["layer_abstract"] = resource_data.get("abstract", "")
                                metadata["layer_srs"] = resource_data.get("srs", "")
                                metadata["layer_native_crs"] = resource_data.get("nativeCRS", "")
                                metadata["store_format"] = "Vector" if ft else "Raster"

                                # Also get latLonBoundingBox if bbox wasn't set
                                if "latlon_bbox" not in metadata:
                                    ll_bbox = resource_data.get("latLonBoundingBox", {})
                                    if ll_bbox:
                                        metadata["latlon_bbox"] = {
                                            "minx": ll_bbox.get("minx", -180),
                                            "miny": ll_bbox.get("miny", -90),
                                            "maxx": ll_bbox.get("maxx", 180),
                                            "maxy": ll_bbox.get("maxy", 90),
                                        }
                    except Exception:
                        pass

            return Response(metadata)

        except Exception as e:
            return Response(
                {"error": f"Failed to get metadata: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
