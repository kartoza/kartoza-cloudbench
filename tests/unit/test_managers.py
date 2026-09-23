"""Unit tests for apps.core.managers (HTTP client factories)."""

import httpx

from apps.core.managers import make_async_client, make_client


class TestMakeClient:
    """Tests for the synchronous HTTP client factory."""

    def test_sets_base_url(self) -> None:
        client = make_client("https://geoserver.example.com")
        assert str(client.base_url) == "https://geoserver.example.com"
        client.close()

    def test_no_auth_when_credentials_missing(self) -> None:
        client = make_client("https://geoserver.example.com")
        assert client.auth is None
        client.close()

    def test_basic_auth_when_credentials_given(self) -> None:
        client = make_client("https://geoserver.example.com", "admin", "geoserver")
        assert isinstance(client.auth, httpx.BasicAuth)
        client.close()

    def test_no_auth_when_only_username_given(self) -> None:
        client = make_client("https://geoserver.example.com", username="admin")
        assert client.auth is None
        client.close()

    def test_follows_redirects_and_has_a_timeout(self) -> None:
        client = make_client("https://geoserver.example.com")
        assert client.follow_redirects is True
        assert client.timeout == httpx.Timeout(30.0, connect=10.0)
        client.close()

    def test_extra_kwargs_are_forwarded(self) -> None:
        client = make_client("https://geoserver.example.com", headers={"X-Test": "1"})
        assert client.headers["X-Test"] == "1"
        client.close()


class TestMakeAsyncClient:
    """Tests for the asynchronous HTTP client factory."""

    def test_sets_base_url(self) -> None:
        client = make_async_client("https://geoserver.example.com")
        assert str(client.base_url) == "https://geoserver.example.com"

    def test_basic_auth_when_credentials_given(self) -> None:
        client = make_async_client("https://geoserver.example.com", "admin", "geoserver")
        assert isinstance(client.auth, httpx.BasicAuth)
