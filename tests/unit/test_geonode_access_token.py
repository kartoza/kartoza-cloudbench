"""A username/password GeoNode connection's OAuth2 token (for the WMS preview)."""

import pytest

from apps.geonode import access_token

GN = "https://gn.example"


@pytest.fixture(autouse=True)
def _no_cached_tokens():
    access_token._tokens.clear()
    yield
    access_token._tokens.clear()


def _geonode(http_mock, *, login_status=302, token="tok"):
    http_mock.add(
        "GET",
        "/account/login/$",
        text="<form>",
        headers={"set-cookie": "csrftoken=csrf1; Path=/"},
    )
    http_mock.add(
        "POST",
        "/account/login/$",
        status=login_status,
        headers={"location": "/people/profile/u/"} if login_status == 302 else {},
    )
    http_mock.add("GET", "/api/o/v4/userinfo$", json={"access_token": token})


def test_logs_in_and_reads_the_token(http_mock):
    _geonode(http_mock)
    assert access_token.fetch_access_token(GN + "/", "u", "p") == "tok"

    login = http_mock.requests("POST")[0]
    body = login.content.decode()
    assert "csrfmiddlewaretoken=csrf1" in body and "login=u" in body and "password=p" in body
    assert login.headers["Referer"] == f"{GN}/account/login/"
    userinfo = http_mock.calls[-1]
    assert "csrftoken=csrf1" in userinfo.headers["cookie"]


def test_rejected_login_raises(http_mock):
    _geonode(http_mock, login_status=200)
    with pytest.raises(ValueError, match="rejected the login"):
        access_token.fetch_access_token(GN, "u", "bad")


def test_token_is_cached(http_mock):
    _geonode(http_mock)
    assert access_token.get_access_token(GN, "u", "p") == "tok"
    assert access_token.get_access_token(GN, "u", "p") == "tok"
    assert len(http_mock.requests("POST")) == 1


def test_refresh_waits_a_minute_between_logins(http_mock):
    _geonode(http_mock)
    access_token.get_access_token(GN, "u", "p")
    # Just fetched: a refresh keeps it, or every tile of a private layer logs in.
    access_token.get_access_token(GN, "u", "p", refresh=True)
    assert len(http_mock.requests("POST")) == 1

    key = access_token._key(GN, "u", "p")
    token, fetched = access_token._tokens[key]
    access_token._tokens[key] = (token, fetched - access_token.REFRESH_AFTER - 1)
    _geonode(http_mock, token="tok2")
    assert access_token.get_access_token(GN, "u", "p", refresh=True) == "tok2"
    assert len(http_mock.requests("POST")) == 2


def test_failed_login_gives_no_token(http_mock):
    _geonode(http_mock, login_status=200)
    assert access_token.get_access_token(GN, "u", "bad") == ""
