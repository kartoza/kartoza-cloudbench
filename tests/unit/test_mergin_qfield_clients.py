"""Unit tests for the Mergin Maps and QFieldCloud API clients."""

from types import SimpleNamespace

import httpx
import pytest

from apps.mergin import client as mergin
from apps.qfieldcloud import client as qfield

# Managers only read .pk (cache key) and pass the user on to get_config.
USER = SimpleNamespace(pk=1, username="u")
OTHER_USER = SimpleNamespace(pk=2, username="v")
MERGIN_URL = "https://mergin.test"
QFIELD_URL = "https://qfield.test"


def _mergin_project(**extra):
    return {
        "id": "p1",
        "name": "proj",
        "namespace": "ns",
        "description": "d",
        "version": "v3",
        "disk_usage": 10,
        "created": "c",
        "updated": "u",
        "access": {"owners": []},
        **extra,
    }


@pytest.mark.unit
class TestMerginClient:
    def test_headers_prefer_auth_token_then_static_token(self):
        assert mergin.MerginClient(MERGIN_URL, "u")._get_headers() == {}
        static = mergin.MerginClient(MERGIN_URL, "u", token="t")
        assert static._get_headers() == {"Authorization": "Bearer t"}
        static._auth_token = "session"
        assert static._get_headers() == {"Authorization": "Bearer session"}

    def test_authenticate_with_token(self):
        c = mergin.MerginClient(MERGIN_URL + "/", "u", token="t")
        assert c.url == MERGIN_URL
        assert c.authenticate() is True

    def test_authenticate_without_credentials(self):
        assert mergin.MerginClient(MERGIN_URL, "u").authenticate() is False

    def test_authenticate_with_password(self, http_mock):
        http_mock.add("POST", "/v1/auth/login", json={"token": "abc"})
        c = mergin.MerginClient(MERGIN_URL, "u", password="pw")
        assert c.authenticate() is True
        assert c._get_headers() == {"Authorization": "Bearer abc"}

    def test_authenticate_login_without_token(self, http_mock):
        http_mock.add("POST", "/v1/auth/login", json={})
        assert mergin.MerginClient(MERGIN_URL, "u", password="pw").authenticate() is False

    def test_test_connection_ok(self, http_mock):
        http_mock.add("GET", "/v1/user/profile", json={"username": "alice"})
        ok, msg = mergin.MerginClient(MERGIN_URL, "u", token="t").test_connection()
        assert ok and "alice" in msg

    def test_test_connection_authenticates_first(self, http_mock):
        http_mock.add("POST", "/v1/auth/login", json={"token": "abc"})
        http_mock.add("GET", "/v1/user/profile", json={})
        ok, msg = mergin.MerginClient(MERGIN_URL, "bob", password="pw").test_connection()
        assert ok and "bob" in msg

    def test_test_connection_http_error(self, http_mock):
        http_mock.add("GET", "/v1/user/profile", status=401)
        ok, msg = mergin.MerginClient(MERGIN_URL, "u", token="t").test_connection()
        assert not ok and "401" in msg

    def test_test_connection_network_error(self, http_mock):
        http_mock.add("GET", ".*", exc=httpx.ConnectError("down"))
        ok, msg = mergin.MerginClient(MERGIN_URL, "u", token="t").test_connection()
        assert not ok and "down" in msg

    def test_list_projects(self, http_mock):
        http_mock.add("GET", "/v1/project/paginated", json={"projects": [_mergin_project()]})
        projects = mergin.MerginClient(MERGIN_URL, "u", token="t").list_projects(
            namespace="ns", flag="created"
        )
        assert projects[0].to_dict()["fullName"] == "ns/proj"
        query = str(http_mock.calls[0].url)
        assert "namespace=ns" in query and "flag=created" in query

    def test_get_project(self, http_mock):
        http_mock.add("GET", "/v1/project/ns/proj", json=_mergin_project())
        project = mergin.MerginClient(MERGIN_URL, "u", token="t").get_project("ns", "proj")
        assert project.version == "v3" and project.disk_usage == 10

    def test_get_project_not_found(self, http_mock):
        http_mock.add("GET", "/v1/project/ns/nope", status=404)
        assert mergin.MerginClient(MERGIN_URL, "u", token="t").get_project("ns", "nope") is None

    def test_list_project_files(self, http_mock):
        http_mock.add("GET", r"/v1/project/ns/proj$", json=_mergin_project())
        http_mock.add("GET", "/files", json=[{"path": "a.gpkg"}])
        client = mergin.MerginClient(MERGIN_URL, "u", token="t")
        assert client.list_project_files("ns", "proj", version="v2") == [{"path": "a.gpkg"}]
        assert "version=v2" in str(http_mock.calls[-1].url)

    def test_list_project_files_missing_project(self, http_mock):
        http_mock.add("GET", "/v1/project/ns/proj", status=404)
        assert (
            mergin.MerginClient(MERGIN_URL, "u", token="t").list_project_files("ns", "proj") == []
        )

    def test_project_versions(self, http_mock):
        http_mock.add("GET", "/history", json=[{"name": "v1"}])
        client = mergin.MerginClient(MERGIN_URL, "u", token="t")
        assert client.get_project_versions("ns", "proj") == [{"name": "v1"}]

    def test_http_error_propagates(self, http_mock):
        http_mock.add("GET", ".*", status=500)
        with pytest.raises(httpx.HTTPStatusError):
            mergin.MerginClient(MERGIN_URL, "u", token="t").list_projects()


@pytest.mark.unit
class TestMerginClientManager:
    @pytest.fixture(autouse=True)
    def _reset(self):
        mergin.MerginClientManager._instance = None
        yield
        mergin.MerginClientManager._instance = None

    def test_unknown_connection(self, monkeypatch):
        monkeypatch.setattr(
            mergin,
            "get_config",
            lambda _user: SimpleNamespace(get_mergin_connection=lambda _id: None),
        )
        with pytest.raises(ValueError, match="not found"):
            mergin.get_mergin_client("x", USER)

    def test_caches_and_removes_client(self, monkeypatch):
        conn = SimpleNamespace(url=MERGIN_URL, username="u", password=None, token="t")
        monkeypatch.setattr(
            mergin,
            "get_config",
            lambda _user: SimpleNamespace(get_mergin_connection=lambda _id: conn),
        )
        first = mergin.get_mergin_client("c1", USER)
        assert mergin.get_mergin_client("c1", USER) is first
        assert mergin.get_mergin_client("c1", OTHER_USER) is not first  # cached per user
        assert mergin.MerginClientManager() is mergin.MerginClientManager()
        mergin.MerginClientManager().remove_client("c1", USER)
        assert mergin.get_mergin_client("c1", USER) is not first


@pytest.mark.unit
class TestQFieldCloudClient:
    def make(self, **kwargs):
        return qfield.QFieldCloudClient(QFIELD_URL, "u", **kwargs)

    def test_headers(self):
        assert self.make()._get_headers() == {}
        c = self.make(token="t")
        assert c._get_headers() == {"Authorization": "Token t"}
        c._auth_token = "s"
        assert c._get_headers() == {"Authorization": "Token s"}

    def test_authenticate_variants(self, http_mock):
        assert self.make(token="t").authenticate() is True
        assert self.make().authenticate() is False
        http_mock.add("POST", "/auth/login/", json={"token": "abc"})
        assert self.make(password="pw").authenticate() is True

    def test_test_connection(self, http_mock):
        http_mock.add("GET", "/auth/user/", json={"username": "alice"})
        ok, msg = self.make(token="t").test_connection()
        assert ok and "alice" in msg

    def test_test_connection_failures(self, http_mock):
        http_mock.add("GET", "/auth/user/", status=403)
        ok, msg = self.make(token="t").test_connection()
        assert not ok and "403" in msg
        http_mock.add("GET", "/auth/user/", exc=httpx.ConnectError("nope"))
        ok, msg = self.make(token="t").test_connection()
        assert not ok and "nope" in msg

    def test_projects(self, http_mock):
        item = {"id": "1", "name": "n", "owner": "o", "is_public": True}
        http_mock.add("GET", r"/projects/$", json=[item])
        http_mock.add("GET", r"/projects/1/$", json=item)
        http_mock.add("GET", r"/projects/404/$", status=404)
        client = self.make(token="t")
        assert client.list_projects()[0].to_dict()["isPublic"] is True
        assert client.get_project("1").owner == "o"
        assert client.get_project("404") is None

    def test_files_status_download(self, http_mock):
        http_mock.add("GET", r"/files/1/$", json=[{"name": "a"}])
        http_mock.add("GET", r"/projects/1/status/", json={"status": "ok"})
        http_mock.add("GET", r"/files/1/a.txt/", content=b"data")
        client = self.make(token="t")
        assert client.list_project_files("1") == [{"name": "a"}]
        assert client.get_project_status("1") == {"status": "ok"}
        assert client.download_file("1", "a.txt") == b"data"


@pytest.mark.unit
class TestQFieldCloudClientManager:
    @pytest.fixture(autouse=True)
    def _reset(self):
        qfield.QFieldCloudClientManager._instance = None
        yield
        qfield.QFieldCloudClientManager._instance = None

    def test_unknown_connection(self, monkeypatch):
        monkeypatch.setattr(
            qfield,
            "get_config",
            lambda _user: SimpleNamespace(get_qfieldcloud_connection=lambda _id: None),
        )
        with pytest.raises(ValueError, match="not found"):
            qfield.get_qfieldcloud_client("x", USER)

    def test_caches_and_removes_client(self, monkeypatch):
        conn = SimpleNamespace(url=QFIELD_URL, username="u", password=None, token="t")
        monkeypatch.setattr(
            qfield,
            "get_config",
            lambda _user: SimpleNamespace(get_qfieldcloud_connection=lambda _id: conn),
        )
        first = qfield.get_qfieldcloud_client("c1", USER)
        assert qfield.get_qfieldcloud_client("c1", USER) is first
        assert qfield.get_qfieldcloud_client("c1", OTHER_USER) is not first  # cached per user
        qfield.QFieldCloudClientManager().remove_client("c1", USER)
        assert qfield.get_qfieldcloud_client("c1", USER) is not first
