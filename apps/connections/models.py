"""Saved GeoServer connections."""

from django.db import models

from apps.core import models as schemas
from apps.core.db import ConnectionModel
from apps.core.fields import EncryptedCharField


class GeoServerConnection(ConnectionModel):
    """A user's saved connection to one GeoServer instance."""

    schema = schemas.Connection

    url = models.CharField(max_length=500)
    username = models.CharField(max_length=255)
    password = EncryptedCharField(blank=True, default="")

    class Meta(ConnectionModel.Meta):
        verbose_name = "GeoServer connection"
