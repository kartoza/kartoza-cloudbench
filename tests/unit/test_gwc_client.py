"""Unit tests for the GeoWebCache REST client."""

import httpx
import pytest

from apps.core.config import Connection
from apps.core.exceptions import GeoServerError
from apps.gwc.client import GWCClient

BASE = "http://gs.test/geoserver"


@pytest.fixture
def gwc() -> GWCClient:
    return GWCClient(Connection(id="c1", name="GS", url=BASE, username="a", password="b"))


@pytest.mark.unit
class TestGWCReads:
    def test_list_layers(self, gwc, http_mock):
        http_mock.add("GET", r"/gwc/rest/layers\.json", json={"layers": ["a"]})
        assert gwc.list_layers() == ["a"]

    def test_get_layer_encodes_colon(self, gwc, http_mock):
        http_mock.add("GET", r"layers/ws%3Aly\.json", json={"GeoServerLayer": {"name": "ws:ly"}})
        assert gwc.get_layer("ws:ly") == {"name": "ws:ly"}

    def test_seed_status(self, gwc, http_mock):
        http_mock.add("GET", r"/seed/ws%3Aly\.json", json={"long-array-array": [[1, 2]]})
        assert gwc.get_seed_status("ws:ly") == [[1, 2]]

    def test_gridsets(self, gwc, http_mock):
        http_mock.add("GET", r"/gridsets\.json", json={"gridSets": [{"name": "g"}]})
        http_mock.add("GET", r"/gridsets/g\.json", json={"gridSet": {"name": "g"}})
        assert gwc.list_gridsets() == [{"name": "g"}]
        assert gwc.get_gridset("g") == {"name": "g"}

    def test_disk_quota_and_usage(self, gwc, http_mock):
        http_mock.add("GET", r"/diskquota\.json", json={"gwcQuotaConfiguration": {"enabled": True}})
        assert gwc.get_disk_quota() == {"enabled": True}
        assert gwc.get_disk_usage() == {"enabled": True}

    def test_disk_usage_falls_back_on_error(self, gwc, http_mock):
        http_mock.add("GET", r"/diskquota\.json", status=500)
        assert gwc.get_disk_usage() == {"enabled": False, "usage": "unknown"}

    def test_not_found_and_errors(self, gwc, http_mock):
        http_mock.add("GET", r"/layers\.json", status=404)
        with pytest.raises(GeoServerError) as exc:
            gwc.list_layers()
        assert exc.value.status_code == 404
        http_mock.add("GET", r"/layers\.json", status=500, text="x")
        with pytest.raises(GeoServerError) as exc:
            gwc.list_layers()
        assert exc.value.status_code == 500

    def test_transport_error(self, gwc, http_mock):
        http_mock.add("GET", ".*", exc=httpx.ConnectError("down"))
        with pytest.raises(GeoServerError, match="GWC HTTP error"):
            gwc.list_layers()


@pytest.mark.unit
class TestGWCWrites:
    def test_seed_layer_payload(self, gwc, http_mock):
        http_mock.add("POST", r"/seed/ws%3Aly\.json", status=200)
        result = gwc.seed_layer("ws:ly", zoom_stop=5, seed_type="reseed")
        assert result == {"status": "started", "layer": "ws:ly"}
        body = http_mock.calls[0].content
        assert b"reseed" in body and b'"zoomStop":5' in body.replace(b" ", b"")

    def test_truncate_layer_optional_fields(self, gwc, http_mock):
        http_mock.add("POST", r"/seed/", status=200)
        gwc.truncate_layer("ly", grid_set="g", zoom_start=1, zoom_stop=2, format="image/png")
        body = http_mock.calls[0].content
        for token in (b"gridSetId", b"zoomStart", b"zoomStop", b"format", b"truncate"):
            assert token in body

    def test_kill_seed_tasks(self, gwc, http_mock):
        http_mock.add("POST", r"/seed/ly", status=200)
        assert gwc.kill_seed_tasks("ly")["status"] == "killed"
        assert "kill_all=running" in str(http_mock.calls[0].url)

    def test_mass_truncate_params(self, gwc, http_mock):
        http_mock.add("POST", r"/masstruncate", status=200)
        assert gwc.mass_truncate(workspace="ws", layer="ly") == {"status": "truncated"}
        url = str(http_mock.calls[0].url)
        assert "workspace=ws" in url and "layer=ly" in url

    @pytest.mark.parametrize(
        "call",
        [
            lambda c: c.seed_layer("ly"),
            lambda c: c.truncate_layer("ly"),
            lambda c: c.kill_seed_tasks("ly"),
            lambda c: c.mass_truncate(),
        ],
    )
    def test_write_errors(self, gwc, http_mock, call):
        http_mock.add("POST", ".*", status=500, text="bad")
        with pytest.raises(GeoServerError) as exc:
            call(gwc)
        assert exc.value.status_code == 500
