"""GeoNode API client.

Provides a client for interacting with GeoNode REST API
for managing geospatial data catalog and services.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import httpx

from apps.core.config import get_config

from .utilities import RESOURCE_TYPE_LIST_REQUEST_MAP

if TYPE_CHECKING:
    from django.contrib.auth.models import User

logger = logging.getLogger(__name__)


@dataclass
class GeoNodeResource:
    """GeoNode resource information."""

    pk: int
    uuid: str
    name: str
    title: str
    abstract: str = ""
    category: str = ""
    owner: str = ""
    date: str = ""
    thumbnail_url: str = ""
    detail_url: str = ""
    resource_type: str = ""
    subtype: str = ""
    # A dataset's layer name, "workspace:name": the map preview's WMS layer.
    alternate: str = ""
    # [west, south, east, north] in lon/lat: the map preview zooms to it.
    ll_bbox: list[float] = field(default_factory=list)

    @classmethod
    def from_api(cls, item: dict[str, Any]) -> "GeoNodeResource":
        """Build from one resource of GeoNode's API (``/resources``, ``/datasets/<pk>``…)."""
        category = item.get("category") or {}
        owner = item.get("owner") or {}
        return cls(
            pk=item.get("pk", 0),
            uuid=item.get("uuid", ""),
            name=item.get("name") or "",
            title=item.get("title", ""),
            abstract=item.get("abstract", ""),
            category=category.get("identifier", ""),
            owner=owner.get("username", ""),
            date=item.get("date", ""),
            thumbnail_url=item.get("thumbnail_url") or "",
            detail_url=item.get("detail_url") or "",
            resource_type=item.get("resource_type") or "",
            subtype=item.get("subtype") or "",
            alternate=item.get("alternate") or "",
            ll_bbox=_ll_bbox(item),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary.

        GeoNode's own field names: the frontend reads them as GeoNode sends
        them (web/src/types: GeoNodeResource / GeoNodeDataset).
        """
        return {
            "pk": self.pk,
            "uuid": self.uuid,
            "name": self.name,
            "title": self.title,
            "abstract": self.abstract,
            "category": self.category,
            "owner": self.owner,
            "date": self.date,
            "thumbnail_url": self.thumbnail_url,
            "detail_url": self.detail_url,
            "resource_type": self.resource_type,
            "subtype": self.subtype,
            "alternate": self.alternate,
            "ll_bbox": self.ll_bbox,
        }


def _ll_bbox(item: dict[str, Any]) -> list[float]:
    """A resource's lon/lat bounds, from GeoNode's ``ll_bbox_polygon``; [] if none."""
    try:
        ring = (item.get("ll_bbox_polygon") or {}).get("coordinates")[0]
        xs = [float(point[0]) for point in ring]
        ys = [float(point[1]) for point in ring]
    except (AttributeError, IndexError, TypeError, ValueError):
        return []
    if not xs:
        return []
    return [min(xs), min(ys), max(xs), max(ys)]


class GeoNodeClient:
    """Client for GeoNode REST API."""

    def __init__(
        self,
        url: str,
        username: str | None = None,
        password: str | None = None,
        api_key: str | None = None,
    ):
        """Initialize GeoNode client.

        Args:
            url: GeoNode server URL
            username: Username for authentication
            password: Password for authentication
            api_key: GeoNode OAuth2 access token (alternative to username/password),
                sent as a Bearer token
        """
        self.url = url.rstrip("/")
        self.username = username
        self.password = password
        self.api_key = api_key

        # Create HTTP client
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        auth = None
        if username and password:
            auth = httpx.BasicAuth(username, password)

        self.client = httpx.Client(
            base_url=f"{self.url}/api/v2",
            timeout=30.0,
            headers=headers,
            auth=auth,
        )

    def test_connection(self) -> tuple[bool, str]:
        """Test the connection.

        Probes ``/api/v2/resources`` — the endpoint the app actually reads —
        rather than the API root ``/api/v2/``. The root answers 401 whenever
        credentials are present but rejected there, even for a GeoNode that
        serves resources and accepts uploads fine, so testing it reported a
        working connection as broken. This also tells "can't reach GeoNode"
        apart from "GeoNode rejected these credentials".

        Returns:
            Tuple of (success, message)
        """
        try:
            response = self.client.get("/resources", params={"page_size": 1})
        except Exception as e:
            return False, f"Could not reach GeoNode at {self.url}: {e}"

        if response.status_code in (401, 403):
            if self.username or self.api_key:
                return False, "Reached GeoNode, but it rejected the credentials."
            return False, "GeoNode requires authentication; add a username/password or API token."
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            return False, f"HTTP error: {e.response.status_code}"
        return True, f"Connected to GeoNode at {self.url}"

    def list_categories(self) -> list[dict[str, Any]]:
        """List resource categories.

        Returns:
            List of categories
        """
        response = self.client.get("/categories")
        response.raise_for_status()

        return response.json().get("categories", [])

    def list_users(
        self,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """List users.

        Args:
            page: Page number
            page_size: Items per page

        Returns:
            Dictionary with users and pagination info
        """
        params = {
            "page": page,
            "page_size": page_size,
        }

        response = self.client.get("/users", params=params)
        response.raise_for_status()

        return response.json()

    def list_resources(
        self,
        resource_type: str,
        page: int = 1,
        page_size: int = 20,
        category: str | None = None,
        owner: str | None = None,
    ) -> dict[str, Any]:
        """List resources by type.

        Args:
            resource_type: One of datasets, maps, documents, geostories,
                dashboards.
            page: Page number
            page_size: Items per page
            category: Filter by category identifier
            owner: Filter by owner username

        Returns:
            Dictionary with resources and pagination info
        """
        params: dict[str, Any] = {
            "page": page,
            "page_size": page_size,
        }
        params["filter{resource_type.in}"] = RESOURCE_TYPE_LIST_REQUEST_MAP.get(
            resource_type, resource_type
        )
        if category:
            params["filter{category__identifier}"] = category
        if owner:
            params["filter{owner__username}"] = owner

        response = self.client.get("/resources", params=params)
        response.raise_for_status()

        data = response.json()
        resources = [GeoNodeResource.from_api(item) for item in data.get("resources", [])]

        return {
            resource_type: [r.to_dict() for r in resources],
            "total": data.get("total", 0),
            "page": data.get("page", 1),
            "pageSize": data.get("page_size", 20),
        }

    def upload_dataset(
        self,
        file: bytes,
        filename: str,
        charset: str = "UTF-8",
        title: str | None = None,
        abstract: str | None = None,
    ) -> dict[str, Any]:
        """Upload a dataset file to GeoNode.

        Args:
            file: File content as bytes
            filename: Original filename (e.g. roads.zip, dem.tif)
            charset: Character encoding of the dataset
            title: Optional dataset title
            abstract: Optional dataset abstract/description

        Returns:
            Upload response dict with execution_id and redirect_to
        """
        ext = filename.rsplit(".", 1)[-1].lower()
        mime_types = {
            "zip": "application/zip",
            "shp": "application/octet-stream",
            "tif": "image/tiff",
            "tiff": "image/tiff",
            "gpkg": "application/geopackage+sqlite3",
            "geojson": "application/geo+json",
            "json": "application/geo+json",
            "kml": "application/vnd.google-earth.kml+xml",
            "csv": "text/csv",
        }
        mime = mime_types.get(ext, "application/octet-stream")

        files = {"base_file": (filename, file, mime)}
        data: dict[str, str] = {"charset": charset}
        if ext == "zip":
            data["store_spatial_files"] = "true"
            files["zip_file"] = (filename, file, mime)
        if title:
            data["dataset_title"] = title
        if abstract:
            data["abstract"] = abstract

        response = self.client.post(
            "/uploads/upload",
            files=files,
            data=data,
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()

    def get_execution(self, execution_id: str) -> dict[str, Any]:
        """The importer's execution request for an upload (status, resources)."""
        response = self.client.get(f"/executionrequest/{execution_id}")
        response.raise_for_status()
        return response.json().get("request", {})

    def update_dataset(self, dataset_id: int, fields: dict[str, Any]) -> None:
        """Change a dataset's metadata (title, abstract…)."""
        response = self.client.patch(f"/datasets/{dataset_id}", json=fields)
        response.raise_for_status()

    def apply_dataset_metadata(
        self,
        execution_id: str,
        title: str | None = None,
        abstract: str | None = None,
        timeout: float = 600,
        interval: float = 5,
    ) -> list[int]:
        """Give the datasets an upload created their title and abstract.

        GeoNode's importer ignores the title and abstract sent with the
        upload (the dataset is named after its file or layer), so set them
        once the import has finished. Returns the datasets changed; none if
        the import failed or didn't finish in ``timeout`` seconds.
        """
        fields = {k: v for k, v in (("title", title), ("abstract", abstract)) if v}
        if not fields:
            return []
        deadline = time.monotonic() + timeout
        while True:
            execution = self.get_execution(execution_id)
            status = execution.get("status")
            if status == "finished":
                break
            if status == "failed" or time.monotonic() > deadline:
                logger.warning("GeoNode import %s ended %s: metadata not set", execution_id, status)
                return []
            time.sleep(interval)
        resources = (execution.get("output_params") or {}).get("resources") or []
        ids = [r["id"] for r in resources if r.get("id")]
        if not ids and execution.get("geonode_resource"):
            ids = [execution["geonode_resource"]]
        for dataset_id in ids:
            self.update_dataset(dataset_id, fields)
        return ids

    def upload_document(
        self,
        file: bytes,
        filename: str,
        title: str | None = None,
        abstract: str | None = None,
    ) -> dict[str, Any]:
        """Upload a document to GeoNode.

        Args:
            file: File content as bytes
            filename: Original filename (e.g. report.pdf, photo.jpg)
            title: Optional document title
            abstract: Optional document abstract/description

        Returns:
            Upload response dict from GeoNode documents API
        """
        import mimetypes

        mime, _ = mimetypes.guess_type(filename)
        mime = mime or "application/octet-stream"

        files = {"doc_file": (filename, file, mime)}
        data: dict[str, str] = {}
        if title:
            data["title"] = title
        if abstract:
            data["abstract"] = abstract

        response = self.client.post(
            "/documents/",
            files=files,
            data=data,
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()

    def get_resource(self, resource_type: str, resource_id: int) -> GeoNodeResource:
        """Get a specific resource.

        Args:
            resource_type: One of datasets, maps, documents, geostories,
                dashboards.
            resource_id: Resource primary key

        Returns:
            GeoNodeResource

        Raises:
            httpx.HTTPStatusError: On HTTP errors including 404
        """
        response = self.client.get(f"/{resource_type}/{resource_id}")
        response.raise_for_status()
        return GeoNodeResource.from_api(response.json().get(resource_type.rstrip("s"), {}))


def get_geonode_client(connection_id: str, user: "User") -> GeoNodeClient:
    """Get a GeoNode client for a connection."""
    conn = get_config(user).get_geonode_connection(connection_id)
    if not conn:
        raise ValueError(f"GeoNode connection not found: {connection_id}")
    return GeoNodeClient(
        url=conn.url,
        username=conn.username,
        password=conn.password,
        api_key=conn.api_key,
    )
