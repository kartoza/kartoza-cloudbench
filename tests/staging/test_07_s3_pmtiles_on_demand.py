"""Staging: a vector upload converted to GeoParquet + PMTiles on-demand.

bali_districts.geojson -> GeoParquet + PMTiles on an on-demand CloudNativeGIS
server (one Hetzner server, started and deleted by GeoHosting, billed per
started hour). The upload lands under ``cbtest/`` and is left there: nothing
in S3 is ever deleted.
"""

import pytest

from ._ondemand import follow_job, require_on_demand, start_conversion

pytestmark = pytest.mark.timeout(4000)


def test_vector_to_pmtiles_on_demand(app, api, staging, settings, data_file):
    s3 = require_on_demand(staging, settings)
    path = data_file("vector/bali_districts.geojson")

    picked = start_conversion(app, api, settings, s3, path, f"cbtest/{path.name}")
    statuses, job = follow_job(app, api, settings, path.name)

    summary = f"server {picked!r}, statuses {statuses}, job {job}"
    assert job, f"no conversion job for {path.name} ({summary})"
    assert job["status"] == "completed", summary
    # On demand the server is provisioned, then deleted before the job completes.
    assert "provisioning" in statuses or "pending" in statuses, summary
    assert "deprovisioning" in statuses, summary

    # A vector source yields both a PMTiles (the map tiles) and a GeoParquet.
    outputs = job.get("outputPaths") or []
    assert any(p.lower().endswith(".pmtiles") for p in outputs), f"no PMTiles output: {summary}"
    assert any(p.lower().endswith(".parquet") for p in outputs), f"no GeoParquet output: {summary}"
