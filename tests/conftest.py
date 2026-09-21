"""Pytest configuration and fixtures for Kartoza CloudBench tests.

This module provides comprehensive fixtures for:
- Django API testing
- Configuration management
- Mock external services (GeoServer, S3, PostgreSQL)
- Test data factories
"""

import os
import re
import tempfile
from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from django.test import Client
from rest_framework.test import APIClient

# ============================================================================
# Environment Setup
# ============================================================================


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment() -> Generator[None, None, None]:
    """Set up test environment before any tests run."""
    # Create temporary directories for testing
    with tempfile.TemporaryDirectory(prefix="cloudbench-test-") as tmpdir:
        os.environ["XDG_CONFIG_HOME"] = tmpdir
        os.environ["XDG_DATA_HOME"] = tmpdir
        os.environ["XDG_CACHE_HOME"] = tmpdir
        os.environ["CLOUDBENCH_DATA_FOLDER"] = tmpdir
        os.environ["DJANGO_SETTINGS_MODULE"] = "cloudbench.settings.testing"
        yield


@pytest.fixture(scope="session")
def temp_config_dir() -> Generator[str, None, None]:
    """Create a temporary config directory for testing."""
    with tempfile.TemporaryDirectory(prefix="cloudbench-config-") as tmpdir:
        original_config = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = tmpdir
        yield tmpdir
        if original_config:
            os.environ["XDG_CONFIG_HOME"] = original_config


# ============================================================================
# Django Fixtures
# ============================================================================


@pytest.fixture
def django_client() -> Client:
    """Return a Django test client."""
    return Client()


@pytest.fixture
def api_client() -> APIClient:
    """Return a DRF API test client."""
    return APIClient()


@pytest.fixture
def authenticated_api_client(db: Any, tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> APIClient:
    """Return a DRF client logged in as a user with an isolated data folder.

    Views resolve per-user config from ``request.user.username`` under
    CLOUDBENCH_DATA_FOLDER, so each test gets its own empty folder.
    """
    from django.contrib.auth import get_user_model

    monkeypatch.setenv("CLOUDBENCH_DATA_FOLDER", str(tmp_path))
    user = get_user_model().objects.create_user(username="test-user", password="test-pass")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def api_client_json(api_client: APIClient) -> APIClient:
    """Return an API client configured for JSON requests."""
    api_client.default_format = "json"
    return api_client


# ============================================================================
# Configuration Fixtures
# ============================================================================


@pytest.fixture
def config_manager(tmp_path: Any) -> Generator[Any, None, None]:
    """Get a fresh per-user ConfigManager backed by an isolated data folder."""
    from unittest.mock import patch

    from apps.core.config import Config, ConfigManager

    with patch.dict(os.environ, {"CLOUDBENCH_DATA_FOLDER": str(tmp_path)}):
        manager = ConfigManager("test-user")

        # Start from an empty config regardless of what is on disk
        manager._config = Config()

        yield manager


@pytest.fixture
def providers_manager(tmp_path: Any) -> Generator[Any, None, None]:
    """Get a fresh ProvidersManager for testing with isolated config directory."""
    from unittest.mock import patch

    from apps.core.providers import ProvidersManager

    with patch.dict(os.environ, {"CLOUDBENCH_DATA_FOLDER": str(tmp_path)}):
        yield ProvidersManager("test-user")


# ============================================================================
# Connection Fixtures
# ============================================================================


@pytest.fixture
def sample_connection() -> Any:
    """Create a sample GeoServer connection for testing."""
    from apps.core.config import Connection

    return Connection(
        id="test-conn-001",
        name="Test GeoServer",
        url="http://localhost:8080/geoserver",
        username="admin",
        password="geoserver",
        is_active=False,
    )


@pytest.fixture
def sample_s3_connection() -> Any:
    """Create a sample S3 connection for testing."""
    from apps.core.config import S3Connection

    return S3Connection(
        id="test-s3-001",
        name="Test MinIO",
        endpoint="localhost:9000",
        access_key="minioadmin",
        secret_key="minioadmin",
        use_ssl=False,
        path_style=True,
        is_active=False,
    )


@pytest.fixture
def sample_geonode_connection() -> Any:
    """Create a sample GeoNode connection for testing."""
    from apps.core.config import GeoNodeConnection

    return GeoNodeConnection(
        id="test-geonode-001",
        name="Test GeoNode",
        url="http://localhost:8000",
        username="admin",
        password="admin",
        is_active=False,
    )


@pytest.fixture
def sample_iceberg_connection() -> Any:
    """Create a sample Iceberg connection for testing."""
    from apps.core.config import IcebergCatalogConnection

    return IcebergCatalogConnection(
        id="test-iceberg-001",
        name="Test Iceberg",
        url="http://localhost:8181",
        warehouse="s3://warehouse",
        is_active=False,
    )


@pytest.fixture
def sample_qfieldcloud_connection() -> Any:
    """Create a sample QFieldCloud connection for testing."""
    from apps.core.config import QFieldCloudConnection

    return QFieldCloudConnection(
        id="test-qfc-001",
        name="Test QFieldCloud",
        url="https://app.qfield.cloud",
        username="testuser",
        token="test-token",
        is_active=False,
    )


@pytest.fixture
def sample_mergin_connection() -> Any:
    """Create a sample Mergin Maps connection for testing."""
    from apps.core.config import MerginMapsConnection

    return MerginMapsConnection(
        id="test-mergin-001",
        name="Test Mergin",
        url="https://app.merginmaps.com",
        username="testuser",
        token="test-token",
        is_active=False,
    )


# ============================================================================
# Mock External Services
# ============================================================================


@pytest.fixture
def mock_geoserver_client() -> Generator[MagicMock, None, None]:
    """Mock GeoServer client for testing without a real server."""
    with patch("apps.geoserver.client.GeoServerClient") as mock:
        client = MagicMock()
        client.get_workspaces.return_value = [
            {
                "name": "test_workspace",
                "href": "http://localhost:8080/geoserver/rest/workspaces/test_workspace",
            }
        ]
        client.get_layers.return_value = [
            {"name": "test_layer", "href": "http://localhost:8080/geoserver/rest/layers/test_layer"}
        ]
        client.test_connection.return_value = True
        mock.return_value = client
        yield client


@pytest.fixture
def mock_s3_client() -> Generator[MagicMock, None, None]:
    """Mock S3 client for testing without a real S3 server."""
    with patch("apps.s3.client.S3Client") as mock:
        client = MagicMock()
        client.list_buckets.return_value = [
            {"Name": "test-bucket", "CreationDate": "2024-01-01T00:00:00Z"}
        ]
        client.list_objects.return_value = {
            "Contents": [
                {"Key": "test-file.geojson", "Size": 1024, "LastModified": "2024-01-01T00:00:00Z"}
            ]
        }
        client.test_connection.return_value = True
        mock.return_value = client
        yield client


@pytest.fixture
def mock_postgres_service() -> Generator[MagicMock, None, None]:
    """Mock PostgreSQL service for testing without a real database."""
    with patch("apps.postgres.service.PostgresService") as mock:
        service = MagicMock()
        service.list_services.return_value = [
            {"name": "test_service", "host": "localhost", "port": 5432, "dbname": "testdb"}
        ]
        service.get_schemas.return_value = ["public", "test_schema"]
        service.get_tables.return_value = [
            {"name": "test_table", "schema": "public", "type": "table"}
        ]
        service.test_connection.return_value = True
        mock.return_value = service
        yield service


@pytest.fixture
def mock_httpx_client() -> Generator[MagicMock, None, None]:
    """Mock httpx client for testing HTTP requests."""
    with patch("httpx.AsyncClient") as mock:
        client = MagicMock()
        mock.return_value.__aenter__.return_value = client
        yield client


# ============================================================================
# HTTP mocking (httpx transport level)
# ============================================================================


class HttpMock:
    """Route table that answers every httpx request made during a test.

    Patches the httpx transports, so it works for code that builds its own
    ``httpx.Client`` / ``httpx.AsyncClient`` as well as ``make_client``.
    Routes added later win over earlier ones. Unmatched requests raise
    ``httpx.ConnectError`` and are still recorded in ``calls``.
    """

    def __init__(self) -> None:
        self.routes: list[dict[str, Any]] = []
        self.calls: list[Any] = []

    def add(
        self,
        method: str,
        pattern: str,
        *,
        json: Any = None,
        text: str | None = None,
        content: bytes | None = None,
        status: int = 200,
        headers: dict[str, str] | None = None,
        exc: Exception | None = None,
    ) -> None:
        """Register a response for requests whose URL matches ``pattern`` (regex)."""
        self.routes.append(
            {
                "method": method.upper(),
                "pattern": re.compile(pattern),
                "json": json,
                "text": text,
                "content": content,
                "status": status,
                "headers": headers or {},
                "exc": exc,
            }
        )

    def requests(self, method: str | None = None) -> list[Any]:
        """Return recorded requests, optionally filtered by method."""
        return [c for c in self.calls if method is None or c.method == method.upper()]

    def handle(self, request: Any) -> Any:
        import httpx

        self.calls.append(request)
        for route in reversed(self.routes):
            if route["method"] not in ("*", request.method):
                continue
            if not route["pattern"].search(str(request.url)):
                continue
            if route["exc"] is not None:
                raise route["exc"]
            kwargs: dict[str, Any] = {"headers": route["headers"], "request": request}
            if route["json"] is not None:
                kwargs["json"] = route["json"]
            elif route["text"] is not None:
                kwargs["text"] = route["text"]
            else:
                kwargs["content"] = route["content"] or b""
            return httpx.Response(route["status"], **kwargs)
        raise httpx.ConnectError(f"No mock route for {request.method} {request.url}")


@pytest.fixture
def http_mock() -> Generator[HttpMock, None, None]:
    """Intercept all httpx traffic and answer from a per-test route table."""
    import httpx

    mock = HttpMock()

    def sync_handler(_self: Any, request: Any) -> Any:
        request.read()  # make streamed/multipart bodies inspectable via .content
        return mock.handle(request)

    async def async_handler(_self: Any, request: Any) -> Any:
        await request.aread()
        return mock.handle(request)

    with (
        patch.object(httpx.HTTPTransport, "handle_request", sync_handler),
        patch.object(httpx.AsyncHTTPTransport, "handle_async_request", async_handler),
    ):
        yield mock


class FakePG:
    """Scriptable stand-in for ``psycopg2.connect``.

    Register result sets with ``add(sql_substring, rows, columns=None)``; the
    first registered substring found in an executed statement (case
    insensitive) supplies the rows. Unmatched statements return no rows.
    Pass an ``Exception`` as ``rows`` to make the statement raise.
    """

    def __init__(self) -> None:
        self.rules: list[tuple[str, Any, list[str] | None]] = []
        self.queries: list[tuple[str, Any]] = []
        self.connect_kwargs: list[dict[str, Any]] = []
        self.commits = 0

    def add(self, fragment: str, rows: Any, columns: list[str] | None = None) -> None:
        self.rules.append((fragment.lower(), rows, columns))

    def connect(self, **kwargs: Any) -> "FakePGConnection":
        self.connect_kwargs.append(kwargs)
        return FakePGConnection(self)


class FakePGConnection:
    def __init__(self, fake: FakePG) -> None:
        self.fake = fake

    def __enter__(self) -> "FakePGConnection":
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    def cursor(self, *_: Any, **__: Any) -> "FakePGCursor":
        return FakePGCursor(self.fake)

    def commit(self) -> None:
        self.fake.commits += 1

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass

    autocommit = False


class FakePGCursor:
    def __init__(self, fake: FakePG) -> None:
        self.fake = fake
        self.rows: list[Any] = []
        self.description: list[tuple[str]] | None = None
        self.rowcount = 0

    def __enter__(self) -> "FakePGCursor":
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    def execute(self, sql: Any, params: Any = None) -> None:
        text = str(sql)
        self.fake.queries.append((text, params))
        self.rows, self.description = [], None
        lowered = text.lower()
        for fragment, rows, columns in self.fake.rules:
            if fragment in lowered:
                if isinstance(rows, Exception):
                    raise rows
                self.rows = list(rows)
                self.rowcount = len(self.rows)
                if columns:
                    self.description = [(c,) for c in columns]
                return

    def fetchall(self) -> list[Any]:
        rows, self.rows = self.rows, []
        return rows

    def fetchone(self) -> Any:
        return self.rows.pop(0) if self.rows else None

    def close(self) -> None:
        pass


@pytest.fixture
def fake_pg() -> Generator[FakePG, None, None]:
    """Replace ``psycopg2.connect`` everywhere with a scriptable fake."""
    import psycopg2

    fake = FakePG()
    with patch.object(psycopg2, "connect", fake.connect):
        yield fake


@pytest.fixture
def user_config(authenticated_api_client: APIClient) -> Any:
    """ConfigManager for the user behind ``authenticated_api_client``."""
    from apps.core.config import get_config

    return get_config("test-user")


# ============================================================================
# Test Data Fixtures
# ============================================================================


@pytest.fixture
def sample_geojson() -> dict[str, Any]:
    """Return sample GeoJSON data for testing."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                "properties": {"name": "Test Point", "value": 42},
            }
        ],
    }


@pytest.fixture
def sample_sld_style() -> str:
    """Return sample SLD style for testing."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld">
    <NamedLayer>
        <Name>test_style</Name>
        <UserStyle>
            <Title>Test Style</Title>
            <FeatureTypeStyle>
                <Rule>
                    <PointSymbolizer>
                        <Graphic>
                            <Mark>
                                <WellKnownName>circle</WellKnownName>
                                <Fill>
                                    <CssParameter name="fill">#FF0000</CssParameter>
                                </Fill>
                            </Mark>
                            <Size>6</Size>
                        </Graphic>
                    </PointSymbolizer>
                </Rule>
            </FeatureTypeStyle>
        </UserStyle>
    </NamedLayer>
</StyledLayerDescriptor>"""


@pytest.fixture
def sample_pg_service_conf() -> str:
    """Return sample pg_service.conf content for testing."""
    return """[test_service]
host=localhost
port=5432
dbname=testdb
user=testuser
password=testpass

[another_service]
host=remotehost
port=5433
dbname=anotherdb
user=admin
"""


# ============================================================================
# Temporary File Fixtures
# ============================================================================


@pytest.fixture
def temp_geojson_file(sample_geojson: dict[str, Any]) -> Generator[str, None, None]:
    """Create a temporary GeoJSON file for testing."""
    import json

    with tempfile.NamedTemporaryFile(mode="w", suffix=".geojson", delete=False) as f:
        json.dump(sample_geojson, f)
        f.flush()
        yield f.name
    os.unlink(f.name)


@pytest.fixture
def temp_sld_file(sample_sld_style: str) -> Generator[str, None, None]:
    """Create a temporary SLD file for testing."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sld", delete=False) as f:
        f.write(sample_sld_style)
        f.flush()
        yield f.name
    os.unlink(f.name)


@pytest.fixture
def temp_pg_service_file(sample_pg_service_conf: str) -> Generator[str, None, None]:
    """Create a temporary pg_service.conf file for testing."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".conf", delete=False) as f:
        f.write(sample_pg_service_conf)
        f.flush()
        yield f.name
    os.unlink(f.name)


# ============================================================================
# Async Fixtures
# ============================================================================


@pytest.fixture
def anyio_backend() -> str:
    """Return the async backend to use."""
    return "asyncio"


# ============================================================================
# Cleanup Fixtures
# ============================================================================


@pytest.fixture(autouse=True)
def reset_singletons() -> Generator[None, None, None]:
    """Reset all singletons before and after each test."""
    # Reset BEFORE test
    from apps.core.config import ConfigManager
    from apps.core.providers import ProvidersManager

    ConfigManager._instance = None
    ProvidersManager._instance = None

    yield

    # Reset AFTER test
    ConfigManager._instance = None
    ProvidersManager._instance = None
