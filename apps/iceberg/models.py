"""Saved Apache Iceberg REST catalog connections."""

from django.db import models

from apps.core import models as schemas
from apps.core.db import ConnectionModel
from apps.core.fields import EncryptedCharField


class IcebergCatalogConnection(ConnectionModel):
    """A user's saved connection to one Iceberg REST catalog."""

    schema = schemas.IcebergCatalogConnection

    url = models.CharField(max_length=500)
    warehouse = models.CharField(max_length=500, blank=True, default="")
    token = EncryptedCharField(max_length=4000, blank=True, default="")
    client_id = models.CharField(max_length=255, blank=True, default="")
    client_secret = EncryptedCharField(max_length=4000, blank=True, default="")
    prefix = models.CharField(max_length=255, blank=True, default="")
    s3_endpoint = models.CharField(max_length=500, blank=True, default="")
    access_key = EncryptedCharField(blank=True, default="")
    secret_key = EncryptedCharField(blank=True, default="")
    region = models.CharField(max_length=100, blank=True, default="")
    jupyter_url = models.CharField(max_length=500, blank=True, default="")

    class Meta(ConnectionModel.Meta):
        verbose_name = "Iceberg catalog connection"
