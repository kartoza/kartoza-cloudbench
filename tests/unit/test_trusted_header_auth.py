"""Unit tests for the trusted-header auth middleware."""

import pytest
from django.contrib.auth.models import AnonymousUser
from django.http import HttpResponse
from django.test import RequestFactory

from apps.core.trusted_header_auth import (
    TrustedHeaderAuthMiddleware,
    TrustedHeaderUser,
)


def _get_response(request):
    return HttpResponse("ok")


@pytest.mark.unit
class TestTrustedHeaderAuthMiddleware:
    """Tests for TrustedHeaderAuthMiddleware."""

    def test_sets_user_when_token_and_header_match(self, settings) -> None:
        """A matching internal token + user id populates request.user."""
        settings.INTERNAL_SHARED_SECRET = "shh"
        middleware = TrustedHeaderAuthMiddleware(_get_response)
        request = RequestFactory().get(
            "/", HTTP_X_INTERNAL_TOKEN="shh", HTTP_X_USER_ID="7"
        )
        middleware(request)
        assert isinstance(request.user, TrustedHeaderUser)
        assert request.user.id == "7"
        assert request.user.is_authenticated is True
        # DRF's SessionAuthentication checks is_active on request.user —
        # a regression here 500s every DRF view for trusted-header requests.
        assert request.user.is_active is True

    def test_ignores_mismatched_token(self, settings) -> None:
        """A wrong internal token must not authenticate the request."""
        settings.INTERNAL_SHARED_SECRET = "shh"
        middleware = TrustedHeaderAuthMiddleware(_get_response)
        request = RequestFactory().get(
            "/", HTTP_X_INTERNAL_TOKEN="wrong", HTTP_X_USER_ID="7"
        )
        middleware(request)
        assert isinstance(request.user, AnonymousUser)

    def test_ignores_when_secret_unset(self, settings) -> None:
        """An empty INTERNAL_SHARED_SECRET disables the trusted-header path."""
        settings.INTERNAL_SHARED_SECRET = ""
        middleware = TrustedHeaderAuthMiddleware(_get_response)
        request = RequestFactory().get(
            "/", HTTP_X_INTERNAL_TOKEN="anything", HTTP_X_USER_ID="7"
        )
        middleware(request)
        assert isinstance(request.user, AnonymousUser)

    def test_leaves_existing_user_when_headers_absent(self, settings) -> None:
        """Requests without the trusted headers keep whatever user was set."""
        settings.INTERNAL_SHARED_SECRET = "shh"
        middleware = TrustedHeaderAuthMiddleware(_get_response)
        request = RequestFactory().get("/")
        request.user = "someone-already-set"
        middleware(request)
        assert request.user == "someone-already-set"
