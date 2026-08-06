"""GeoNode API client.

Provides a client for interacting with GeoNode REST API
for managing geospatial data catalog and services.
"""

from dataclasses import dataclass
from typing import Any

import httpx

from apps.core.config import get_config
from .utilities import RESOURCE_TYPE_LIST_REQUEST_MAP


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

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "pk": self.pk,
            "uuid": self.uuid,
            "name": self.name,
            "title": self.title,
            "abstract": self.abstract,
            "category": self.category,
            "owner": self.owner,
            "date": self.date,
            "thumbnailUrl": self.thumbnail_url,
            "detailUrl": self.detail_url,
        }


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
            api_key: API key (alternative to username/password)
        """
        self.url = url.rstrip("/")
        self.username = username
        self.password = password
        self.api_key = api_key

        # Create HTTP client
        headers = {}
        if api_key:
            headers["Authorization"] = f"ApiKey {api_key}"

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

        Returns:
            Tuple of (success, message)
        """
        try:
            response = self.client.get("/")
            response.raise_for_status()

            return True, f"Connected to GeoNode at {self.url}"
        except httpx.HTTPStatusError as e:
            return False, f"HTTP error: {e.response.status_code}"
        except Exception as e:
            return False, str(e)

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
        params[
            "filter{resource_type.in}"] = RESOURCE_TYPE_LIST_REQUEST_MAP.get(
            resource_type, resource_type
        )
        if category:
            params["filter{category__identifier}"] = category
        if owner:
            params["filter{owner__username}"] = owner

        response = self.client.get("/resources", params=params)
        response.raise_for_status()

        data = response.json()
        resources = []

        for item in data.get("resources", []):
            resources.append(
                GeoNodeResource(
                    pk=item.get("pk", 0),
                    uuid=item.get("uuid", ""),
                    name=item.get("name", ""),
                    title=item.get("title", ""),
                    abstract=item.get("abstract", ""),
                    category=item.get("category", {}).get("identifier", "")
                    if item.get("category", {}) else "",
                    owner=item.get("owner", {}).get("username", "")
                    if item.get("owner", {}) else "",
                    date=item.get("date", ""),
                    thumbnail_url=item.get("thumbnail_url", ""),
                    detail_url=item.get("detail_url", ""),
                )
            )

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

    def get_resource(
            self, resource_type: str, resource_id: int
    ) -> GeoNodeResource:
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
        item = response.json().get(resource_type.rstrip("s"), {})

        return GeoNodeResource(
            pk=item.get("pk", 0),
            uuid=item.get("uuid", ""),
            name=item.get("name", ""),
            title=item.get("title", ""),
            abstract=item.get("abstract", ""),
            category=item.get("category", {}).get("identifier", "")
            if item.get("category", {}) else "",
            owner=item.get("owner", {}).get("username", "")
            if item.get("owner", {}) else "",
            date=item.get("date", ""),
            thumbnail_url=item.get("thumbnail_url", ""),
            detail_url=item.get("detail_url", ""),
        )


def get_geonode_client(
        connection_id: str,
        user_id: str = "default"
) -> GeoNodeClient:
    """Get a GeoNode client for a connection."""
    conn = get_config(user_id).get_geonode_connection(connection_id)
    if not conn:
        raise ValueError(f"GeoNode connection not found: {connection_id}")
    return GeoNodeClient(
        url=conn.url,
        username=conn.username,
        password=conn.password,
        api_key=conn.api_key,
    )
