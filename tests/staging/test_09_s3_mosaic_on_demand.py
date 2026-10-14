"""Staging: several GeoTIFF tiles published as one COG mosaic, on-demand.

raster/mosaic_tiles/bali_dem_01..04.tif -> one COG mosaic on an on-demand
CloudNativeGIS server (one Hetzner server, started and deleted by GeoHosting).
The upload lands under ``cbtest/`` and is left there: nothing in S3 is ever
deleted.
"""

import time

import pytest

from ._ondemand import require_on_demand

pytestmark = pytest.mark.timeout(4000)

TERMINAL = {"completed", "failed", "cancelled"}


def _jobs_by_id(api):
    body = api.get("/s3/conversion/jobs")
    jobs = body.get("jobs", []) if isinstance(body, dict) else body
    return {j.get("id"): j for j in jobs}


def _new_job(api, before):
    """The job that appeared since ``before`` (a mosaic, if several did)."""
    new = [j for jid, j in _jobs_by_id(api).items() if jid not in before]
    mosaics = [j for j in new if j.get("targetFormat") == "mosaic"]
    return (mosaics or new or [None])[0]


def test_mosaic_to_cog_on_demand(app, api, staging, settings, data_file, run_id):
    s3 = require_on_demand(staging, settings)
    tiles = [data_file(f"raster/mosaic_tiles/bali_dem_0{i}.tif") for i in (1, 2, 3, 4)]
    name = f"{run_id}_mosaic"
    page = app.page
    before = set(_jobs_by_id(api))

    def flow():
        if _new_job(api, before):
            return  # a prior attempt already started the job
        app.tree_node(s3["name"]).click()
        page.get_by_role("button", name="Upload", exact=True).first.click()
        app.dialog.wait_for()
        # Several GeoTIFFs at once -> the dialog offers a mosaic (one COG).
        app.dialog.locator("input[type=file]").set_input_files([str(t) for t in tiles])
        app.dialog.get_by_placeholder("Elevation 2024").fill(name)
        server_type = app.dialog.locator("select").filter(has_text="/h").first
        if settings.ondemand_server_id:
            server_type.select_option(settings.ondemand_server_id)
        app.shot("mosaic_filled")
        app.dialog.get_by_role("button", name="Upload", exact=True).click()
        confirm = page.get_by_role("button", name="Continue", exact=True)
        try:
            confirm.wait_for(timeout=15000)
            app.shot("mosaic_cost")
            confirm.click()
        except Exception:
            pass
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if _new_job(api, before):
                return
            text = app.dialog.inner_text() if app.dialog.count() else ""
            if "Failed to fetch" in text or "rror" in text:
                app.shot("mosaic_error")
                raise AssertionError(f"mosaic upload failed: {text[:400]}")
            page.wait_for_timeout(5000)
        app.shot("mosaic_no_job")
        raise AssertionError("no mosaic job 10 minutes after the upload started")

    app.network_retry(flow)

    statuses = []
    job = None
    deadline = time.monotonic() + settings.job_timeout
    while time.monotonic() < deadline:
        job = _new_job(api, before)
        if job and (not statuses or statuses[-1] != job["status"]):
            statuses.append(job["status"])
            app.shot(f"status_{len(statuses):02d}_{job['status']}")
        if job and job["status"] in TERMINAL:
            break
        page.wait_for_timeout(5000)
    app.shot("done")
    summary = f"statuses {statuses}, job {job}"
    assert job, f"no mosaic job ({summary})"
    assert job["status"] == "completed", summary
    assert "deprovisioning" in statuses, summary
    # The mosaic publishes a single merged COG (plus a VRT and the tiles).
    outputs = job.get("outputPaths") or []
    assert any(p.lower().endswith(".tif") for p in outputs), f"no COG output: {summary}"
