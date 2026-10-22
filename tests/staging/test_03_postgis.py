"""Staging: PostGIS, on the instance bought on GeoHosting.

Imports files into ``public`` through Import Data (upload → detect layers →
import), as new tables named after the run.
"""

import pytest

pytestmark = pytest.mark.timeout(900)

SCHEMA = "public"


@pytest.fixture(scope="module")
def service(staging):
    # GeoHosting names a PostGIS service after its instance, which is also its
    # host name (zakki-postgis-003 at zakki-postgis-003.sta.geospatialhosting.com).
    bought = [s for s in staging["pg_services"] if s["host"].split(".")[0] == s["name"]]
    if not bought:
        pytest.skip("no PostGIS bought on GeoHosting")
    return bought[0]


def tables(api, service):
    body = api.get(f"/pg/services/{service['name']}/schemas/{SCHEMA}/tables")
    return {t["name"]: t for t in body["tables"]}


@pytest.mark.parametrize(
    "relative, rows",
    [
        ("vector/bali_districts.geojson", 9),
        ("vector/bali_cities_wkt.csv", 10),
    ],
)
def test_import_vector(app, api, service, data_file, relative, rows):
    """A vector file becomes a table with every row."""
    path = data_file(relative)
    table = path.stem.lower()

    def flow():
        app.tree_node(service["name"]).click()
        app.tools_upload()
        app.dialog.locator("input[type=file]").set_input_files(str(path))
        app.dialog.get_by_role("button", name="Upload", exact=True).click()
        import_button = app.dialog.get_by_role("button", name="Import to PostgreSQL")
        import_button.wait_for(timeout=300000)
        app.shot("layers_detected")
        import_button.click()
        app.wait_text(r"Import Results", timeout=600000, scope=app.dialog)
        app.shot("imported")
        assert "failed" not in app.dialog.inner_text().lower(), app.dialog.inner_text()[:1000]

    app.network_retry(flow)

    found = tables(api, service)
    assert table in found, f"{table} not in {SCHEMA}: {sorted(found)[:20]}"
    data = api.get(f"/pg/services/{service['name']}/schemas/{SCHEMA}/tables/{table}/data?limit=1")
    assert data["total"] == rows
