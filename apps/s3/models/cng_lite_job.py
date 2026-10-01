"""Persistent status of CloudNativeGIS-to-S3 conversion jobs."""

import time
import uuid

import httpx
from django.conf import settings
from django.db import models

from apps.core.fields import EncryptedCharField

# Source/target labels per job kind, used only for API responses.
CONVERSION_FORMATS = {
    "pmtiles": {"sourceFormat": "shapefile", "targetFormat": "pmtiles"},
    "cog": {"sourceFormat": "tiff", "targetFormat": "cog"},
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
)


class CngLiteJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, default="pmtiles")
    owner_id = models.CharField(max_length=255)
    connection_id = models.CharField(max_length=255)
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
    # The CloudNativeGIS service this job's conversion runs on, and its bearer
    # token (encrypted at rest) - for CLOUDNATIVEGIS_ON_DEMAND, where each job
    # gets its own instead of the fixed CLOUDNATIVEGIS_URL/API_TOKEN.
    cloudnativegis_url = models.URLField(max_length=2000, blank=True, default="")
    cloudnativegis_api_token = EncryptedCharField(blank=True, default="")
    # The job's id on the CloudNativeGIS side, set once it has been submitted
    # there (see apps.s3.cng_lite.run_conversion) - what its status is polled
    # and its results downloaded by.
    cng_job_id = models.CharField(max_length=64, blank=True, default="")
    # Set when a job produces more than one output file (every GeoPackage
    # job does: one PMTiles per vector layer, or one COG per raster table).
    # `output_key` then becomes the folder they were all stored under,
    # rather than a single object key — see apps.s3.cng_lite.run_conversion.
    output_keys = models.JSONField(null=True, blank=True)
    output_size = models.BigIntegerField(default=0)
    status = models.CharField(
        max_length=20, choices=CngLiteJobStatus.choices, default=CngLiteJobStatus.PENDING
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
        set; on-demand isn't supported yet, so it's never valid.
        """
        if settings.CLOUDNATIVEGIS_ON_DEMAND:
            return False
        return bool(settings.CLOUDNATIVEGIS_URL)

    @staticmethod
    def health():
        """Whether the CloudNativeGIS service answers its /health check.

        Without CLOUDNATIVEGIS_ON_DEMAND that's the service at
        CLOUDNATIVEGIS_URL. Raises NotImplementedError with it on, which
        isn't supported yet.
        """
        if settings.CLOUDNATIVEGIS_ON_DEMAND:
            raise NotImplementedError(
                "CloudNativeGIS health check is not supported with CLOUDNATIVEGIS_ON_DEMAND."
            )
        return _is_healthy(settings.CLOUDNATIVEGIS_URL)

    def provision(self):
        """Get the CloudNativeGIS service this job runs on, and wait until it's healthy.

        Fills in cloudnativegis_url/cloudnativegis_api_token - without
        CLOUDNATIVEGIS_ON_DEMAND, the fixed CLOUDNATIVEGIS_URL/API_TOKEN - then
        polls its /health. Raises NotImplementedError with on-demand, which
        isn't supported yet, and ValueError if the service isn't healthy
        within CLOUDNATIVEGIS_PROVISIONING_TIMEOUT.
        """
        if settings.CLOUDNATIVEGIS_ON_DEMAND:
            raise NotImplementedError(
                "CloudNativeGIS provisioning is not supported with CLOUDNATIVEGIS_ON_DEMAND."
            )
        self.cloudnativegis_url = settings.CLOUDNATIVEGIS_URL.rstrip("/")
        self.cloudnativegis_api_token = settings.CLOUDNATIVEGIS_API_TOKEN
        self.save(update_fields=["cloudnativegis_url", "cloudnativegis_api_token", "updated_at"])

        timeout = settings.CLOUDNATIVEGIS_PROVISIONING_TIMEOUT
        deadline = time.monotonic() + timeout
        waiting_message = "Waiting for CloudNativeGIS to become ready"
        while not _is_healthy(self.cloudnativegis_url):
            if time.monotonic() >= deadline:
                raise ValueError(
                    f"CloudNativeGIS at {self.cloudnativegis_url} did not become healthy "
                    f"within {timeout}s."
                )
            if self.message != waiting_message:
                # Only message/updated_at: the status is set by the caller.
                self.message = waiting_message
                self.save(update_fields=["message", "updated_at"])
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
