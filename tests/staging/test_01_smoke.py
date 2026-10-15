"""Staging: the app loads, shows what's there, and offers to buy on GeoHosting.

Read only: nothing is created.
"""

import pytest

pytestmark = pytest.mark.timeout(300)


def test_tree_lists_every_connection(app, staging):
    """Every connection the API knows about is in the tree."""
    names = (
        [c["name"] for c in staging["geoservers"]]
        + [c["name"] for c in staging["geonodes"]]
        + [s["name"] for s in staging["pg_services"]]
        + [c["name"] for c in staging["s3"]]
    )
    assert names, "staging has no connections at all"
    for name in names:
        app.tree_node(name)
    app.shot("tree")


def test_geohosting_instances_are_connected(staging):
    """Instances bought on GeoHosting were added as ``geohosting_<id>``."""
    bought = [
        c["id"]
        for c in staging["geoservers"] + staging["geonodes"]
        if str(c["id"]).startswith("geohosting_")
    ]
    assert bought, "no GeoServer/GeoNode bought on GeoHosting is in CloudBench"


@pytest.mark.parametrize(
    "group, config_key, buy_page",
    [
        ("PostgreSQL", "createPostgisUrl", "#/app/PostGIS"),
        ("GeoServer", "createGeoServerUrl", "#/app/GeoServer"),
        ("GeoNode", "createGeoNodeUrl", "#/app/GeoNode"),
        ("S3 Storage", None, None),
    ],
)
def test_add_dialog_offers_buy_on_geohosting(app, staging, group, config_key, buy_page):
    """The "Add" dialog offers "Buy in GeoHosting", pointing at the right product."""
    if config_key:
        assert staging["frontend_config"][config_key].endswith(buy_page)

    app.tree_node(group).hover()
    row = app.tree_node(group).locator("xpath=ancestor::*[.//button[@aria-label='Add']][1]")
    row.get_by_role("button", name="Add", exact=True).first.click()
    app.dialog.wait_for()
    app.shot(f"add_{group}")
    buy = app.dialog.get_by_role("button", name="Buy in GeoHosting")
    if config_key:
        assert buy.is_visible()
    else:
        assert buy.count() == 0, "S3 can't be bought on GeoHosting"
    app.page.keyboard.press("Escape")


def test_on_demand_server_types(staging):
    """On demand: GeoHosting lists server types, priced, at least one in stock."""
    cng = staging["cloudnativegis"]
    assert cng.get("available"), "CloudNativeGIS reported unavailable"
    if not cng.get("onDemand"):
        pytest.skip("staging runs CloudNativeGIS in non-demand mode")
    servers = cng["servers"]
    assert servers, "no server types enabled on GeoHosting"
    for server in servers:
        assert float(server["price"]) > 0 and server["currency"]
    assert any(s["available"] for s in servers), "every server type is out of stock"


def test_jobs_and_map_explorer_open(app):
    """The Jobs popover and the Map Explorer open."""
    app.page.get_by_role("button", name="Jobs", exact=True).click()
    app.wait_text(r"Conversions")
    app.shot("jobs")
    app.page.keyboard.press("Escape")

    app.page.get_by_role("button", name="Map Explorer", exact=True).click()
    app.wait_text(r"Data Explorer")
    app.shot("map_explorer")
