"""GeoNode API client.

Provides a client for interacting with GeoNode REST API
for managing geospatial data catalog and services.
"""

import json
import mimetypes
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx

from apps.core.config import get_config

from .utilities import RESOURCE_TYPE_LIST_REQUEST_MAP

if TYPE_CHECKING:
    from django.contrib.auth.models import User

DATASET_MIME_TYPES = {
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


class GeoNodeUploadError(Exception):
    """GeoNode refused an upload."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


# A form's file part: (field name, filename, content type).
FilePart = tuple[str, str, str]


def multipart_envelope(
    fields: dict[str, str],
    file: FilePart,
    small_files: dict[FilePart, bytes] | None = None,
) -> tuple[str, bytes, bytes]:
    """(boundary, everything before the file's bytes, everything after) of a form.

    The streamed `file` is the last part, so its bytes go in between; any
    `small_files` (held whole) come before it.
    """
    boundary = uuid.uuid4().hex

    def file_header(name: str, filename: str, content_type: str) -> bytes:
        # A quote or line break would end the header early.
        for c in '\\"\r\n':
            filename = filename.replace(c, "_")
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()

    head = b"".join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        + value.encode()
        + b"\r\n"
        for key, value in fields.items()
    )
    for part, content in (small_files or {}).items():
        head += file_header(*part) + content + b"\r\n"
    head += file_header(*file)
    return boundary, head, f"\r\n--{boundary}--\r\n".encode()


def _error_message(response: httpx.Response) -> str:
    """GeoNode's own explanation of an error, when it gives one."""
    try:
        data = response.json()
    except ValueError:
        return response.text[:500] or f"HTTP {response.status_code}"
    if isinstance(data, dict):
        for key in ("errors", "detail", "message", "error"):
            if data.get(key):
                value = data[key]
                return value if isinstance(value, str) else json.dumps(value)
    return json.dumps(data)[:500]


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
        resources = []

        for item in data.get("resources", []):
            resources.append(
                GeoNodeResource(
                    pk=item.get("pk", 0),
                    uuid=item.get("uuid", ""),
                    name=item.get("name", ""),
                    title=item.get("title", ""),
                    abstract=item.get("abstract", ""),
                    category=(
                        item.get("category", {}).get("identifier", "")
                        if item.get("category", {})
                        else ""
                    ),
                    owner=(
                        item.get("owner", {}).get("username", "") if item.get("owner", {}) else ""
                    ),
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
        content: Iterable[bytes],
        filename: str,
        size: int,
        response_timeout: float,
        charset: str = "UTF-8",
        title: str | None = None,
        abstract: str | None = None,
    ) -> dict[str, Any]:
        """Upload a dataset file, streamed as it comes (never held whole).

        Args:
            content: The file's bytes, in pieces
            filename: Original filename (e.g. roads.zip, dem.tif)
            size: The file's size
            response_timeout: Seconds to wait for GeoNode once all is sent
            charset: Character encoding of the dataset
            title: Optional dataset title
            abstract: Optional dataset abstract/description

        Returns:
            Upload response dict with execution_id and redirect_to
        """
        ext = filename.rsplit(".", 1)[-1].lower()
        fields = {"charset": charset}
        if title:
            fields["dataset_title"] = title
        if abstract:
            fields["abstract"] = abstract
        mime = DATASET_MIME_TYPES.get(ext, "application/octet-stream")
        if ext != "zip":
            return self._post_file(
                "/uploads/upload",
                fields,
                ("base_file", filename, mime),
                content,
                size,
                response_timeout,
            )
        # GeoNode 4.x only unzips a zip sent as zip_file, then puts the .shp
        # it finds in place of base_file - which must still be there and
        # not empty, but isn't read. The zip can't be sent twice in one
        # pass, so base_file is a 1-byte stand-in. (Checked on GeoHosting's
        # GeoNode 4.x; newer GeoNodes that dropped zip_file aren't covered.)
        fields["store_spatial_files"] = "true"
        return self._post_file(
            "/uploads/upload",
            fields,
            ("zip_file", filename, mime),
            content,
            size,
            response_timeout,
            small_files={("base_file", filename, mime): b"\0"},
        )

    def upload_document(
        self,
        content: Iterable[bytes],
        filename: str,
        size: int,
        response_timeout: float,
        title: str | None = None,
        abstract: str | None = None,
    ) -> dict[str, Any]:
        """Upload a document, streamed as it comes (never held whole).

        Args:
            content: The file's bytes, in pieces
            filename: Original filename (e.g. report.pdf, photo.jpg)
            size: The file's size
            response_timeout: Seconds to wait for GeoNode once all is sent
            title: Optional document title
            abstract: Optional document abstract/description

        Returns:
            Upload response dict from GeoNode documents API
        """
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        fields = {}
        if title:
            fields["title"] = title
        if abstract:
            fields["abstract"] = abstract
        return self._post_file(
            "/documents/", fields, ("doc_file", filename, mime), content, size, response_timeout
        )

    def _post_file(
        self,
        path: str,
        fields: dict[str, str],
        file: FilePart,
        content: Iterable[bytes],
        size: int,
        response_timeout: float,
        small_files: dict[FilePart, bytes] | None = None,
    ) -> dict[str, Any]:
        """POST a multipart form whose one file part is streamed.

        The form is built here rather than by httpx so its length is known
        before the file has arrived: it's sent as Content-Length, since many
        GeoNodes sit behind proxies that refuse chunked transfer encoding.
        """
        boundary, head, tail = multipart_envelope(fields, file, small_files)

        def body() -> Iterator[bytes]:
            yield head
            yield from content
            yield tail

        response = self.client.post(
            path,
            content=body(),
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(head) + size + len(tail)),
            },
            timeout=httpx.Timeout(30.0, connect=10.0, read=response_timeout),
        )
        if response.status_code >= 400:
            raise GeoNodeUploadError(_error_message(response), response.status_code)
        return response.json()

    def get_upload_size_limit(self, slug: str) -> int | None:
        """GeoNode's upload size limit `slug` in bytes; None if it can't tell.

        Slugs: dataset_upload_size, document_upload_size, file_upload_handler.
        Older GeoNodes have no such API: the upload is tried anyway.
        """
        try:
            response = self.client.get("/upload-size-limits/", params={"page_size": 100})
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        for items in data.values():
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get("slug") == slug:
                    max_size = item.get("max_size")
                    return max_size if isinstance(max_size, int) else None
        return None

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
        item = response.json().get(resource_type.rstrip("s"), {})

        return GeoNodeResource(
            pk=item.get("pk", 0),
            uuid=item.get("uuid", ""),
            name=item.get("name", ""),
            title=item.get("title", ""),
            abstract=item.get("abstract", ""),
            category=(
                item.get("category", {}).get("identifier", "") if item.get("category", {}) else ""
            ),
            owner=item.get("owner", {}).get("username", "") if item.get("owner", {}) else "",
            date=item.get("date", ""),
            thumbnail_url=item.get("thumbnail_url", ""),
            detail_url=item.get("detail_url", ""),
        )


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
