"""QFieldCloud API client.

Provides a client for interacting with QFieldCloud API
for managing QGIS projects and field data collection.
"""

import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx

from apps.core.config import get_config

if TYPE_CHECKING:
    from django.contrib.auth.models import User


@dataclass
class QFieldCloudProject:
    """QFieldCloud project information."""

    id: str
    name: str
    owner: str
    description: str = ""
    is_public: bool = False
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "owner": self.owner,
            "description": self.description,
            "isPublic": self.is_public,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class QFieldCloudClient:
    """Client for QFieldCloud API."""

    def __init__(
        self,
        url: str,
        username: str,
        password: str | None = None,
        token: str | None = None,
    ):
        """Initialize QFieldCloud client.

        Args:
            url: QFieldCloud server URL
            username: Username for authentication
            password: Password (if using password auth)
            token: API token (if using token auth)
        """
        self.url = url.rstrip("/")
        self.username = username
        self.password = password
        self.token = token
        self._auth_token: str | None = None

        # Create HTTP client
        self.client = httpx.Client(
            base_url=f"{self.url}/api/v1",
            timeout=30.0,
        )

    def _get_headers(self) -> dict[str, str]:
        """Get authentication headers."""
        if self._auth_token:
            return {"Authorization": f"Token {self._auth_token}"}
        if self.token:
            return {"Authorization": f"Token {self.token}"}
        return {}

    def authenticate(self) -> bool:
        """Authenticate and get token.

        Returns:
            True if authentication successful
        """
        if self.token:
            self._auth_token = self.token
            return True

        if not self.password:
            return False

        response = self.client.post(
            "/auth/login/",
            json={"username": self.username, "password": self.password},
        )
        response.raise_for_status()

        data = response.json()
        self._auth_token = data.get("token")
        return bool(self._auth_token)

    def test_connection(self) -> tuple[bool, str]:
        """Test the connection.

        Returns:
            Tuple of (success, message)
        """
        try:
            if not self._auth_token and not self.token:
                self.authenticate()

            response = self.client.get(
                "/auth/user/",
                headers=self._get_headers(),
            )
            response.raise_for_status()

            user = response.json()
            return True, f"Connected as {user.get('username', self.username)}"
        except httpx.HTTPStatusError as e:
            return False, f"HTTP error: {e.response.status_code}"
        except Exception as e:
            return False, str(e)

    def list_projects(self) -> list[QFieldCloudProject]:
        """List all accessible projects.

        Returns:
            List of QFieldCloudProject objects
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            "/projects/",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        projects = []
        for item in response.json():
            projects.append(
                QFieldCloudProject(
                    id=item.get("id", ""),
                    name=item.get("name", ""),
                    owner=item.get("owner", ""),
                    description=item.get("description", ""),
                    is_public=item.get("is_public", False),
                    created_at=item.get("created_at", ""),
                    updated_at=item.get("updated_at", ""),
                )
            )
        return projects

    def get_project(self, project_id: str) -> QFieldCloudProject | None:
        """Get a specific project.

        Args:
            project_id: Project ID

        Returns:
            QFieldCloudProject or None
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            f"/projects/{project_id}/",
            headers=self._get_headers(),
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        item = response.json()

        return QFieldCloudProject(
            id=item.get("id", ""),
            name=item.get("name", ""),
            owner=item.get("owner", ""),
            description=item.get("description", ""),
            is_public=item.get("is_public", False),
            created_at=item.get("created_at", ""),
            updated_at=item.get("updated_at", ""),
        )

    def list_project_files(self, project_id: str) -> list[dict[str, Any]]:
        """List files in a project.

        Args:
            project_id: Project ID

        Returns:
            List of file information dictionaries
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            f"/files/{project_id}/",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.json()

    def get_project_status(self, project_id: str) -> dict[str, Any]:
        """Get project sync status.

        Args:
            project_id: Project ID

        Returns:
            Status information
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            f"/projects/{project_id}/status/",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.json()

    def download_file(
        self,
        project_id: str,
        filename: str,
    ) -> bytes:
        """Download a file from a project.

        Args:
            project_id: Project ID
            filename: File path within project

        Returns:
            File content as bytes
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            f"/files/{project_id}/{filename}/",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.content


class QFieldCloudClientManager:
    """Thread-safe manager for QFieldCloud clients."""

    _instance: "QFieldCloudClientManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "QFieldCloudClientManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._clients: dict[str, QFieldCloudClient] = {}
        return cls._instance

    def get_client(self, connection_id: str, user: "User") -> QFieldCloudClient:
        """Get or create a QFieldCloud client.

        Args:
            connection_id: Connection ID
            user: User the connection belongs to

        Returns:
            QFieldCloudClient instance

        Raises:
            ValueError: If connection not found
        """
        cache_key = f"{user.pk}:{connection_id}"
        with self._lock:
            if cache_key in self._clients:
                return self._clients[cache_key]

            config = get_config(user)
            conn = config.get_qfieldcloud_connection(connection_id)
            if not conn:
                raise ValueError(f"QFieldCloud connection not found: {connection_id}")

            client = QFieldCloudClient(
                url=conn.url,
                username=conn.username,
                password=conn.password,
                token=conn.token,
            )

            self._clients[cache_key] = client
            return client

    def remove_client(self, connection_id: str, user: "User") -> None:
        """Remove a cached client."""
        with self._lock:
            self._clients.pop(f"{user.pk}:{connection_id}", None)


def get_qfieldcloud_client(connection_id: str, user: "User") -> QFieldCloudClient:
    """Get a QFieldCloud client for a connection."""
    manager = QFieldCloudClientManager()
    return manager.get_client(connection_id, user)
