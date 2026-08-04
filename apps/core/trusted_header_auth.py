"""Middleware that trusts an internal reverse proxy for user identity.

Standalone CloudBench no longer shares a Django session with GeoHosting, so
it can't rely on ``request.user`` from ``AuthenticationMiddleware`` for
browser-originated requests. Instead, nginx validates the GSH session via
an ``auth_request`` subrequest and forwards the resulting user id in the
``X-User-Id`` header, alongside a static ``X-Internal-Token`` shared secret
so CloudBench only trusts requests that actually came through nginx.
"""

from django.conf import settings
from django.contrib.auth.models import AnonymousUser


class TrustedHeaderUser:
    """Minimal stand-in for a Django user, identified only by id.

    CloudBench has no user database of its own — its config storage is
    keyed by a plain user id string — so this needs to satisfy the
    ``request.user`` surface that existing views and DRF's
    SessionAuthentication (which checks ``is_active``) rely on.
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


class TrustedHeaderAuthMiddleware:
    """Populate ``request.user`` from trusted internal proxy headers."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        secret = getattr(settings, "INTERNAL_SHARED_SECRET", "")
        token = request.META.get("HTTP_X_INTERNAL_TOKEN", "")
        user_id = request.META.get("HTTP_X_USER_ID", "")

        if secret and token == secret and user_id:
            request.user = TrustedHeaderUser(user_id)
        elif not hasattr(request, "user"):
            request.user = AnonymousUser()

        return self.get_response(request)
