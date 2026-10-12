"""On-demand CloudNativeGIS servers GeoHosting started for CloudBench's jobs."""

from django.conf import settings
from django.db import models
from django.utils.dateparse import parse_datetime

from apps.core.fields import EncryptedCharField


class CngLiteInstanceServer(models.Model):
    """A GeoHosting HetznerServerInstance: a CloudNativeGIS server jobs run on.

    CLOUDNATIVEGIS_ON_DEMAND only. Kept as GeoHosting last answered about it
    (see record) - one server can run several of its owner's jobs (`jobs`).
    """

    class Status(models.TextChoices):
        """Where GeoHosting says the server is in its life."""

        PROVISIONING = "provisioning", "Provisioning"
        READY = "ready", "Ready"
        DELETING = "deleting", "Deleting"
        DELETED = "deleted", "Deleted"
        FAILED = "failed", "Failed"

    # GeoHosting's id for it: the `server_id` its API answers with, and
    # what it's asked for again by.
    instance_id = models.UUIDField(unique=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cng_lite_instance_servers"
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PROVISIONING
    )
    # Its CloudNativeGIS service, and its bearer token (encrypted at rest) -
    # only while it's ready: GeoHosting gives them out only then.
    url = models.URLField(max_length=2000, blank=True, default="")
    api_token = EncryptedCharField(blank=True, default="")
    # The GeoHosting HetznerServer (a server type in a location) it was
    # started as, and its specifications (cores, memory, disk, ...).
    type_id = models.PositiveIntegerField(null=True, blank=True)
    specification = models.JSONField(null=True, blank=True)
    # Why it failed, if it did.
    error = models.TextField(blank=True, default="")
    # When Hetzner created it: it's billed from then until it's deleted.
    created = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.instance_id} ({self.status})"

    @classmethod
    def record(cls, answer, owner):
        """Save GeoHosting's `answer` about a server (see GeoHostingClient), owned by `owner`.

        Returns the server, created the first time GeoHosting tells of it.
        """
        picked = answer.get("server") or {}
        values = {
            "owner": owner,
            "status": answer.get("status") or cls.Status.PROVISIONING,
            "url": (answer.get("url") or "").rstrip("/"),
            "api_token": answer.get("token") or "",
            "error": answer.get("error") or "",
            "created": parse_datetime(answer["created"]) if answer.get("created") else None,
        }
        if picked:
            values["type_id"] = picked.get("id")
            values["specification"] = picked.get("specifications")
        server, _ = cls.objects.update_or_create(instance_id=answer["server_id"], defaults=values)
        return server

    def forget(self):
        """Gone at GeoHosting (nothing to answer about it any more): deleted, token forgotten."""
        self.status = self.Status.DELETED
        self.api_token = ""
        self.save(update_fields=["status", "api_token", "updated_at"])
