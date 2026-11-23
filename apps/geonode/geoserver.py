"""Requests to a GeoNode's GeoServer (``<GeoNode>/geoserver/ows``), as the connection's user.

GeoServer checks a GeoNode OAuth2 token with GeoNode, so private layers the
user may see are served too. A token connection sends its token; a
username/password connection logs in to GeoNode for one (``access_token``),
since GeoServer doesn't take a GeoNode user's basic auth. (GeoNode's own
``/gs/ows`` proxy does take basic auth, but a map's worth of tiles at once
hangs GeoNode: each holds a GeoNode worker while GeoServer waits on another
for the token check.)
"""

import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx

from apps.core.config import GeoNodeConnection

from .access_token import get_access_token

# GeoServer's answers to a layer the request may not see, the same as to one
# that doesn't exist: WMS, WFS and WCS each word it differently.
_HIDDEN = re.compile(
    rb"LayerNotDefined|Could not find layer|Feature type \S+ unknown"
    rb"|NoSuchCoverage|Could not locate coverage"
)


# The content types of GeoServer's exception reports (and of an HTML error page).
_EXCEPTION_TYPES = {"text/xml", "application/xml", "application/vnd.ogc.se_xml", "text/html"}


def is_exception(response: httpx.Response) -> bool:
    """Whether GeoServer answered with an error, not the data asked for.

    GeoServer often answers an error with 200 and an XML exception report.
    (Matched exactly: an Excel export's type has "xml" in it too.)
    """
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    return response.status_code >= 400 or content_type in _EXCEPTION_TYPES


def layer_hidden(response: httpx.Response) -> bool:
    """Whether GeoServer refused the layer: denied, or "not found" (private)."""
    if response.status_code in (401, 403):
        return True
    if not is_exception(response):
        return False
    return bool(_HIDDEN.search(response.read()))


def exception_message(response: httpx.Response) -> str:
    """GeoServer's error message from an exception report (or the status)."""
    body = response.read().decode(errors="replace")
    match = re.search(r"<(?:ServiceException|ows:ExceptionText)(?:\s[^>]*)?>([\s\S]*?)</", body)
    if match and match.group(1).strip():
        return match.group(1).strip()
    return f"GeoServer answered {response.status_code}"


def _send(client: httpx.Client, url: str, params: Any, token: str) -> httpx.Response:
    headers = {"User-Agent": "CloudBench"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = client.build_request(
        "GET", f"{url.rstrip('/')}/geoserver/ows", params=params, headers=headers
    )
    return client.send(request, stream=True)


@contextmanager
def open_ows(
    conn: GeoNodeConnection, params: Any, timeout: float = 30.0
) -> Iterator[httpx.Response]:
    """GET ``/geoserver/ows`` with ``params``, as the connection's user; streamed.

    GeoServer treats an expired token as no token, so a layer it won't show
    may just need a fresh one: a username/password connection then logs in
    again (at most once a minute) and asks once more.
    """
    logs_in = not conn.api_key and bool(conn.username and conn.password)
    token = conn.api_key or (
        get_access_token(conn.url, conn.username, conn.password) if logs_in else ""
    )
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = _send(client, conn.url, params, token)
        try:
            if logs_in and layer_hidden(response):
                fresh = get_access_token(conn.url, conn.username, conn.password, refresh=True)
                if fresh and fresh != token:
                    response.close()
                    response = _send(client, conn.url, params, fresh)
            yield response
        finally:
            response.close()
