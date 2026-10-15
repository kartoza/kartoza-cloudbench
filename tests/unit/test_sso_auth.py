"""Unit tests for the SSO token authentication used by the iframe handoff."""

import pytest
from django.core import signing
from django.test import RequestFactory

from apps.core.sso_auth import (
    QueryTokenAuthentication,
    SignedSSOTokenAuthentication,
    sign_sso_token,
)


@pytest.mark.unit
class TestSignedSSOTokenAuthentication:
    """Tests for SignedSSOTokenAuthentication."""

    @pytest.mark.django_db
    def test_authenticates_a_freshly_signed_token(self, settings, django_user_model) -> None:
        """A token signed with the current secret resolves to the real Django user."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        alice = django_user_model.objects.create(username="alice")
        token = sign_sso_token("alice")
        request = RequestFactory().get("/", HTTP_AUTHORIZATION=f"Token {token}")

        result = SignedSSOTokenAuthentication().authenticate(request)

        assert result is not None
        user, auth = result
        # A real model instance, so ORM lookups like filter(owner=request.user) work.
        assert user == alice
        assert user.is_authenticated is True
        assert auth is None

    @pytest.mark.django_db
    def test_rejects_token_for_unknown_user(self, settings) -> None:
        """A validly signed token whose user doesn't exist must not authenticate."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        token = sign_sso_token("ghost")
        request = RequestFactory().get("/", HTTP_AUTHORIZATION=f"Token {token}")

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    @pytest.mark.django_db
    def test_rejects_token_for_inactive_user(self, settings, django_user_model) -> None:
        """A deactivated user can't keep using a token minted before deactivation."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        django_user_model.objects.create(username="alice", is_active=False)
        token = sign_sso_token("alice")
        request = RequestFactory().get("/", HTTP_AUTHORIZATION=f"Token {token}")

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    def test_rejects_token_signed_with_a_different_secret(self, settings) -> None:
        """A token signed with a stale/wrong secret must not authenticate."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        stale_signer = signing.TimestampSigner(salt="cloudbench-sso", key="wrong-secret")
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
        request = RequestFactory().get("/", HTTP_AUTHORIZATION=f"Token {token}")

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    def test_ignores_requests_without_token_header(self, settings) -> None:
        """No Authorization header at all is just unauthenticated, not an error."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        request = RequestFactory().get("/")

        assert SignedSSOTokenAuthentication().authenticate(request) is None

    def test_ignores_non_token_authorization_schemes(self, settings) -> None:
        """A Bearer/Basic header (service-to-service auth) is left alone."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        request = RequestFactory().get("/", HTTP_AUTHORIZATION="Bearer some-service-token")

        assert SignedSSOTokenAuthentication().authenticate(request) is None


@pytest.mark.unit
class TestQueryTokenAuthentication:
    """Tests for QueryTokenAuthentication (the ?token= path, for Web Workers)."""

    def _drf_get(self, path):
        """A DRF Request (has .query_params), as DRF hands authenticators."""
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory

        return Request(APIRequestFactory().get(path))

    @pytest.mark.django_db
    def test_authenticates_a_signed_sso_token_in_the_query(
        self, settings, django_user_model
    ) -> None:
        """A signed SSO token passed as ?token= resolves to the real Django user."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        alice = django_user_model.objects.create(username="alice")
        token = sign_sso_token("alice")

        result = QueryTokenAuthentication().authenticate(self._drf_get(f"/?token={token}"))

        assert result is not None
        user, auth = result
        assert user == alice
        assert auth is None

    @pytest.mark.django_db
    def test_authenticates_a_drf_token_in_the_query(self, settings, django_user_model) -> None:
        """A DRF auth token (standalone login) passed as ?token= also works."""
        from rest_framework.authtoken.models import Token

        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        bob = django_user_model.objects.create(username="bob")
        key = Token.objects.create(user=bob).key

        result = QueryTokenAuthentication().authenticate(self._drf_get(f"/?token={key}"))

        assert result is not None
        user, _ = result
        assert user == bob

    @pytest.mark.django_db
    def test_rejects_a_drf_token_for_an_inactive_user(self, settings, django_user_model) -> None:
        """A DRF token can't be used once its user is deactivated."""
        from rest_framework.authtoken.models import Token

        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        bob = django_user_model.objects.create(username="bob", is_active=False)
        key = Token.objects.create(user=bob).key

        assert QueryTokenAuthentication().authenticate(self._drf_get(f"/?token={key}")) is None

    def test_ignores_requests_without_a_token_param(self, settings) -> None:
        """No ?token= at all is just unauthenticated, not an error."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"

        assert QueryTokenAuthentication().authenticate(self._drf_get("/")) is None

    @pytest.mark.django_db
    def test_rejects_an_unknown_token(self, settings) -> None:
        """A ?token= that is neither a valid SSO token nor a DRF key is refused."""
        settings.CLOUDBENCH_SERVICE_TOKEN = "shh"
        settings.CLOUDBENCH_SSO_TOKEN_MAX_AGE = 3600
        stale = signing.TimestampSigner(salt="cloudbench-sso", key="wrong-secret").sign("7")

        assert QueryTokenAuthentication().authenticate(self._drf_get(f"/?token={stale}")) is None
        assert QueryTokenAuthentication().authenticate(self._drf_get("/?token=deadbeef")) is None


@pytest.mark.django_db
def test_anonymous_requests_are_asked_to_log_in_with_401():
    """With the real authenticators, an anonymous request gets 401, not 403."""
    from rest_framework.authentication import TokenAuthentication
    from rest_framework.permissions import IsAuthenticated
    from rest_framework.response import Response
    from rest_framework.test import APIRequestFactory
    from rest_framework.views import APIView

    class Protected(APIView):
        authentication_classes = [SignedSSOTokenAuthentication, TokenAuthentication]
        permission_classes = [IsAuthenticated]

        def get(self, request):
            return Response({})

    response = Protected.as_view()(APIRequestFactory().get("/api/anything"))

    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Token"
