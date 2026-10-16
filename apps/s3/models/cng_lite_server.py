"""On-demand CloudNativeGIS servers GeoHosting started for CloudBench's jobs."""

from django.conf import settings
from django.db import models
from django.utils.dateparse import parse_datetime

from apps.core.fields import EncryptedCharField
from apps.core.geohosting import GeoHostingClient, GeoHostingError

# What would tell the user which server it is (Hetzner's type name, e.g.
# "cx23", and the specifications' "description", the type name again): never
# shown to them.
HIDDEN_SERVER_TYPE_KEYS = ("type",)
HIDDEN_SPECIFICATION_KEYS = ("description",)


def hide_specification(specification):
    """`specification` without what names the server type (HIDDEN_SPECIFICATION_KEYS)."""
    if not isinstance(specification, dict):
        return specification
    return {
        key: value for key, value in specification.items() if key not in HIDDEN_SPECIFICATION_KEYS
    }


def hide_server_type(server_type):
    """GeoHosting's `server_type` as the user may see it: without its type name."""
    shown = {key: value for key, value in server_type.items() if key not in HIDDEN_SERVER_TYPE_KEYS}
    if "specifications" in shown:
        shown["specifications"] = hide_specification(shown["specifications"])
    return shown


class CngLiteServer(models.Model):
    """A GeoHosting HetznerServer: a CloudNativeGIS server jobs run on.

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

    # Running: being started, or ready - what another job can still run on.
    RUNNING = (Status.PROVISIONING, Status.READY)

    # GeoHosting's id for it: the `server_id` its API answers with, and
    # what it's asked for again by.
    instance_id = models.UUIDField(unique=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cng_lite_servers"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PROVISIONING)
    # Its CloudNativeGIS service, and its bearer token (encrypted at rest) -
    # only while it's ready: GeoHosting gives them out only then.
    url = models.URLField(max_length=2000, blank=True, default="")
    api_token = EncryptedCharField(blank=True, default="")
    # The GeoHosting HetznerServerType (a server type in a location) it was
    # started as, and its specifications (cores, memory, disk, ...).
    type_id = models.PositiveIntegerField(null=True, blank=True)
    specification = models.JSONField(null=True, blank=True)
    # Why it failed, if it did.
    error = models.TextField(blank=True, default="")
    # When Hetzner created it: it's billed from then until it's deleted.
    created = models.DateTimeField(null=True, blank=True)
    # Whether it was started to be deleted once its job is done: from the
    # job it was first asked for by (see CngLiteJob.auto_destroy).
    auto_destroy = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.instance_id} ({self.status})"

    @classmethod
    def record(cls, answer, owner, auto_destroy=True):
        """Save GeoHosting's `answer` about a server (see GeoHostingClient), owned by `owner`.

        Returns the server, created the first time GeoHosting tells of it -
        with `auto_destroy`, which a later answer doesn't change.
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
        server, _ = cls.objects.update_or_create(
            instance_id=answer["server_id"],
            defaults=values,
            create_defaults={**values, "auto_destroy": auto_destroy},
        )
        return server

    @classmethod
    def running_for(cls, user):
        """`user`'s running servers (provisioning or ready), as GeoHosting has them now.

        Asks GeoHosting for them, saving each (see record) - one it didn't
        know of before as auto_destroy, so it isn't offered to run another
        job on - and asks again about the ones saved as running it didn't
        list (deleted meanwhile, say). None if GeoHosting doesn't know
        `user`. Raises GeoHostingError if GeoHosting can't be asked.
        """
        geohosting = GeoHostingClient()
        try:
            answers = geohosting.list_servers(user.get_username())
        except GeoHostingError as exc:
            if exc.status_code == 400:
                return []
            raise
        running = [cls.record(answer, user) for answer in answers]
        listed = [server.pk for server in running]
        for server in cls.objects.filter(owner=user, status__in=cls.RUNNING).exclude(pk__in=listed):
            answer = geohosting.get_server(server.instance_id)
            if answer is None:
                server.forget()
            else:
                cls.record(answer, user)
        return [server for server in running if server.status in cls.RUNNING]

    def sync_from_geohosting(self):
        """Ask GeoHosting about it again, saving its answer (see record).

        Forgotten (see forget) if GeoHosting has none any more. Raises
        GeoHostingError if GeoHosting can't be asked.
        """
        answer = GeoHostingClient().get_server(self.instance_id)
        if answer is None:
            self.forget()
        else:
            self.record(answer, self.owner)
            self.refresh_from_db()

    def to_dict(self):
        return {
            "instanceId": str(self.instance_id),
            "status": self.status,
            "autoDestroy": self.auto_destroy,
            "typeId": self.type_id,
            "specification": hide_specification(self.specification),
            "created": self.created.isoformat() if self.created else None,
            "jobs": self.jobs.count(),
        }

    def forget(self):
        """Gone at GeoHosting (nothing to answer about it any more): deleted, token forgotten."""
        self.status = self.Status.DELETED
        self.api_token = ""
        self.save(update_fields=["status", "api_token", "updated_at"])
