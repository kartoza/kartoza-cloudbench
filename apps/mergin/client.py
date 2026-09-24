"""Mergin Maps API client.

Provides a client for interacting with Mergin Maps API
for managing geodata synchronization projects.
"""

import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx

from apps.core.config import get_config

if TYPE_CHECKING:
    from django.contrib.auth.models import User


@dataclass
class MerginProject:
    """Mergin Maps project information."""

    id: str
    name: str
    namespace: str
    description: str = ""
    version: str = ""
    disk_usage: int = 0
    created: str = ""
    updated: str = ""
    access: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "namespace": self.namespace,
            "fullName": f"{self.namespace}/{self.name}",
            "description": self.description,
            "version": self.version,
            "diskUsage": self.disk_usage,
            "created": self.created,
            "updated": self.updated,
            "access": self.access,
        }


class MerginClient:
    """Client for Mergin Maps API."""

    def __init__(
        self,
        url: str,
        username: str,
        password: str | None = None,
        token: str | None = None,
    ):
        """Initialize Mergin client.

        Args:
            url: Mergin Maps server URL
            username: Username for authentication
            password: Password (if using password auth)
            token: API token (if using token auth)
        """
        self.url = url.rstrip("/")
        self.username = username
        self.password = password
        self.token = token
        self._auth_token: str | None = None

        self.client = httpx.Client(
            base_url=self.url,
            timeout=30.0,
        )

    def _get_headers(self) -> dict[str, str]:
        """Get authentication headers."""
        if self._auth_token:
            return {"Authorization": f"Bearer {self._auth_token}"}
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
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
            "/v1/auth/login",
            json={"login": self.username, "password": self.password},
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
                "/v1/user/profile",
                headers=self._get_headers(),
            )
            response.raise_for_status()

            user = response.json()
            return True, f"Connected as {user.get('username', self.username)}"
        except httpx.HTTPStatusError as e:
            return False, f"HTTP error: {e.response.status_code}"
        except Exception as e:
            return False, str(e)

    def list_projects(
        self,
        namespace: str | None = None,
        flag: str | None = None,
    ) -> list[MerginProject]:
        """List projects.

        Args:
            namespace: Filter by namespace/organization
            flag: Filter by flag (created, shared, etc.)

        Returns:
            List of MerginProject objects
        """
        if not self._auth_token:
            self.authenticate()

        params = {}
        if namespace:
            params["namespace"] = namespace
        if flag:
            params["flag"] = flag

        response = self.client.get(
            "/v1/project/paginated",
            params=params,
            headers=self._get_headers(),
        )
        response.raise_for_status()

        data = response.json()
        projects = []

        for item in data.get("projects", []):
            projects.append(
                MerginProject(
                    id=item.get("id", ""),
                    name=item.get("name", ""),
                    namespace=item.get("namespace", ""),
                    description=item.get("description", ""),
                    version=item.get("version", ""),
                    disk_usage=item.get("disk_usage", 0),
                    created=item.get("created", ""),
                    updated=item.get("updated", ""),
                    access=item.get("access"),
                )
            )
        return projects

    def get_project(self, namespace: str, name: str) -> MerginProject | None:
        """Get a specific project.

        Args:
            namespace: Project namespace/owner
            name: Project name

        Returns:
            MerginProject or None
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            f"/v1/project/{namespace}/{name}",
            headers=self._get_headers(),
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        item = response.json()

        return MerginProject(
            id=item.get("id", ""),
            name=item.get("name", ""),
            namespace=item.get("namespace", ""),
            description=item.get("description", ""),
            version=item.get("version", ""),
            disk_usage=item.get("disk_usage", 0),
            created=item.get("created", ""),
            updated=item.get("updated", ""),
            access=item.get("access"),
        )

    def list_project_files(
        self,
        namespace: str,
        name: str,
        version: str | None = None,
    ) -> list[dict[str, Any]]:
        """List files in a project.

        Args:
            namespace: Project namespace
            name: Project name
            version: Optional version (defaults to latest)

        Returns:
            List of file information
        """
        if not self._auth_token:
            self.authenticate()

        project = self.get_project(namespace, name)
        if not project:
            return []

        files_url = f"/v1/project/{namespace}/{name}/files"
        if version:
            files_url = f"{files_url}?version={version}"

        response = self.client.get(
            files_url,
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.json()

    def get_project_versions(
        self,
        namespace: str,
        name: str,
    ) -> list[dict[str, Any]]:
        """Get project version history.

        Args:
            namespace: Project namespace
            name: Project name

        Returns:
            List of version information
        """
        if not self._auth_token:
            self.authenticate()

        response = self.client.get(
            f"/v1/project/{namespace}/{name}/history",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.json()


class MerginClientManager:
    """Thread-safe manager for Mergin clients."""

    _instance: "MerginClientManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "MerginClientManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._clients: dict[str, MerginClient] = {}
        return cls._instance

    def get_client(self, connection_id: str, user: "User") -> MerginClient:
        """Get or create a Mergin client.

        Args:
            connection_id: Connection ID
            user: User the connection belongs to

        Returns:
            MerginClient instance

        Raises:
            ValueError: If connection not found
        """
        cache_key = f"{user.pk}:{connection_id}"
        with self._lock:
            if cache_key in self._clients:
                return self._clients[cache_key]

            config = get_config(user)
            conn = config.get_mergin_connection(connection_id)
            if not conn:
                raise ValueError(f"Mergin connection not found: {connection_id}")

            client = MerginClient(
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


def get_mergin_client(connection_id: str, user: "User") -> MerginClient:
    """Get a Mergin client for a connection."""
    manager = MerginClientManager()
    return manager.get_client(connection_id, user)
