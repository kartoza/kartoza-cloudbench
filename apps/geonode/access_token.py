"""A GeoNode OAuth2 access token for a username/password connection.

GeoServer only accepts GeoNode's OAuth2 tokens, not a GeoNode user's basic
auth, so the map preview's WMS proxy needs a token to draw private layers.
GeoNode hands out a user's token from ``/api/o/v4/userinfo`` (the same token
GeoServer checks), but only to a logged-in session, not to basic auth: so
log in through the login form first.

Tokens are kept in this process's memory, never stored. A token is fetched
again at most once every ``REFRESH_AFTER`` seconds: GeoServer answers an
expired token as it does an anonymous request, so the proxy can't tell "the
token expired" from "the layer is private", and would otherwise log in on every
tile of a private layer.
"""

import hashlib
import logging
import threading
import time

import httpx

logger = logging.getLogger(__name__)

REFRESH_AFTER = 60.0
LOGIN_PATH = "/account/login/"
USERINFO_PATH = "/api/o/v4/userinfo"

# key -> (token, fetched at); token is "" when the login failed.
_tokens: dict[str, tuple[str, float]] = {}
_lock = threading.Lock()


def _key(url: str, username: str, password: str) -> str:
    return hashlib.sha256(f"{url}\0{username}\0{password}".encode()).hexdigest()


def fetch_access_token(url: str, username: str, password: str) -> str:
    """Log in to GeoNode and return the user's OAuth2 access token.

    Raises ``ValueError`` when GeoNode rejects the login or hands out no token.
    """
    url = url.rstrip("/")
    with httpx.Client(base_url=url, timeout=30.0, follow_redirects=False) as session:
        session.get(LOGIN_PATH, follow_redirects=True).raise_for_status()
        csrf = session.cookies.get("csrftoken")
        if not csrf:
            raise ValueError("GeoNode's login page set no CSRF cookie")
        login = session.post(
            LOGIN_PATH,
            data={"csrfmiddlewaretoken": csrf, "login": username, "password": password},
            headers={"Referer": f"{url}{LOGIN_PATH}"},
        )
        # A successful login redirects; a failed one shows the form again.
        if not login.is_redirect:
            raise ValueError(f"GeoNode rejected the login (HTTP {login.status_code})")
        info = session.get(USERINFO_PATH)
        info.raise_for_status()
        token = info.json().get("access_token")
        if not token:
            raise ValueError("GeoNode's userinfo has no access_token")
        return token


def get_access_token(url: str, username: str, password: str, refresh: bool = False) -> str:
    """The connection's GeoNode access token, or "" if it can't be had.

    ``refresh`` asks for a new one (the one we have may have expired), unless
    it was fetched less than ``REFRESH_AFTER`` seconds ago.
    """
    key = _key(url, username, password)
    with _lock:
        cached = _tokens.get(key)
        if cached and (not refresh or time.monotonic() - cached[1] < REFRESH_AFTER):
            return cached[0]
        try:
            token = fetch_access_token(url, username, password)
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("No GeoNode access token for %s at %s: %s", username, url, e)
            token = ""
        _tokens[key] = (token, time.monotonic())
        return token
