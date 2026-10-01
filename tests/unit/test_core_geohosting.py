"""GeoHostingClient: OAuth client credentials, and the CloudNativeGIS health check."""

from unittest.mock import patch

import httpx
import pytest

from apps.core.geohosting import GeoHostingClient, GeoHostingError

HEALTHY = "http://geohosting/api/v1/cloudnative-gis-processing/healthy/"


@pytest.fixture
def geohosting(settings):
    settings.GEOHOSTING_URL = "http://geohosting"
    settings.GEOHOSTING_CLIENT_ID = "cloudbench"
    settings.GEOHOSTING_CLIENT_SECRET = "secret"
    GeoHostingClient.clear_token_cache()
    yield settings
    GeoHostingClient.clear_token_cache()


def token_response(token="token-1", expires_in=300):
    return httpx.Response(200, json={"access_token": token, "expires_in": expires_in})


@pytest.mark.parametrize(
    "missing", ["GEOHOSTING_URL", "GEOHOSTING_CLIENT_ID", "GEOHOSTING_CLIENT_SECRET"]
)
def test_needs_every_setting(geohosting, missing):
    setattr(geohosting, missing, "")
    assert GeoHostingClient.is_configured() is False
    with pytest.raises(GeoHostingError, match="isn't configured"):
        GeoHostingClient()


def test_health_check_with_a_client_credentials_token(geohosting):
    answer = {"healthy": True, "snapshot": {"id": 123}}
    with (
        patch("apps.core.geohosting.httpx.post", return_value=token_response()) as post,
        patch(
            "apps.core.geohosting.httpx.request", return_value=httpx.Response(200, json=answer)
        ) as request,
    ):
        assert GeoHostingClient().cloudnative_gis_processing_health() == answer

    post.assert_called_once()
    assert post.call_args.args == ("http://geohosting/oauth2/token/",)
    assert post.call_args.kwargs["data"] == {
        "grant_type": "client_credentials",
        "scope": "cloudbench",
    }
    assert post.call_args.kwargs["auth"] == ("cloudbench", "secret")
    assert request.call_args.args == ("GET", HEALTHY)
    assert request.call_args.kwargs["headers"] == {"Authorization": "Bearer token-1"}


def test_unhealthy_answer_is_returned_not_raised(geohosting):
    answer = {"healthy": False, "detail": "No snapshot found"}
    with (
        patch("apps.core.geohosting.httpx.post", return_value=token_response()),
        patch("apps.core.geohosting.httpx.request", return_value=httpx.Response(503, json=answer)),
    ):
        assert GeoHostingClient().cloudnative_gis_processing_health() == answer


def test_token_is_reused_until_it_expires(geohosting):
    ok = httpx.Response(200, json={"healthy": True})
    with (
        patch(
            "apps.core.geohosting.httpx.post",
            side_effect=[token_response("token-1"), token_response("token-2")],
        ) as post,
        patch("apps.core.geohosting.httpx.request", return_value=ok) as request,
        # Fetched at 0 (expires at 270); checked at 100; checked and refetched at 1000.
        patch("apps.core.geohosting.time.monotonic", side_effect=[0, 100, 1000, 1000]),
    ):
        GeoHostingClient().cloudnative_gis_processing_health()  # fetched at 0
        GeoHostingClient().cloudnative_gis_processing_health()  # 100: still valid
        GeoHostingClient().cloudnative_gis_processing_health()  # 1000: expired

    assert post.call_count == 2
    tokens = [call.kwargs["headers"]["Authorization"] for call in request.call_args_list]
    assert tokens == ["Bearer token-1", "Bearer token-1", "Bearer token-2"]


def test_a_401_fetches_a_new_token_once(geohosting):
    with (
        patch(
            "apps.core.geohosting.httpx.post",
            side_effect=[token_response("revoked"), token_response("fresh")],
        ) as post,
        patch(
            "apps.core.geohosting.httpx.request",
            side_effect=[httpx.Response(401), httpx.Response(200, json={"healthy": True})],
        ) as request,
    ):
        assert GeoHostingClient().cloudnative_gis_processing_health() == {"healthy": True}

    assert post.call_count == 2
    assert request.call_args.kwargs["headers"] == {"Authorization": "Bearer fresh"}


@pytest.mark.parametrize(
    "token, health, error",
    [
        (httpx.Response(401, text="invalid_client"), None, "refused the client credentials"),
        (httpx.ConnectError("refused"), None, "Could not reach GeoHosting"),
        (token_response(), httpx.Response(403), "returned HTTP 403"),
        (token_response(), httpx.ConnectError("refused"), "Could not reach GeoHosting"),
        (token_response(), httpx.Response(200, text="<html>"), "non-JSON"),
    ],
)
def test_errors_raise_geohosting_error(geohosting, token, health, error):
    with (
        patch("apps.core.geohosting.httpx.post", side_effect=[token]),
        patch("apps.core.geohosting.httpx.request", side_effect=[health]),
        pytest.raises(GeoHostingError, match=error),
    ):
        GeoHostingClient().cloudnative_gis_processing_health()
