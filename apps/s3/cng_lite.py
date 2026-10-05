"""Shared job orchestration for CloudNativeGIS Lite conversions (PMTiles, COG).

Format-specific modules (`pmtiles.py`, `cog.py`) validate/prepare their own
source file, then a CngLiteJob runs through CNGProcessingClient. What differs
per kind - which cng-lite endpoint to submit to, what files each layer gets,
which of a GeoPackage's contents it converts - is each module's Converter
(see converter_for). CloudNativeGIS uploads every result straight to the
bucket (see apps.s3.direct_upload); CloudBench writes the Portolan metadata.
"""

import hashlib
import logging
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from functools import cached_property
from pathlib import Path, PurePosixPath

import httpx
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import close_old_connections
from django.utils import timezone

from . import direct_upload, portolan
from .client import get_s3_client
from .geopackage import is_geopackage
from .models import (
    ACTIVE_CNG_LITE_JOB_STATUSES,
    AWAITING_LAYER_SELECTION,
    CANCELLABLE_CNG_LITE_JOB_STATUSES,
    CngLiteJob,
    CngLiteJobLog,
    CngLiteJobStatus,
    JobCancelled,
    S3Connection,
)

logger = logging.getLogger(__name__)


def _provider_name(user):
    return user.get_username() or user.email or f"CloudBench user {user.pk}"


class TargetExists(Exception):
    """The upload would publish into a folder that already holds data.

    Raised unless the upload was confirmed to replace it (`replace=True`),
    so an upload never silently overwrites an existing layer.
    """

    def __init__(self, folder, is_group):
        super().__init__(folder)
        self.folder = folder
        self.is_group = is_group


def target_folder(key, source_name):
    """The folder an upload publishes into, known before converting anything.

    A shapefile/TIFF becomes one layer folder, a GeoPackage one sub-catalog
    folder of layers - either way named after the uploaded file, beside the
    upload key (see CNGProcessingClient.layers / plan_layers).
    """
    parent = str(PurePosixPath(key).parent)
    parent = "" if parent in ("", ".") else parent
    name = portolan.sanitize_layer_id(PurePosixPath(source_name).stem)
    folder = f"{parent}/{name}" if parent else name
    # Every job's raw upload is kept under "<parent>/sources/"; replacing a
    # layer folder of that name would delete them.
    if name == "sources":
        raise ValueError('"sources" is reserved for uploaded source files; rename the file.')
    return folder


def folder_exists(s3_client, folder):
    return bool(
        s3_client.list_objects(prefix=f"{folder}/", delimiter="", max_keys=1).get("objects")
    )


def check_target(s3_client, key, source_name, replace):
    """Raise TargetExists if the upload's folder holds data and `replace` isn't set."""
    folder = target_folder(key, source_name)
    if not replace and folder_exists(s3_client, folder):
        raise TargetExists(folder, is_group=is_geopackage(source_name))
    return folder


def _staged_geopackage(job):
    """The GeoPackage the upload staged on local disk, if it's still there."""
    for kind in ("pmtiles", "cog"):
        path = job_directory(kind, job.id) / "source.gpkg"
        if path.exists():
            return path
    return None


def _publish_source(job, s3_client, catalog_folder):
    """Move a GeoPackage's original upload into its layer group's folder.

    From where it was staged for conversion ("<parent>/sources/<job>/") to
    "<group>/source/<name>", so it's kept once beside the layers it produced
    and goes with them if the group is deleted. Uploaded from the local copy
    when there is one (hashed on the way, for file:checksum/size), else
    copied within S3. Returns each layer's `source` asset (href relative to
    a layer folder), or None if the move failed - best-effort, like the
    rest of the catalog metadata.
    """
    name = PurePosixPath(job.source_name).name
    dest_key = f"{catalog_folder}/{portolan.SOURCE_FOLDER}/{name}"
    file = None
    try:
        local = _staged_geopackage(job)
        if local:
            digest = hashlib.sha256()
            with local.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            with local.open("rb") as source:
                s3_client.client.upload_fileobj(
                    source,
                    job.bucket,
                    dest_key,
                    ExtraArgs={"ContentType": portolan.GEOPACKAGE_MEDIA_TYPE},
                )
            file = {
                "checksum": portolan.sha256_multihash(digest.digest()),
                "size": local.stat().st_size,
            }
        else:
            s3_client.client.copy(
                {"Bucket": job.bucket, "Key": job.source_key}, job.bucket, dest_key
            )
        if job.source_key and job.source_key != dest_key:
            s3_client.delete_object(job.source_key)
        job.source_key = dest_key
        update_job(job.id, source_key=dest_key)
    except Exception:
        logger.exception("Job %s: couldn't move the GeoPackage into %s", job.id, dest_key)
        return None
    return {
        "filename": f"../{portolan.SOURCE_FOLDER}/{name}",
        "role": "source",
        "media_type": portolan.GEOPACKAGE_MEDIA_TYPE,
        "file": file,
    }


def host_contact_email(connection_id):
    """The Portolan `host` contact: the connection's own, else the server default."""
    try:
        connection = S3Connection.objects.filter(pk=connection_id).first()
    except (ValueError, ValidationError):
        connection = None
    return (connection.contact_email if connection else "") or settings.PORTOLAN_HOST_EMAIL


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


# How long to wait for one conversion: CLOUDNATIVEGIS_CONVERSION_TIMEOUT,
# plus this much per GB uploaded, up to a cap - a big shapefile genuinely
# takes longer to tile than a small one.
CONVERSION_TIMEOUT_PER_GB = 10 * 60
MAX_CONVERSION_TIMEOUT = 6 * 60 * 60


def conversion_timeout(input_size):
    """Seconds to wait for a conversion of `input_size` bytes, scaled to it."""
    base = settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT
    scaled = base + round(CONVERSION_TIMEOUT_PER_GB * input_size / 1024**3)
    return max(base, min(scaled, MAX_CONVERSION_TIMEOUT))


def update_job(job_id, **values):
    """Save `values` on job `job_id` - unless it's being cancelled.

    Raises JobCancelled instead if the user has asked to stop it
    (CANCELLING): whatever runs it stops at its next update, rather than
    carrying on (or overwriting CANCELLING). finish_job is what ends it.
    """
    updated = (
        CngLiteJob.objects.filter(pk=job_id)
        .exclude(status=CngLiteJobStatus.CANCELLING)
        .update(updated_at=timezone.now(), **values)
    )
    if not updated:
        raise_if_cancelling(job_id)


def raise_if_cancelling(job_id):
    """Raise JobCancelled if the user has asked to stop job `job_id`."""
    if CngLiteJob.objects.filter(pk=job_id, status=CngLiteJobStatus.CANCELLING).exists():
        raise JobCancelled(f"Conversion {job_id} was cancelled.")


def finish_job(job, outcome, **values):
    """End `job` as `outcome` (completed/failed/cancelled), saving `values` with it.

    With CLOUDNATIVEGIS_ON_DEMAND it's DEPROVISIONING first - `outcome` and
    `values` saved, so a restart can carry on with just this - while
    GeoHosting deletes its server. A failure to delete it is only logged:
    the job's outcome stands either way. A job failing while it was being
    cancelled ends cancelled. Saved even while CANCELLING (unlike
    update_job): this is what ends it.
    """

    def save(**fields):
        CngLiteJob.objects.filter(pk=job.id).update(updated_at=timezone.now(), **fields)
        for field, value in fields.items():
            setattr(job, field, value)

    if outcome == CngLiteJobStatus.FAILED and (
        CngLiteJob.objects.filter(pk=job.id, status=CngLiteJobStatus.CANCELLING).exists()
    ):
        outcome = CngLiteJobStatus.CANCELLED
        values = {**values, "message": "Conversion cancelled", "error": ""}

    if settings.CLOUDNATIVEGIS_ON_DEMAND:
        save(status=CngLiteJobStatus.DEPROVISIONING, outcome=outcome, **values)
        try:
            job.deprovision()
        except Exception:
            logger.exception("Job %s: couldn't delete its CloudNativeGIS server", job.id)
        values = {}
    save(status=outcome, completed_at=timezone.now(), **values)


def cancel_job(job):
    """Ask `job` to stop: CANCELLING, until whatever runs it stops.

    That's at its next update or poll (JobCancelled), when it's deprovisioned
    and ends CANCELLED (see finish_job). The jobs waiting on it (a
    GeoPackage's raster job, after its vector one) are cancelled with it.
    Only while it's CANCELLABLE: raises ValueError otherwise (e.g. already
    publishing, or finished). A GeoPackage still waiting for its layers to
    be picked has nothing running: see pmtiles.cancel_geopackage_inspection.
    """
    cancelling = {
        "status": CngLiteJobStatus.CANCELLING,
        "message": "Cancelling the conversion",
        "updated_at": timezone.now(),
    }
    cancelled = (
        CngLiteJob.objects.filter(pk=job.pk, status__in=CANCELLABLE_CNG_LITE_JOB_STATUSES)
        .exclude(AWAITING_LAYER_SELECTION)
        .update(**cancelling)
    )
    if not cancelled:
        job.refresh_from_db()
        raise ValueError(f"A {job.get_status_display().lower()} conversion can't be cancelled.")
    CngLiteJob.objects.filter(depends_on=job, status=CngLiteJobStatus.PENDING).update(**cancelling)
    job.refresh_from_db()


def expire_stalled_job(job):
    cutoff = timezone.now() - timedelta(seconds=settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT + 120)
    expired = CngLiteJob.objects.filter(
        pk=job.pk,
        status__in=ACTIVE_CNG_LITE_JOB_STATUSES,
        updated_at__lt=cutoff,
    ).update(
        status=CngLiteJobStatus.FAILED,
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
    return parse_json(response, method, path)


def parse_json(response, method, path):
    """A CloudNativeGIS response's JSON body; ValueError if it isn't JSON."""
    try:
        return response.json()
    except ValueError as exc:
        raise ValueError(
            f"CloudNativeGIS returned a non-JSON response from {method} {path} "
            f"(HTTP {response.status_code}): {response.text[:200]!r}. "
            "Check that CLOUDNATIVEGIS_URL points at CloudNativeGIS Lite."
        ) from exc


def _response_body(response):
    """What to log of a response's body: its JSON, else (some of) its text."""
    try:
        return response.json()
    except Exception:  # noqa: BLE001 - not JSON, or a stream never read
        try:
            return {"text": response.text[:2000]}
        except Exception:  # noqa: BLE001
            return None


def wait_for_job(client, job_id, cng_job_id, deadline):
    """Poll cng-lite until its job finishes, returning the finished job's body.

    For a mosaic (see apps.s3.mosaic.run_mosaic); a conversion polls through
    CNGProcessingClient.poll instead.

    Relays cng-lite's live progress (e.g. "Converting layer 2/5: dashboard",
    40% through) into the job's own message/progress as it goes, so the
    frontend shows real movement across a multi-layer GeoPackage (or a
    mosaic's tiles) instead of sitting at one fixed value.
    """
    while time.monotonic() < deadline:
        body = client.get(f"api/v1/jobs/{cng_job_id}").json()
        if body.get("status") == "failed":
            raise ValueError(
                f"CloudNativeGIS conversion failed: {body.get('detail') or 'Unknown error'}"
            )
        if body.get("status") == "done":
            return body
        raise_if_cancelling(job_id)
        detail = body.get("detail")
        if detail:
            fraction = body.get("detailProgress")
            values = {"message": detail}
            if fraction is not None:
                values["progress"] = 20 + round(60 * fraction)
            update_job(job_id, **values)
        time.sleep(min(settings.CLOUDNATIVEGIS_POLL_INTERVAL, max(0, deadline - time.monotonic())))
    raise TimeoutError("Timed out waiting for CloudNativeGIS to produce the converted file(s).")


class CngJobNotFound(Exception):
    """CloudNativeGIS no longer has the job (or its results).

    It keeps jobs in memory only, for a limited time (LITE_JOB_RESULT_TTL):
    a restart of it, or results not collected in time, loses them.
    """


@dataclass(frozen=True)
class Converter:
    """What differs between conversion kinds (see pmtiles.CONVERTER, cog.CONVERTER)."""

    # cng-lite endpoint the job is submitted to.
    endpoint: str
    # assets_for(layer_id) -> [{role, filename, media_type}]: a layer's files.
    assets_for: Callable
    # pick_layers(inspection) -> [name]: which of a GeoPackage's contents
    # (CloudNativeGIS's /gpkg/layers report) this kind converts.
    pick_layers: Callable
    # payload(job) -> dict: extra fields for the submission, beyond `source`.
    payload: Callable


def plan_layers(job, names, assets_for):
    """Decide each layer's folder name and file names before converting anything.

    `names` are the layers to convert as CloudNativeGIS knows them - a
    GeoPackage's layers or raster tables - or [None] for a single-layer
    source, titled after the uploaded file. Returns [{'name', 'layer_id',
    'title', 'assets'}], so each file's final key is known up front, to hand
    CloudNativeGIS an upload URL for it. The same job always plans the same.
    """
    taken = set()
    layers = []
    for name in names:
        title_stem = name if name is not None else PurePosixPath(job.source_name).stem
        layer_id = portolan.unique_layer_id(portolan.sanitize_layer_id(title_stem), taken)
        layers.append(
            {
                "name": name,
                "layer_id": layer_id,
                "title": portolan.prettify(title_stem),
                "assets": assets_for(layer_id),
            }
        )
    return layers


def converter_for(kind):
    # pmtiles/cog/copc import this module, so they're only imported when needed.
    from . import cog, copc, pmtiles  # noqa: PLC0415

    return {
        pmtiles.KIND: pmtiles.CONVERTER,
        cog.KIND: cog.CONVERTER,
        copc.KIND: copc.CONVERTER,
    }[kind]


class CNGProcessingClient:
    """Runs one CngLiteJob through CloudNativeGIS, one step per status.

        provision  pending/provisioning -> pushing
        push       pushing              -> polling (cng_job_id)
        poll       polling              -> verifying (cng_results/cng_errors)
        verify     verifying            -> publishing
        publish    publishing           -> (deprovisioning ->) completed
        fail       any                  -> (deprovisioning ->) failed
        cancel     cancelling           -> (deprovisioning ->) cancelled

    Deprovisioning - only with CLOUDNATIVEGIS_ON_DEMAND - deletes the job's
    server, whether it completed, failed or was cancelled (see finish_job).
    A job the user cancels (see cancel_job) stops at its next update or
    poll (JobCancelled).

    Each step reads what it needs from the job and writes its outcome back to
    it, so run() carries on from whichever step the job's status says it's at
    - e.g. a job left "polling" resumes polling its cng_job_id. Each step also
    keeps the job's progress/message current for the frontend.

    CloudNativeGIS uploads every result straight to the bucket, through a
    presigned URL per file (see apps.s3.direct_upload): push plans each
    layer's folder and files up front (plan_layers, the job kind's Converter
    naming them), verify checks what arrived, and publish writes each
    layer's Portolan entry - collection.json/README.md/AGENTS.md/default
    style (see apps.s3.portolan) - in its own folder under wherever
    `job.output_key` pointed ("{parent}/{layer_id}/"). A GeoPackage's layers
    sit in its sub-catalog, its layer group (see apps.s3.layer_groups).
    """

    def __init__(self, job):
        self.job = job
        self.converter = converter_for(job.kind)
        self._http = None
        # Whether this run has checked the uploaded results yet: a job
        # resumed at "publishing" checks them again first.
        self._verified = False

    # -- Entry point ---------------------------------------------------------

    def run(self):
        """Run the job's remaining steps, ending it completed or failed."""
        close_old_connections()
        steps = [self.provision, self.push, self.poll_until_done, self.verify, self.publish]
        start = {
            CngLiteJobStatus.PENDING: 0,
            CngLiteJobStatus.PROVISIONING: 0,
            CngLiteJobStatus.PUSHING: 1,
            CngLiteJobStatus.POLLING: 2,
            CngLiteJobStatus.VERIFYING: 3,
            # Re-checks the uploaded files.
            CngLiteJobStatus.PUBLISHING: 3,
        }
        if self.job.status in (CngLiteJobStatus.DEPROVISIONING, CngLiteJobStatus.CANCELLING):
            # Interrupted once finished, or cancelled before it got to run
            # (e.g. waiting for the job it depends on): only its server's
            # left to delete.
            if self.job.status == CngLiteJobStatus.CANCELLING:
                outcome, values = CngLiteJobStatus.CANCELLED, {"message": "Conversion cancelled"}
            else:
                outcome, values = self.job.outcome or CngLiteJobStatus.FAILED, {}
            try:
                self.finish(outcome, **values)
            finally:
                close_old_connections()
            return
        try:
            if self.job.status not in start:
                raise ValueError(f"Can't run a conversion that is {self.job.status}.")
            index = start[self.job.status]
            if index > 0:
                # Resumed past provisioning (e.g. after a restart), when its
                # CloudNativeGIS may itself still be coming back up.
                self.job.wait_until_healthy()
            resubmitted = False
            while index < len(steps):
                try:
                    steps[index]()
                except CngJobNotFound:
                    # Its source is still in S3: submit it again, once.
                    if resubmitted:
                        raise
                    resubmitted = True
                    logger.warning(
                        "Job %s: CloudNativeGIS lost job %s, resubmitting",
                        self.job.id,
                        self.job.cng_job_id,
                    )
                    index = steps.index(self.push)
                    continue
                index += 1
        except JobCancelled:
            logger.info("CloudNativeGIS conversion %s cancelled", self.job.id)
            self._discard_uploads()
            self.finish(CngLiteJobStatus.CANCELLED, message="Conversion cancelled")
        except Exception as exc:
            logger.exception("CloudNativeGIS conversion %s failed", self.job.id)
            self.fail(exc)
        finally:
            if self._http is not None:
                self._http.close()
            close_old_connections()

    # -- Steps -----------------------------------------------------------------

    def provision(self):
        """Get the CloudNativeGIS service to run on (see CngLiteJob.provision)."""
        self.update(
            status=CngLiteJobStatus.PROVISIONING,
            progress=5,
            message="Preparing CloudNativeGIS",
        )
        self.job.provision()

    def push(self):
        """Submit the job, with a presigned URL to read its source and one per result.

        Presigned URLs let cng-lite fetch the source and upload each result
        straight to its final key with plain HTTPS, using the credentials of
        whichever S3 connection the user picked, without cng-lite ever
        holding S3 credentials of its own. Each upload URL accepts only its
        file's content type, and lasts only as long as the job is waited for.
        """
        self.update(
            status=CngLiteJobStatus.PUSHING,
            progress=10,
            message="Sending the file to CloudNativeGIS",
        )
        timeout = conversion_timeout(self.job.input_size)
        source_url = self.s3_client.generate_presigned_url(self.job.source_key, expiration=timeout)
        expiry = timeout + direct_upload.URL_MARGIN
        uploads = [
            {
                **({"layer": layer["name"]} if layer["name"] is not None else {}),
                "files": {
                    asset["role"]: {
                        "url": direct_upload.presign_put(
                            self.s3_client,
                            f"{layer['folder']}/{asset['filename']}",
                            expiry,
                            asset["media_type"],
                        ),
                        "content_type": asset["media_type"],
                    }
                    for asset in layer["assets"]
                },
            }
            for layer in self.layers(names=self._layer_names())
        ]
        payload = {"source": source_url, **self.converter.payload(self.job), "uploads": uploads}
        endpoint = self.converter.endpoint
        started = time.monotonic()
        try:
            response = self.http.request("POST", endpoint, json=payload)
        except httpx.HTTPError as exc:
            self._log("POST", endpoint, started, request_payload=payload, error=exc)
            raise
        # The presigned URLs' credentials are redacted (see CngLiteJobLog.redact).
        self._log("POST", endpoint, started, request_payload=payload, response=response)
        response.raise_for_status()
        submission = parse_json(response, "POST", endpoint)
        self._verified = False
        self.update(
            status=CngLiteJobStatus.POLLING,
            cng_job_id=submission["job_id"],
            cng_results=None,
            cng_errors=None,
            # CloudNativeGIS's own progress (e.g. "Generating vector tiles
            # (PMTiles): 45% · GeoParquet ready", then "Uploading the
            # results (2 of 3)") is relayed from here, as 20-80%;
            # CloudBench's steps after it take the rest.
            progress=20,
            message="Waiting for CloudNativeGIS to start",
        )

    def poll_until_done(self):
        """poll() every CLOUDNATIVEGIS_POLL_INTERVAL until done, or time out.

        The timeout scales with the upload's size (see conversion_timeout).
        """
        deadline = time.monotonic() + conversion_timeout(self.job.input_size)
        while time.monotonic() < deadline:
            if self.poll():
                return
            raise_if_cancelling(self.job.id)
            time.sleep(
                min(settings.CLOUDNATIVEGIS_POLL_INTERVAL, max(0, deadline - time.monotonic()))
            )
        raise TimeoutError("Timed out waiting for CloudNativeGIS to produce the converted file(s).")

    def poll(self):
        """Check on the conversion once; True once done (and its results saved).

        The results are what CloudNativeGIS uploaded, per layer - [{layer,
        files: {role: {size, sha256, info}}}] (a GeoPackage conversion has a
        layer per vector layer or raster table; anything else exactly one) -
        plus any layers/tables cng-lite skipped rather than failing the job.
        Until done, relays cng-lite's live per-layer progress (e.g.
        "Converting layer 2/5: dashboard", 40% through) into the job's
        message/progress, so a multi-layer GeoPackage shows real movement.
        """
        path = f"api/v1/jobs/{self.job.cng_job_id}"
        started = time.monotonic()
        try:
            response = self.http.get(path)
        except httpx.HTTPError as exc:
            self._log("GET", path, started, error=exc)
            raise
        if response.status_code == 404:
            error = f"CloudNativeGIS has no job {self.job.cng_job_id}."
            self._log("GET", path, started, response=response, error=error)
            raise CngJobNotFound(error)
        try:
            body = parse_json(response, "GET", path)
        except ValueError as exc:
            self._log("GET", path, started, response=response, error=exc)
            raise
        # Only what changes something is logged - not every "still at it".
        if body.get("status") in ("done", "failed"):
            self._log("GET", path, started, response=response)
        if body.get("status") == "failed":
            raise ValueError(
                f"CloudNativeGIS conversion failed: {body.get('detail') or 'Unknown error'}"
            )
        if body.get("status") == "done":
            if "outputs" not in body:
                raise ValueError(
                    "CloudNativeGIS didn't upload the results itself: it needs updating "
                    "to a version that does."
                )
            uploaded = body["outputs"].get("layers") or []
            if not uploaded:
                raise ValueError("CloudNativeGIS uploaded no results.")
            self.update(
                status=CngLiteJobStatus.VERIFYING,
                cng_results=uploaded,
                cng_errors=body.get("errors") or [],
                progress=82,
                message="Checking the uploaded files",
            )
            return True
        detail = body.get("detail")
        if detail:
            fraction = body.get("detailProgress")
            values = {"message": detail}
            if fraction is not None:
                values["progress"] = 20 + round(60 * fraction)
            self.update(**values)
        return False

    def verify(self):
        """Check what CloudNativeGIS uploaded is in the bucket as it reported.

        Its word isn't taken for it (see direct_upload.verify_uploads): a
        mismatch fails the job, and a new layer's half-written folder is
        removed. A replaced one's is left as it is, to look into.
        """
        if self.job.status != CngLiteJobStatus.VERIFYING:
            self.update(
                status=CngLiteJobStatus.VERIFYING,
                progress=82,
                message="Checking the uploaded files",
            )
        layers = self.uploaded_layers()
        expected = [
            (f"{layer['folder']}/{asset['filename']}", asset["output"]["size"], asset["media_type"])
            for layer in layers
            for asset in layer["assets"]
        ]
        try:
            direct_upload.verify_uploads(self.s3_client, expected)
        except ValueError:
            if not self.job.replace_existing:
                for layer in layers:
                    self.s3_client.delete_prefix(f"{layer['folder']}/")
            raise
        self._verified = True

    def publish(self):
        """Publish each uploaded layer as its own Portolan layer, then complete the job."""
        if not self._verified:
            self.verify()
        job = self.job
        self.update(
            status=CngLiteJobStatus.PUBLISHING,
            progress=86,
            message="Publishing to the catalog",
        )
        layers = self.uploaded_layers()
        catalog_folder, catalog_title = self.catalog()
        # A GeoPackage's original is kept once in its group folder and
        # listed as each of its layers' `source` asset.
        source_asset = None
        if catalog_folder:
            self.update(message="Keeping the original GeoPackage")
            source_asset = _publish_source(job, self.s3_client, catalog_folder)
        written = {
            f"{layer['folder']}/{asset['filename']}"
            for layer in layers
            for asset in layer["assets"]
        }
        if job.replace_existing:
            # The new files are already on their final keys: once they're
            # up, whatever else the replaced layer (or group) had goes.
            self.update(progress=88, message="Removing the replaced layer's old files")
            keep = written | ({job.source_key} if source_asset else set())
            direct_upload.delete_leftovers(
                self.s3_client, target_folder(job.output_key, job.source_name), keep
            )
        provider_name = _provider_name(self.owner)
        host_email = host_contact_email(job.connection_id)

        output_keys = []
        output_size = 0
        for index, layer in enumerate(layers):
            data_assets = []
            info = None
            table_info = None
            for asset in layer["assets"]:
                output = asset["output"]
                output_size += output["size"]
                output_keys.append(
                    {"name": asset["filename"], "key": f"{layer['folder']}/{asset['filename']}"}
                )
                data_assets.append(
                    {
                        "filename": asset["filename"],
                        "role": asset["role"],
                        "media_type": asset["media_type"],
                        "file": direct_upload.file_fields(output),
                    }
                )
                # A GeoParquet's info is its schema (and a bbox in its own
                # CRS); the WGS84 bbox/zoom/layer names always come from the
                # PMTiles or COG.
                if asset["media_type"] == portolan.PARQUET_MEDIA_TYPE:
                    table_info = output.get("info")
                elif asset["role"] != "thumbnail" and info is None:
                    info = output.get("info")

            self.update(
                progress=90 + round(7 * index / len(layers)),
                message=f"Writing the catalog entry: {layer['title']}",
            )
            portolan.finalize_layer(
                self.s3_client,
                folder=layer["folder"],
                layer_id=layer["layer_id"],
                title=layer["title"],
                kind=job.kind,
                data_assets=[*data_assets, source_asset] if source_asset else data_assets,
                license_id=job.license,
                license_url=job.license_url,
                provider_name=provider_name,
                source_name=job.source_name,
                info=info,
                table_info=table_info,
                host_name=settings.PORTOLAN_HOST_NAME,
                host_email=host_email,
                catalog_folder=catalog_folder,
                catalog_title=catalog_title,
                catalog_description=(
                    f"Layers from {job.source_name}, uploaded via CloudBench."
                    if catalog_folder
                    else ""
                ),
            )
        self.complete(layers, output_keys, output_size)

    def complete(self, layers, output_keys, output_size):
        """Mark the job completed, recording any layers/tables cng-lite skipped.

        Those are recorded on `job.error`, even though the job itself
        completes.
        """
        layer_errors = self.job.cng_errors or []
        if layer_errors:
            logger.warning(
                "Job %s: %d layer(s)/table(s) skipped: %s",
                self.job.id,
                len(layer_errors),
                layer_errors,
            )
        message = f"Published {len(layers)} layer{'s' if len(layers) != 1 else ''} to the catalog"
        if layer_errors:
            message += f" ({len(layer_errors)} skipped)"
        self.finish(
            CngLiteJobStatus.COMPLETED,
            progress=100,
            output_size=output_size,
            output_keys=output_keys,
            error="; ".join(f"{e['name']}: {e['error']}" for e in layer_errors),
            message=message,
        )

    def fail(self, exc):
        """Mark the job failed with a readable version of `exc`."""
        error = str(exc)
        if isinstance(exc, httpx.HTTPStatusError):
            error = f"CloudNativeGIS returned HTTP {exc.response.status_code}. Check its logs."
        elif isinstance(exc, httpx.RequestError):
            error = "Could not contact CloudNativeGIS. Check the service URL and connectivity."
        self.finish(
            CngLiteJobStatus.FAILED,
            message="CloudNativeGIS conversion failed",
            error=error,
        )

    def finish(self, outcome, **values):
        """End the job as `outcome`, deleting its server first (see finish_job)."""
        # Its files aren't needed any more, whatever happens to its server.
        self._clean_up()
        finish_job(self.job, outcome, **values)

    # -- Shared resources ------------------------------------------------------

    @cached_property
    def owner(self):
        return self.job.owner

    @cached_property
    def s3_client(self):
        if self.job.connection_id is None:
            raise ValueError("The S3 connection this conversion was uploading to has been deleted.")
        return get_s3_client(self.job.connection_id, self.owner)

    @property
    def http(self):
        """Client for the job's CloudNativeGIS (set by provision())."""
        if self._http is None:
            self._http = httpx.Client(
                base_url=f"{self.job.cloudnativegis_url}/",
                timeout=httpx.Timeout(60, connect=10),
                follow_redirects=False,
                headers=self.job.cloudnativegis_headers(),
            )
        return self._http

    @property
    def directory(self):
        return job_directory(self.job.kind, self.job.id)

    def _log(self, method, path, started, *, request_payload=None, response=None, error=None):
        """Log a request to the job's CloudNativeGIS (see CngLiteJobLog)."""
        CngLiteJobLog.record(
            self.job,
            target=CngLiteJobLog.Target.CLOUDNATIVEGIS,
            method=method,
            url=f"{self.job.cloudnativegis_url}/{path.lstrip('/')}",
            request_payload=request_payload,
            status_code=response.status_code if response is not None else None,
            response_payload=_response_body(response) if response is not None else None,
            error=str(error) if error else "",
            duration_ms=(time.monotonic() - started) * 1000,
        )

    def update(self, **values):
        """Save `values` on the job, in the database and on self.job."""
        update_job(self.job.id, **values)
        for field, value in values.items():
            setattr(self.job, field, value)

    def catalog(self):
        """(folder, title) of a GeoPackage's sub-catalog; ("", "") otherwise."""
        if not is_geopackage(self.job.source_name):
            return "", ""
        parent = str(PurePosixPath(self.job.output_key).parent)
        parent = "" if parent in ("", ".") else parent
        stem = PurePosixPath(self.job.source_name).stem
        gpkg_id = portolan.sanitize_layer_id(stem)
        return (f"{parent}/{gpkg_id}" if parent else gpkg_id), portolan.prettify(stem)

    def layers(self, names=None):
        """The job's planned layers (see plan_layers), each with its `folder`.

        `names` defaults to the ones it was submitted with: [None] for a
        single-layer source, else the GeoPackage's chosen `layers`.
        """
        if names is None:
            names = list(self.job.layers) if is_geopackage(self.job.source_name) else [None]
        catalog_folder, _title = self.catalog()
        base = catalog_folder or str(PurePosixPath(self.job.output_key).parent)
        base = "" if base in ("", ".") else base
        layers = plan_layers(self.job, names, self.converter.assets_for)
        for layer in layers:
            layer["folder"] = f"{base}/{layer['layer_id']}" if base else layer["layer_id"]
        return layers

    def uploaded_layers(self):
        """The planned layers CloudNativeGIS uploaded, each asset with its `output`.

        A layer it skipped has no outputs and is left out; so is a file it
        didn't make (e.g. a thumbnail that didn't render).
        """
        uploaded = {entry.get("layer"): entry["files"] for entry in self.job.cng_results or []}
        layers = []
        for layer in self.layers():
            files = uploaded.get(layer["name"])
            if files is None:
                continue
            layer["assets"] = [
                {**asset, "output": files[asset["role"]]}
                for asset in layer["assets"]
                if asset["role"] in files
            ]
            layers.append(layer)
        if not layers:
            raise ValueError("CloudNativeGIS uploaded no results.")
        return layers

    def _layer_names(self):
        """The layers to convert: [None] for one-layer sources, else the GeoPackage's.

        A GeoPackage whose layers weren't picked (uploaded straight to convert)
        is asked what it holds - and what of it this kind converts - so every
        layer's files can be planned.
        """
        if not is_geopackage(self.job.source_name):
            return [None]
        if self.job.layers is None:
            url = self.s3_client.generate_presigned_url(self.job.source_key, expiration=300)
            inspection = request_json(self.http, "POST", "api/v1/gpkg/layers", json={"source": url})
            self.update(layers=self.converter.pick_layers(inspection))
        if not self.job.layers:
            raise ValueError("The GeoPackage has nothing of this kind to convert.")
        return list(self.job.layers)

    def _discard_uploads(self):
        """Remove what CloudNativeGIS may have uploaded already, for a cancelled job.

        Only once it was submitted (it uploads straight to each layer's
        folder), and only a new layer's folder - empty before, as verify
        leaves it on a mismatch; a replaced one's is left as it is.
        """
        if not self.job.cng_job_id or self.job.replace_existing:
            return
        try:
            for layer in self.layers():
                self.s3_client.delete_prefix(f"{layer['folder']}/")
        except Exception:  # noqa: BLE001 - it's cancelled either way
            logger.exception("Job %s: couldn't remove its partial uploads", self.job.id)

    def _clean_up(self):
        # Only once the job's finished: until then a resumed job still needs
        # what's in there (staged source, downloaded results).
        shutil.rmtree(self.directory, ignore_errors=True)


def run_conversion(job_id):
    """Run conversion job `job_id` (see CNGProcessingClient)."""
    close_old_connections()
    try:
        job = CngLiteJob.objects.get(pk=job_id)
    except CngLiteJob.DoesNotExist:
        logger.warning("CloudNativeGIS conversion %s no longer exists", job_id)
        return
    CNGProcessingClient(job).run()


def _is_resumable(job):
    """Whether CNGProcessingClient can carry `job` on (it has a Converter)."""
    try:
        converter_for(job.kind)
    except KeyError:
        return False
    return True


def resume_interrupted_conversions():
    """Run every conversion a restart left unfinished, oldest first; returns how many.

    Only for when nothing else is running conversions - e.g. at startup,
    before the server takes requests (see the resume_conversions command) -
    as any job still active then must have been interrupted. Each carries on
    from the step its status says it got to. GeoPackages still waiting for
    their layers to be picked are left alone; a job that depends on another
    runs after it, from wherever that one moved their source to. A kind that
    can't be resumed (a mosaic) is failed instead. A job left deprovisioning,
    any kind, has its server deleted and ends as it was going to.
    """
    jobs = list(
        CngLiteJob.objects.filter(status__in=ACTIVE_CNG_LITE_JOB_STATUSES)
        .exclude(AWAITING_LAYER_SELECTION)
        .order_by("created_at")
    )
    for job in jobs:
        if job.status == CngLiteJobStatus.DEPROVISIONING:
            # Finished - a mosaic too - but its server is still to be deleted.
            logger.info("Resuming deleting the server of %s %s", job.kind, job.id)
            finish_job(job, job.outcome or CngLiteJobStatus.FAILED)
            continue
        if job.status == CngLiteJobStatus.CANCELLING:
            # Cancelled - a mosaic too - but not stopped before the restart.
            logger.info("Finishing cancelling %s %s", job.kind, job.id)
            shutil.rmtree(job_directory(job.kind, job.id), ignore_errors=True)
            finish_job(job, CngLiteJobStatus.CANCELLED, message="Conversion cancelled")
            continue
        if not _is_resumable(job):
            # A mosaic runs in one go (see apps.s3.mosaic.run_mosaic): its
            # tiles were staged only locally, so it can't pick up again.
            logger.info("Can't resume %s %s; failing it", job.kind, job.id)
            shutil.rmtree(job_directory(job.kind, job.id), ignore_errors=True)
            finish_job(
                job,
                CngLiteJobStatus.FAILED,
                message="CloudNativeGIS conversion interrupted",
                error="The conversion was interrupted by a restart. Please retry the upload.",
            )
            continue
        logger.info("Resuming CloudNativeGIS conversion %s (%s)", job.id, job.status)
        if job.depends_on_id and job.status == CngLiteJobStatus.PENDING:
            # Created after the job it depends on, so that one has run by now.
            dependency = CngLiteJob.objects.filter(pk=job.depends_on_id).first()
            if dependency is not None:
                job.source_key = dependency.source_key
                job.save(update_fields=["source_key", "updated_at"])
        CNGProcessingClient(job).run()
    return len(jobs)
