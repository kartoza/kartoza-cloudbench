"""Saved PostgreSQL services (pg_service.conf-style entries)."""

from django.db import models

from apps.core import models as schemas
from apps.core.db import ConnectionModel
from apps.core.fields import EncryptedCharField


class PostgresService(ConnectionModel):
    """A user's saved PostgreSQL service, looked up by its `name`."""

    schema = schemas.PGService

    host = models.CharField(max_length=255, default="localhost")
    port = models.PositiveIntegerField(default=5432)
    dbname = models.CharField(max_length=255, blank=True, default="")
    user = models.CharField(max_length=255, blank=True, default="")
    password = EncryptedCharField(blank=True, default="")
    sslmode = models.CharField(max_length=50, blank=True, default="")
    options = models.JSONField(default=dict, blank=True)

    class Meta(ConnectionModel.Meta):
        verbose_name = "PostgreSQL service"
