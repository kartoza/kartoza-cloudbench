"""Unit tests for the SSO token authentication used by the iframe handoff."""

import pytest
from django.core import signing
from django.test import RequestFactory

from apps.core.sso_auth import (
    SignedSSOTokenAuthentication,
    TrustedHeaderUser,
    sign_sso_token,
)


@pytest.mark.unit
class TestSignedSSOTokenAuthentication:
    """Tests for SignedSSOTokenAuthentication."""

    def test_authenticates_a_freshly_signed_token(self, settings) -> None:
        """A token signed with the current secret resolves to its user id."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        token = sign_sso_token("7")
        request = RequestFactory().get(
            "/", HTTP_AUTHORIZATION=f"Token {token}"
        )

        result = SignedSSOTokenAuthentication().authenticate(request)

        assert result is not None
        user, auth = result
        assert isinstance(user, TrustedHeaderUser)
        assert user.id == "7"
        assert user.is_authenticated is True
        # DRF's permission checks rely on is_active on request.user — a
        # regression here 500s every DRF view for SSO-authenticated requests.
        assert user.is_active is True
        assert auth is None

    def test_rejects_token_signed_with_a_different_secret(
        self, settings
    ) -> None:
        """A token signed with a stale/wrong secret must not authenticate."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        stale_signer = signing.TimestampSigner(
            salt="cloudbench-sso", key="wrong-secret"
        )
        request = RequestFactory().get(
            "/",
            HTTP_AUTHORIZATION=f"Token {stale_signer.sign('7')}",
        )

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    def test_rejects_expired_token(self, settings) -> None:
        """A token older than CLOUDBENCH_SSO_TOKEN_MAX_AGE must not pass."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 0
        token = sign_sso_token("7")
        request = RequestFactory().get(
            "/", HTTP_AUTHORIZATION=f"Token {token}"
        )

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    def test_ignores_requests_without_token_header(self, settings) -> None:
        """No Authorization header at all is just unauthenticated, not an error."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        request = RequestFactory().get("/")

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    def test_ignores_non_token_authorization_schemes(self, settings) -> None:
        """A Bearer/Basic header (service-to-service auth) is left alone."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        request = RequestFactory().get(
            "/", HTTP_AUTHORIZATION="Bearer some-service-token"
        )

        assert SignedSSOTokenAuthentication().authenticate(request) is None
