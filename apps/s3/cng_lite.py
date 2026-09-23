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
from django.contrib.auth import get_user_model
from django.db import close_old_connections
from django.utils import timezone

from . import portolan
from .client import get_s3_client
from .models import CngLiteJob, LayerCollection, LayerCollectionItem

logger = logging.getLogger(__name__)


def _provider_name(owner_id):
    try:
        user = get_user_model().objects.filter(pk=owner_id).first()
        if user:
            return user.get_username() or user.email or f"CloudBench user {owner_id}"
    except Exception:
        pass
    return f"CloudBench user {owner_id}"


def _create_collection(job, items):
    """Groups a job's published layers into a LayerCollection for Map Explorer.

    `items` is [{'name', 'key'}, ...] — one per logical layer, already
    pointing at its Portolan-published data file. Best-effort: a failure
    here shouldn't undo the conversion that already succeeded and already
    landed in S3.
    """
    if not items:
        return
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
                name=item["name"],
                key=item["key"],
                format=job.kind,
            )
            for item in items
        ])
    except Exception:
        logger.exception("Job %s: failed to create a layer collection (files were still uploaded)", job.id)


def cng_lite_headers():
    """Auth header for every request to CloudNativeGIS Lite, if a token is configured."""
    if not settings.CLOUDNATIVEGIS_API_TOKEN:
        return {}
    return {"Authorization": f"Bearer {settings.CLOUDNATIVEGIS_API_TOKEN}"}


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
    group_results,
    build_extra_payload=None,
):
    """Run a conversion job, then publish each result as its own Portolan layer.

    `group_results(job, results)` (provided by pmtiles.py/cog.py) groups
    cng-lite's raw output files into logical layers — one PMTiles file is
    one layer; a COG's original-CRS file and its "_3857" companion (see
    tiff_to_cog.py) are the same layer's two assets. Each logical layer
    gets its own folder under wherever `job.output_key` pointed
    ("{parent}/{layer_id}/"), holding its data file(s) plus a generated
    collection.json/README.md/AGENTS.md/default style (see
    apps.s3.portolan) instead of landing as a bare object.

    Any layers/tables cng-lite skipped (rather than failing the whole job)
    are recorded on `job.error`, even though the job itself still completes.
    """
    close_old_connections()
    directory = job_directory(kind, job_id)
    # Usually already created by the staging step (start_conversion/
    # inspect_geopackage) under this same `kind`. A GeoPackage that turns
    # out to hold only raster tables gets reassigned from pmtiles to cog
    # after inspection (see cog.start_geopackage_conversion) — staged
    # under "pmtiles", converted under "cog" — so this can't assume it
    # exists yet.
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
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
            headers=cng_lite_headers(),
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

            update_job(job.id, progress=70, message="Downloading converted file(s)")
            local_paths = {}
            total_size = 0
            for index, item in enumerate(results):
                local_path = directory / f"result-{index}"
                total_size += download_result(client, item["result_url"], local_path, validate_result, invalid_result_message)
                local_paths[item["name"]] = local_path

            update_job(job.id, progress=85, message="Publishing to catalog")
            layers = group_results(job, results)
            base_prefix = str(PurePosixPath(job.output_key).parent)
            base_prefix = "" if base_prefix in ("", ".") else base_prefix
            provider_name = _provider_name(job.owner_id)

            collection_items = []
            output_keys = []
            for layer in layers:
                folder = f"{base_prefix}/{layer['layer_id']}" if base_prefix else layer["layer_id"]
                data_assets = []
                dest_keys = {}
                info = None
                for asset in layer["assets"]:
                    local_path = local_paths[asset["item"]["name"]]
                    dest_key = f"{folder}/{asset['filename']}"
                    with local_path.open("rb") as source:
                        s3_client.client.upload_fileobj(
                            source, job.bucket, dest_key, ExtraArgs={"ContentType": output_content_type}
                        )
                    output_keys.append({"name": asset["filename"], "key": dest_key})
                    data_assets.append({"filename": asset["filename"], "role": asset["role"]})
                    dest_keys[asset["role"]] = dest_key
                    if info is None:
                        info = asset["item"].get("info")

                portolan.finalize_layer(
                    s3_client,
                    folder=folder,
                    layer_id=layer["layer_id"],
                    title=layer["title"],
                    kind=kind,
                    data_assets=data_assets,
                    license_id=job.license,
                    provider_name=provider_name,
                    source_name=job.source_name,
                    info=info,
                )
                # The "visual" (renderable) asset is what Map Explorer opens —
                # a plain PMTiles layer has only that; a COG layer's other
                # asset is its original-CRS file, kept for download/GIS use.
                primary_key = dest_keys.get("visual") or dest_keys.get("data")
                collection_items.append({"name": layer["title"], "key": primary_key})

        _create_collection(job, collection_items)

        if layer_errors:
            logger.warning("Job %s: %d layer(s)/table(s) skipped: %s", job_id, len(layer_errors), layer_errors)
        error_summary = "; ".join(f"{e['name']}: {e['error']}" for e in layer_errors)
        message = f"Published {len(layers)} layer{'s' if len(layers) != 1 else ''} to the catalog"
        if layer_errors:
            message += f" ({len(layer_errors)} skipped)"

        update_job(
            job.id,
            status="completed",
            progress=100,
            output_size=total_size,
            output_keys=output_keys,
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
