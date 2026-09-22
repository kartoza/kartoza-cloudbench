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
from .models import CngLiteJob, LayerCollection, LayerCollectionItem

logger = logging.getLogger(__name__)


def _item_display_name(filename, kind):
    """Strips the file extension (and cog.py's "_cog" suffix) for a clean layer name."""
    stem = PurePosixPath(filename).stem
    if kind == "cog" and stem.endswith("_cog"):
        stem = stem[: -len("_cog")]
    return stem


def _create_collection(job, output_keys, kind):
    """Groups a multi-output job's layers into a LayerCollection for Map Explorer.

    Best-effort: a failure here shouldn't undo the conversion that already
    succeeded and already landed in S3.
    """
    try:
        collection = LayerCollection.objects.create(
            owner_id=job.owner_id,
            connection_id=job.connection_id,
            bucket=job.bucket,
            name=PurePosixPath(job.source_name).stem,
            source_name=job.source_name,
        )
        LayerCollectionItem.objects.bulk_create([
            LayerCollectionItem(
                collection=collection,
                name=_item_display_name(item["name"], kind),
                key=item["key"],
                format=kind,
            )
            for item in output_keys
        ])
    except Exception:
        logger.exception("Job %s: failed to create a layer collection (files were still uploaded)", job.id)


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


def submit_job(client, s3_client, source_key, expiration, endpoint, extra_payload=None):
    """Submit the job, handing cng-lite a presigned URL to the source already in S3.

    A presigned URL lets cng-lite fetch the file with a plain HTTPS GET,
    using the credentials of whichever S3 connection the user picked,
    without cng-lite ever needing S3 credentials of its own.
    """
    source_url = s3_client.generate_presigned_url(source_key, expiration=expiration)
    payload = {"source": source_url, **(extra_payload or {})}
    submission = request_json(client, "POST", endpoint, json=payload)
    return submission["job_id"]


def wait_for_results(client, job_id, cng_job_id, deadline):
    """Poll cng-lite until the conversion finishes, returning a tuple of
    (results, errors). `results` is [{'name', 'result_url'}, ...] — one
    entry per output file (a GeoPackage conversion produces one per vector
    layer or raster table; anything else produces exactly one). `errors`
    lists any layers/tables cng-lite skipped rather than failing the job.

    Relays cng-lite's live per-layer/per-raster progress (e.g. "Converting
    layer 2/5: dashboard", 40% through) into the job's own message/progress
    as it goes, so the frontend's existing display shows real movement
    across a multi-layer GeoPackage instead of sitting at one fixed value.
    """
    while time.monotonic() < deadline:
        body = client.get(f"api/v1/jobs/{cng_job_id}").json()
        if body.get("status") == "failed":
            raise ValueError(f"CloudNativeGIS conversion failed: {body.get('detail') or 'Unknown error'}")
        if body.get("status") == "done":
            results = body.get("results")
            if not results:
                raise ValueError("CloudNativeGIS returned no result files.")
            return results, body.get("errors") or []
        detail = body.get("detail")
        if detail:
            fraction = body.get("detailProgress")
            values = {"message": detail}
            if fraction is not None:
                values["progress"] = 20 + round(60 * fraction)
            update_job(job_id, **values)
        time.sleep(min(settings.CLOUDNATIVEGIS_POLL_INTERVAL, max(0, deadline - time.monotonic())))
    raise TimeoutError("Timed out waiting for CloudNativeGIS to produce the converted file(s).")


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


def run_conversion(
    job_id,
    *,
    kind,
    endpoint,
    validate_result,
    invalid_result_message,
    output_content_type,
    build_extra_payload=None,
    use_folder=None,
):
    """Run a conversion job and upload whatever cng-lite produced.

    A job that produces exactly one file is uploaded straight to
    `job.output_key`, unchanged from before. A job that produces several
    (every GeoPackage conversion does — one PMTiles per vector layer, or
    one COG per raster table) is uploaded into the same "source" folder
    the original upload was staged in (see source_object_key), one object
    per file, recorded in `job.output_keys`. `use_folder(job)`, if given,
    forces folder mode even for a single file (e.g. a GeoPackage with
    exactly one selected layer still gets a folder, so the output location
    doesn't depend on how many layers you picked).

    Any layers/tables cng-lite skipped (rather than failing the whole job)
    are recorded on `job.error`, even though the job itself still completes.
    """
    close_old_connections()
    directory = job_directory(kind, job_id)
    try:
        job = CngLiteJob.objects.get(pk=job_id)
        deadline = time.monotonic() + settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT
        update_job(job.id, status="running", progress=10, message="Submitting to CloudNativeGIS")
        s3_client = get_s3_client(job.connection_id, job.owner_id)
        extra_payload = build_extra_payload(job) if build_extra_payload else None
        with httpx.Client(
            base_url=f"{settings.CLOUDNATIVEGIS_URL}/",
            timeout=httpx.Timeout(60, connect=10),
            follow_redirects=False,
        ) as client:
            cng_job_id = submit_job(
                client,
                s3_client,
                job.source_key,
                settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT,
                endpoint,
                extra_payload,
            )
            update_job(job.id, progress=20, message="Waiting for CloudNativeGIS conversion")
            results, layer_errors = wait_for_results(client, job.id, cng_job_id, deadline)

            update_job(job.id, progress=85, message="Downloading converted file(s)")
            folder = bool(use_folder(job)) if use_folder else len(results) > 1
            # "Well-named folder" = wherever the original upload was already
            # staged (sources/<job_id>/...), so each layer lands right next
            # to the file it came from.
            folder_key = str(PurePosixPath(job.source_key).parent) if folder else None

            output_keys = []
            total_size = 0
            for index, item in enumerate(results):
                local_path = directory / f"result-{index}"
                total_size += download_result(client, item["result_url"], local_path, validate_result, invalid_result_message)
                dest_key = f"{folder_key}/{item['name']}" if folder else job.output_key
                with local_path.open("rb") as source:
                    s3_client.client.upload_fileobj(
                        source, job.bucket, dest_key, ExtraArgs={"ContentType": output_content_type}
                    )
                output_keys.append({"name": item["name"], "key": dest_key})

        if folder and output_keys:
            _create_collection(job, output_keys, kind)

        if layer_errors:
            logger.warning("Job %s: %d layer(s)/table(s) skipped: %s", job_id, len(layer_errors), layer_errors)
        error_summary = "; ".join(f"{e['name']}: {e['error']}" for e in layer_errors)
        message = f"{len(output_keys)} files uploaded to S3" if folder else "File uploaded to S3"
        if layer_errors:
            message += f" ({len(layer_errors)} skipped)"

        update_job(
            job.id,
            status="completed",
            progress=100,
            output_size=total_size,
            output_keys=output_keys if folder else None,
            error=error_summary,
            message=message,
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
