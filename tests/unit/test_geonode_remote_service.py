"""Unit tests for the GeoNode admin-scraping remote service client."""

import pytest

from apps.core.models import GeoNodeConnection
from apps.geonode import remote_service as rs

GN = "https://gn.test"

LOGIN_PAGE = '<form><input name="csrfmiddlewaretoken" value="tok123"></form>'

SERVICES_TABLE = """
<table id="result_list"><tbody>
<tr><td></td><th>7</th><td>Svc A</td><td>http://a.test</td><td>WMS</td><td>I</td></tr>
<tr><td></td><th>bad</th><td>Svc B</td><td>http://b.test</td><td>WMS</td><td>I</td></tr>
<tr><td>short</td></tr>
</tbody></table>
"""

HARVEST_TABLE = """
<table>
<tr><td><input name="resource_list" value="11"></td><td>n1</td><td>t1</td><td>a1</td><td>ty1</td></tr>
<tr><td><input name="resource_list" value="12"></td></tr>
</table>
"""


@pytest.fixture
def service() -> rs.GeoNodeRemoteService:
    conn = GeoNodeConnection(id="g1", name="GN", url=GN + "/", username="admin", password="pw")
    return rs.GeoNodeRemoteService(conn)


def _mock_login(http_mock, *, session_cookie=True):
    http_mock.add("GET", r"/admin/login/", text=LOGIN_PAGE)
    headers = {"set-cookie": "sessionid=abc; Path=/"} if session_cookie else {}
    http_mock.add("POST", r"/admin/login/", text="ok", headers=headers)


@pytest.mark.unit
class TestLogin:
    def test_login_success_extracts_csrf_from_form(self, service, http_mock):
        _mock_login(http_mock)
        service.login()
        assert service._logged_in is True
        assert b"tok123" in http_mock.requests("POST")[0].content

    def test_login_failure_without_session(self, service, http_mock):
        _mock_login(http_mock, session_cookie=False)
        with pytest.raises(PermissionError):
            service.login()

    def test_context_manager_logs_in_and_closes(self, http_mock):
        _mock_login(http_mock)
        conn = GeoNodeConnection(id="g1", name="GN", url=GN, username="a", password="b")
        with rs.GeoNodeRemoteService(conn) as svc:
            assert svc._logged_in

    def test_ensure_logged_in_only_once(self, service, http_mock):
        _mock_login(http_mock)
        service._ensure_logged_in()
        service._ensure_logged_in()
        assert len(http_mock.requests("POST")) == 1


@pytest.mark.unit
class TestServices:
    @pytest.fixture(autouse=True)
    def _login(self, service, http_mock):
        _mock_login(http_mock)
        service.login()

    def test_list_services_skips_malformed_rows(self, service, http_mock):
        http_mock.add("GET", r"/admin/services/service/$", text=SERVICES_TABLE)
        services = service.list_services()
        assert [s.id for s in services] == [7]
        assert services[0].to_dict()["baseUrl"] == "http://a.test"

    def test_create_service(self, service, http_mock):
        http_mock.add("GET", r"/services/register/", text=LOGIN_PAGE)
        http_mock.add("POST", r"/services/register/", text="<html>ok</html>")
        service.create_service("http://wms.test", "WFS")
        body = http_mock.requests("POST")[-1].content
        assert b"http%3A%2F%2Fwms.test" in body and b"WFS" in body

    def test_create_service_connect_error(self, service, http_mock):
        http_mock.add("GET", r"/services/register/", text=LOGIN_PAGE)
        http_mock.add("POST", r"/services/register/", text="Could not connect to it")
        with pytest.raises(ValueError, match="Could not connect"):
            service.create_service("http://x")

    def test_create_service_form_errors(self, service, http_mock):
        page = """<p class="errornote">bad</p>
        <div class="grp-errors"><div class="c-1">URL</div>
        <ul class="errorlist"><li>Invalid</li></ul></div>"""
        http_mock.add("GET", r"/services/register/", text=LOGIN_PAGE)
        http_mock.add("POST", r"/services/register/", text=page)
        with pytest.raises(ValueError, match="URL: Invalid"):
            service.create_service("http://x")

    def test_delete_service(self, service, http_mock):
        http_mock.add("GET", r"/7/delete/", text=LOGIN_PAGE)
        http_mock.add("POST", r"/7/delete/", text="ok")
        service.delete_service(7)
        assert b"post=yes" in http_mock.requests("POST")[-1].content

    def test_rescan(self, service, http_mock):
        http_mock.add("GET", r"/services/7/rescan", text="ok")
        service.rescan_service(7)

    def test_list_harvest_resources_from_table(self, service, http_mock):
        http_mock.add("GET", r"/services/7/rescan", text="ok")
        http_mock.add("GET", r"/services/7/harvest", text=HARVEST_TABLE)
        resources = service.list_harvest_resources(7)
        assert resources[0] == {
            "id": "11",
            "name": "n1",
            "title": "t1",
            "abstract": "a1",
            "type": "ty1",
        }
        assert resources[1]["name"] == ""

    def test_list_harvest_resources_from_js(self, service, http_mock):
        js = "<script>resources.push({'id': '5', 'name': 'x'});resources.push({bad});</script>"
        http_mock.add("GET", r"/services/7/rescan", text="ok")
        http_mock.add("GET", r"/services/7/harvest", text=js)
        assert service.list_harvest_resources(7) == [{"id": "5", "name": "x"}]

    def test_import_resources_all_and_selected(self, service, http_mock):
        http_mock.add("GET", r"/services/7/harvest", text=HARVEST_TABLE)
        http_mock.add("POST", r"/services/7/harvest", text="ok")
        available = service.import_resources(7)
        assert [a["id"] for a in available] == ["11", "12"]
        body = http_mock.requests("POST")[-1].content
        assert b"resource_list=11" in body and b"resource_list=12" in body
        service.import_resources(7, resource_ids=[12])
        assert b"resource_list=11" not in http_mock.requests("POST")[-1].content


@pytest.mark.unit
class TestParsingHelpers:
    def test_form_errors_fallback_messages(self):
        page = b'<p class="errornote">x</p><ul class="errorlist"><li>Loose</li></ul>'
        with pytest.raises(ValueError, match="Loose"):
            rs._raise_if_form_errors(page)
        with pytest.raises(ValueError, match="no details"):
            rs._raise_if_form_errors(b'<p class="errornote">x</p>')

    def test_no_errors_is_noop(self):
        rs._raise_if_form_errors(b"<html><body>fine</body></html>")


@pytest.mark.unit
class TestFactory:
    def test_get_remote_service(self, config_manager):
        config_manager.add_geonode_connection(
            GeoNodeConnection(id="g1", name="GN", url=GN, username="a", password="b")
        )
        service = rs.get_remote_service("g1", config_manager._user)
        assert isinstance(service, rs.GeoNodeRemoteService)
        with pytest.raises(ValueError):
            rs.get_remote_service("missing", config_manager._user)
