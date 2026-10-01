"""Persistent status of CloudNativeGIS-to-S3 conversion jobs."""

import logging
import time
import uuid

import httpx
from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.fields import EncryptedCharField
from apps.core.geohosting import GeoHostingClient, GeoHostingError

from .s3_connection import S3Connection

logger = logging.getLogger(__name__)

# Source/target labels per job kind, used only for API responses.
CONVERSION_FORMATS = {
    "pmtiles": {"sourceFormat": "shapefile", "targetFormat": "pmtiles"},
    "cog": {"sourceFormat": "tiff", "targetFormat": "cog"},
    "mosaic": {"sourceFormat": "tiff", "targetFormat": "mosaic"},
}


def _is_healthy(url):
    """Whether the CloudNativeGIS service at `url` answers its /health check."""
    url = url.rstrip("/")
    if not url:
        return False
    try:
        response = httpx.get(f"{url}/health", timeout=2.0, follow_redirects=False)
    except (httpx.HTTPError, httpx.InvalidURL):
        return False
    return response.status_code == 200


class CngLiteJobStatus(models.TextChoices):
    # Not started yet: just created (thread about to start), a GeoPackage
    # waiting for its layers to be picked (`layers` null), or a GeoPackage's
    # raster job waiting for its vector job (see geopackage_convert).
    PENDING = "pending", "Pending"
    # Getting the CloudNativeGIS service the job will run on - its
    # cloudnativegis_url/cloudnativegis_api_token (CLOUDNATIVEGIS_ON_DEMAND).
    PROVISIONING = "provisioning", "Provisioning"
    # Submitting the job to CloudNativeGIS; `cng_job_id` not known yet.
    PUSHING = "pushing", "Pushing"
    # Submitted (`cng_job_id` set): polling CloudNativeGIS until it's converted.
    POLLING = "polling", "Polling"
    # Downloading CloudNativeGIS' result files.
    DOWNLOADING = "downloading", "Downloading"
    # Uploading the results to S3 and writing their Portolan catalog entries.
    PUBLISHING = "publishing", "Publishing"
    # No longer set (split into PUSHING..PUBLISHING); kept for jobs saved
    # before, which still count as active until they finish or stall.
    RUNNING = "running", "Running"
    # Finished (`outcome` says how): having GeoHosting delete the job's
    # on-demand server before it's marked completed/failed.
    DEPROVISIONING = "deprovisioning", "Deprovisioning"
    # Published; a non-empty `error` lists layers CloudNativeGIS skipped.
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"


# Not finished yet: listed as in progress, and checked for having stalled.
ACTIVE_CNG_LITE_JOB_STATUSES = (
    CngLiteJobStatus.PENDING,
    CngLiteJobStatus.PROVISIONING,
    CngLiteJobStatus.PUSHING,
    CngLiteJobStatus.POLLING,
    CngLiteJobStatus.DOWNLOADING,
    CngLiteJobStatus.PUBLISHING,
    CngLiteJobStatus.RUNNING,
    CngLiteJobStatus.DEPROVISIONING,
)

# A GeoPackage still waiting for the user to pick its layers (see
# apps.s3.pmtiles.inspect_geopackage): pending, but not ready to run.
AWAITING_LAYER_SELECTION = Q(
    status=CngLiteJobStatus.PENDING, layers__isnull=True, source_name__iendswith=".gpkg"
)


class CngLiteJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, default="pmtiles")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cng_lite_jobs"
    )
    # The bucket the upload's source and results go to. Null once that
    # connection is deleted: the job's history stays, but it can't run anymore.
    connection = models.ForeignKey(
        S3Connection, null=True, on_delete=models.SET_NULL, related_name="cng_lite_jobs"
    )
    bucket = models.CharField(max_length=255)
    source_name = models.CharField(max_length=255)
    source_key = models.TextField(blank=True)
    output_key = models.TextField()
    input_size = models.BigIntegerField()
    # GeoPackage -> pmtiles only: which layers to include, chosen after
    # inspecting the file (see apps.s3.pmtiles.inspect_geopackage). Null for
    # jobs that don't go through the inspect/pick flow (shapefiles, TIFFs).
    layers = models.JSONField(null=True, blank=True)
    # SPDX id (or "other") the user picked at upload time, carried through
    # to the generated Portolan collection.json — see apps.s3.portolan.
    license = models.CharField(max_length=100, default="other", blank=True)
    # Where an "other" license's terms live, written as the collection's
    # rel=license link (blank: a generated LICENSE.md says they're unknown).
    license_url = models.URLField(max_length=2000, blank=True, default="")
    # The upload was confirmed to replace an existing layer (or GeoPackage
    # layer group) folder: it's cleared before the new files are published.
    replace_existing = models.BooleanField(default=False)
    # A job that only runs once this one has finished - a GeoPackage's raster
    # tables after its vector layers, from wherever publishing those moved the
    # source to (see apps.s3.geopackage_convert).
    depends_on = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="dependents"
    )
    # The CloudNativeGIS service this job's conversion runs on, and its bearer
    # token (encrypted at rest) - for CLOUDNATIVEGIS_ON_DEMAND, where each job
    # gets its own instead of the fixed CLOUDNATIVEGIS_URL/API_TOKEN.
    cloudnativegis_url = models.URLField(max_length=2000, blank=True, default="")
    cloudnativegis_api_token = EncryptedCharField(blank=True, default="")
    # The job's id on the CloudNativeGIS side, set once it has been submitted
    # there (see apps.s3.cng_lite.CNGProcessingClient.push) - what its status is polled
    # and its results downloaded by.
    cng_job_id = models.CharField(max_length=64, blank=True, default="")
    # CloudNativeGIS' result files once it's done - [{name, result_url, info?}]
    # - each completed with {file, size, checksum} once downloaded to the job's
    # directory (see apps.s3.cng_lite.CNGProcessingClient.download), and the
    # layers/tables it skipped - [{name, error}].
    cng_results = models.JSONField(null=True, blank=True)
    cng_errors = models.JSONField(null=True, blank=True)
    # Set when a job produces more than one output file (every GeoPackage
    # job does: one PMTiles per vector layer, or one COG per raster table).
    # `output_key` then becomes the folder they were all stored under,
    # rather than a single object key — see apps.s3.cng_lite.CNGProcessingClient.publish.
    output_keys = models.JSONField(null=True, blank=True)
    output_size = models.BigIntegerField(default=0)
    status = models.CharField(
        max_length=20, choices=CngLiteJobStatus.choices, default=CngLiteJobStatus.PENDING
    )
    # While DEPROVISIONING: the status (completed/failed) it ends with once
    # its server is deleted (see apps.s3.cng_lite.finish_job).
    outcome = models.CharField(
        max_length=20, choices=CngLiteJobStatus.choices, blank=True, default=""
    )
    progress = models.PositiveSmallIntegerField(default=0)
    message = models.TextField(default="Waiting to upload to CloudNativeGIS")
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    @staticmethod
    def is_valid():
        """Whether CloudNativeGIS is configured, so conversions can be started.

        Without CLOUDNATIVEGIS_ON_DEMAND that's just CLOUDNATIVEGIS_URL being
        set; with it, GeoHosting - which starts the servers - being configured.
        """
        if settings.CLOUDNATIVEGIS_ON_DEMAND:
            return GeoHostingClient.is_configured()
        return bool(settings.CLOUDNATIVEGIS_URL)

    @staticmethod
    def health():
        """Whether CloudNativeGIS can take conversions.

        Without CLOUDNATIVEGIS_ON_DEMAND: whether the service at
        CLOUDNATIVEGIS_URL answers its /health check. With it: whether
        GeoHosting, which starts its servers, can (it reaches the Hetzner
        Cloud API, and has a snapshot to start them from).
        """
        if not settings.CLOUDNATIVEGIS_ON_DEMAND:
            return _is_healthy(settings.CLOUDNATIVEGIS_URL)
        if not GeoHostingClient.is_configured():
            return False
        try:
            response = GeoHostingClient().cloudnative_gis_processing_health()
        except GeoHostingError as exc:
            logger.warning("GeoHosting's CloudNativeGIS health check failed: %s", exc)
            return False
        if not response.get("healthy"):
            logger.warning(
                "GeoHosting can't start CloudNativeGIS servers: %s", response.get("detail")
            )
        return response.get("healthy") is True

    # ---------------------------------
    # STEP 2
    # ---------------------------------
    def provision(self):
        """Get the CloudNativeGIS service this job runs on, and wait until it's healthy.

        Fills in cloudnativegis_url/cloudnativegis_api_token - without
        CLOUDNATIVEGIS_ON_DEMAND, the fixed CLOUDNATIVEGIS_URL/API_TOKEN; with
        it, those of a server GeoHosting starts for this job (see
        _provision_on_demand) - then polls its /health. Raises ValueError if
        it can't be had, or isn't healthy within
        CLOUDNATIVEGIS_PROVISIONING_TIMEOUT.
        """
        if settings.CLOUDNATIVEGIS_ON_DEMAND:
            url, token = self._provision_on_demand()
        else:
            url, token = settings.CLOUDNATIVEGIS_URL, settings.CLOUDNATIVEGIS_API_TOKEN
        self.cloudnativegis_url = url.rstrip("/")
        self.cloudnativegis_api_token = token
        self.save(update_fields=["cloudnativegis_url", "cloudnativegis_api_token", "updated_at"])
        self.wait_until_healthy()

    def _provision_on_demand(self):
        """Have GeoHosting start this job's server; returns its (url, token).

        Asks for it (owned by this job's owner, a GeoHosting user), then polls
        until it's ready or failed - GeoHosting decides when starting it has
        failed (timeouts included), so there's no deadline here. Asking again
        for the same job - e.g. resuming it - gives the same server, or a new
        one if it was deleted meanwhile. Every request is logged
        (CngLiteJobLog), but a poll only if it says something new. Raises
        ValueError if GeoHosting refuses it or says it failed.
        """
        geohosting = GeoHostingClient()
        log = self._geohosting_log()
        self._set_message("Starting a CloudNativeGIS server")

        server = self._ask_geohosting_for_server(geohosting, log)
        while server["status"] != "ready":
            if server["status"] == "failed":
                raise ValueError(
                    "GeoHosting couldn't start a CloudNativeGIS server: "
                    f"{server.get('error') or 'unknown error'}"
                )
            time.sleep(settings.CLOUDNATIVEGIS_POLL_INTERVAL)
            server = geohosting.get_server(self.id, log=log)
            if server is None or server["status"] == "deleted":
                # Gone meanwhile (e.g. cleaned up): ask for a new one.
                server = self._ask_geohosting_for_server(geohosting, log)
        return server["url"], server["token"]

    def _ask_geohosting_for_server(self, geohosting, log):
        """POST for this job's server; waits out one still being deleted."""
        while True:
            try:
                return geohosting.create_server(self.id, self.owner.get_username(), log=log)
            except GeoHostingError as exc:
                if exc.status_code == 400:
                    raise ValueError(
                        f"This account isn't linked to GeoHosting, so it can't use on-demand "
                        f"CloudNativeGIS: {exc}"
                    ) from exc
                still_deleting = exc.status_code == 409 and "being deleted" in str(exc)
                if not still_deleting:
                    raise ValueError(str(exc)) from exc
            time.sleep(settings.CLOUDNATIVEGIS_POLL_INTERVAL)

    def deprovision(self):
        """Have GeoHosting delete this job's on-demand server, and wait until it's gone.

        Only with CLOUDNATIVEGIS_ON_DEMAND. GeoHosting decides when deleting
        it has failed, so there's no deadline here. Forgets the server's
        token once it's asked to delete it. Raises GeoHostingError if
        GeoHosting refuses or can't be reached.
        """
        if not settings.CLOUDNATIVEGIS_ON_DEMAND:
            return
        geohosting = GeoHostingClient()
        log = self._geohosting_log()
        server = geohosting.delete_server(self.id, log=log)
        if self.cloudnativegis_api_token:
            self.cloudnativegis_api_token = ""
            self.save(update_fields=["cloudnativegis_api_token", "updated_at"])
        while server is not None and server["status"] != "deleted":
            time.sleep(settings.CLOUDNATIVEGIS_POLL_INTERVAL)
            server = geohosting.get_server(self.id, log=log)

    def _geohosting_log(self):
        """A GeoHostingClient `log` callback recording into CngLiteJobLog.

        Skips a GET that only repeats the server's status (still starting).
        """
        from .cng_lite_job_log import CngLiteJobLog  # noqa: PLC0415 - it imports this module

        last = {"status": None}

        def log(**request):
            answer = request["response_payload"]
            status = answer.get("status") if isinstance(answer, dict) else None
            if request["method"] == "GET" and not request["error"] and status == last["status"]:
                return
            last["status"] = status
            CngLiteJobLog.record(self, target=CngLiteJobLog.Target.GEOHOSTING, **request)

        return log

    def _set_message(self, message):
        """Only message/updated_at: the status is set by the caller."""
        if self.message != message:
            self.message = message
            self.save(update_fields=["message", "updated_at"])

    def wait_until_healthy(self):
        """Poll this job's CloudNativeGIS /health until it answers.

        Raises ValueError if it doesn't within CLOUDNATIVEGIS_PROVISIONING_TIMEOUT.
        """
        timeout = settings.CLOUDNATIVEGIS_PROVISIONING_TIMEOUT
        deadline = time.monotonic() + timeout
        while not _is_healthy(self.cloudnativegis_url):
            if time.monotonic() >= deadline:
                raise ValueError(
                    f"CloudNativeGIS at {self.cloudnativegis_url} did not become healthy "
                    f"within {timeout}s."
                )
            self._set_message("Waiting for CloudNativeGIS to become ready")
            time.sleep(settings.CLOUDNATIVEGIS_POLL_INTERVAL)

    def cloudnativegis_headers(self):
        """Auth header for requests to this job's CloudNativeGIS, if it has a token."""
        if not self.cloudnativegis_api_token:
            return {}
        return {"Authorization": f"Bearer {self.cloudnativegis_api_token}"}

    def to_dict(self):
        formats = CONVERSION_FORMATS[self.kind]
        output_paths = (
            [f"s3://{self.bucket}/{item['key']}" for item in self.output_keys]
            if self.output_keys
            else [f"s3://{self.bucket}/{self.output_key}"]
        )
        return {
            "id": str(self.id),
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "sourcePath": self.source_name,
            "sourceStoredPath": (
                f"s3://{self.bucket}/{self.source_key}" if self.source_key else None
            ),
            "outputPath": output_paths[0] if len(output_paths) == 1 else None,
            "outputPaths": output_paths,
            "sourceFormat": formats["sourceFormat"],
            "targetFormat": formats["targetFormat"],
            "inputSize": self.input_size,
            "outputSize": self.output_size,
            "layers": self.layers,
            "startedAt": self.created_at.isoformat(),
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }
