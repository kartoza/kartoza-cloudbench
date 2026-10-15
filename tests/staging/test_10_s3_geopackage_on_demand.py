"""Staging: GeoPackage's two-job conversion is not available on-demand.

A GeoPackage (vector layer + raster table) is meant to convert as two jobs,
vector -> PMTiles + GeoParquet and raster -> COG, chosen in a layer picker the
dialog shows after *inspecting* the file. That inspect step has no provisioned
server to read the layers on in on-demand mode, so ``POST /s3/gpkg/inspect``
fails there:

    400 "Pick a server to run the conversion on."        (no server picked)
    502 "Could not inspect the GeoPackage: ... '/api/v1/gpkg/layers' 400"
                                                          (with a server picked)

This is a known *deferred* item (see CLAUDE.md, "Inspecting a GeoPackage in
on-demand mode"), not a regression. Staging runs CloudNativeGIS on-demand, so
the two-job GeoPackage flow can't be exercised here; this test records that
and skips until it lands. The individual pipelines it would use are covered
elsewhere: vector -> PMTiles by test_07, raster -> COG by test_05.
"""

import pytest

from ._ondemand import require_on_demand

pytestmark = pytest.mark.timeout(600)


def test_geopackage_two_jobs_unavailable_on_demand(staging, settings, data_file):
    require_on_demand(staging, settings)
    # data_file is kept in the signature so the fixture (and its skip-if-missing
    # check) still documents which file the flow would use once it's supported.
    data_file("raster/bali_vector_and_raster.gpkg")
    pytest.skip("GeoPackage inspection is deferred in on-demand mode (see CLAUDE.md)")
