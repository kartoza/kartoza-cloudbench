"""Confirm a GeoPackage's vector layers and raster tables, and convert both.

A GeoPackage can hold vector layers (-> PMTiles + GeoParquet) and raster
tables (-> COG) side by side. After inspection (pmtiles.inspect_geopackage)
the user picks from both; each kind is its own conversion job, publishing
into the same Portolan sub-catalog folder.
"""

import logging
import os
import shutil
import threading

from . import cog, pmtiles
from .cng_lite import job_directory
from .models import CngLiteJob

logger = logging.getLogger(__name__)


def start_geopackage_conversion(job_id, user, layers=None, tables=None):
    """Start converting an inspected GeoPackage's chosen layers and tables.

    With only vector layers or only raster tables this is the single-kind
    conversion (pmtiles/cog.start_geopackage_conversion). With both, the
    inspected job converts the layers and a second job the tables, run one
    after the other (see _run_in_turn). Returns the started jobs, vector
    first.
    """
    layers = list(layers or [])
    tables = list(tables or [])
    if not layers and not tables:
        raise ValueError("Select at least one layer or raster table.")
    if not tables:
        return [pmtiles.start_geopackage_conversion(job_id, user, layers)]
    if not layers:
        return [cog.start_geopackage_conversion(job_id, user, tables)]

    vector = CngLiteJob.objects.filter(
        pk=job_id, owner_id=user.username, kind=pmtiles.KIND, status="pending", layers__isnull=True
    ).first()
    if not vector:
        raise ValueError("Job not found, or conversion was already started.")
    vector.layers = layers
    vector.save(update_fields=["layers", "updated_at"])
    raster = CngLiteJob.objects.create(
        kind=cog.KIND,
        owner_id=vector.owner_id,
        connection_id=vector.connection_id,
        bucket=vector.bucket,
        source_name=vector.source_name,
        source_key=vector.source_key,
        output_key=vector.output_key,
        input_size=vector.input_size,
        layers=tables,
        license=vector.license,
        license_url=vector.license_url,
        # Only the first job clears a confirmed-replace folder: this one
        # publishes beside the layers the vector job just put there.
        replace_existing=False,
        message="Waiting for the vector layers to finish",
    )
    _share_staged_source(vector, raster)
    threading.Thread(target=_run_in_turn, args=(vector.id, raster.id), daemon=True).start()
    return [vector, raster]


def _share_staged_source(vector, raster):
    """Give the raster job its own link to the GeoPackage staged on disk.

    Each job's directory is removed when it finishes; a hard link keeps the
    file (so the raster job can still hash it for its source asset) without
    a second copy of a possibly large file.
    """
    staged = job_directory(pmtiles.KIND, vector.id) / "source.gpkg"
    if not staged.exists():
        return
    directory = job_directory(cog.KIND, raster.id)
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    try:
        os.link(staged, directory / "source.gpkg")
    except OSError:
        shutil.copyfile(staged, directory / "source.gpkg")


def _run_in_turn(vector_id, raster_id):
    """Convert the vector layers, then the raster tables."""
    group_id = None
    try:
        group_id = pmtiles.run_conversion(vector_id)
    except Exception:
        logger.exception("GeoPackage vector job %s failed unexpectedly", vector_id)
    finally:
        vector = CngLiteJob.objects.filter(pk=vector_id).first()
        if vector is not None:
            CngLiteJob.objects.filter(pk=raster_id).update(source_key=vector.source_key)
        cog.run_conversion(raster_id, collection_id=group_id)
