"""Convert TIFFs via CloudNativeGIS Lite and transfer the resulting COG to S3."""

import shutil
import threading
from pathlib import PurePosixPath

from django.conf import settings

from . import portolan
from .client import get_s3_client
from .cng_lite import Converter, check_target, job_directory, source_object_key
from .cng_lite import run_conversion as run_cng_lite_conversion
from .geopackage import is_geopackage, prepare_geopackage
from .models import CngLiteJob, CngLiteJobStatus

KIND = "cog"
ENDPOINT = "api/v1/cog"
CONTENT_TYPE = portolan.COG_MEDIA_TYPE

# TIFF byte-order markers: "II*\x00" (little-endian) / "MM\x00*" (big-endian).
TIFF_MAGIC = (b"II*\x00", b"MM\x00*")


def assets_for(layer_id):
    """A raster's files: its COG (data), EPSG:3857 COG (visual), and thumbnail.

    Map Explorer renders only Web Mercator COGs, hence the "_3857" one.
    """
    return [
        {"role": "data", "filename": f"{layer_id}.tif", "media_type": CONTENT_TYPE},
        {"role": "visual", "filename": f"{layer_id}_3857.tif", "media_type": CONTENT_TYPE},
        {
            "role": "thumbnail",
            "filename": portolan.THUMBNAIL_FILENAME,
            "media_type": portolan.THUMBNAIL_MEDIA_TYPE,
        },
    ]


def pick_layers(inspection):
    """A GeoPackage's raster tables, from CloudNativeGIS's inspection of it."""
    return [table["name"] for table in inspection.get("rasterTables", [])]


def output_key(key):
    key = key.rstrip("/")
    if key.lower().endswith((".tif", ".tiff")):
        return key
    return f"{PurePosixPath(key).with_suffix('')}.tif"


def prepare_tiff(uploaded_file, destination):
    """Validate the upload is a single TIFF and copy it to `destination`."""
    if not uploaded_file.name.lower().endswith((".tif", ".tiff")):
        raise ValueError("Select a GeoTIFF (.tif or .tiff) file.")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The TIFF exceeds the upload size limit.")
    header = uploaded_file.read(4)
    uploaded_file.seek(0)
    if header not in TIFF_MAGIC:
        raise ValueError("The file is not a valid TIFF.")
    with destination.open("wb") as output:
        for chunk in uploaded_file.chunks():
            output.write(chunk)


def start_conversion(
    uploaded_file,
    key,
    connection_id,
    user,
    license_id=portolan.DEFAULT_LICENSE,
    license_url="",
    replace=False,
    hetzner_server_id=None,
):
    """Start converting an upload; raises TargetExists unless `replace` (see check_target)."""
    if not CngLiteJob.is_valid():
        raise ValueError("CloudNativeGIS is not configured.")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The file exceeds the upload size limit.")
    geopackage = is_geopackage(uploaded_file.name)
    s3_client = get_s3_client(connection_id, user)
    check_target(s3_client, output_key(key), uploaded_file.name, replace)
    job = CngLiteJob(
        kind=KIND,
        owner=user,
        connection_id=connection_id,
        bucket=s3_client.bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=uploaded_file.size,
        license=license_id,
        license_url=license_url,
        replace_existing=replace,
        hetzner_server_id=hetzner_server_id,
    )
    directory = job_directory(KIND, job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        if geopackage:
            source_path = directory / "source.gpkg"
            prepare_geopackage(uploaded_file, source_path, settings.UPLOAD_MAX_FILE_SIZE)
            content_type = "application/geopackage+sqlite3"
        else:
            source_path = directory / "source.tif"
            prepare_tiff(uploaded_file, source_path)
            content_type = "image/tiff"
        job.source_key = source_object_key(
            job.output_key, job.id, PurePosixPath(uploaded_file.name).name
        )
        with source_path.open("rb") as source_file:
            s3_client.client.upload_fileobj(
                source_file,
                s3_client.bucket,
                job.source_key,
                ExtraArgs={"ContentType": content_type},
            )
        job.save()
        threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        if job.pk:
            CngLiteJob.objects.filter(pk=job.pk).delete()
        raise
    return job


def start_geopackage_conversion(job_id, user, tables):
    """Confirm a raster GeoPackage's tables and start its COG conversion.

    The job was created by pmtiles.inspect_geopackage (every GeoPackage is
    inspected there first, since only after inspecting it do we know
    whether it holds vector layers, raster tables, or both) — reassign it
    from "pmtiles" to "cog" now that we know it's headed for raster
    conversion, reusing the GeoPackage already staged in S3 rather than
    uploading it again.
    """
    if not tables:
        raise ValueError("Select at least one raster table.")
    job = CngLiteJob.objects.filter(
        pk=job_id,
        owner=user,
        kind="pmtiles",
        status=CngLiteJobStatus.PENDING,
        layers__isnull=True,
    ).first()
    if not job:
        raise ValueError("Job not found, or conversion was already started.")
    job.kind = KIND
    job.layers = tables
    job.save(update_fields=["kind", "layers", "updated_at"])
    # The staged source lives under the "pmtiles" job directory (from
    # inspect_geopackage); run_conversion creates its own "cog" one fresh.
    shutil.rmtree(job_directory("pmtiles", job.id), ignore_errors=True)
    threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    return job


CONVERTER = Converter(
    endpoint=ENDPOINT,
    assets_for=assets_for,
    pick_layers=pick_layers,
    # The tables picked (start_geopackage_conversion), or - for a GeoPackage
    # uploaded straight to convert - all of them, listed before converting
    # (see CNGProcessingClient._layer_names).
    payload=lambda job: {
        "thumbnail": True,
        **({"tables": job.layers} if job.layers else {}),
    },
)


def run_conversion(job_id):
    run_cng_lite_conversion(job_id)
