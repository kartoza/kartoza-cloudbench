"""The on-demand servers of a bulk upload: up to N, each running one layer at a time.

On demand every conversion needs a CloudNativeGIS server, and starting one
takes minutes and is billed per started hour - too much to start one per layer.
So a batch starts up to N servers (its "processing servers", capped by
CLOUDNATIVEGIS_BULK_MAX_SERVERS), as many as it has layers for, and gives each
queued layer a free one when the layer's turn comes. A layer runs on its server
as any conversion does (CngLiteJob.instance_server) but leaves it running: the
batch deletes the servers it started - if auto_destroy - as soon as they're no
longer needed, i.e. once no layer is waiting for one, and at the latest when it
is over (see `stopping`).

Everything here is a step, never a wait: the batch's coordinator (apps.s3.bulk)
calls these on every pass, so a restart loses nothing - what's known is in the
database (CngLiteServer.batch), as GeoHosting last answered about it. Starting
and deleting a server are GeoHosting's to time out; a server that fails to start
is replaced up to MAX_FAILURES times, and then the batch goes on with those it has.
"""

import logging
import uuid

from apps.core.geohosting import GeoHostingClient, GeoHostingError

from .models import ACTIVE_CNG_LITE_JOB_STATUSES, CngLiteJob, CngLiteServer

logger = logging.getLogger(__name__)

# How many servers may fail to start before the batch stops asking for more.
MAX_FAILURES = 2
# What a server's `error` starts with when GeoHosting couldn't be asked to delete it.
DELETE_FAILED = "Couldn't delete it: "

Status = CngLiteServer.Status


def sync(batch):
    """Ask GeoHosting again about the batch's servers that are changing (starting or deleting).

    Saved as it answers (see CngLiteServer.record); a server it has none of any
    more is forgotten. A failure to ask is only logged: the next pass asks again.
    """
    for server in batch.servers.filter(status__in=[Status.PROVISIONING, Status.DELETING]):
        try:
            server.sync_from_geohosting()
        except GeoHostingError:
            logger.warning("Bulk upload %s: couldn't ask about server %s", batch.id, server.pk)


def alive(batch):
    """How many of the batch's servers are running (starting or ready)."""
    return batch.servers.filter(status__in=CngLiteServer.RUNNING).count()


def failures(batch):
    """How many of the batch's servers GeoHosting couldn't start."""
    return batch.servers.filter(status=Status.FAILED).count()


def start_missing(batch, wanted):
    """Start servers until the batch has `wanted` running - unless too many failed.

    Each is asked for at once and starts in the background; it is saved
    before it is asked for, so a restart in between finds it (and asks about
    it) rather than starting another.
    """
    for _ in range(wanted - alive(batch)):
        if failures(batch) > MAX_FAILURES:
            return
        _start(batch)


def _start(batch):
    server = CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=batch.owner,
        batch=batch,
        auto_destroy=batch.auto_destroy,
        type_id=batch.hetzner_server_id,
    )
    try:
        answer = GeoHostingClient().create_server(
            batch.id,
            batch.owner.get_username(),
            batch.hetzner_server_id,
            server_id=server.instance_id,
        )
    except GeoHostingError as exc:
        logger.warning("Bulk upload %s: couldn't start a server: %s", batch.id, exc)
        server.status = Status.FAILED
        server.error = str(exc)
        server.save(update_fields=["status", "error", "updated_at"])
        return
    CngLiteServer.record(answer, batch.owner, batch.auto_destroy)


def _busy_ids(batch):
    """The pks of the batch's servers a layer is running on."""
    return set(
        CngLiteJob.objects.filter(
            instance_server__batch=batch, status__in=ACTIVE_CNG_LITE_JOB_STATUSES
        ).values_list("instance_server_id", flat=True)
    )


def free(batch):
    """The batch's ready servers with no layer running on them, oldest first."""
    busy = _busy_ids(batch)
    return [
        server
        for server in batch.servers.filter(status=Status.READY).order_by("created_at")
        if server.pk not in busy
    ]


def gave_up(batch):
    """Whether the batch has no server and will start no more (too many failed).

    Its waiting layers can't run: they fail, with `last_error`.
    """
    return failures(batch) > MAX_FAILURES and not alive(batch)


def last_error(batch):
    """Why the batch's latest server failed to start."""
    server = batch.servers.filter(status=Status.FAILED).order_by("-updated_at").first()
    return (server.error if server else "") or "unknown error"


def release_idle(batch):
    """Delete the batch's servers that no layer is running on, if it started them to be deleted.

    For when no layer is waiting for a server any more: whatever isn't busy
    now isn't needed, and is billed until it's gone. A server being started
    goes too. Those the user wants kept (not auto_destroy) are left running.
    """
    busy = _busy_ids(batch)
    for server in batch.servers.filter(status__in=CngLiteServer.RUNNING, auto_destroy=True):
        if server.pk not in busy:
            _delete(server)


def _delete(server):
    """Ask GeoHosting to delete `server`, in the background (see sync for when it's gone)."""
    try:
        answer = GeoHostingClient().delete_server(server.instance_id)
    except GeoHostingError as exc:
        logger.exception("Server %s: couldn't ask GeoHosting to delete it", server.pk)
        server.error = f"{DELETE_FAILED}{exc}"
        server.save(update_fields=["error", "updated_at"])
        return
    if answer is None:
        server.forget()
    else:
        CngLiteServer.record(answer, server.owner)


def stopping(batch):
    """Delete the servers the batch has left; True while it has to wait for them to be gone.

    For when its layers are all over. Servers kept running (not
    auto_destroy), and any that couldn't be asked to be deleted, don't
    hold the batch up - the failure is logged, and the server stays on
    GeoHosting's list.
    """
    release_idle(batch)
    leaving = batch.servers.filter(
        auto_destroy=True, status__in=[*CngLiteServer.RUNNING, Status.DELETING]
    ).exclude(error__startswith=DELETE_FAILED)
    return leaving.exists()
