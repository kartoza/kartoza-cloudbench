"""Convert TIFFs via CloudNativeGIS Lite and transfer the resulting COG to S3."""

import shutil
import threading
from pathlib import PurePosixPath

from django.conf import settings

from .client import get_s3_client
from .cng_lite import job_directory, run_conversion as run_cng_lite_conversion, source_object_key
from .geopackage import is_geopackage, prepare_geopackage
from .models import CngLiteJob

KIND = "cog"
ENDPOINT = "api/v1/cog"
CONTENT_TYPE = "image/tiff"

# TIFF byte-order markers: "II*\x00" (little-endian) / "MM\x00*" (big-endian).
TIFF_MAGIC = (b"II*\x00", b"MM\x00*")


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


def start_conversion(uploaded_file, key, connection_id, bucket, owner_id):
    if not settings.CLOUDNATIVEGIS_URL:
        raise ValueError("CloudNativeGIS URL is not configured.")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The file exceeds the upload size limit.")
    geopackage = is_geopackage(uploaded_file.name)
    job = CngLiteJob(
        kind=KIND,
        owner_id=owner_id,
        connection_id=connection_id,
        bucket=bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=uploaded_file.size,
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
        job.source_key = source_object_key(job.output_key, job.id, PurePosixPath(uploaded_file.name).name)
        s3_client = get_s3_client(connection_id, owner_id)
        with source_path.open("rb") as source_file:
            s3_client.client.upload_fileobj(
                source_file,
                bucket,
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


def run_conversion(job_id):
    run_cng_lite_conversion(
        job_id,
        kind=KIND,
        endpoint=ENDPOINT,
        validate_result=validate_cog,
        invalid_result_message="CloudNativeGIS did not return a valid COG file.",
        output_content_type=CONTENT_TYPE,
        # A raster GeoPackage converts to one COG per raster table (never
        # merged), stored under a folder named after the upload — even
        # when it only has one, for predictability.
        use_folder=lambda job: is_geopackage(job.source_name),
    )
