"""Staging: a corrupt file fed to an on-demand conversion.

Covers two requirements with one server:
  R3 - an invalid file fails cleanly, with no output published.
  R5 - a failed on-demand job still deletes its Hetzner server.
"""

import pytest

from ._ondemand import follow_job, require_on_demand, start_conversion

pytestmark = pytest.mark.timeout(4000)


def test_corrupt_tif_fails_and_deletes_server(app, api, staging, settings, data_file):
    s3 = require_on_demand(staging, settings)
    path = data_file("invalid/corrupt.tif")

    start_conversion(app, api, settings, s3, path, f"cbtest/{path.name}")
    statuses, job = follow_job(app, api, settings, path.name)

    summary = f"statuses {statuses}, job {job}"
    assert job, f"no conversion job for {path.name} ({summary})"
    # Clean failure, not a hang or a crash, with a readable error.
    assert job["status"] == "failed", summary
    assert job.get("error"), f"failed job has no error message: {summary}"

    # Nothing half-made: no layer in the catalog, no object at the output path.
    # (``outputPaths`` on the job is only the planned destination, not proof
    # anything was written.)
    stem = path.stem
    layers = api.get(f"/s3/portolan/layers/{s3['id']}").get("layers", [])
    assert not any(
        stem in str(layer) for layer in layers
    ), f"a broken layer was published: {layers}"
    out_key = "/".join(job["outputPaths"][0].split("/")[3:])  # drop s3://bucket/
    objects = api.get(f"/s3/objects/{s3['id']}?prefix={out_key}")
    assert not objects.get("objects"), f"output file left behind at {out_key}: {objects}"

    # If a server was ever started, it must be gone again.
    if any(s in statuses for s in ("provisioning", "polling", "deprovisioning")):
        assert "deprovisioning" in statuses, summary
        server = job.get("server") or {}
        assert server.get("status") in (None, "deleted"), f"server not deleted: {summary}"
