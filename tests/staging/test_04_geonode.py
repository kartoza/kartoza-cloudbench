"""Staging: GeoNode, on the instance bought on GeoHosting.

Uploads a dataset and a document through the row's Import Data dialog, then
waits for GeoNode to list them (its import runs on after the upload).
"""

import time

import pytest

pytestmark = pytest.mark.timeout(900)


@pytest.fixture(scope="module")
def geonode(staging):
    bought = [c for c in staging["geonodes"] if str(c["id"]).startswith("geohosting_")]
    if not bought:
        pytest.skip("no GeoNode bought on GeoHosting")
    return bought[0]


def listed(api, geonode, resource_type):
    body = api.get(f"/geonode/connections/{geonode['id']}/{resource_type}?page_size=100")
    return {r["pk"]: r for r in body.get(resource_type, [])}


def wait_new(api, geonode, resource_type, before, stem, timeout=300):
    """The resource GeoNode lists once its import is done (named after ``stem``)."""
    deadline = time.monotonic() + timeout
    while True:
        new = [
            r
            for pk, r in listed(api, geonode, resource_type).items()
            if pk not in before and stem in (r.get("title") or "") + (r.get("name") or "")
        ]
        if new:
            return new[0]
        if time.monotonic() > deadline:
            raise AssertionError(f"GeoNode never listed a new {resource_type[:-1]} for {stem}")
        time.sleep(10)


@pytest.mark.parametrize(
    "relative, kind, resource_type",
    [
        # GeoJSON: its layer is named after the file, so the dataset carries the
        # run's prefix even if GeoNode names it after the layer.
        ("vector/bali_districts.geojson", "Dataset", "datasets"),
        ("documents/bali_report.pdf", "Document", "documents"),
    ],
)
def test_upload(app, api, geonode, data_file, relative, kind, resource_type):
    """The upload completes and GeoNode then lists the resource."""
    path = data_file(relative)
    title = f"{path.stem} title"
    before = listed(api, geonode, resource_type)

    def flow():
        app.row_action(geonode["name"], "Import Data").click()
        app.dialog.wait_for()
        app.dialog.get_by_role("button", name=kind, exact=True).click()
        app.dialog.locator("input[type=file]").set_input_files(str(path))
        title_field = app.dialog.get_by_label("Title (optional)")
        if title_field.count():
            title_field.fill(title)
        app.shot("filled")
        app.dialog.get_by_role("button", name="Upload", exact=True).click()
        app.wait_text(r"Upload complete|rror|ailed", timeout=600000, scope=app.dialog)
        app.shot("result")
        assert app.dialog.get_by_text("Upload complete").count(), app.dialog.inner_text()[:1000]

    app.network_retry(flow)

    resource = wait_new(api, geonode, resource_type, before, path.stem)
    assert resource.get("title") == title, (
        f"GeoNode titled the {kind.lower()} {resource.get('title')!r}, "
        f"not the title entered in the dialog ({title!r})"
    )
