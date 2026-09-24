"""Convert TIFFs via CloudNativeGIS Lite and transfer the resulting COG to S3."""

import shutil
import threading
from pathlib import PurePosixPath

from django.conf import settings

from . import portolan
from .client import get_s3_client
from .cng_lite import job_directory, source_object_key
from .cng_lite import run_conversion as run_cng_lite_conversion
from .geopackage import is_geopackage, prepare_geopackage
from .models import CngLiteJob

KIND = "cog"
ENDPOINT = "api/v1/cog"
CONTENT_TYPE = "image/tiff"

# TIFF byte-order markers: "II*\x00" (little-endian) / "MM\x00*" (big-endian).
TIFF_MAGIC = (b"II*\x00", b"MM\x00*")


def group_results(job, results):
    """Groups cng-lite's COG output into one logical layer per raster.

    Every raster produces two files — the original-CRS COG and its
    "_3857" EPSG:3857 companion (see tiff_to_cog.py) — that belong to the
    same layer. A GeoPackage's per-table files each keep their own name;
    a plain TIFF's (generically-named) pair instead takes its title from
    the original upload.
    """
    is_multi = is_geopackage(job.source_name)
    groups = {}
    order = []
    for item in results:
        stem = PurePosixPath(item["name"]).stem
        is_3857 = stem.endswith("_3857")
        base = stem[: -len("_3857")] if is_3857 else stem
        if base.endswith("_cog"):
            base = base[: -len("_cog")]
        if base not in groups:
            groups[base] = {}
            order.append(base)
        groups[base]["visual" if is_3857 else "data"] = item

    layers = []
    for base in order:
        title_stem = base if is_multi else PurePosixPath(job.source_name).stem
        title = portolan.prettify(title_stem)
        layer_id = portolan.sanitize_layer_id(title_stem)
        assets = []
        if "data" in groups[base]:
            assets.append(
                {"item": groups[base]["data"], "filename": f"{layer_id}.tif", "role": "data"}
            )
        if "visual" in groups[base]:
            assets.append(
                {
                    "item": groups[base]["visual"],
                    "filename": f"{layer_id}_3857.tif",
                    "role": "visual",
                }
            )
        layers.append({"layer_id": layer_id, "title": title, "assets": assets})
    return layers


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
    uploaded_file, key, connection_id, user, license_id=portolan.DEFAULT_LICENSE
):
    if not settings.CLOUDNATIVEGIS_URL:
        raise ValueError("CloudNativeGIS URL is not configured.")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The file exceeds the upload size limit.")
    geopackage = is_geopackage(uploaded_file.name)
    s3_client = get_s3_client(connection_id, user)
    job = CngLiteJob(
        kind=KIND,
        owner_id=user.username,
        connection_id=connection_id,
        bucket=s3_client.bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=uploaded_file.size,
        license=license_id,
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


def validate_cog(output):
    return output.read(4) in TIFF_MAGIC


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
        pk=job_id, owner_id=user.username, kind="pmtiles", status="pending", layers__isnull=True
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


def run_conversion(job_id):
    run_cng_lite_conversion(
        job_id,
        kind=KIND,
        endpoint=ENDPOINT,
        validate_result=validate_cog,
        invalid_result_message="CloudNativeGIS did not return a valid COG file.",
        output_content_type=CONTENT_TYPE,
        group_results=group_results,
        # Only set when confirmed via start_geopackage_conversion (a
        # direct GeoPackage upload with targetFormat=cog converts every
        # raster table, same as before).
        build_extra_payload=lambda job: {"tables": job.layers} if job.layers else None,
    )
