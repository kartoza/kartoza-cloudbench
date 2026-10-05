"""Saved Mergin Maps connections."""

from django.db import models

from apps.core import models as schemas
from apps.core.db import ConnectionModel
from apps.core.fields import EncryptedCharField


class MerginMapsConnection(ConnectionModel):
    """A user's saved connection to one Mergin Maps server."""

    schema = schemas.MerginMapsConnection

    url = models.CharField(max_length=500, default="https://app.merginmaps.com")
    username = models.CharField(max_length=255)
    password = EncryptedCharField(blank=True, default="")
    token = EncryptedCharField(max_length=4000, blank=True, default="")

    class Meta(ConnectionModel.Meta):
        verbose_name = "Mergin Maps connection"
