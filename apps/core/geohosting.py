"""Client for GeoHosting's API, as CloudBench calls it.

The opposite direction to apps.core.geohosting_bridge (GeoHosting pushing
into CloudBench). Authenticates with OAuth client credentials: an
Application on GeoHosting whose id/secret are GEOHOSTING_CLIENT_ID/
GEOHOSTING_CLIENT_SECRET, its tokens requested with the `cloudbench` scope.
GeoHosting gives that scope only to the Application set as its
CLOUDBENCH_OAUTH_CLIENT_ID, and its API needs nothing else (no staff user
behind it, no session). Access tokens are short-lived
(minutes); one is cached per process until shortly before it expires, and
fetched again on a 401.
"""

import logging
import threading
import time

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

SCOPE = "cloudbench"
# Fetch a new token this long before the cached one expires.
TOKEN_MARGIN = 30


class GeoHostingError(Exception):
    """GeoHosting couldn't be reached, refused us, or answered unexpectedly."""


class GeoHostingClient:
    # (url, client_id) -> (access token, time.monotonic() it expires at)
    _tokens: dict = {}
    _lock = threading.Lock()

    def __init__(self):
        self.url = settings.GEOHOSTING_URL.rstrip("/")
        self.client_id = settings.GEOHOSTING_CLIENT_ID
        self.client_secret = settings.GEOHOSTING_CLIENT_SECRET
        if not self.is_configured():
            raise GeoHostingError(
                "GeoHosting isn't configured "
                "(GEOHOSTING_URL, GEOHOSTING_CLIENT_ID, GEOHOSTING_CLIENT_SECRET)."
            )

    @staticmethod
    def is_configured():
        return bool(
            settings.GEOHOSTING_URL
            and settings.GEOHOSTING_CLIENT_ID
            and settings.GEOHOSTING_CLIENT_SECRET
        )

    @classmethod
    def clear_token_cache(cls):
        with cls._lock:
            cls._tokens.clear()

    # -- CloudNativeGIS Processing ---------------------------------------------

    def cloudnative_gis_processing_health(self):
        """GeoHosting's check that it can start servers (Hetzner API + snapshot).

        Returns its answer - {"healthy": true, "snapshot": {...}} or
        {"healthy": false, "detail": "..."} - or raises GeoHostingError if
        GeoHosting itself couldn't be asked.
        """
        response = self.request("GET", "api/v1/cloudnative-gis-processing/healthy/")
        # 503 is GeoHosting answering "not healthy", with the reason.
        if response.status_code not in (200, 503):
            raise GeoHostingError(
                f"GeoHosting's health check returned HTTP {response.status_code}."
            )
        return self._json(response)

    # -- HTTP ------------------------------------------------------------------

    def request(self, method, path, **kwargs):
        """Call GeoHosting's API with an access token, fetching a new one on a 401."""
        response = self._send(method, path, self.access_token(), **kwargs)
        if response.status_code == 401:
            response = self._send(method, path, self.access_token(refresh=True), **kwargs)
        return response

    def access_token(self, refresh=False):
        key = (self.url, self.client_id)
        with self._lock:
            cached = self._tokens.get(key)
            if cached and not refresh and cached[1] > time.monotonic():
                return cached[0]
            token, expires_in = self._fetch_token()
            self._tokens[key] = (token, time.monotonic() + max(0, expires_in - TOKEN_MARGIN))
            return token

    def _fetch_token(self):
        try:
            response = httpx.post(
                f"{self.url}/oauth2/token/",
                data={"grant_type": "client_credentials", "scope": SCOPE},
                auth=(self.client_id, self.client_secret),
                timeout=httpx.Timeout(30, connect=10),
            )
        except httpx.HTTPError as exc:
            raise GeoHostingError(f"Could not reach GeoHosting: {exc}") from exc
        if response.status_code != 200:
            raise GeoHostingError(
                f"GeoHosting refused the client credentials (HTTP {response.status_code}): "
                f"{response.text[:200]}"
            )
        body = self._json(response)
        if not body.get("access_token"):
            raise GeoHostingError("GeoHosting returned no access token.")
        return body["access_token"], int(body.get("expires_in") or 0)

    def _send(self, method, path, token, **kwargs):
        try:
            return httpx.request(
                method,
                f"{self.url}/{path.lstrip('/')}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=httpx.Timeout(30, connect=10),
                follow_redirects=False,
                **kwargs,
            )
        except httpx.HTTPError as exc:
            raise GeoHostingError(f"Could not reach GeoHosting: {exc}") from exc

    @staticmethod
    def _json(response):
        try:
            return response.json()
        except ValueError as exc:
            raise GeoHostingError(
                f"GeoHosting returned a non-JSON response (HTTP {response.status_code})."
            ) from exc
