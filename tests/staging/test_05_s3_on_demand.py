"""Staging: an S3 upload converted on an on-demand CloudNativeGIS server.

One GeoTIFF → COG. GeoHosting starts a Hetzner server for the job (billed per
started hour) and deletes it when the job is done. The upload lands under
``cbtest/`` in the bucket and is left there: nothing in S3 is ever deleted.
"""

import time

import pytest

pytestmark = pytest.mark.timeout(4000)

TERMINAL = {"completed", "failed", "cancelled"}


def find_job(api, source_name):
    body = api.get("/s3/conversion/jobs")
    jobs = body.get("jobs", []) if isinstance(body, dict) else body
    for job in jobs:
        if source_name in (job.get("sourcePath") or "") + (job.get("sourceStoredPath") or ""):
            return job
    return None


def test_geotiff_to_cog_on_demand(app, api, staging, settings, data_file):
    cng = staging["cloudnativegis"]
    if not cng.get("onDemand"):
        pytest.skip("staging runs CloudNativeGIS in non-demand mode")
    if not settings.ondemand_enabled or settings.ondemand_max_jobs < 1:
        pytest.skip("on-demand tests are switched off in .env.staging")
    in_stock = [s for s in cng["servers"] if s["available"]]
    if not in_stock:
        pytest.fail("every on-demand server type is out of stock")
    if not staging["s3"]:
        pytest.skip("no S3 connection")
    s3 = staging["s3"][0]

    path = data_file("raster/bali_dem.tif")
    page = app.page
    picked = None

    def start():
        """Upload with conversion; return once CloudBench has made the job."""
        nonlocal picked
        if find_job(api, path.name):
            return  # an earlier attempt got through: never start a second server
        app.tree_node(s3["name"]).click()
        page.get_by_role("button", name="Upload", exact=True).first.click()
        app.dialog.wait_for()
        app.dialog.locator("input[type=file]").set_input_files(str(path))
        app.dialog.get_by_placeholder("path/to/file.tif").fill(f"cbtest/{path.name}")
        server_type = app.dialog.locator("select").filter(has_text="/h").first
        if settings.ondemand_server_id:
            server_type.select_option(settings.ondemand_server_id)
        picked = server_type.evaluate("s => s.options[s.selectedIndex].text")
        app.shot("filled")
        app.dialog.get_by_role("button", name="Upload", exact=True).click()
        # Staging asks to confirm the cost first ("The server will be destroyed
        # after this job … billed per started hour").
        confirm = page.get_by_role("button", name="Continue", exact=True)
        try:
            confirm.wait_for(timeout=15000)
            app.shot("cost_confirmation")
            confirm.click()
        except Exception:
            pass  # no confirmation on this version
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if find_job(api, path.name):
                return
            text = app.dialog.inner_text() if app.dialog.count() else ""
            if "Failed to fetch" in text or "rror" in text:
                app.shot("upload_error")
                raise AssertionError(f"upload failed: {text[:500]}")
            # A page wait, not time.sleep: the test's request routing runs on
            # this thread, so sleeping would hold up the browser's upload.
            page.wait_for_timeout(5000)
        app.shot("no_job")
        raise AssertionError("no conversion job 10 minutes after the upload started")

    app.network_retry(start)

    # Follow the job through the API, noting every status it passes.
    statuses = []
    job = None
    deadline = time.monotonic() + settings.job_timeout
    while time.monotonic() < deadline:
        job = find_job(api, path.name)
        if job and (not statuses or statuses[-1] != job["status"]):
            statuses.append(job["status"])
            app.shot(f"status_{len(statuses):02d}_{job['status']}")
        if job and job["status"] in TERMINAL:
            break
        page.wait_for_timeout(5000)
    app.shot("done")
    summary = f"server {picked!r}, statuses {statuses}, job {job}"
    assert job, f"no conversion job for {path.name} ({summary})"
    assert job["status"] == "completed", summary
    assert "provisioning" in statuses or "pending" in statuses, summary
    # On demand the server is deleted before the job completes.
    assert "deprovisioning" in statuses, summary
    assert job["outputPaths"] and job["outputSize"], summary
