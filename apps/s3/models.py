"""S3 connections and persistent status for CloudNativeGIS-to-S3 conversions."""

import uuid

from django.conf import settings
from django.db import models

from apps.core.fields import EncryptedCharField


class S3Connection(models.Model):
    """A user's saved S3-compatible storage connection.

    access_key/secret_key are encrypted at rest (see apps.core.fields.
    EncryptedCharField) — this replaces the old plaintext-JSON-file storage
    that used to live in apps.core.config.ConfigManager.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="s3_connections")
    name = models.CharField(max_length=255)
    endpoint = models.CharField(max_length=500)
    access_key = EncryptedCharField()
    secret_key = EncryptedCharField()
    region = models.CharField(max_length=100, blank=True, default="")
    use_ssl = models.BooleanField(default=True)
    path_style = models.BooleanField(default=True)
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

# Source/target labels per job kind, used only for API responses.
CONVERSION_FORMATS = {
    "pmtiles": {"sourceFormat": "shapefile", "targetFormat": "pmtiles"},
    "cog": {"sourceFormat": "tiff", "targetFormat": "cog"},
}


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
    output_size = models.BigIntegerField(default=0)
    status = models.CharField(max_length=20, default="pending")
    progress = models.PositiveSmallIntegerField(default=0)
    message = models.TextField(default="Waiting to upload to CloudNativeGIS")
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def to_dict(self):
        formats = CONVERSION_FORMATS[self.kind]
        return {
            "id": str(self.id),
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "sourcePath": self.source_name,
            "sourceStoredPath": f"s3://{self.bucket}/{self.source_key}" if self.source_key else None,
            "outputPath": f"s3://{self.bucket}/{self.output_key}",
            "sourceFormat": formats["sourceFormat"],
            "targetFormat": formats["targetFormat"],
            "inputSize": self.input_size,
            "outputSize": self.output_size,
            "startedAt": self.created_at.isoformat(),
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }
