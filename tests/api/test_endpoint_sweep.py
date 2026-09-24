"""Smoke sweep over every ``/api/`` route.

Each route is called with every HTTP method its view implements, once while
all upstream HTTP calls succeed (``{}``) and once while they all fail (500).
The assertion is deliberately loose: views must not raise unhandled errors
that escape as a 5xx *crash* of the test client for the failing upstream, and
must never leak a traceback. Behavioural assertions live in the per-app
test modules.
"""

import re
import uuid
from typing import Any

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.core.models import (
    GeoNodeConnection,
    IcebergCatalogConnection,
    MerginMapsConnection,
    PGService,
    QFieldCloudConnection,
    S3Connection,
)

METHODS = ("get", "post", "put", "patch", "delete")
BODY = {
    "name": "x",
    "url": "http://upstream.test",
    "workspace": "ws",
    "sql": "select 1",
    "query": "select 1",
    "prompt": "list layers",
    "table": "t",
    "schema": "public",
    "layer": "ly",
    "format": "sld",
    "content": "<sld/>",
}


def _fill(route: str) -> str:
    """Replace ``<conv:name>`` / ``(?P<name>..)`` placeholders with plausible values."""
    route = re.sub(r"\(\?P<\w+>[^)]*\)", "c1", route).replace("^", "").replace("$", "")
    out = ""
    i = 0
    while i < len(route):
        if route[i] != "<":
            out += route[i]
            i += 1
            continue
        j = route.index(">", i)
        conv, _, _name = route[i + 1 : j].partition(":")
        out += {"int": "1", "uuid": str(uuid.uuid4()), "path": "a/b"}.get(conv, "c1")
        i = j + 1
    return out


def _walk(patterns: Any, prefix: str = "") -> Any:
    for p in patterns:
        route = prefix + str(p.pattern)
        if isinstance(p, URLResolver):
            yield from _walk(p.url_patterns, route)
        elif isinstance(p, URLPattern) and route.startswith("api/"):
            cls = getattr(p.callback, "cls", None) or getattr(p.callback, "view_class", None)
            if cls is None:
                continue
            for method in METHODS:
                if hasattr(cls, method):
                    yield f"/{_fill(route)}", method


def _routes() -> list[tuple[str, str]]:
    return sorted(set(_walk(get_resolver().url_patterns)))


@pytest.fixture
def seeded_client(authenticated_api_client: APIClient, user_config: Any) -> APIClient:
    """Logged-in client whose user owns one connection of every type, id ``c1``."""
    from apps.core.models import Connection

    user_config.add_connection(
        Connection(id="c1", name="GS", url="http://gs.test/geoserver", username="a", password="b")
    )
    user_config.add_s3_connection(
        S3Connection(id="c1", name="S3", endpoint="s3.test", access_key="k", secret_key="s")
    )
    user_config.add_geonode_connection(
        GeoNodeConnection(id="c1", name="GN", url="http://gn.test", username="a", password="b")
    )
    user_config.add_iceberg_connection(
        IcebergCatalogConnection(id="c1", name="IC", url="http://ic.test", warehouse="w")
    )
    user_config.add_qfieldcloud_connection(
        QFieldCloudConnection(id="c1", name="QF", username="u", token="t")
    )
    user_config.add_mergin_connection(
        MerginMapsConnection(id="c1", name="MM", username="u", token="t")
    )
    user_config.add_pg_service(PGService(name="c1", host="db.test", dbname="d", user="u"))
    authenticated_api_client.raise_request_exception = False
    return authenticated_api_client


PUBLIC_ROUTES = {"/api/auth/login/"}
ROUTES = _routes()


def _call(client: APIClient, path: str, method: str) -> Any:
    body = BODY if method in ("post", "put", "patch") else None
    return (
        getattr(client, method)(path, body, format="json")
        if body
        else getattr(client, method)(path)
    )


@pytest.mark.api
@pytest.mark.parametrize(("path", "method"), ROUTES, ids=[f"{m}:{p}" for p, m in ROUTES])
class TestEndpointSweep:
    def test_upstream_ok(self, seeded_client, http_mock, path, method):
        http_mock.add("*", ".*", json={})
        response = _call(seeded_client, path, method)
        assert response.status_code < 600

    def test_upstream_failing(self, seeded_client, http_mock, path, method):
        http_mock.add("*", ".*", status=500, text="upstream down")
        response = _call(seeded_client, path, method)
        assert response.status_code < 600

    def test_requires_authentication(self, api_client, path, method):
        response = _call(api_client, path, method)
        if path in PUBLIC_ROUTES:
            assert response.status_code < 500
        else:
            assert response.status_code in (401, 403)
