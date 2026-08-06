"""HTTP client factory for connection management."""

from typing import Any

import httpx


def make_client(
    base_url: str,
    username: str | None = None,
    password: str | None = None,
    **kwargs: Any,
) -> httpx.Client:
    """Create a synchronous HTTP client.

    Args:
        base_url: Base URL for the client
        username: Optional username for basic auth
        password: Optional password for basic auth
        **kwargs: Additional arguments passed to httpx.Client

    Returns:
        New httpx.Client instance
    """
    auth = httpx.BasicAuth(username, password) if username and password else None
    return httpx.Client(
        base_url=base_url,
        auth=auth,
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
        **kwargs,
    )


def make_async_client(
    base_url: str,
    username: str | None = None,
    password: str | None = None,
    **kwargs: Any,
) -> httpx.AsyncClient:
    """Create an asynchronous HTTP client.

    Args:
        base_url: Base URL for the client
        username: Optional username for basic auth
        password: Optional password for basic auth
        **kwargs: Additional arguments passed to httpx.AsyncClient

    Returns:
        New httpx.AsyncClient instance
    """
    auth = httpx.BasicAuth(username, password) if username and password else None
    return httpx.AsyncClient(
        base_url=base_url,
        auth=auth,
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
        **kwargs,
    )