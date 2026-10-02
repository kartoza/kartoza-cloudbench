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


SERVER_TYPES = "http://geohosting/api/v1/cloudnative-gis-processing/server-types/"


def test_server_types_are_the_enabled_ones(geohosting):
    answer = [{"type": "cx23", "location": "fsn1", "currency": "EUR", "price": "0.0060"}]
    with (
        patch("apps.core.geohosting.httpx.post", return_value=token_response()),
        patch(
            "apps.core.geohosting.httpx.request", return_value=httpx.Response(200, json=answer)
        ) as request,
    ):
        assert GeoHostingClient().cloudnative_gis_processing_server_types() == answer
    assert request.call_args.args == ("GET", SERVER_TYPES)


def test_server_types_refused(geohosting):
    with (
        patch("apps.core.geohosting.httpx.post", return_value=token_response()),
        patch("apps.core.geohosting.httpx.request", return_value=httpx.Response(403)),
        pytest.raises(GeoHostingError, match="couldn't list its server types"),
    ):
        GeoHostingClient().cloudnative_gis_processing_server_types()


# -- A job's on-demand server ----------------------------------------------------

SERVERS = "http://geohosting/api/v1/cloudnative-gis-processing/servers/"
JOB_ID = "11111111-2222-3333-4444-555555555555"


def server_call(geohosting, answer, method_name, *args):
    """Call `method_name` with GeoHosting answering `answer`; returns (result, request, log)."""
    logged = []
    with (
        patch("apps.core.geohosting.httpx.post", return_value=token_response()),
        patch("apps.core.geohosting.httpx.request", side_effect=[answer]) as request,
    ):
        method = getattr(GeoHostingClient(), method_name)
        try:
            result = method(*args, log=lambda **entry: logged.append(entry))
        except GeoHostingError as exc:
            result = exc
    return result, request, logged


def test_create_server_posts_the_job_its_owner_and_server_type(geohosting):
    answer = {"job_id": JOB_ID, "status": "provisioning", "url": "", "token": ""}
    result, request, logged = server_call(
        geohosting, httpx.Response(202, json=answer), "create_server", JOB_ID, "tim", 7
    )
    assert result == answer
    assert request.call_args.args == ("POST", SERVERS)
    assert request.call_args.kwargs["json"] == {
        "job_id": JOB_ID,
        "username": "tim",
        "hetzner_server_id": 7,
    }
    [entry] = logged
    assert entry["method"] == "POST"
    assert entry["url"] == SERVERS
    assert entry["request_payload"] == {"job_id": JOB_ID, "username": "tim", "hetzner_server_id": 7}
    assert entry["status_code"] == 202
    assert entry["response_payload"] == answer
    assert entry["error"] == ""


@pytest.mark.parametrize(
    "status, detail",
    [
        (400, "No GeoHosting user 'tim'."),
        (400, "Server type 7 isn't enabled."),
        (409, "still being deleted"),
    ],
)
def test_create_server_refusals_carry_the_status(geohosting, status, detail):
    error, _, logged = server_call(
        geohosting,
        httpx.Response(status, json={"detail": detail}),
        "create_server",
        JOB_ID,
        "tim",
        7,
    )
    assert isinstance(error, GeoHostingError)
    assert error.status_code == status
    assert detail in str(error)
    assert logged[0]["status_code"] == status


def test_get_server(geohosting):
    answer = {"job_id": JOB_ID, "status": "ready", "url": "http://10.0.0.5:8000", "token": "t"}
    result, request, _ = server_call(
        geohosting, httpx.Response(200, json=answer), "get_server", JOB_ID
    )
    assert result == answer
    assert request.call_args.args == ("GET", f"{SERVERS}{JOB_ID}/")


def test_get_server_none(geohosting):
    result, _, _ = server_call(geohosting, httpx.Response(404, json={}), "get_server", JOB_ID)
    assert result is None


def test_delete_server(geohosting):
    deleting, request, _ = server_call(
        geohosting, httpx.Response(202, json={"status": "deleting"}), "delete_server", JOB_ID
    )
    assert deleting == {"status": "deleting"}
    assert request.call_args.args == ("DELETE", f"{SERVERS}{JOB_ID}/")
    gone, _, logged = server_call(geohosting, httpx.Response(204), "delete_server", JOB_ID)
    assert gone is None
    assert logged[0]["status_code"] == 204


def test_an_unreachable_geohosting_is_logged(geohosting):
    error, _, logged = server_call(
        geohosting, httpx.ConnectError("refused"), "create_server", JOB_ID, "tim", 7
    )
    assert isinstance(error, GeoHostingError)
    [entry] = logged
    assert entry["status_code"] is None
    assert "refused" in entry["error"]
