"""Shared helpers for the on-demand S3 conversion tests (test_05, test_06)."""

import time

import pytest

TERMINAL = {"completed", "failed", "cancelled"}


def find_job(api, source_name):
    body = api.get("/s3/conversion/jobs")
    jobs = body.get("jobs", []) if isinstance(body, dict) else body
    for job in jobs:
        if source_name in (job.get("sourcePath") or "") + (job.get("sourceStoredPath") or ""):
            return job
    return None


def require_on_demand(staging, settings):
    """Skip/fail unless an on-demand conversion can run now."""
    cng = staging["cloudnativegis"]
    if not cng.get("onDemand"):
        pytest.skip("staging runs CloudNativeGIS in non-demand mode")
    if not settings.ondemand_enabled or settings.ondemand_max_jobs < 1:
        pytest.skip("on-demand tests are switched off in .env.staging")
    if not any(s["available"] for s in cng["servers"]):
        pytest.fail("every on-demand server type is out of stock")
    if not staging["s3"]:
        pytest.skip("no S3 connection")
    return staging["s3"][0]


def start_conversion(app, api, settings, s3, path, object_key):
    """Upload ``path`` to S3 with conversion; return once the job exists.

    Returns the server-type label picked. Retries the upload (only) if the
    browser drops a request.
    """
    page = app.page
    picked = {"label": None}

    def flow():
        if find_job(api, path.name):
            return  # an earlier attempt got through: never start a second server
        app.tree_node(s3["name"]).click()
        page.get_by_role("button", name="Upload", exact=True).first.click()
        app.dialog.wait_for()
        app.dialog.locator("input[type=file]").set_input_files(str(path))
        app.dialog.get_by_placeholder("path/to/file.tif").fill(object_key)
        server_type = app.dialog.locator("select").filter(has_text="/h").first
        if settings.ondemand_server_id:
            server_type.select_option(settings.ondemand_server_id)
        picked["label"] = server_type.evaluate("s => s.options[s.selectedIndex].text")
        app.shot("filled")
        app.dialog.get_by_role("button", name="Upload", exact=True).click()
        confirm = page.get_by_role("button", name="Continue", exact=True)
        try:
            confirm.wait_for(timeout=15000)
            app.shot("cost_confirmation")
            confirm.click()
        except Exception:
            pass
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if find_job(api, path.name):
                return
            text = app.dialog.inner_text() if app.dialog.count() else ""
            if "Failed to fetch" in text:
                raise AssertionError(f"upload dropped: {text[:300]}")
            page.wait_for_timeout(5000)
        app.shot("no_job")
        raise AssertionError("no conversion job 10 minutes after the upload started")

    app.network_retry(flow)
    return picked["label"]


def follow_job(app, api, settings, source_name):
    """Poll the job to a terminal status; return (statuses seen, final job)."""
    statuses = []
    job = None
    deadline = time.monotonic() + settings.job_timeout
    while time.monotonic() < deadline:
        job = find_job(api, source_name)
        if job and (not statuses or statuses[-1] != job["status"]):
            statuses.append(job["status"])
            app.shot(f"status_{len(statuses):02d}_{job['status']}")
        if job and job["status"] in TERMINAL:
            break
        app.page.wait_for_timeout(5000)
    app.shot("done")
    return statuses, job
