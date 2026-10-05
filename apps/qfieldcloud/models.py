"""Saved QFieldCloud connections."""

from django.db import models

from apps.core import models as schemas
from apps.core.db import ConnectionModel
from apps.core.fields import EncryptedCharField


class QFieldCloudConnection(ConnectionModel):
    """A user's saved connection to one QFieldCloud server."""

    schema = schemas.QFieldCloudConnection

    url = models.CharField(max_length=500, default="https://app.qfield.cloud")
    username = models.CharField(max_length=255, blank=True, default="")
    password = EncryptedCharField(blank=True, default="")
    token = EncryptedCharField(max_length=4000, blank=True, default="")

    class Meta(ConnectionModel.Meta):
        verbose_name = "QFieldCloud connection"
