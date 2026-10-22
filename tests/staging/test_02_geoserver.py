"""Staging: GeoServer, on the instance bought on GeoHosting.

Creates the ``cbtest`` workspace (once), then uploads a shapefile and a
GeoTIFF into it through the upload dialog, as new stores.
"""

import pytest

pytestmark = pytest.mark.timeout(900)

WORKSPACE = "cbtest"


@pytest.fixture(scope="module")
def geoserver(staging):
    bought = [c for c in staging["geoservers"] if str(c["id"]).startswith("geohosting_")]
    if not bought:
        pytest.skip("no GeoServer bought on GeoHosting")
    return bought[0]


def workspaces(api, geoserver):
    return [w["name"] for w in api.get(f"/workspaces/{geoserver['id']}")]


def test_create_workspace(app, api, geoserver):
    """The connection panel's "Create New Workspace" makes the workspace."""
    if WORKSPACE in workspaces(api, geoserver):
        pytest.skip(f"workspace {WORKSPACE!r} already there")
    app.tree_node(geoserver["name"]).click()
    app.page.get_by_role("button", name="Create New Workspace").click()
    app.dialog.get_by_placeholder("my_workspace").fill(WORKSPACE)
    app.shot("workspace_dialog")
    app.dialog.get_by_role("button", name="Create Workspace").click()
    app.dialog.wait_for(state="hidden", timeout=60000)
    assert WORKSPACE in workspaces(api, geoserver)


@pytest.mark.parametrize(
    "relative, kind",
    [
        ("vector/bali_districts_shp.zip", "datastores"),
        ("raster/bali_dem.tif", "coveragestores"),
    ],
)
def test_upload(app, api, geoserver, data_file, relative, kind):
    """Tools → Upload Data on the workspace creates a store with its layer."""
    if WORKSPACE not in workspaces(api, geoserver):
        pytest.skip(f"no {WORKSPACE!r} workspace (test_create_workspace failed?)")
    path = data_file(relative)
    store = path.stem.replace(".", "_")

    def flow():
        app.tree_node(geoserver["name"]).click()
        app.tree_node(WORKSPACE).click()
        app.tools_upload()
        app.dialog.locator("input[type=file]").set_input_files(str(path))
        store_field = app.dialog.get_by_placeholder("e.g. my_store")
        store_field.fill(store)
        app.shot("filled")
        app.dialog.get_by_role("button", name="Upload", exact=True).click()
        # main uploads first, then asks to "Send to GeoServer"; the upload
        # passthrough branch sends it straight on.
        send = app.dialog.get_by_role("button", name="Send to GeoServer")
        app.wait_text(
            r"Upload Result|Send to GeoServer|rror|ailed", timeout=600000, scope=app.dialog
        )
        if send.count() and send.is_enabled():
            send.click()
            app.wait_text(r"Upload Result|rror|ailed", timeout=600000, scope=app.dialog)
        app.shot("result")
        assert app.dialog.get_by_text("Upload Result").count(), app.dialog.inner_text()[:1000]

    app.network_retry(flow)

    stores = [s["name"] for s in api.get(f"/{kind}/{geoserver['id']}/{WORKSPACE}")]
    assert store in stores
    layers = [layer["name"] for layer in api.get(f"/layers/{geoserver['id']}/{WORKSPACE}")]
    assert layers, "store created but no layer published"
