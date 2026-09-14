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
from django.core import signing
from rest_framework.authentication import BaseAuthentication

_SSO_TOKEN_SALT = "cloudbench-sso"


class TrustedHeaderUser:
    """Minimal stand-in for a Django user, identified only by id.

    CloudBench has no user database of its own — its config storage is
    keyed by a plain user id string — so this needs to satisfy the
    ``request.user`` surface that existing views rely on.
    """

    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_staff = False
    is_superuser = False

    def __init__(self, user_id: str) -> None:
        self.id = user_id
        self.pk = user_id
        self.username = user_id

    def __str__(self) -> str:
        return self.id


def sign_sso_token(user_id: str) -> str:
    """Mint a signed, time-limited SSO token for the given user id."""
    return signing.TimestampSigner(
        salt=_SSO_TOKEN_SALT, key=settings.CLOUDBENCH_SERVICE_TOKEN
    ).sign(user_id)


class SignedSSOTokenAuthentication(BaseAuthentication):
    """Authenticate requests carrying a signed SSO token.

    Reads ``Authorization: Token <value>``, verifies the signature and
    expiry, and resolves it to a ``TrustedHeaderUser``. Returns ``None``
    (rather than raising) on a missing/invalid/expired token, so DRF falls
    through to the next authenticator instead of hard-failing.
    """

    def authenticate(self, request):
        """Return (user, None) for a valid token, else None."""
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith("Token "):
            return None
        token = auth_header[len("Token "):].strip()
        if not token:
            return None

        signer = signing.TimestampSigner(
            salt=_SSO_TOKEN_SALT, key=settings.CLOUDBENCH_SERVICE_TOKEN
        )
        try:
            user_id = signer.unsign(
                token, max_age=settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE
            )
        except signing.BadSignature:
            return None

        return TrustedHeaderUser(user_id), None
