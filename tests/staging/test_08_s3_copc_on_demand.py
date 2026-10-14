"""Staging: a LAS point cloud converted to COPC on-demand.

ubud_100k.las -> COPC (.copc.laz) on an on-demand CloudNativeGIS server (one
Hetzner server, started and deleted by GeoHosting). The upload lands under
``cbtest/`` and is left there: nothing in S3 is ever deleted.
"""

import pytest

from ._ondemand import follow_job, require_on_demand, start_conversion

pytestmark = pytest.mark.timeout(4000)


def test_las_to_copc_on_demand(app, api, staging, settings, data_file):
    s3 = require_on_demand(staging, settings)
    path = data_file("pointcloud/ubud_100k.las")

    picked = start_conversion(app, api, settings, s3, path, f"cbtest/{path.name}")
    statuses, job = follow_job(app, api, settings, path.name)

    summary = f"server {picked!r}, statuses {statuses}, job {job}"
    assert job, f"no conversion job for {path.name} ({summary})"
    assert job["status"] == "completed", summary
    assert "provisioning" in statuses or "pending" in statuses, summary
    assert "deprovisioning" in statuses, summary

    outputs = job.get("outputPaths") or []
    assert any(".copc" in p.lower() for p in outputs), f"no COPC output: {summary}"
