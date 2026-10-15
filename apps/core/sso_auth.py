"""DRF authentication for GeoHosting's iframe SSO handoff.

CloudBench is embedded directly in GeoHosting's frontend via iframe,
cross-origin — there's no shared Django session and no fronting nginx to
trust headers from any more. Instead, GeoHosting's backend asks CloudBench
(via /api/geohosting/sso-token/, see geohosting_bridge.py) to mint a
short-lived signed token for the logged-in user, and hands it to the
browser as a URL parameter. CloudBench's own frontend picks that up and
sends it back as "Authorization: Token <value>" on every API call (see
web/src/api/common.ts) — this class verifies it.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from rest_framework.authentication import BaseAuthentication

_SSO_TOKEN_SALT = "cloudbench-sso"


def sign_sso_token(username: str) -> str:
    """Mint a signed, time-limited SSO token for the given username."""
    return signing.TimestampSigner(
        salt=_SSO_TOKEN_SALT, key=settings.CLOUDBENCH_SERVICE_TOKEN
    ).sign(username)


def _user_for_sso_token(token: str):
    """The active Django user a signed SSO token resolves to, or ``None``.

    ``None`` (never an exception) for a missing, malformed, expired or
    unknown-user token, so an authenticator built on this falls through to
    the next one instead of hard-failing.
    """
    if not token:
        return None
    signer = signing.TimestampSigner(salt=_SSO_TOKEN_SALT, key=settings.CLOUDBENCH_SERVICE_TOKEN)
    try:
        username = signer.unsign(token, max_age=settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE)
    except signing.BadSignature:
        return None
    return get_user_model().objects.filter(username=username, is_active=True).first()


def _user_for_drf_token(key: str):
    """The active user a DRF auth token resolves to, or ``None``.

    What ``rest_framework.authentication.TokenAuthentication`` reads from the
    header, looked up here from a raw key — for standalone CloudBench, whose
    login issues a DRF token rather than a signed SSO one.
    """
    if not key:
        return None
    try:
        from rest_framework.authtoken.models import Token
    except (ImportError, RuntimeError):
        return None
    token = Token.objects.select_related("user").filter(key=key).first()
    if token is None or not token.user.is_active:
        return None
    return token.user


class SignedSSOTokenAuthentication(BaseAuthentication):
    """Authenticate requests carrying a signed SSO token.

    Reads ``Authorization: Token <value>``, verifies the signature and
    expiry, and resolves it to the Django user with that username — the
    bridge (geohosting_bridge.get_user) creates it before any token for it
    is minted, so SSO requests get the same ``request.user`` as a normal
    login. Returns ``None`` (rather than raising) on a missing/invalid/
    expired token, or one whose user no longer exists or is inactive, so
    DRF falls through to the next authenticator instead of hard-failing.
    """

    def authenticate_header(self, _request):
        """The scheme a refused request is told to log in with.

        The same `Token` header TokenAuthentication reads. As the first
        authenticator, this is what DRF asks: without it, an anonymous
        request gets 403 instead of 401 with `WWW-Authenticate: Token`.
        """
        return "Token"

    def authenticate(self, request):
        """Return (user, None) for a valid ``Token`` header, else None."""
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith("Token "):
            return None
        user = _user_for_sso_token(auth_header[len("Token ") :].strip())
        return (user, None) if user else None


class QueryTokenAuthentication(BaseAuthentication):
    """Authenticate a token passed as the ``token`` query parameter.

    For requests a Web Worker makes, which can't carry an Authorization
    header: the point-cloud (COPC) preview reader (maplibre-gl-lidar) streams
    a file with byte-range requests from inside a Worker, and the app's
    window.fetch token-injection patch (web/src/api/common.ts) only runs on
    the main thread, so it can't reach them. The worker instead gets the
    token in the proxy URL's query string.

    Accepts either kind of token the header path takes — a signed SSO token
    (GeoHosting iframe; already handed to the browser as a URL parameter at
    load, so no new exposure) or a DRF auth token (standalone login). Use it
    only on the S3 proxy view, so a token travels in a URL for that read-only,
    per-connection-scoped endpoint and nowhere else. Falls through (returns
    ``None``) on a missing/invalid token.
    """

    def authenticate(self, request):
        """Return (user, None) for a valid ``?token=``, else None."""
        token = request.query_params.get("token", "").strip()
        if not token:
            return None
        user = _user_for_sso_token(token) or _user_for_drf_token(token)
        return (user, None) if user else None
