"""S3 connections and persistent status for CloudNativeGIS-to-S3 conversions."""

import uuid

from django.conf import settings
from django.db import models

from apps.core.fields import EncryptedCharField


class S3Connection(models.Model):
    """A user's saved connection to one S3-compatible bucket.

    A connection is scoped to exactly one bucket — most S3-compatible
    providers issue credentials scoped to a single bucket, and this
    avoids needing account-wide permissions just to browse. Add another
    connection to reach a different bucket.

    access_key/secret_key are encrypted at rest (see apps.core.fields.
    EncryptedCharField) — this replaces the old plaintext-JSON-file storage
    that used to live in apps.core.config.ConfigManager.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="s3_connections"
    )
    name = models.CharField(max_length=255)
    endpoint = models.CharField(max_length=500)
    bucket = models.CharField(max_length=255, blank=True, default="")
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
    # GeoPackage -> pmtiles only: which layers to include, chosen after
    # inspecting the file (see apps.s3.pmtiles.inspect_geopackage). Null for
    # jobs that don't go through the inspect/pick flow (shapefiles, TIFFs).
    layers = models.JSONField(null=True, blank=True)
    # SPDX id (or "other") the user picked at upload time, carried through
    # to the generated Portolan collection.json — see apps.s3.portolan.
    license = models.CharField(max_length=100, default="other", blank=True)
    # Set when a job produces more than one output file (every GeoPackage
    # job does: one PMTiles per vector layer, or one COG per raster table).
    # `output_key` then becomes the folder they were all stored under,
    # rather than a single object key — see apps.s3.cng_lite.run_conversion.
    output_keys = models.JSONField(null=True, blank=True)
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


class LayerCollection(models.Model):
    """A group of layers produced together from one GeoPackage upload.

    Created automatically once a multi-output CngLiteJob (pmtiles per
    vector layer, or COG per raster table) completes — see
    apps.s3.cng_lite.run_conversion.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner_id = models.CharField(max_length=255)
    connection_id = models.CharField(max_length=255)
    bucket = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    source_name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def to_dict(self, include_items=False):
        data = {
            "id": str(self.id),
            "connectionId": self.connection_id,
            "bucket": self.bucket,
            "name": self.name,
            "sourceName": self.source_name,
            "itemCount": self.items.count(),
            "createdAt": self.created_at.isoformat(),
        }
        if include_items:
            data["items"] = [item.to_dict() for item in self.items.all()]
        return data


class LayerCollectionItem(models.Model):
    collection = models.ForeignKey(LayerCollection, on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=255)
    key = models.TextField()
    format = models.CharField(max_length=10)  # "pmtiles" | "cog"

    def to_dict(self):
        return {"name": self.name, "key": self.key, "format": self.format}
