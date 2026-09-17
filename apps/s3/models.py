"""Persistent status for CloudNativeGIS-to-S3 conversions."""

import uuid

from django.db import models


class PMTilesJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner_id = models.CharField(max_length=255)
    connection_id = models.CharField(max_length=255)
    bucket = models.CharField(max_length=255)
    source_name = models.CharField(max_length=255)
    output_key = models.TextField()
    input_size = models.BigIntegerField()
    output_size = models.BigIntegerField(default=0)
    layer_id = models.PositiveBigIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, default="pending")
    progress = models.PositiveSmallIntegerField(default=0)
    message = models.TextField(default="Waiting to upload to CloudNativeGIS")
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def to_dict(self):
        return {
            "id": str(self.id),
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "sourcePath": self.source_name,
            "outputPath": f"s3://{self.bucket}/{self.output_key}",
            "sourceFormat": "shapefile",
            "targetFormat": "pmtiles",
            "inputSize": self.input_size,
            "outputSize": self.output_size,
            "startedAt": self.created_at.isoformat(),
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }
