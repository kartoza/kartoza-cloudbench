"""Unit tests for the GeoServer REST client (HTTP mocked at the transport)."""

import json

import httpx
import pytest

from apps.core.config import Connection
from apps.core.exceptions import GeoServerError
from apps.geoserver.client import (
    GeoServerClient,
    GeoServerClientManager,
    get_geoserver_client,
)

BASE = "http://gs.test/geoserver"


@pytest.fixture
def client() -> GeoServerClient:
    conn = Connection(id="c1", name="GS", url=BASE, username="admin", password="pw")
    return GeoServerClient(conn)


LIST_CASES = [
    ("list_workspaces", (), "/rest/workspaces.json", "workspaces", "workspace"),
    ("list_workspaces", (), "/rest/workspaces.json", "workspaces", "workspace"),
    ("list_datastores", ("ws",), "/workspaces/ws/datastores.json", "dataStores", "dataStore"),
    (
        "list_coveragestores",
        ("ws",),
        "/workspaces/ws/coveragestores.json",
        "coverageStores",
        "coverageStore",
    ),
    (
        "list_featuretypes",
        ("ws", "ds"),
        "/workspaces/ws/datastores/ds/featuretypes.json",
        "featureTypes",
        "featureType",
    ),
    (
        "list_coverages",
        ("ws", "cs"),
        "/workspaces/ws/coveragestores/cs/coverages.json",
        "coverages",
        "coverage",
    ),
    ("list_layers", (), "/rest/layers.json", "layers", "layer"),
    ("list_layers", ("ws",), "/workspaces/ws/layers.json", "layers", "layer"),
    ("list_styles", (), "/rest/styles.json", "styles", "style"),
    ("list_styles", ("ws",), "/workspaces/ws/styles.json", "styles", "style"),
    ("list_layergroups", (), "/rest/layergroups.json", "layerGroups", "layerGroup"),
    ("list_layergroups", ("ws",), "/workspaces/ws/layergroups.json", "layerGroups", "layerGroup"),
]


@pytest.mark.unit
class TestListMethods:
    @pytest.mark.parametrize(("method", "args", "path", "outer", "inner"), LIST_CASES)
    def test_list_returns_items(self, client, http_mock, method, args, path, outer, inner):
        http_mock.add(
            "GET", path.replace(".json", r"\.json"), json={outer: {inner: [{"name": "a"}]}}
        )
        assert getattr(client, method)(*args) == [{"name": "a"}]

    @pytest.mark.parametrize(("method", "args", "path", "outer", "inner"), LIST_CASES)
    def test_list_empty_string_returns_empty(
        self, client, http_mock, method, args, path, outer, inner
    ):
        # GeoServer returns "" instead of an object when there are no items
        http_mock.add("GET", path.replace(".json", r"\.json"), json={outer: ""})
        assert getattr(client, method)(*args) == []


GET_CASES = [
    ("get_workspace", ("ws",), "/workspaces/ws.json", "workspace"),
    ("get_datastore", ("ws", "ds"), "/workspaces/ws/datastores/ds.json", "dataStore"),
    ("get_coveragestore", ("ws", "cs"), "/workspaces/ws/coveragestores/cs.json", "coverageStore"),
    (
        "get_featuretype",
        ("ws", "ds", "ft"),
        "/workspaces/ws/datastores/ds/featuretypes/ft.json",
        "featureType",
    ),
    (
        "get_coverage",
        ("ws", "cs", "cv"),
        "/workspaces/ws/coveragestores/cs/coverages/cv.json",
        "coverage",
    ),
    ("get_layer", ("ws", "ly"), "/workspaces/ws/layers/ly.json", "layer"),
    ("get_style", ("st",), "/rest/styles/st.json", "style"),
    ("get_style", ("st", "ws"), "/workspaces/ws/styles/st.json", "style"),
    ("get_layergroup", ("lg",), "/rest/layergroups/lg.json", "layerGroup"),
    ("get_layergroup", ("lg", "ws"), "/workspaces/ws/layergroups/lg.json", "layerGroup"),
]


@pytest.mark.unit
class TestGetMethods:
    @pytest.mark.parametrize(("method", "args", "path", "key"), GET_CASES)
    def test_get_returns_payload(self, client, http_mock, method, args, path, key):
        http_mock.add("GET", path.replace(".json", r"\.json"), json={key: {"name": "x"}})
        assert getattr(client, method)(*args) == {"name": "x"}

    def test_404_raises_not_found(self, client, http_mock):
        http_mock.add("GET", "workspaces/ws", status=404)
        with pytest.raises(GeoServerError) as exc:
            client.get_workspace("ws")
        assert exc.value.status_code == 404

    def test_server_error_raises(self, client, http_mock):
        http_mock.add("GET", "workspaces", status=500, text="boom")
        with pytest.raises(GeoServerError) as exc:
            client.list_workspaces()
        assert exc.value.status_code == 500
        assert "boom" in exc.value.message

    def test_transport_error_wrapped(self, client, http_mock):
        http_mock.add("GET", ".*", exc=httpx.ConnectError("down"))
        with pytest.raises(GeoServerError, match="HTTP error"):
            client.list_workspaces()


@pytest.mark.unit
class TestWorkspaceWrites:
    def test_create_workspace(self, client, http_mock):
        http_mock.add("POST", "workspaces", status=201)
        client.create_workspace("my-ws", isolated=True, default=True)
        request = http_mock.requests("POST")[0]
        assert b'"isolated":true' in request.content.replace(b" ", b"")
        assert "default=true" in str(request.url)

    def test_create_workspace_rejects_bad_name(self, client):
        with pytest.raises(GeoServerError) as exc:
            client.create_workspace("bad name!")
        assert exc.value.status_code == 400

    def test_update_workspace(self, client, http_mock):
        http_mock.add("PUT", "workspaces/ws", status=200)
        client.update_workspace("ws", new_name="ws2", isolated=False)
        body = http_mock.requests("PUT")[0].content
        assert b"ws2" in body and b"false" in body

    def test_delete_workspace_recurse(self, client, http_mock):
        http_mock.add("DELETE", "workspaces/ws", status=200)
        client.delete_workspace("ws", recurse=True)
        assert "recurse=true" in str(http_mock.requests("DELETE")[0].url)


WRITE_CASES = [
    ("create_workspace", ("ws",), "POST"),
    ("update_workspace", ("ws", "n"), "PUT"),
    ("delete_workspace", ("ws",), "DELETE"),
    ("create_datastore", ("ws", "ds", {"dbtype": "postgis"}), "POST"),
    ("delete_datastore", ("ws", "ds"), "DELETE"),
    ("create_coveragestore", ("ws", "cs"), "POST"),
    ("delete_coveragestore", ("ws", "cs"), "DELETE"),
    ("create_featuretype", ("ws", "ds", "ft"), "POST"),
    ("delete_featuretype", ("ws", "ds", "ft"), "DELETE"),
    ("update_layer", ("ws", "ly"), "PUT"),
    ("delete_layer", ("ws", "ly"), "DELETE"),
    ("create_style", ("st", "<sld/>"), "POST"),
    ("update_style_content", ("st", "<sld/>"), "PUT"),
    ("delete_style", ("st",), "DELETE"),
    ("update_layer_styles", ("ws", "ly", "st"), "PUT"),
    ("upload_shapefile", ("ws", "ds", b"zip"), "PUT"),
    ("upload_geotiff", ("ws", "cs", b"tiff"), "PUT"),
    ("upload_geopackage", ("ws", "ds", b"gpkg"), "PUT"),
]


@pytest.mark.unit
class TestWriteErrors:
    @pytest.mark.parametrize(("method", "args", "verb"), WRITE_CASES)
    def test_error_status_raises(self, client, http_mock, method, args, verb):
        http_mock.add(verb, ".*", status=403, text="forbidden")
        with pytest.raises(GeoServerError) as exc:
            getattr(client, method)(*args)
        assert exc.value.status_code == 403

    @pytest.mark.parametrize(("method", "args", "verb"), WRITE_CASES)
    def test_success_does_not_raise(self, client, http_mock, method, args, verb):
        http_mock.add("*", ".*", status=201)
        getattr(client, method)(*args)


@pytest.mark.unit
class TestStoresAndLayers:
    def test_create_datastore_payload(self, client, http_mock):
        http_mock.add("POST", "datastores", status=201)
        client.create_datastore("ws", "ds", {"host": "db", "port": "5432"}, description="d")
        body = http_mock.requests("POST")[0].content
        assert b"connectionParameters" in body and b'"@key"' in body

    def test_create_coveragestore_with_url(self, client, http_mock):
        http_mock.add("POST", "coveragestores", status=201)
        client.create_coveragestore("ws", "cs", url="file:///data/a.tif", description="d")
        body = http_mock.requests("POST")[0].content
        assert b"file:///data/a.tif" in body and b'"description"' in body

    def test_create_featuretype_defaults(self, client, http_mock):
        http_mock.add("POST", "featuretypes", status=201)
        client.create_featuretype("ws", "ds", "ft", title="Title", srs="EPSG:3857")
        body = http_mock.requests("POST")[0].content
        assert b"nativeName" in body and b"EPSG:3857" in body

    def test_update_layer_all_fields(self, client, http_mock):
        http_mock.add("PUT", "layers/ly", status=200)
        client.update_layer(
            "ws", "ly", enabled=True, advertised=False, queryable=True, default_style="st"
        )
        body = http_mock.requests("PUT")[0].content
        for token in (b"enabled", b"advertised", b"queryable", b"defaultStyle"):
            assert token in body

    def test_feature_count_parses_xml(self, client, http_mock):
        http_mock.add("GET", "wfs", text='<FeatureCollection numberMatched="42"/>')
        assert client.get_layer_feature_count("ws", "ly") == 42

    @pytest.mark.parametrize("text", ["<not-xml", '<a numberMatched="x"/>', "<a/>"])
    def test_feature_count_bad_response_is_zero(self, client, http_mock, text):
        http_mock.add("GET", "wfs", text=text)
        assert client.get_layer_feature_count("ws", "ly") == 0

    def test_feature_count_http_error_is_zero(self, client, http_mock):
        http_mock.add("GET", "wfs", status=500)
        assert client.get_layer_feature_count("ws", "ly") == 0


@pytest.mark.unit
class TestStyles:
    @pytest.mark.parametrize(
        ("fmt", "ext"), [("sld", "sld"), ("css", "css"), ("mbstyle", "json"), ("other", "sld")]
    )
    def test_get_style_content_uses_format_extension(self, client, http_mock, fmt, ext):
        meta = json.dumps({"style": {"format": fmt}})
        http_mock.add("GET", r"styles/st\.json", text=meta)
        if ext != "json":  # the mbstyle content URL is the same as the metadata URL
            http_mock.add("GET", rf"styles/st\.{ext}$", text="CONTENT")
        content = "CONTENT" if ext != "json" else meta
        assert client.get_style_content("st") == (content, fmt)

    def test_get_style_content_workspace_scoped(self, client, http_mock):
        http_mock.add("GET", r"workspaces/ws/styles/st\.json", json={"style": {}})
        http_mock.add("GET", r"workspaces/ws/styles/st\.sld", text="X")
        assert client.get_style_content("st", "ws") == ("X", "sld")

    def test_get_style_content_error(self, client, http_mock):
        http_mock.add("GET", r"styles/st\.json", json={"style": {}})
        http_mock.add("GET", r"styles/st\.sld", status=500, text="bad")
        with pytest.raises(GeoServerError):
            client.get_style_content("st")

    def test_create_style_workspace_scoped_uploads_content(self, client, http_mock):
        http_mock.add("*", ".*", status=201)
        client.create_style("st", "body", style_format="css", workspace="ws")
        methods = [(r.method, r.url.path) for r in http_mock.calls]
        assert methods[0] == ("POST", "/geoserver/rest/workspaces/ws/styles.json")
        assert methods[1] == ("PUT", "/geoserver/rest/workspaces/ws/styles/st.css")
        assert http_mock.calls[1].headers["content-type"] == "application/vnd.geoserver.geocss+css"

    def test_delete_style_workspace_purge(self, client, http_mock):
        http_mock.add("DELETE", ".*", status=200)
        client.delete_style("st", workspace="ws", purge=True)
        url = str(http_mock.calls[0].url)
        assert "workspaces/ws/styles/st" in url and "purge=true" in url


@pytest.mark.unit
class TestLayerStyles:
    def test_get_layer_styles(self, client, http_mock):
        http_mock.add(
            "GET",
            r"layers/ly\.json",
            json={
                "layer": {
                    "defaultStyle": {"name": "def"},
                    "styles": {"style": [{"name": "a"}, "b", None]},
                }
            },
        )
        assert client.get_layer_styles("ws", "ly") == {
            "defaultStyle": "def",
            "additionalStyles": ["a", "b"],
        }

    def test_get_layer_styles_missing(self, client, http_mock):
        http_mock.add("GET", r"layers/ly\.json", json={"layer": {"defaultStyle": "x"}})
        assert client.get_layer_styles("ws", "ly") == {
            "defaultStyle": "",
            "additionalStyles": [],
        }

    def test_update_layer_styles_with_additional(self, client, http_mock):
        http_mock.add("PUT", "layers/ly", status=200)
        client.update_layer_styles("ws", "ly", "def", ["a", "b"])
        assert b'"styles"' in http_mock.calls[0].content


@pytest.mark.unit
class TestLayerMetadata:
    def test_featuretype_bbox(self, client, http_mock):
        http_mock.add(
            "GET",
            r"layers/ly\.json",
            json={
                "layer": {
                    "name": "ly",
                    "type": "VECTOR",
                    "resource": {
                        "@class": "featureType",
                        "href": f"{BASE}/rest/workspaces/ws/datastores/ds/featuretypes/ly.json",
                    },
                }
            },
        )
        http_mock.add(
            "GET",
            r"featuretypes/ly\.json",
            json={"featureType": {"nativeBoundingBox": {"minx": 1}}},
        )
        meta = client.get_layer_metadata("ws", "ly")
        assert meta["bbox"] == {"minx": 1}
        assert meta["name"] == "ly"

    def test_coverage_bbox_falls_back_to_latlon(self, client, http_mock):
        http_mock.add(
            "GET",
            r"layers/ly\.json",
            json={"layer": {"resource": {"@class": "coverage", "href": f"{BASE}/cov.json"}}},
        )
        http_mock.add("GET", r"cov\.json", json={"coverage": {"latLonBoundingBox": {"minx": 2}}})
        assert client.get_layer_metadata("ws", "ly")["bbox"] == {"minx": 2}

    @pytest.mark.parametrize("klass", ["featureType", "coverage"])
    def test_resource_fetch_failure_is_swallowed(self, client, http_mock, klass):
        http_mock.add(
            "GET",
            r"layers/ly\.json",
            json={"layer": {"resource": {"@class": klass, "href": f"{BASE}/res.json"}}},
        )
        http_mock.add("GET", r"res\.json", exc=httpx.ConnectError("x"))
        assert client.get_layer_metadata("ws", "ly")["bbox"] is None

    def test_no_resource(self, client, http_mock):
        http_mock.add("GET", r"layers/ly\.json", json={"layer": {"name": "ly"}})
        assert client.get_layer_metadata("ws", "ly")["bbox"] is None


@pytest.mark.unit
class TestAvailableFeatureTypes:
    def test_list(self, client, http_mock):
        http_mock.add("GET", "featuretypes", json={"list": {"string": ["a", "b"]}})
        assert client.list_available_featuretypes("ws", "ds") == ["a", "b"]

    def test_single_string(self, client, http_mock):
        http_mock.add("GET", "featuretypes", json={"list": {"string": "a"}})
        assert client.list_available_featuretypes("ws", "ds") == ["a"]

    def test_error_returns_empty(self, client, http_mock):
        http_mock.add("GET", "featuretypes", status=500)
        assert client.list_available_featuretypes("ws", "ds") == []


@pytest.mark.unit
class TestClientManager:
    def test_get_client_for_known_connection(self, config_manager, monkeypatch):
        config_manager.add_connection(
            Connection(id="c1", name="GS", url=BASE, username="a", password="b")
        )
        client = GeoServerClientManager("test-user").get_client("c1")
        assert isinstance(client, GeoServerClient)
        assert isinstance(get_geoserver_client("c1", "test-user"), GeoServerClient)

    def test_unknown_connection_raises(self, config_manager):
        with pytest.raises(ValueError, match="not found"):
            GeoServerClientManager("test-user").get_client("nope")
