"""Convert shapefiles via CloudNativeGIS Lite and transfer the resulting PMTiles to S3."""

import logging
import shutil
import threading
import time
import zipfile
from datetime import timedelta
from pathlib import Path, PurePosixPath

import httpx
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from .client import get_s3_client
from .models import PMTilesJob

logger = logging.getLogger(__name__)


def output_key(key):
    key = key.rstrip("/")
    if key.lower().endswith(".shp.zip"):
        key = key[:-8]
    elif not key.lower().endswith(".pmtiles"):
        key = str(PurePosixPath(key).with_suffix(""))
    else:
        return key
    return f"{key}.pmtiles"


def job_directory(job_id):
    return Path(settings.UPLOAD_TEMP_DIR) / "pmtiles" / str(job_id)


def sources_directory_key(target_key, job_id):
    """Folder for persisting a job's raw uploads, grouped alongside its eventual output."""
    directory = str(PurePosixPath(target_key).parent)
    prefix = "" if directory in ("", ".") else f"{directory}/"
    return f"{prefix}sources/{job_id}"


def source_object_key(target_key, job_id, uploaded_name):
    """Key for persisting the synthesized shapefile zip used as the conversion input."""
    name = uploaded_name
    if not name.lower().endswith(".zip"):
        name = f"{PurePosixPath(name).stem}.zip"
    return f"{sources_directory_key(target_key, job_id)}/{name}"


def prepare_shapefile(uploaded_file, destination, identifier, companion_files=()):
    """Validate and flatten one shapefile, using unique names upstream."""
    if uploaded_file.name.lower().endswith(".shp"):
        stem = PurePosixPath(uploaded_file.name).stem.lower()
        components = {}
        for component in [uploaded_file, *companion_files]:
            path = PurePosixPath(component.name)
            suffix = path.suffix.lower()
            if path.stem.lower() != stem or suffix not in {
                ".shp",
                ".shx",
                ".dbf",
                ".prj",
                ".cpg",
                ".qix",
                ".sbn",
                ".sbx",
            }:
                raise ValueError("Select only the matching components of one shapefile.")
            if suffix in components:
                raise ValueError("Duplicate shapefile components were selected.")
            components[suffix] = component
        if not {".shp", ".shx", ".dbf"}.issubset(components):
            raise ValueError(
                "Select the matching .shp, .shx and .dbf files together. "
                "Cloudbench will ZIP them automatically."
            )
        if sum(component.size for component in components.values()) > settings.UPLOAD_MAX_FILE_SIZE:
            raise ValueError("The shapefile components exceed the upload size limit.")
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            for suffix, component in components.items():
                with archive.open(f"{identifier}{suffix}", "w", force_zip64=True) as output:
                    for chunk in component.chunks():
                        output.write(chunk)
        return
    if companion_files:
        raise ValueError("Multiple files are supported only for matching shapefile components.")
    if not uploaded_file.name.lower().endswith(".zip"):
        raise ValueError("Select a shapefile and its companion files, or a shapefile ZIP.")
    try:
        with zipfile.ZipFile(uploaded_file) as source:
            files = [entry for entry in source.infolist() if not entry.is_dir()]
            shapes = [entry for entry in files if entry.filename.lower().endswith(".shp")]
            if len(shapes) != 1:
                raise ValueError("The ZIP must contain exactly one shapefile.")
            stem = str(PurePosixPath(shapes[0].filename).with_suffix("")).lower()
            sidecars = {}
            for entry in files:
                path = PurePosixPath(entry.filename)
                if str(path.with_suffix("")).lower() != stem:
                    continue
                suffix = path.suffix.lower()
                if suffix not in {".shp", ".shx", ".dbf", ".prj", ".cpg", ".qix", ".sbn", ".sbx"}:
                    continue
                if suffix in sidecars:
                    raise ValueError("The ZIP contains duplicate shapefile components.")
                sidecars[suffix] = entry
            if not {".shp", ".shx", ".dbf"}.issubset(sidecars):
                raise ValueError("The ZIP must include matching .shp, .shx and .dbf files.")
            if sum(entry.file_size for entry in sidecars.values()) > settings.UPLOAD_MAX_FILE_SIZE:
                raise ValueError("The uncompressed shapefile exceeds the upload size limit.")
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as target:
                for suffix, entry in sidecars.items():
                    with (
                        source.open(entry) as incoming,
                        target.open(f"{identifier}{suffix}", "w", force_zip64=True) as outgoing,
                    ):
                        shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise ValueError("The shapefile ZIP is invalid, encrypted, or unsupported.") from exc


def upload_raw_components(s3_client, bucket, output_key_value, job_id, uploaded_file, companion_files):
    """Persist each originally-uploaded file (not just the synthesized zip) to S3."""
    directory = sources_directory_key(output_key_value, job_id)
    for component in (uploaded_file, *companion_files):
        component.seek(0)
        key = f"{directory}/{PurePosixPath(component.name).name}"
        content_type = component.content_type or "application/octet-stream"
        s3_client.client.upload_fileobj(component, bucket, key, ExtraArgs={"ContentType": content_type})


def start_conversion(uploaded_file, key, connection_id, bucket, owner_id, companion_files=()):
    if not settings.CLOUDNATIVEGIS_URL:
        raise ValueError("CloudNativeGIS URL is not configured.")
    input_size = uploaded_file.size + sum(component.size for component in companion_files)
    if input_size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The file exceeds the upload size limit.")
    job = PMTilesJob(
        owner_id=owner_id,
        connection_id=connection_id,
        bucket=bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=input_size,
    )
    directory = job_directory(job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        source_path = directory / "source.zip"
        prepare_shapefile(uploaded_file, source_path, job.id, companion_files)
        job.source_key = source_object_key(job.output_key, job.id, uploaded_file.name)
        s3_client = get_s3_client(connection_id, owner_id)
        if companion_files:
            upload_raw_components(s3_client, bucket, job.output_key, job.id, uploaded_file, companion_files)
        with source_path.open("rb") as source_file:
            s3_client.client.upload_fileobj(
                source_file,
                bucket,
                job.source_key,
                ExtraArgs={"ContentType": "application/zip"},
            )
        job.save()
        threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        if job.pk:
            PMTilesJob.objects.filter(pk=job.pk).delete()
        raise
    return job


def update_job(job_id, **values):
    PMTilesJob.objects.filter(pk=job_id).update(updated_at=timezone.now(), **values)


def expire_stalled_job(job):
    cutoff = timezone.now() - timedelta(seconds=settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT + 120)
    expired = PMTilesJob.objects.filter(
        pk=job.pk,
        status__in=["pending", "running"],
        updated_at__lt=cutoff,
    ).update(
        status="failed",
        error="Conversion was interrupted or stopped responding. Please retry the upload.",
        message="PMTiles conversion interrupted",
        completed_at=timezone.now(),
    )
    if expired:
        shutil.rmtree(job_directory(job.pk), ignore_errors=True)
        job.refresh_from_db()


def request_json(client, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    try:
        return response.json()
    except ValueError as exc:
        raise ValueError(
            f"CloudNativeGIS returned a non-JSON response from {method} {path} "
            f"(HTTP {response.status_code}): {response.text[:200]!r}. "
            "Check that CLOUDNATIVEGIS_URL points at CloudNativeGIS Lite."
        ) from exc


def submit_pmtiles_job(client, s3_client, bucket, source_key, expiration):
    """Submit the job, handing cng-lite a presigned URL to the zip already in S3.

    A presigned URL lets cng-lite fetch the file with a plain HTTPS GET,
    using the credentials of whichever S3 connection the user picked,
    without cng-lite ever needing S3 credentials of its own.
    """
    source_url = s3_client.generate_presigned_url(bucket, source_key, expiration=expiration)
    submission = request_json(client, "POST", "api/v1/pmtiles", json={"source": source_url})
    return submission["job_id"]


def wait_for_pmtiles(client, cng_job_id, deadline):
    """Poll cng-lite until the conversion finishes, returning its result path.
    """
    expected_result_path = f"/api/v1/jobs/{cng_job_id}/result"
    while time.monotonic() < deadline:
        body = client.get(f"api/v1/jobs/{cng_job_id}").json()
        if body.get("status") == "failed":
            raise ValueError(f"CloudNativeGIS conversion failed: {body.get('detail') or 'Unknown error'}")
        if body.get("status") == "done":
            if body.get("result_url") != expected_result_path:
                raise ValueError("CloudNativeGIS returned an unexpected result location.")
            return expected_result_path
        time.sleep(min(settings.CLOUDNATIVEGIS_POLL_INTERVAL, max(0, deadline - time.monotonic())))
    raise TimeoutError("Timed out waiting for CloudNativeGIS to produce PMTiles.")


def download_pmtiles(client, result_path, destination):
    size = 0
    with client.stream("GET", result_path.lstrip("/")) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_bytes(1024 * 1024):
                size += len(chunk)
                if size > settings.UPLOAD_MAX_FILE_SIZE:
                    raise ValueError("The generated PMTiles exceeds the upload size limit.")
                output.write(chunk)
    with destination.open("rb") as output:
        if output.read(7) != b"PMTiles":
            raise ValueError("CloudNativeGIS did not return a valid PMTiles file.")
    return size


def run_conversion(job_id):
    close_old_connections()
    directory = job_directory(job_id)
    try:
        job = PMTilesJob.objects.get(pk=job_id)
        deadline = time.monotonic() + settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT
        update_job(job.id, status="running", progress=10, message="Submitting to CloudNativeGIS")
        s3_client = get_s3_client(job.connection_id, job.owner_id)
        with httpx.Client(
            base_url=f"{settings.CLOUDNATIVEGIS_URL}/",
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
        ) as client:
            cng_job_id = submit_pmtiles_job(
                client, s3_client, job.bucket, job.source_key, settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT
            )
            update_job(job.id, progress=20, message="Waiting for CloudNativeGIS conversion")
            result_path = wait_for_pmtiles(client, cng_job_id, deadline)
            update_job(job.id, progress=85, message="Downloading converted PMTiles")
            output = directory / "output.pmtiles"
            size = download_pmtiles(client, result_path, output)
        update_job(job.id, progress=95, message="Uploading PMTiles to S3")
        with output.open("rb") as source:
            s3_client.client.upload_fileobj(
                source,
                job.bucket,
                job.output_key,
                ExtraArgs={"ContentType": "application/vnd.pmtiles"},
            )
        update_job(
            job.id,
            status="completed",
            progress=100,
            output_size=size,
            message="PMTiles uploaded to S3",
            completed_at=timezone.now(),
        )
    except Exception as exc:
        logger.exception("PMTiles conversion %s failed", job_id)
        error = str(exc)
        if isinstance(exc, httpx.HTTPStatusError):
            error = f"CloudNativeGIS returned HTTP {exc.response.status_code}. Check its logs."
        elif isinstance(exc, httpx.RequestError):
            error = "Could not contact CloudNativeGIS. Check the service URL and connectivity."
        update_job(
            job_id,
            status="failed",
            message="PMTiles conversion failed",
            error=error,
            completed_at=timezone.now(),
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)
        close_old_connections()
