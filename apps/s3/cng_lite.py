"""Shared job orchestration for CloudNativeGIS Lite conversions (PMTiles, COG).

Format-specific modules (`pmtiles.py`, `cog.py`) validate/prepare their own
source file and call `run_conversion` with the pieces that differ: which
cng-lite endpoint to submit to, how to sanity-check the downloaded result,
and what content type to store it with in S3.
"""

import logging
import shutil
import time
from datetime import timedelta
from pathlib import Path, PurePosixPath

import httpx
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from .client import get_s3_client
from .models import CngLiteJob

logger = logging.getLogger(__name__)


def job_directory(kind, job_id):
    return Path(settings.UPLOAD_TEMP_DIR) / kind / str(job_id)


def sources_directory_key(target_key, job_id):
    """Folder for persisting a job's raw uploads, grouped alongside its eventual output."""
    directory = str(PurePosixPath(target_key).parent)
    prefix = "" if directory in ("", ".") else f"{directory}/"
    return f"{prefix}sources/{job_id}"


def source_object_key(target_key, job_id, filename):
    """Key for persisting the file used as the conversion input."""
    return f"{sources_directory_key(target_key, job_id)}/{filename}"


def update_job(job_id, **values):
    CngLiteJob.objects.filter(pk=job_id).update(updated_at=timezone.now(), **values)


def expire_stalled_job(job):
    cutoff = timezone.now() - timedelta(seconds=settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT + 120)
    expired = CngLiteJob.objects.filter(
        pk=job.pk,
        status__in=["pending", "running"],
        updated_at__lt=cutoff,
    ).update(
        status="failed",
        error="Conversion was interrupted or stopped responding. Please retry the upload.",
        message="CloudNativeGIS conversion interrupted",
        completed_at=timezone.now(),
    )
    if expired:
        shutil.rmtree(job_directory(job.kind, job.pk), ignore_errors=True)
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


def submit_job(client, s3_client, bucket, source_key, expiration, endpoint):
    """Submit the job, handing cng-lite a presigned URL to the source already in S3.

    A presigned URL lets cng-lite fetch the file with a plain HTTPS GET,
    using the credentials of whichever S3 connection the user picked,
    without cng-lite ever needing S3 credentials of its own.
    """
    source_url = s3_client.generate_presigned_url(bucket, source_key, expiration=expiration)
    submission = request_json(client, "POST", endpoint, json={"source": source_url})
    return submission["job_id"]


def wait_for_result(client, cng_job_id, deadline):
    """Poll cng-lite until the conversion finishes, returning its result path."""
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
    raise TimeoutError("Timed out waiting for CloudNativeGIS to produce the converted file.")


def download_result(client, result_path, destination, validate_result, invalid_result_message):
    size = 0
    with client.stream("GET", result_path.lstrip("/")) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_bytes(1024 * 1024):
                size += len(chunk)
                if size > settings.UPLOAD_MAX_FILE_SIZE:
                    raise ValueError("The generated file exceeds the upload size limit.")
                output.write(chunk)
    with destination.open("rb") as output:
        if not validate_result(output):
            raise ValueError(invalid_result_message)
    return size


def run_conversion(job_id, *, kind, endpoint, validate_result, invalid_result_message, output_content_type):
    close_old_connections()
    directory = job_directory(kind, job_id)
    try:
        job = CngLiteJob.objects.get(pk=job_id)
        deadline = time.monotonic() + settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT
        update_job(job.id, status="running", progress=10, message="Submitting to CloudNativeGIS")
        s3_client = get_s3_client(job.connection_id, job.owner_id)
        with httpx.Client(
            base_url=f"{settings.CLOUDNATIVEGIS_URL}/",
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
        ) as client:
            cng_job_id = submit_job(
                client, s3_client, job.bucket, job.source_key, settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT, endpoint
            )
            update_job(job.id, progress=20, message="Waiting for CloudNativeGIS conversion")
            result_path = wait_for_result(client, cng_job_id, deadline)
            update_job(job.id, progress=85, message="Downloading converted file")
            output = directory / "output"
            size = download_result(client, result_path, output, validate_result, invalid_result_message)
        update_job(job.id, progress=95, message="Uploading result to S3")
        with output.open("rb") as source:
            s3_client.client.upload_fileobj(
                source,
                job.bucket,
                job.output_key,
                ExtraArgs={"ContentType": output_content_type},
            )
        update_job(
            job.id,
            status="completed",
            progress=100,
            output_size=size,
            message="File uploaded to S3",
            completed_at=timezone.now(),
        )
    except Exception as exc:
        logger.exception("CloudNativeGIS conversion %s failed", job_id)
        error = str(exc)
        if isinstance(exc, httpx.HTTPStatusError):
            error = f"CloudNativeGIS returned HTTP {exc.response.status_code}. Check its logs."
        elif isinstance(exc, httpx.RequestError):
            error = "Could not contact CloudNativeGIS. Check the service URL and connectivity."
        update_job(
            job_id,
            status="failed",
            message="CloudNativeGIS conversion failed",
            error=error,
            completed_at=timezone.now(),
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)
        close_old_connections()
