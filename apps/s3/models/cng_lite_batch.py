"""A bulk upload: every layer in a bucket folder, converted N at a time."""

import uuid

from django.conf import settings
from django.db import models

from .s3_connection import S3Connection


class CngLiteBatch(models.Model):
    """The layers of one folder, as CngLiteJobs (`jobs`) run N at a time."""

    class Status(models.TextChoices):
        """Where the batch is, from its jobs."""

        RUNNING = "running", "Running"
        # Asked to stop: its waiting jobs are cancelled, its running ones
        # stopped where they can be; it ends CANCELLED once none is left.
        CANCELLING = "cancelling", "Cancelling"
        # Every layer published (or skipped).
        COMPLETED = "completed", "Completed"
        # Some published, some failed (or never started).
        PARTIAL = "partial", "Partial"
        # None published, and at least one failed.
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    class OnExists(models.TextChoices):
        """What to do with a layer whose folder already holds data."""

        SKIP = "skip", "Skip it"
        REPLACE = "replace", "Replace it"
        # Strict: a layer that exists is a failure, and the first failure
        # of any kind cancels the jobs still waiting.
        STOP = "stop", "Stop the batch at the first failure"

    ACTIVE = (Status.RUNNING, Status.CANCELLING)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cng_lite_batches"
    )
    # Null once the connection is deleted: the history stays, nothing more runs.
    connection = models.ForeignKey(
        S3Connection, null=True, on_delete=models.SET_NULL, related_name="cng_lite_batches"
    )
    # Where the folder is read from, when that isn't `connection`'s bucket
    # (which is where the layers go): its jobs convert each file where it
    # is, only reading it. Null with a `source_bucket` means that connection
    # was deleted since. Blank source_bucket: the same bucket.
    source_connection = models.ForeignKey(
        S3Connection, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    source_bucket = models.CharField(max_length=255, blank=True, default="")
    # The folder whose layers are converted ("incoming/", "" is never allowed).
    source_prefix = models.TextField()
    # Where the layers go: blank, beside each file (one folder per layer), or one folder.
    destination_prefix = models.TextField(blank=True, default="")
    license = models.CharField(max_length=100, default="other", blank=True)
    license_url = models.URLField(max_length=2000, blank=True, default="")
    on_exists = models.CharField(max_length=10, choices=OnExists.choices, default=OnExists.SKIP)
    # N: the most jobs running at once.
    concurrency = models.PositiveSmallIntegerField(default=1)
    # Layers left out because they already existed (on_exists = skip):
    # [{"key", "name", "kind", "reason"}] - they get no job.
    skipped = models.JSONField(default=list, blank=True)
    # Also publish a VRT collection of the batch's converted GeoTIFFs once they
    # are all done (see apps.s3.bulk_vrt): its name, and where it has got to -
    # {state: pending | building | done | skipped | failed, message, folder?, key?,
    # count?, leftOut?}. Empty without create_vrt. It never fails the batch.
    create_vrt = models.BooleanField(default=False)
    vrt_name = models.CharField(max_length=255, blank=True, default="")
    vrt = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RUNNING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_cross_bucket(self):
        """Whether the folder is read from another bucket than the layers go to."""
        return bool(self.source_bucket)

    @property
    def is_active(self):
        return self.status in self.ACTIVE

    def to_dict(self):
        """The batch and its layers, as the bulk upload API serves it.

        Jobs are in the order they run; layers skipped for already existing
        come last. Every job still being converted - whichever step it is
        at - is "running" here; a layer is "queued" until it has a slot.
        """
        jobs = [
            {
                "key": job.origin_key,
                "name": job.source_name,
                "kind": job.kind,
                "status": _JOB_STATUS.get(job.status, "running"),
                "progress": job.progress,
                "message": job.message,
                "error": job.error or None,
                "jobId": str(job.id),
            }
            for job in self.jobs.order_by("created_at", "source_name")
        ]
        jobs += [
            {
                "key": item["key"],
                "name": item["name"],
                "kind": item["kind"],
                "status": "skipped",
                "progress": 100,
                "message": item["reason"],
                "error": None,
                "jobId": None,
            }
            for item in self.skipped
        ]
        return {
            "id": str(self.id),
            "connectionId": str(self.connection_id) if self.connection_id else None,
            "sourceConnectionId": (
                str(self.source_connection_id) if self.source_connection_id else None
            ),
            "sourceName": self.source_label,
            "prefix": self.source_prefix,
            "status": self.status,
            "concurrency": self.concurrency,
            "onExists": self.on_exists,
            "vrt": self.vrt if self.create_vrt else None,
            "createdAt": self.created_at.isoformat(),
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "jobs": jobs,
        }

    @property
    def source_label(self):
        """What the folder is read from, when not the destination's bucket (else None)."""
        if not self.is_cross_bucket:
            return None
        return self.source_connection.name if self.source_connection_id else self.source_bucket


_JOB_STATUS = {
    "queued": "queued",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "cancelled",
}
