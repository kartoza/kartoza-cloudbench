"""A user's saved connection to one S3-compatible bucket."""

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
    EncryptedCharField).
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
    # Contact for this bucket's published data: the `host` provider email in
    # its Portolan collections. Blank falls back to settings.PORTOLAN_HOST_EMAIL.
    contact_email = models.EmailField(blank=True, default="")
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
