"""Shared Django model base for a user's saved service connections.

Connections used to live in a plaintext per-user config.json managed by
apps.core.config.ConfigManager. Each connection type now has its own table
(see e.g. apps.connections.models.GeoServerConnection) with its secrets
encrypted at rest, mirroring apps.s3.models.S3Connection.

ConfigManager still hands out the Pydantic models from apps.core.models, so
views and clients didn't have to change — `to_schema`/`apply_schema`
convert between a row and its Pydantic counterpart.
"""

import uuid
from typing import ClassVar

from django.conf import settings
from django.db import models
from pydantic import BaseModel


class ConnectionModel(models.Model):
    """Abstract base: one row is one saved connection owned by one user.

    `connection_id` is the id the API and frontend have always used (e.g.
    "conn_20260101120000", "geohosting_7" or a UUID string), unique per
    owner. It's kept separate from the primary key because the old
    timestamp-based ids can collide between users.
    """

    # The Pydantic model rows convert to/from; its field names must match
    # this model's, with the Pydantic `id` mapping onto `connection_id`.
    schema: ClassVar[type[BaseModel]]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="%(class)ss"
    )
    connection_id = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        # Oldest first, matching the append order of the old JSON lists.
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "connection_id"],
                name="%(app_label)s_%(class)s_unique_owner_connection_id",
            )
        ]

    def __str__(self):
        return self.name

    @classmethod
    def _schema_fields(cls) -> list[str]:
        return [name for name in cls.schema.model_fields if name != "id"]

    def to_schema(self) -> BaseModel:
        """This row as its Pydantic model."""
        data = {name: getattr(self, name) for name in self._schema_fields()}
        return self.schema(id=self.connection_id, **data)

    def apply_schema(self, obj: BaseModel) -> None:
        """Copy a Pydantic model's values onto this row (without saving)."""
        self.connection_id = obj.id
        for name in self._schema_fields():
            setattr(self, name, getattr(obj, name))
