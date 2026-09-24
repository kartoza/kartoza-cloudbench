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

    def authenticate(self, request):
        """Return (user, None) for a valid token, else None."""
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith("Token "):
            return None
        token = auth_header[len("Token ") :].strip()
        if not token:
            return None

        signer = signing.TimestampSigner(
            salt=_SSO_TOKEN_SALT, key=settings.CLOUDBENCH_SERVICE_TOKEN
        )
        try:
            username = signer.unsign(token, max_age=settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE)
        except signing.BadSignature:
            return None

        user = get_user_model().objects.filter(username=username, is_active=True).first()
        if user is None:
            return None
        return user, None
