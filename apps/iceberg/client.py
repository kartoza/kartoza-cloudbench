"""Apache Iceberg REST Catalog client.

Provides a client for interacting with Apache Iceberg REST Catalog API
for managing data lake tables.
"""

import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx

from apps.core.config import get_config

if TYPE_CHECKING:
    from django.contrib.auth.models import User


@dataclass
class IcebergNamespace:
    """Iceberg namespace information."""

    name: list[str]
    properties: dict[str, str] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "fullName": ".".join(self.name),
            "properties": self.properties or {},
        }


@dataclass
class IcebergTable:
    """Iceberg table information."""

    namespace: list[str]
    name: str
    metadata_location: str = ""
    properties: dict[str, str] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "namespace": self.namespace,
            "name": self.name,
            "fullName": f"{'.'.join(self.namespace)}.{self.name}",
            "metadataLocation": self.metadata_location,
            "properties": self.properties or {},
        }


class IcebergClient:
    """Client for Apache Iceberg REST Catalog API."""

    def __init__(
        self,
        url: str,
        warehouse: str,
        token: str | None = None,
        credentials: dict[str, str] | None = None,
    ):
        """Initialize Iceberg client.

        Args:
            url: Catalog REST API URL
            warehouse: Warehouse identifier
            token: OAuth2 bearer token
            credentials: OAuth2 credentials (client_id, client_secret)
        """
        self.url = url.rstrip("/")
        self.warehouse = warehouse
        self.token = token
        self.credentials = credentials
        self._access_token: str | None = None

        # Create HTTP client
        self.client = httpx.Client(
            base_url=self.url,
            timeout=30.0,
        )

    def _get_headers(self) -> dict[str, str]:
        """Get authentication headers."""
        headers = {"X-Iceberg-Access-Delegation": "vended-credentials"}

        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        elif self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        return headers

    def authenticate(self) -> bool:
        """Authenticate using OAuth2 credentials.

        Returns:
            True if authentication successful
        """
        if self.token:
            self._access_token = self.token
            return True

        if not self.credentials:
            return True  # No auth required

        response = self.client.post(
            "/v1/oauth/tokens",
            data={
                "grant_type": "client_credentials",
                "client_id": self.credentials.get("client_id"),
                "client_secret": self.credentials.get("client_secret"),
            },
        )

        if response.status_code != 200:
            return False

        data = response.json()
        self._access_token = data.get("access_token")
        return bool(self._access_token)

    def test_connection(self) -> tuple[bool, str]:
        """Test the connection.

        Returns:
            Tuple of (success, message)
        """
        try:
            self.authenticate()

            response = self.client.get(
                "/v1/config",
                headers=self._get_headers(),
            )
            response.raise_for_status()

            config = response.json()
            return True, f"Connected to Iceberg catalog: {config.get('defaults', {})}"
        except httpx.HTTPStatusError as e:
            return False, f"HTTP error: {e.response.status_code}"
        except Exception as e:
            return False, str(e)

    def get_config(self) -> dict[str, Any]:
        """Get catalog configuration.

        Returns:
            Catalog configuration
        """
        self.authenticate()

        response = self.client.get(
            "/v1/config",
            params={"warehouse": self.warehouse},
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.json()

    def list_namespaces(
        self,
        parent: list[str] | None = None,
    ) -> list[IcebergNamespace]:
        """List namespaces.

        Args:
            parent: Parent namespace (for nested namespaces)

        Returns:
            List of IcebergNamespace objects
        """
        self.authenticate()

        params = {}
        if parent:
            params["parent"] = ".".join(parent)

        response = self.client.get(
            f"/v1/{self.warehouse}/namespaces",
            params=params,
            headers=self._get_headers(),
        )
        response.raise_for_status()

        data = response.json()
        namespaces = []

        for ns in data.get("namespaces", []):
            namespaces.append(IcebergNamespace(name=ns))

        return namespaces

    def get_namespace(self, namespace: list[str]) -> IcebergNamespace | None:
        """Get namespace details.

        Args:
            namespace: Namespace identifier

        Returns:
            IcebergNamespace or None
        """
        self.authenticate()

        ns_path = ".".join(namespace)
        response = self.client.get(
            f"/v1/{self.warehouse}/namespaces/{ns_path}",
            headers=self._get_headers(),
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        data = response.json()

        return IcebergNamespace(
            name=data.get("namespace", namespace),
            properties=data.get("properties"),
        )

    def create_namespace(
        self,
        namespace: list[str],
        properties: dict[str, str] | None = None,
    ) -> IcebergNamespace:
        """Create a namespace.

        Args:
            namespace: Namespace identifier
            properties: Namespace properties

        Returns:
            Created IcebergNamespace
        """
        self.authenticate()

        body: dict[str, Any] = {"namespace": namespace}
        if properties:
            body["properties"] = properties

        response = self.client.post(
            f"/v1/{self.warehouse}/namespaces",
            json=body,
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return IcebergNamespace(
            name=namespace,
            properties=properties,
        )

    def list_tables(self, namespace: list[str]) -> list[IcebergTable]:
        """List tables in a namespace.

        Args:
            namespace: Namespace identifier

        Returns:
            List of IcebergTable objects
        """
        self.authenticate()

        ns_path = ".".join(namespace)
        response = self.client.get(
            f"/v1/{self.warehouse}/namespaces/{ns_path}/tables",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        data = response.json()
        tables = []

        for item in data.get("identifiers", []):
            tables.append(
                IcebergTable(
                    namespace=item.get("namespace", namespace),
                    name=item.get("name", ""),
                )
            )

        return tables

    def get_table(
        self,
        namespace: list[str],
        table: str,
    ) -> IcebergTable | None:
        """Get table details.

        Args:
            namespace: Namespace identifier
            table: Table name

        Returns:
            IcebergTable or None
        """
        self.authenticate()

        ns_path = ".".join(namespace)
        response = self.client.get(
            f"/v1/{self.warehouse}/namespaces/{ns_path}/tables/{table}",
            headers=self._get_headers(),
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        data = response.json()

        return IcebergTable(
            namespace=namespace,
            name=table,
            metadata_location=data.get("metadata-location", ""),
            properties=data.get("properties"),
        )

    def get_table_metadata(
        self,
        namespace: list[str],
        table: str,
    ) -> dict[str, Any]:
        """Get full table metadata.

        Args:
            namespace: Namespace identifier
            table: Table name

        Returns:
            Table metadata including schema
        """
        self.authenticate()

        ns_path = ".".join(namespace)
        response = self.client.get(
            f"/v1/{self.warehouse}/namespaces/{ns_path}/tables/{table}",
            headers=self._get_headers(),
        )
        response.raise_for_status()

        return response.json()


class IcebergClientManager:
    """Thread-safe manager for Iceberg clients."""

    _instance: "IcebergClientManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "IcebergClientManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._clients: dict[str, IcebergClient] = {}
        return cls._instance

    def get_client(self, connection_id: str, user: "User") -> IcebergClient:
        """Get or create an Iceberg client.

        Args:
            connection_id: Connection ID
            user: User the connection belongs to

        Returns:
            IcebergClient instance

        Raises:
            ValueError: If connection not found
        """
        cache_key = f"{user.pk}:{connection_id}"
        with self._lock:
            if cache_key in self._clients:
                return self._clients[cache_key]

            config = get_config(user)
            conn = config.get_iceberg_connection(connection_id)
            if not conn:
                raise ValueError(f"Iceberg connection not found: {connection_id}")

            credentials = None
            if conn.client_id and conn.client_secret:
                credentials = {
                    "client_id": conn.client_id,
                    "client_secret": conn.client_secret,
                }

            client = IcebergClient(
                url=conn.url,
                warehouse=conn.warehouse,
                token=conn.token,
                credentials=credentials,
            )

            self._clients[cache_key] = client
            return client

    def remove_client(self, connection_id: str, user: "User") -> None:
        """Remove a cached client."""
        with self._lock:
            self._clients.pop(f"{user.pk}:{connection_id}", None)


def get_iceberg_client(connection_id: str, user: "User") -> IcebergClient:
    """Get an Iceberg client for a connection."""
    manager = IcebergClientManager()
    return manager.get_client(connection_id, user)
