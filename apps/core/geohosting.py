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
    """GeoHosting couldn't be reached, refused us, or answered unexpectedly.

    `status_code` is GeoHosting's HTTP status, when it answered (e.g. 400 for
    an unknown user, 409 for a server still being deleted).
    """

    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


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

    def cloudnative_gis_processing_server_types(self):
        """The server types GeoHosting may start servers as - the enabled ones.

        [{id, type, location, specifications, currency, price, available}],
        the cheapest first; [] if none is enabled. `available`: whether
        Hetzner has it in stock right now. Raises GeoHostingError if
        GeoHosting couldn't be asked (or couldn't ask Hetzner).
        """
        response = self.request("GET", "api/v1/cloudnative-gis-processing/server-types/")
        if response.status_code != 200:
            raise self._refused(response, "list its server types")
        return self._json(response)

    # -- A CloudBench job's on-demand server ----------------------------------
    #
    # Each takes an optional `log` callback, called once per request with
    # method, url, request_payload, status_code, response_payload, error and
    # duration_ms - see apps.s3.models.CngLiteJobLog.

    SERVERS = "api/v1/cloudnative-gis-processing/servers/"

    def create_server(self, job_id, username, hetzner_server_id, log=None):
        """Ask GeoHosting for a server for `job_id`, owned by GeoHosting user `username`.

        Started in the background as `hetzner_server_id` - the `id` of one
        of cloudnative_gis_processing_server_types, the only type it's
        started as. Returns GeoHosting's answer, with status "provisioning"
        - or "ready" (and url/token) if it already was. Asking again for the
        same job gives the same server. Raises GeoHostingError, with
        status_code 400 for an unknown user or a server type that isn't
        enabled, and 409 for a server still being deleted (or another
        user's job).
        """
        payload = {
            "job_id": str(job_id),
            "username": username,
            "hetzner_server_id": hetzner_server_id,
        }
        response = self._logged("POST", self.SERVERS, log, json=payload)
        if response.status_code not in (200, 202):
            raise self._refused(response, "start a server")
        return self._json(response)

    def get_server(self, job_id, log=None):
        """GeoHosting's answer about `job_id`'s server, or None if it has none."""
        response = self._logged("GET", f"{self.SERVERS}{job_id}/", log)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise self._refused(response, "look up the server")
        return self._json(response)

    def delete_server(self, job_id, log=None):
        """Have GeoHosting delete `job_id`'s server, in the background.

        Returns its answer (status "deleting"), or None if there was none
        (any more).
        """
        response = self._logged("DELETE", f"{self.SERVERS}{job_id}/", log)
        if response.status_code == 204:
            return None
        if response.status_code != 202:
            raise self._refused(response, "delete the server")
        return self._json(response)

    # -- HTTP ------------------------------------------------------------------

    def _logged(self, method, path, log, **kwargs):
        """request(), reporting it to `log` (if given) whether or not it got an answer."""
        started = time.monotonic()
        response = error = None
        try:
            response = self.request(method, path, **kwargs)
            return response
        except GeoHostingError as exc:
            error = exc
            raise
        finally:
            if log is not None:
                log(
                    method=method,
                    url=f"{self.url}/{path.lstrip('/')}",
                    request_payload=kwargs.get("json"),
                    status_code=response.status_code if response is not None else None,
                    response_payload=_body(response) if response is not None else None,
                    error=str(error) if error else "",
                    duration_ms=(time.monotonic() - started) * 1000,
                )

    @staticmethod
    def _refused(response, action):
        """A GeoHostingError for an answer that isn't what we asked for."""
        body = _body(response)
        detail = body.get("detail") if isinstance(body, dict) else None
        return GeoHostingError(
            f"GeoHosting couldn't {action} (HTTP {response.status_code})"
            + (f": {detail}" if detail else "."),
            status_code=response.status_code,
        )

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


def _body(response):
    """A response's JSON body, else None."""
    try:
        return response.json()
    except ValueError:
        return None
