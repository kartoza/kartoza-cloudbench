"""Upload shapefiles to CloudNativeGIS and transfer completed PMTiles to S3."""

import logging
import shutil
import threading
import time
import zipfile
from datetime import timedelta
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

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


def start_conversion(uploaded_file, key, connection_id, bucket, owner_id, companion_files=()):
    if not settings.CLOUDNATIVEGIS_URL:
        raise ValueError("CloudNativeGIS URL is not configured.")
    if not settings.CLOUDNATIVEGIS_USERNAME or not settings.CLOUDNATIVEGIS_PASSWORD:
        raise ValueError("Configure CloudNativeGIS username and password before converting.")
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
        prepare_shapefile(uploaded_file, directory / "source.zip", job.id, companion_files)
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
    return response.json()


def wait_for_pmtiles(client, job, deadline):
    layer_path = f"api/layer/{job.layer_id}/"
    while time.monotonic() < deadline:
        uploads = request_json(client, "GET", f"{layer_path}layer-upload/")
        uploads = uploads.get("results", []) if isinstance(uploads, dict) else uploads
        latest = uploads[0] if uploads else {}
        if latest.get("status") == "Failed":
            raise ValueError(
                f"CloudNativeGIS import failed: {latest.get('note') or 'Unknown error'}"
            )
        layer = request_json(client, "GET", layer_path)
        if latest.get("status") == "Success":
            if layer.get("is_ready") and layer.get("pmtile"):
                return layer["pmtile"]
            raise ValueError("CloudNativeGIS finished importing but did not produce PMTiles.")
        update_job(
            job.id,
            progress=20 + int(min(100, max(0, latest.get("progress", 0))) * 0.6),
            message=latest.get("note") or "Waiting for CloudNativeGIS conversion",
        )
        time.sleep(min(settings.CLOUDNATIVEGIS_POLL_INTERVAL, max(0, deadline - time.monotonic())))
    raise TimeoutError("Timed out waiting for CloudNativeGIS to produce PMTiles.")


def download_pmtiles(client, remote_url, destination):
    """Download only from the configured service, never a returned external host."""
    remote_path = urlsplit(remote_url).path
    if not remote_path.startswith("/media/") or not remote_path.lower().endswith(".pmtiles"):
        raise ValueError("CloudNativeGIS returned an unexpected PMTiles path.")
    size = 0
    with client.stream("GET", remote_path.lstrip("/")) as response:
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
        update_job(job.id, status="running", progress=5, message="Uploading to CloudNativeGIS")
        with httpx.Client(
            base_url=f"{settings.CLOUDNATIVEGIS_URL}/",
            auth=(settings.CLOUDNATIVEGIS_USERNAME, settings.CLOUDNATIVEGIS_PASSWORD),
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
        ) as client:
            layer = request_json(
                client, "POST", "api/layer/", data={"name": PurePosixPath(job.output_key).stem}
            )
            job.layer_id = int(layer["id"])
            update_job(job.id, layer_id=job.layer_id)
            with (directory / "source.zip").open("rb") as source:
                request_json(
                    client,
                    "POST",
                    f"api/layer/{job.layer_id}/layer-upload/",
                    # CloudNativeGIS's PMTiles step shells out to the `ogr2ogr`
                    # CLI on the raw uploaded path. GDAL's Shapefile driver only
                    # auto-mounts a zip archive when the filename ends in
                    # ".shp.zip" — a bare ".zip" fails there even though
                    # geopandas.read_file() (used for the PostGIS import step)
                    # tolerates it via its own path wrapping. Without this,
                    # CloudNativeGIS marks the upload "Success" anyway (it
                    # never checks generate_pmtiles()'s return value), and no
                    # PMTiles are produced.
                    files={"file": (f"{job.id}.shp.zip", source, "application/zip")},
                )
            remote_url = wait_for_pmtiles(client, job, deadline)
            update_job(job.id, progress=85, message="Downloading converted PMTiles")
            output = directory / "output.pmtiles"
            size = download_pmtiles(client, remote_url, output)
        update_job(job.id, progress=95, message="Uploading PMTiles to S3")
        s3_client = get_s3_client(job.connection_id, job.owner_id)
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
            error = f"CloudNativeGIS returned HTTP {exc.response.status_code}. Check its credentials and logs."
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
