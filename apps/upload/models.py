"""Django ORM model for upload sessions."""

import uuid

from django.contrib.auth import get_user_model
from django.db import models

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