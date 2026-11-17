"""Django ORM model for upload sessions."""

import uuid

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

User = get_user_model()


class UploadSession(models.Model):
    session_id = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, null=True, blank=True, related_name="upload_sessions"
    )
    filename = models.CharField(max_length=255)
    file_size = models.BigIntegerField()
    chunk_size = models.BigIntegerField()
    total_chunks = models.IntegerField()
    received_chunks = models.JSONField(default=list)
    upload_dir = models.CharField(max_length=500)
    workspace = models.CharField(max_length=255, blank=True)
    connection_id = models.CharField(max_length=255, blank=True)
    store_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed = models.BooleanField(default=False)
    error = models.TextField(blank=True)

    class Meta:
        app_label = "cloudbench_upload"
        verbose_name = "Upload Session"
        verbose_name_plural = "Upload Sessions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.filename} ({self.session_id})"

    @property
    def progress(self) -> float:
        if self.total_chunks == 0:
            return 0.0
        return len(self.received_chunks) / self.total_chunks * 100

    @property
    def bytes_received(self) -> int:
        return len(self.received_chunks) * self.chunk_size

    def is_complete(self) -> bool:
        return len(self.received_chunks) == self.total_chunks


class UploadJob(models.Model):
    """Work done with an uploaded file after the upload itself, in the background.

    Importing a large file (e.g. a GeoPackage into PostGIS) takes longer than
    a web request may last, so it runs in a thread and the browser polls this
    (see apps/upload/jobs.py). Each kind of target (PostGIS now; GeoServer and
    GeoNode later) records here the same way.
    """

    class Kind(models.TextChoices):
        POSTGIS_VECTOR = "postgis_vector", "PostGIS vector import"
        POSTGIS_RASTER = "postgis_raster", "PostGIS raster import"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    # A running job whose heartbeat is older than this has stopped (the
    # server restarted under it).
    STALE_AFTER_SECONDS = 120

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, null=True, blank=True, related_name="upload_jobs"
    )
    kind = models.CharField(max_length=32, choices=Kind.choices)
    # Where it goes (a PostgreSQL service, a connection) and what it makes
    # (e.g. "public.catchments"): for listing it, never its credentials.
    target = models.CharField(max_length=255, blank=True)
    output = models.CharField(max_length=255, blank=True)
    source_name = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    progress = models.PositiveSmallIntegerField(default=0)
    message = models.CharField(max_length=500, blank=True)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "cloudbench_upload"
        verbose_name = "Upload Job"
        verbose_name_plural = "Upload Jobs"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()}: {self.output or self.source_name} ({self.status})"

    @property
    def is_stale(self) -> bool:
        if self.status not in (self.Status.PENDING, self.Status.RUNNING):
            return False
        last = self.heartbeat_at or self.created_at
        return (timezone.now() - last).total_seconds() > self.STALE_AFTER_SECONDS

    def to_dict(self) -> dict:
        status, error = self.status, self.error
        if self.is_stale:
            status = self.Status.FAILED
            error = "The import stopped (the server restarted during it). Please try again."
        return {
            "id": str(self.id),
            "kind": self.kind,
            "target": self.target,
            "output": self.output,
            "sourceName": self.source_name,
            "status": status,
            "progress": self.progress,
            "message": self.message,
            "error": error,
            "createdAt": self.created_at.isoformat(),
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }
