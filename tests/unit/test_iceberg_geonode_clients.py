"""Unit tests for the Iceberg REST catalog and GeoNode API clients."""

from types import SimpleNamespace

import httpx
import pytest

from apps.core.models import GeoNodeConnection
from apps.geonode import client as geonode
from apps.iceberg import client as iceberg

# Managers only read .pk (cache key) and pass the user on to get_config.
USER = SimpleNamespace(pk=1, username="u")
OTHER_USER = SimpleNamespace(pk=2, username="v")
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
            iceberg,
            "get_config",
            lambda _user: SimpleNamespace(get_iceberg_connection=lambda _i: None),
        )
        with pytest.raises(ValueError):
            iceberg.get_iceberg_client("x", USER)

    def test_builds_client_with_credentials_and_caches(self, monkeypatch):
        conn = SimpleNamespace(
            url=ICE, warehouse="wh", token=None, client_id="i", client_secret="s"
        )
        monkeypatch.setattr(
            iceberg,
            "get_config",
            lambda _user: SimpleNamespace(get_iceberg_connection=lambda _i: conn),
        )
        first = iceberg.get_iceberg_client("c1", USER)
        assert first.credentials == {"client_id": "i", "client_secret": "s"}
        assert iceberg.get_iceberg_client("c1", USER) is first
        assert iceberg.get_iceberg_client("c1", OTHER_USER) is not first  # cached per user
        iceberg.IcebergClientManager().remove_client("c1", USER)
        assert iceberg.get_iceberg_client("c1", USER) is not first


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
        result = self.make().upload_dataset([b"z", b"ip"], "a.zip", 3, 60, title="T", abstract="A")
        assert result == {"success": True}
        request = http_mock.calls[0]
        body = request.content
        # Sent as Content-Length (computed before the file arrives), never chunked.
        assert request.headers["Content-Length"] == str(len(body))
        assert "Transfer-Encoding" not in request.headers
        # GeoNode 4.x unzips zip_file only: the zip goes once, there, and
        # base_file (required, never read) is a 1-byte stand-in before it.
        assert (
            b'name="base_file"; filename="a.zip"\r\nContent-Type: application/zip\r\n\r\n\0\r\n'
            in body
        )
        assert body.index(b'name="base_file"') < body.index(b'name="zip_file"')
        assert b'name="zip_file"; filename="a.zip"' in body and b"\r\n\r\nzip\r\n--" in body
        assert body.count(b"zip\r\n--") == 1
        assert b"store_spatial_files" in body and b"dataset_title" in body

    def test_upload_dataset_zip_as_base_file_on_newer_geonodes(self, http_mock):
        http_mock.add("POST", "/uploads/upload", json={})
        self.make().upload_dataset([b"zip"], "a.zip", 3, 60, zip_field=geonode.BASE_FILE)
        body = http_mock.calls[0].content
        assert b'name="base_file"; filename="a.zip"' in body and b"\r\n\r\nzip\r\n--" in body
        assert b"zip_file" not in body

    @pytest.mark.parametrize(
        "answer, field",
        [
            # GeoNode 4.x looks for a handler by extension first.
            (
                {"status": 500, "json": {"errors": ["No handlers found for this dataset type"]}},
                geonode.ZIP_FILE,
            ),
            # Newer GeoNodes check a zip first.
            (
                {"status": 400, "json": {"base_file": ["Invalid or unsafe ZIP archive."]}},
                geonode.BASE_FILE,
            ),
            # Can't tell: 4.x.
            ({"status": 401, "json": {"detail": "Authentication required"}}, geonode.ZIP_FILE),
            ({"exc": httpx.ConnectError("down")}, geonode.ZIP_FILE),
        ],
    )
    def test_zip_upload_field_asks_the_geonode(self, http_mock, answer, field):
        http_mock.add("POST", "/uploads/upload", **answer)
        assert self.make().zip_upload_field() == field
        body = http_mock.calls[0].content
        # A 1-byte "zip" as base_file: refused either way, nothing created.
        assert b'name="base_file"; filename="cloudbench-probe.zip"' in body
        assert b"zip_file" not in body

    def test_upload_dataset_tif_goes_as_base_file(self, http_mock):
        http_mock.add("POST", "/uploads/upload", json={})
        self.make().upload_dataset([b"II*"], "dem.tif", 3, 60)
        body = http_mock.calls[0].content
        assert b'name="base_file"; filename="dem.tif"' in body and b"zip_file" not in body

    def test_upload_dataset_other_extension(self, http_mock):
        http_mock.add("POST", "/uploads/upload", json={})
        self.make().upload_dataset([b"x"], "a.unknown", 1, 60)
        assert b"application/octet-stream" in http_mock.calls[0].content

    def test_upload_document(self, http_mock):
        http_mock.add("POST", "/documents/", json={"ok": 1})
        result = self.make().upload_document([b"pdf"], "a.pdf", 3, 60, title="T", abstract="A")
        assert result == {"ok": 1}
        assert b'name="doc_file"; filename="a.pdf"' in http_mock.calls[0].content
        assert b"application/pdf" in http_mock.calls[0].content

    def test_upload_refused_carries_geonodes_reason(self, http_mock):
        http_mock.add(
            "POST", "/uploads/upload", status=400, json={"errors": ["Total upload size exceeds"]}
        )
        with pytest.raises(geonode.GeoNodeUploadError, match="Total upload size exceeds") as raised:
            self.make().upload_dataset([b"x"], "a.tif", 1, 60)
        assert raised.value.status_code == 400

    def test_upload_size_limit(self, http_mock):
        http_mock.add(
            "GET",
            "/upload-size-limits/",
            json={
                "upload-size-limits": [
                    {"slug": "dataset_upload_size", "max_size": 104857600},
                    {"slug": "file_upload_handler", "max_size": 1048576000},
                ]
            },
        )
        client = self.make()
        assert client.get_upload_size_limit("dataset_upload_size") == 104857600
        assert client.get_upload_size_limit("document_upload_size") is None

    def test_upload_size_limit_unknown_on_older_geonodes(self, http_mock):
        http_mock.add("GET", "/upload-size-limits/", status=404)
        assert self.make().get_upload_size_limit("dataset_upload_size") is None

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
        client = geonode.get_geonode_client("g1", config_manager._user)
        assert isinstance(client, geonode.GeoNodeClient)
        with pytest.raises(ValueError):
            geonode.get_geonode_client("nope", config_manager._user)
