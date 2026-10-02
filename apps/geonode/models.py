"""Saved GeoNode connections."""

from django.db import models

from apps.core import models as schemas
from apps.core.db import ConnectionModel
from apps.core.fields import EncryptedCharField


class GeoNodeConnection(ConnectionModel):
    """A user's saved connection to one GeoNode instance."""

    schema = schemas.GeoNodeConnection

    url = models.CharField(max_length=500)
    username = models.CharField(max_length=255, blank=True, default="")
    password = EncryptedCharField(blank=True, default="")
    api_key = EncryptedCharField(max_length=4000, blank=True, default="")

    class Meta(ConnectionModel.Meta):
        verbose_name = "GeoNode connection"
