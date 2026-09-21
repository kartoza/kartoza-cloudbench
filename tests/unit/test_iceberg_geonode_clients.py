"""Unit tests for the Iceberg REST catalog and GeoNode API clients."""

from types import SimpleNamespace

import httpx
import pytest

from apps.core.models import GeoNodeConnection
from apps.geonode import client as geonode
from apps.iceberg import client as iceberg

ICE = "https://ice.test"
GN = "https://gn.test"


@pytest.mark.unit
class TestIcebergDataclasses:
    def test_namespace_dict(self):
        ns = iceberg.IcebergNamespace(name=["a", "b"])
        assert ns.to_dict() == {"name": ["a", "b"], "fullName": "a.b", "properties": {}}

    def test_table_dict(self):
        t = iceberg.IcebergTable(namespace=["a"], name="t", metadata_location="s3://m")
        assert t.to_dict()["fullName"] == "a.t"
        assert t.to_dict()["metadataLocation"] == "s3://m"


@pytest.mark.unit
class TestIcebergClient:
    def make(self, **kwargs):
        return iceberg.IcebergClient(ICE + "/", "wh", **kwargs)

    def test_headers(self):
        assert self.make()._get_headers() == {"X-Iceberg-Access-Delegation": "vended-credentials"}
        assert self.make(token="t")._get_headers()["Authorization"] == "Bearer t"
        c = self.make(token="t")
        c._access_token = "s"
        assert c._get_headers()["Authorization"] == "Bearer s"

    def test_authenticate_variants(self, http_mock):
        assert self.make(token="t").authenticate() is True
        assert self.make().authenticate() is True  # anonymous catalog
        creds = {"client_id": "i", "client_secret": "s"}
        http_mock.add("POST", "/v1/oauth/tokens", json={"access_token": "abc"})
        client = self.make(credentials=creds)
        assert client.authenticate() is True
        assert client._get_headers()["Authorization"] == "Bearer abc"
        http_mock.add("POST", "/v1/oauth/tokens", status=401)
        assert self.make(credentials=creds).authenticate() is False

    def test_test_connection(self, http_mock):
        http_mock.add("GET", "/v1/config", json={"defaults": {"a": "b"}})
        ok, msg = self.make().test_connection()
        assert ok and "Connected" in msg
        http_mock.add("GET", "/v1/config", status=500)
        ok, msg = self.make().test_connection()
        assert not ok and "500" in msg
        http_mock.add("GET", "/v1/config", exc=httpx.ConnectError("down"))
        ok, msg = self.make().test_connection()
        assert not ok and "down" in msg

    def test_get_config(self, http_mock):
        http_mock.add("GET", "/v1/config", json={"overrides": {}})
        assert self.make().get_config() == {"overrides": {}}
        assert "warehouse=wh" in str(http_mock.calls[0].url)

    def test_namespaces(self, http_mock):
        http_mock.add("GET", r"/v1/wh/namespaces(\?|$)", json={"namespaces": [["a"], ["b"]]})
        http_mock.add(
            "GET", r"/v1/wh/namespaces/a$", json={"namespace": ["a"], "properties": {"x": "1"}}
        )
        http_mock.add("GET", r"/v1/wh/namespaces/missing$", status=404)
        client = self.make()
        assert [n.name for n in client.list_namespaces(parent=["p"])] == [["a"], ["b"]]
        assert "parent=p" in str(http_mock.calls[0].url)
        assert client.get_namespace(["a"]).properties == {"x": "1"}
        assert client.get_namespace(["missing"]) is None

    def test_create_namespace(self, http_mock):
        http_mock.add("POST", r"/v1/wh/namespaces$", status=200, json={})
        ns = self.make().create_namespace(["n"], properties={"k": "v"})
        assert ns.name == ["n"] and ns.properties == {"k": "v"}
        assert b'"properties"' in http_mock.calls[0].content

    def test_tables(self, http_mock):
        http_mock.add(
            "GET",
            r"/namespaces/a/tables$",
            json={"identifiers": [{"namespace": ["a"], "name": "t1"}, {"name": "t2"}]},
        )
        http_mock.add(
            "GET", r"/tables/t1$", json={"metadata-location": "s3://m", "properties": {"p": "1"}}
        )
        http_mock.add("GET", r"/tables/none$", status=404)
        client = self.make()
        assert [t.name for t in client.list_tables(["a"])] == ["t1", "t2"]
        assert client.get_table(["a"], "t1").metadata_location == "s3://m"
        assert client.get_table(["a"], "none") is None
        assert client.get_table_metadata(["a"], "t1")["properties"] == {"p": "1"}

    def test_http_errors_raise(self, http_mock):
        http_mock.add("*", ".*", status=500)
        with pytest.raises(httpx.HTTPStatusError):
            self.make().list_namespaces()


@pytest.mark.unit
class TestIcebergClientManager:
    @pytest.fixture(autouse=True)
    def _reset(self):
        iceberg.IcebergClientManager._instance = None
        yield
        iceberg.IcebergClientManager._instance = None

    def test_unknown(self, monkeypatch):
        monkeypatch.setattr(
            iceberg, "get_config", lambda: SimpleNamespace(get_iceberg_connection=lambda _i: None)
        )
        with pytest.raises(ValueError):
            iceberg.get_iceberg_client("x")

    def test_builds_client_with_credentials_and_caches(self, monkeypatch):
        conn = SimpleNamespace(
            url=ICE, warehouse="wh", token=None, client_id="i", client_secret="s"
        )
        monkeypatch.setattr(
            iceberg, "get_config", lambda: SimpleNamespace(get_iceberg_connection=lambda _i: conn)
        )
        first = iceberg.get_iceberg_client("c1")
        assert first.credentials == {"client_id": "i", "client_secret": "s"}
        assert iceberg.get_iceberg_client("c1") is first
        iceberg.IcebergClientManager().remove_client("c1")
        assert iceberg.get_iceberg_client("c1") is not first


@pytest.mark.unit
class TestGeoNodeClient:
    def make(self, **kwargs):
        return geonode.GeoNodeClient(GN + "/", **kwargs)

    def test_auth_configuration(self):
        assert self.make(api_key="k").client.headers["Authorization"] == "ApiKey k"
        assert self.make(username="u", password="p").client.auth is not None
        assert self.make().client.auth is None

    def test_test_connection(self, http_mock):
        http_mock.add("GET", "/api/v2/$", json={})
        ok, msg = self.make().test_connection()
        assert ok and GN in msg
        http_mock.add("GET", "/api/v2/$", status=403)
        ok, msg = self.make().test_connection()
        assert not ok and "403" in msg
        http_mock.add("GET", "/api/v2/$", exc=httpx.ConnectError("down"))
        ok, msg = self.make().test_connection()
        assert not ok and "down" in msg

    def test_categories_and_users(self, http_mock):
        http_mock.add("GET", "/categories", json={"categories": [{"identifier": "a"}]})
        http_mock.add("GET", "/users", json={"users": [], "total": 0})
        client = self.make()
        assert client.list_categories() == [{"identifier": "a"}]
        assert client.list_users(page=2, page_size=5)["total"] == 0
        assert "page=2" in str(http_mock.calls[-1].url)

    def test_list_resources_maps_fields_and_filters(self, http_mock):
        http_mock.add(
            "GET",
            "/resources",
            json={
                "resources": [
                    {
                        "pk": 1,
                        "uuid": "u",
                        "name": "n",
                        "title": "T",
                        "category": {"identifier": "cat"},
                        "owner": {"username": "bob"},
                    },
                    {"pk": 2, "category": None, "owner": None},
                ],
                "total": 2,
                "page": 1,
                "page_size": 20,
            },
        )
        result = self.make().list_resources("dataset", category="cat", owner="bob")
        assert result["total"] == 2
        first, second = result["dataset"]
        assert first["category"] == "cat" and first["owner"] == "bob"
        assert second["category"] == "" and second["owner"] == ""
        url = str(http_mock.calls[0].url)
        assert "category__identifier" in url and "owner__username" in url

    def test_upload_dataset_zip(self, http_mock):
        http_mock.add("POST", "/uploads/upload", json={"success": True})
        result = self.make().upload_dataset(b"zip", "a.zip", title="T", abstract="A")
        assert result == {"success": True}
        body = http_mock.calls[0].content
        assert b"zip_file" in body and b"store_spatial_files" in body and b"dataset_title" in body

    def test_upload_dataset_other_extension(self, http_mock):
        http_mock.add("POST", "/uploads/upload", json={})
        self.make().upload_dataset(b"x", "a.unknown")
        assert b"application/octet-stream" in http_mock.calls[0].content

    def test_upload_document(self, http_mock):
        http_mock.add("POST", "/documents/", json={"ok": 1})
        assert self.make().upload_document(b"pdf", "a.pdf", title="T", abstract="A") == {"ok": 1}
        assert b"application/pdf" in http_mock.calls[0].content

    def test_get_resource(self, http_mock):
        http_mock.add(
            "GET",
            "/datasets/5",
            json={"dataset": {"pk": 5, "title": "T", "owner": {"username": "o"}}},
        )
        res = self.make().get_resource("datasets", 5)
        assert res.pk == 5 and res.owner == "o"

    def test_errors_raise(self, http_mock):
        http_mock.add("*", ".*", status=500)
        with pytest.raises(httpx.HTTPStatusError):
            self.make().list_categories()

    def test_get_geonode_client(self, config_manager, monkeypatch):
        config_manager.add_geonode_connection(
            GeoNodeConnection(id="g1", name="GN", url=GN, api_key="k")
        )
        assert isinstance(geonode.get_geonode_client("g1", "test-user"), geonode.GeoNodeClient)
        with pytest.raises(ValueError):
            geonode.get_geonode_client("nope", "test-user")
