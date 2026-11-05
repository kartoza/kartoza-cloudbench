"""Bulk upload: convert every layer in a bucket folder, N at a time.

The user has already put the layers in a folder of the bucket. `preview`
reads the folder and says what each file would become; `start_batch` makes a
CngLiteJob per chosen layer (QUEUED) and a coordinator, `run_batch`, starts
them as slots free up: at most `concurrency` run at once. Each job then runs
as any upload's does (CNGProcessingClient) - bulk only decides when, and from
which file.

A GeoPackage's original is never handed to the pipeline, which moves it
into its layer group once converted (_publish_source): it is copied to the
job's own staging key first - within S3, nothing downloaded - so what gets
moved is CloudBench's own disposable copy, not the user's file. Nothing
else the pipeline converts is ever moved or deleted, so it converts where
it already is, handing CloudNativeGIS a URL straight to it - as does a
GeoPackage in another bucket than the layers go to (see start_batch):
either way, nothing of CloudBench's own is left behind in the source
folder.
"""

import contextlib
import logging
import re
import shutil
import threading
import time
from datetime import timedelta
from pathlib import PurePosixPath

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from . import bulk_servers, bulk_vrt, cog, copc, pmtiles, portolan
from .client import get_s3_client
from .cng_lite import (
    TargetExists,
    cancel_job,
    check_target,
    finish_job,
    job_directory,
    run_conversion,
    source_object_key,
    target_folder,
)
from .geopackage import is_geopackage
from .models import (
    ACTIVE_CNG_LITE_JOB_STATUSES,
    CANCELLABLE_CNG_LITE_JOB_STATUSES,
    CngLiteBatch,
    CngLiteJob,
    CngLiteJobStatus,
)

logger = logging.getLogger(__name__)

# The most files a folder is read for (the preview says when there were more).
PREVIEW_LIMIT = 500

OUTPUT_REASON = "Made by CloudBench (a converted layer, not a source)"
LOOSE_PART_REASON = "Loose shapefile part: zip the shapefile first"
UNSUPPORTED_REASON = "Not a layer CloudBench converts"
STAGED_REASON = "A conversion's staged source"
PUBLISHED_REASON = "Inside a published layer"

# The parts of a shapefile that, uploaded loose, can't be converted: the
# pipeline hands CloudNativeGIS one object, so the shapefile has to be a zip.
_SHAPEFILE_PARTS = {".shp", ".shx", ".dbf", ".prj", ".cpg", ".qix", ".sbn", ".sbx"}
_STAGED_SOURCE = re.compile(r"(^|/)sources/[0-9a-fA-F-]{36}/")
_PROJECTED_RASTER = re.compile(r"_3857\.tiff?$", re.IGNORECASE)

# What each kind of job names its output after (see the kind's output_key).
_OUTPUT_KEY = {
    pmtiles.KIND: pmtiles.output_key,
    cog.KIND: cog.output_key,
    copc.KIND: copc.output_key,
}


def classify(key):
    """What a file in a folder becomes: (job kind, None), or (None, why it's left alone).

    By name: a shapefile `.zip`, GeoPackage, GeoJSON, FlatGeobuf or KML/KMZ
    becomes PMTiles + GeoParquet (kind "pmtiles"), a GeoTIFF a COG ("cog"),
    a LAS/LAZ a COPC ("copc"). What CloudBench itself wrote - outputs, a
    conversion's staged source - and anything else is left alone.
    """
    if _STAGED_SOURCE.search(key):
        return None, STAGED_REASON
    name = PurePosixPath(key).name
    lower = name.lower()
    suffix = PurePosixPath(lower).suffix
    if lower.endswith((".copc.laz", ".pmtiles", ".parquet", ".geoparquet")) or (
        _PROJECTED_RASTER.search(lower)
    ):
        return None, OUTPUT_REASON
    if suffix in _SHAPEFILE_PARTS:
        return None, LOOSE_PART_REASON
    if suffix in (".las", ".laz"):
        return copc.KIND, None
    if suffix in (".tif", ".tiff"):
        return cog.KIND, None
    if suffix == ".zip" or is_geopackage(name) or pmtiles.is_vector_file(name):
        return pmtiles.KIND, None
    return None, UNSUPPORTED_REASON


def max_processing_servers():
    """The most conversions a batch may run at once: servers on demand, else jobs on the one server."""
    if settings.CLOUDNATIVEGIS_ON_DEMAND:
        return settings.CLOUDNATIVEGIS_BULK_MAX_SERVERS
    return settings.CLOUDNATIVEGIS_BULK_MAX_CONCURRENCY


def _clean_prefix(prefix):
    """A folder as a key prefix: no leading slash, one trailing slash."""
    trimmed = (prefix or "").strip().strip("/")
    return f"{trimmed}/" if trimmed else ""


# Where a batch's layers go: "beside" each file (a folder per layer next to it),
# the bucket's top level ("root", where other uploads' layers are), or "folder".
DESTINATIONS = ("beside", "root", "folder")


def destination_mode(destination, destination_prefix):
    """Where layers go, as (mode, folder prefix): `destination`, or what the prefix implies.

    Without a `destination`, a `destination_prefix` means "folder" and none
    "beside". Raises ValueError for an unknown mode, or a folder not named.
    """
    prefix = _clean_prefix(destination_prefix)
    mode = destination or ("folder" if prefix else "beside")
    if mode not in DESTINATIONS:
        raise ValueError(
            f"Layers go beside the files, to the top level or into a folder, not {mode!r}."
        )
    if mode == "folder" and not prefix:
        raise ValueError("Name the folder the layers go into.")
    return mode, prefix if mode == "folder" else ""


def job_key(key, mode="beside", destination_prefix=""):
    """The key a file's job publishes beside: its own, or in the top level or the destination folder.

    A layer is a folder named after the file, next to this key (see target_folder).
    """
    name = PurePosixPath(key).name
    if mode == "root":
        return name
    if mode == "folder":
        return f"{_clean_prefix(destination_prefix)}{name}"
    return key


def _list_files(s3_client, prefix, recursive):
    """The files in `prefix` ((key, size)), whether there were more than the limit, and
    the published folders among them (those holding a catalog.json or collection.json).

    Only those directly in it unless `recursive`. Refuses a folder that is
    itself a Portolan catalog or layer: its files are CloudBench's outputs.
    """
    files = []
    token = None
    while True:
        page = s3_client.list_objects(
            prefix=prefix,
            delimiter="" if recursive else "/",
            max_keys=1000,
            continuation_token=token,
        )
        for obj in page["objects"]:
            key = obj["key"]
            if key.endswith("/") or (not recursive and "/" in key[len(prefix) :]):
                continue
            files.append((key, obj.get("size") or 0))
        if len(files) > PREVIEW_LIMIT or not page.get("isTruncated"):
            break
        token = page.get("nextContinuationToken")
    # The folders a catalog.json or collection.json is in: published layers and groups.
    published = {
        str(PurePosixPath(key).parent)
        for key, _size in files
        if PurePosixPath(key).name in ("catalog.json", "collection.json")
    }
    if prefix.strip("/") in published:
        raise ValueError(
            "That folder is a Portolan catalog or one of its layers: its files are "
            "converted layers already. Pick the folder the source files are in."
        )
    files.sort()
    return files[:PREVIEW_LIMIT], len(files) > PREVIEW_LIMIT, published


def list_folders(user, connection_id, prefix=""):
    """The subfolders of `prefix` that may hold source files: [{prefix, name}].

    Leaves out what CloudBench wrote - published layers and layer groups (the
    root catalog's children) and the `sources/` folders that keep a
    conversion's staged originals - so the folder picker never leads to a
    folder preview refuses. "" is the bucket's top level.
    """
    prefix = _clean_prefix(prefix)
    s3_client = get_s3_client(connection_id, user)
    hidden = portolan.published_folders(s3_client)
    folders = []
    token = None
    while True:
        page = s3_client.list_objects(
            prefix=prefix, delimiter="/", max_keys=1000, continuation_token=token
        )
        for folder in page.get("prefixes", []):
            name = folder[len(prefix) :].strip("/")
            if name and name != "sources" and folder.strip("/") not in hidden:
                folders.append({"prefix": folder, "name": name})
        if not page.get("isTruncated"):
            break
        token = page.get("nextContinuationToken")
    return folders


def _child_folders(s3_client, parent):
    """The names of the folders directly in `parent` ("" is the bucket) that hold anything."""
    prefix = f"{parent}/" if parent else ""
    names = set()
    token = None
    while True:
        page = s3_client.list_objects(
            prefix=prefix, delimiter="/", max_keys=1000, continuation_token=token
        )
        names.update(folder[len(prefix) :].strip("/") for folder in page.get("prefixes", []))
        if not page.get("isTruncated"):
            return names
        token = page.get("nextContinuationToken")


def _entries(source_client, destination_client, prefix, mode, destination_prefix, recursive):
    """The folder's files, each as {key, name, size, kind, exists, target, skipReason}.

    The folder is read from `source_client`'s bucket; the layers go to
    `destination_client`'s (the same one unless the batch crosses buckets).
    `target` is the layer folder a file would publish into, and `exists`
    whether that already holds data - found with one listing of each folder
    the layers go into, not a request per layer. Two files that would publish
    into the same folder (roads.zip and roads.geojson) can't both: the second
    is left alone.
    """
    files, truncated, published = _list_files(source_client, prefix, recursive)
    claimed = {}
    entries = []
    for key, size in files:
        name = PurePosixPath(key).name
        kind, reason = classify(key)
        if kind and any(key.startswith(f"{folder}/") for folder in published):
            kind, reason = None, PUBLISHED_REASON
        entry = {
            "key": key,
            "name": name,
            "size": size,
            "kind": kind,
            "exists": False,
            "target": None,
            "skipReason": reason,
        }
        if kind:
            output = _OUTPUT_KEY[kind](job_key(key, mode, destination_prefix))
            try:
                folder = target_folder(output, name)
            except ValueError as exc:
                entry["kind"], entry["skipReason"] = None, str(exc)
            else:
                if folder in claimed:
                    entry["kind"] = None
                    entry["skipReason"] = f"Same layer name as {claimed[folder]}"
                else:
                    claimed[folder] = name
                    entry["target"] = folder
                    entry["output"] = output
        entries.append(entry)
    existing = {}
    for entry in entries:
        if entry["target"]:
            parent, _, name = entry["target"].rpartition("/")
            if parent not in existing:
                existing[parent] = _child_folders(destination_client, parent)
            entry["exists"] = name in existing[parent]
    return entries, truncated


def _source_connection_id(connection_id, source_connection_id):
    """The connection the folder is read from, or None if that's `connection_id` (the same bucket)."""
    if not source_connection_id or str(source_connection_id) == str(connection_id):
        return None
    return str(source_connection_id)


def _clients(user, connection_id, source_connection_id):
    """The clients for the layers' bucket and the folder's: (destination, source).

    One and the same client when the folder is in the layers' own bucket.
    """
    destination_client = get_s3_client(connection_id, user)
    source_id = _source_connection_id(connection_id, source_connection_id)
    return destination_client, get_s3_client(source_id, user) if source_id else destination_client


def preview(
    user,
    connection_id,
    prefix,
    destination_prefix="",
    recursive=False,
    destination=None,
    source_connection_id=None,
):
    """What bulk upload would do with a folder: {prefix, files, truncated, limits}.

    Reads the buckets only. `prefix` is a folder of `source_connection_id`'s
    bucket (default: the same as `connection_id`, where the layers go). Each
    file says its conversion (`kind`), or why it is left alone (`skipReason`),
    the folder its layer would be (`target`) - which depends on `destination`
    (see destination_mode) - and whether that already exists.
    """
    prefix = _clean_prefix(prefix)
    if not prefix:
        raise ValueError("Pick a folder: bulk upload doesn't convert a whole bucket.")
    destination_client, source_client = _clients(user, connection_id, source_connection_id)
    mode, destination_prefix = destination_mode(destination, destination_prefix)
    entries, truncated = _entries(
        source_client, destination_client, prefix, mode, destination_prefix, recursive
    )
    return {
        "prefix": prefix,
        "files": [{k: v for k, v in entry.items() if k != "output"} for entry in entries],
        "truncated": truncated,
        "limits": {
            "maxConcurrency": max_processing_servers(),
            "onDemand": settings.CLOUDNATIVEGIS_ON_DEMAND,
        },
    }


def start_batch(
    user,
    connection_id,
    *,
    prefix,
    files,
    concurrency,
    license_id=portolan.DEFAULT_LICENSE,
    license_url="",
    destination_prefix="",
    on_exists=CngLiteBatch.OnExists.SKIP,
    recursive=False,
    destination=None,
    source_connection_id=None,
    create_vrt=False,
    vrt_name="",
    server_type_id=None,
    auto_destroy=True,
):
    """Start converting the chosen `files` (keys) of folder `prefix`, `concurrency` at a time.

    On demand, "at a time" is servers: the batch starts up to `concurrency` of
    them, as `server_type_id` (required), each running one layer at a time,
    and deletes them once they're not needed unless `auto_destroy` is off (see
    apps.s3.bulk_servers).

    The layers go to `connection_id`'s bucket; the folder is in the same one,
    or in `source_connection_id`'s - each file is then converted where it is,
    and only read. `destination` says where in the bucket the layers go:
    "beside" each file (the same path), its "root" (where other uploads'
    layers are) or "folder" `destination_prefix`.
    The folder is read again, so what runs is what's in the bucket now.
    Every layer becomes a QUEUED job; a layer whose folder exists is
    skipped, replaced or - `stop` - fails when its turn comes, per
    `on_exists`. `create_vrt` also publishes, once they are done, a VRT
    collection `vrt_name` of the GeoTIFFs that were converted (see apps.s3.bulk_vrt).
    Raises ValueError for what can't be started: CloudNativeGIS
    not configured, no server type picked on demand, a bad N or
    policy, a file that isn't in the folder or isn't a layer, nothing
    chosen, or a batch of this user's already running.
    """
    if not CngLiteJob.is_valid():
        raise ValueError("CloudNativeGIS is not configured.")
    on_demand = settings.CLOUDNATIVEGIS_ON_DEMAND
    if on_demand and not server_type_id:
        raise ValueError("Pick a server to run the conversions on.")
    maximum = max_processing_servers()
    if not isinstance(concurrency, int) or not 1 <= concurrency <= maximum:
        raise ValueError(f"Processing servers must be between 1 and {maximum}.")
    if on_exists not in CngLiteBatch.OnExists.values:
        raise ValueError(f"If a layer exists: skip, replace or stop, not {on_exists!r}.")
    prefix = _clean_prefix(prefix)
    if not prefix:
        raise ValueError("Pick a folder: bulk upload doesn't convert a whole bucket.")
    if CngLiteBatch.objects.filter(owner=user, status__in=CngLiteBatch.ACTIVE).exists():
        raise ValueError("A bulk upload is already running: wait for it, or cancel it.")

    s3_client, source_client = _clients(user, connection_id, source_connection_id)
    source_id = _source_connection_id(connection_id, source_connection_id)
    mode, destination_prefix = destination_mode(destination, destination_prefix)
    entries, _truncated = _entries(
        source_client, s3_client, prefix, mode, destination_prefix, recursive
    )
    by_key = {entry["key"]: entry for entry in entries}
    chosen = []
    for key in dict.fromkeys(files):
        entry = by_key.get(key)
        if entry is None:
            raise ValueError(f"{key} isn't in {prefix}.")
        if not entry["kind"]:
            raise ValueError(f"{entry['name']} can't be converted: {entry['skipReason']}.")
        chosen.append(entry)
    if not chosen:
        raise ValueError("Select at least one layer.")
    if create_vrt:
        bulk_vrt.vrt_id(vrt_name)
        if sum(entry["kind"] == bulk_vrt.KIND for entry in chosen) < bulk_vrt.MIN_RASTERS:
            raise ValueError("A VRT needs at least two GeoTIFFs: choose two or more.")

    license_id = portolan.normalize_license(license_id)
    batch = CngLiteBatch.objects.create(
        owner=user,
        connection_id=connection_id,
        source_connection_id=source_id,
        source_bucket=(source_client.bucket or source_id) if source_id else "",
        source_prefix=prefix,
        destination_prefix=destination_prefix,
        license=license_id,
        license_url=license_url if license_id == "other" else "",
        on_exists=on_exists,
        concurrency=concurrency,
        hetzner_server_id=server_type_id if on_demand else None,
        auto_destroy=bool(auto_destroy),
        create_vrt=bool(create_vrt),
        vrt_name=vrt_name.strip() if create_vrt else "",
        vrt={"state": bulk_vrt.PENDING} if create_vrt else {},
    )
    skipped = []
    for entry in chosen:
        if entry["exists"] and on_exists == CngLiteBatch.OnExists.SKIP:
            skipped.append(
                {
                    "key": entry["key"],
                    "name": entry["name"],
                    "kind": entry["kind"],
                    "target": entry["target"],
                    "reason": "Already published: skipped",
                }
            )
            continue
        CngLiteJob.objects.create(
            batch=batch,
            kind=entry["kind"],
            owner=user,
            connection_id=connection_id,
            bucket=s3_client.bucket,
            source_name=entry["name"],
            origin_key=entry["key"],
            # On demand the batch starts and deletes the servers, not its layers.
            auto_destroy=not on_demand,
            source_in_place=bool(source_id),
            source_connection_id=source_id,
            output_key=entry["output"],
            input_size=entry["size"],
            license=batch.license,
            license_url=batch.license_url,
            replace_existing=entry["exists"] and on_exists == CngLiteBatch.OnExists.REPLACE,
            status=CngLiteJobStatus.QUEUED,
            message="Waiting for a processing server",
        )
    if skipped:
        batch.skipped = skipped
        batch.save(update_fields=["skipped", "updated_at"])
    _start_coordinator(batch.id)
    return batch


# -- The scheduler ---------------------------------------------------------------


def _start_coordinator(batch_id):
    threading.Thread(target=run_batch, args=(batch_id,), daemon=True).start()


def run_batch(batch_id):
    """Run a batch to its end: start its jobs as slots free up, until none is left.

    One per batch, in a thread of the process that started it (or the
    resume_conversions command, for one a restart interrupted). Idempotent
    over the jobs' statuses, so it can be run again to carry a batch on.
    """
    close_old_connections()
    try:
        while step_batch(batch_id):
            time.sleep(settings.CLOUDNATIVEGIS_POLL_INTERVAL)
    except Exception:
        logger.exception("Bulk upload %s stopped unexpectedly", batch_id)
    finally:
        close_old_connections()


def step_batch(batch_id):
    """Do what a batch needs now; True while it still has jobs to wait for.

    Cancelling: the waiting jobs are cancelled and the running ones asked to
    stop. Otherwise - unless "stop" has been hit by a failure - waiting
    jobs are started on the free slots (on demand, the free servers: see
    apps.s3.bulk_servers). It ends once nothing waits or runs - and, on
    demand, once the servers the batch started are deleted.
    """
    batch = CngLiteBatch.objects.filter(pk=batch_id).first()
    if batch is None or not batch.is_active:
        return False
    if batch.on_demand:
        bulk_servers.sync(batch)
    jobs = list(batch.jobs.order_by("created_at", "source_name"))
    queued = [job for job in jobs if job.status == CngLiteJobStatus.QUEUED]
    running = [job for job in jobs if job.status in ACTIVE_CNG_LITE_JOB_STATUSES]

    if batch.status == CngLiteBatch.Status.CANCELLING:
        _cancel_queued(queued, "Conversion cancelled")
        for job in running:
            _stop(job)
    elif batch.on_exists == CngLiteBatch.OnExists.STOP and any(
        job.status == CngLiteJobStatus.FAILED for job in jobs
    ):
        _cancel_queued(queued, "Not started: the batch stops at the first failure")
    elif batch.on_demand:
        _start_on_servers(batch, queued, running)
    else:
        for job in queued[: max(batch.concurrency - len(running), 0)]:
            _start_job(job)

    if batch.jobs.filter(
        status__in=[CngLiteJobStatus.QUEUED, *ACTIVE_CNG_LITE_JOB_STATUSES]
    ).exists():
        return True
    if batch.status == CngLiteBatch.Status.RUNNING:
        _publish_vrt(batch)
    if batch.on_demand and bulk_servers.stopping(batch):
        return True
    _finish_batch(batch)
    return False


def _start_on_servers(batch, queued, running):
    """On demand: start the servers the layers need, and give each waiting layer a free one.

    N servers at most, each running one layer: as many as there are layers
    waiting or running. With none waiting, the servers not running one are
    deleted - nothing needs them. If no server can be had (too many failed to
    start, and none is running), the waiting layers fail.
    """
    if not queued:
        bulk_servers.release_idle(batch)
        return
    bulk_servers.start_missing(batch, min(batch.concurrency, len(queued) + len(running)))
    free = bulk_servers.free(batch)
    for job, server in zip(queued, free, strict=False):
        CngLiteJob.objects.filter(pk=job.pk, status=CngLiteJobStatus.QUEUED).update(
            instance_server=server,
            hetzner_server_id=server.type_id,
            # The batch deletes its servers, not the layers that ran on them.
            auto_destroy=False,
            updated_at=timezone.now(),
        )
        job.refresh_from_db()
        _start_job(job)
    if bulk_servers.gave_up(batch):
        error = f"No server could be started: {bulk_servers.last_error(batch)}"
        for job in queued[len(free) :]:
            _fail(job, error)


def _publish_vrt(batch):
    """Build the batch's VRT collection, once its layers are all over (if it asked for one).

    Claimed by whoever sets it `building`, so it is built once; whatever goes
    wrong is the VRT's alone - the batch's layers are published already.
    """
    if not (batch.create_vrt and batch.vrt.get("state") == bulk_vrt.PENDING):
        return
    claimed = CngLiteBatch.objects.filter(pk=batch.pk, vrt__state=bulk_vrt.PENDING).update(
        vrt={"state": bulk_vrt.BUILDING, "message": "Building the VRT"}, updated_at=timezone.now()
    )
    if not claimed:
        return
    try:
        state = bulk_vrt.publish(batch)
    except Exception as exc:
        logger.exception("Bulk upload %s: couldn't build its VRT", batch.id)
        state = {"state": bulk_vrt.FAILED, "message": f"Couldn't build the VRT: {exc}"}
    CngLiteBatch.objects.filter(pk=batch.pk).update(vrt=state, updated_at=timezone.now())


def _cancel_queued(jobs, message):
    for job in jobs:
        CngLiteJob.objects.filter(pk=job.pk, status=CngLiteJobStatus.QUEUED).update(
            status=CngLiteJobStatus.CANCELLED,
            message=message,
            completed_at=timezone.now(),
            updated_at=timezone.now(),
        )


def _stop(job):
    """Ask a running job to stop, if it still can be (not once publishing)."""
    with contextlib.suppress(ValueError):
        cancel_job(job)


def _start_job(job):
    """Give a queued job its slot: stage its source if it needs one, and run it in a thread of its own.

    A GeoPackage's original is copied to the job's own staging key, since
    the pipeline moves it into its layer group once converted (see
    _publish_source) - it must be its own disposable copy, not the user's
    original. Nothing else the pipeline converts is ever moved or deleted,
    so a plain file (shapefile, GeoTIFF, LAS/LAZ) converts where it already
    is instead, leaving no "sources/" copy behind - the same as one in
    another bucket than the layers go to, which is never copied either way
    (see CngLiteJob.source_in_place). Either way the key is set up front. A
    layer that already exists fails the job unless it replaces it (the
    batch's "stop" policy; see start_batch). Anything that stops it
    starting fails the job, not the batch.
    """
    batch = job.batch
    try:
        if not job.connection_id:
            raise ValueError("The S3 connection was deleted.")
        if job.source_in_place and not job.source_connection_id:
            raise ValueError(f'The connection to the "{batch.source_bucket}" bucket was deleted.')
        s3_client = get_s3_client(str(job.connection_id), job.owner)
        check_target(s3_client, job.output_key, job.source_name, job.replace_existing)
        if job.source_in_place or not is_geopackage(job.source_name):
            source_key = job.origin_key
        else:
            source_key = source_object_key(job.output_key, job.id, job.source_name)
            s3_client.client.copy(
                {"Bucket": job.bucket, "Key": job.origin_key}, job.bucket, source_key
            )
    except TargetExists as exc:
        _fail(job, f'A layer already exists in "{exc.folder}".')
    except Exception as exc:
        logger.exception("Bulk upload: couldn't start %s", job.id)
        _fail(job, str(exc) or "The file couldn't be read from the bucket.")
    else:
        CngLiteJob.objects.filter(pk=job.pk).update(
            status=CngLiteJobStatus.PENDING,
            source_key=source_key,
            message="Waiting to upload to CloudNativeGIS",
            updated_at=timezone.now(),
        )
        threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()


def _fail(job, error):
    finish_job(job, CngLiteJobStatus.FAILED, error=error, message=error)


def _finish_batch(batch):
    """End a batch whose jobs are all over, as what they add up to."""
    statuses = list(batch.jobs.values_list("status", flat=True))
    done = statuses.count(CngLiteJobStatus.COMPLETED) + len(batch.skipped)
    if batch.status == CngLiteBatch.Status.CANCELLING:
        final = CngLiteBatch.Status.CANCELLED
    elif CngLiteJobStatus.FAILED not in statuses:
        final = CngLiteBatch.Status.COMPLETED
    else:
        final = CngLiteBatch.Status.PARTIAL if done else CngLiteBatch.Status.FAILED
    CngLiteBatch.objects.filter(pk=batch.pk, status__in=CngLiteBatch.ACTIVE).update(
        status=final, completed_at=timezone.now(), updated_at=timezone.now()
    )


# -- Cancel, retry, resume ---------------------------------------------------------


def cancel_batch(batch):
    """Stop a batch: its waiting layers are cancelled, its running ones asked to stop.

    A layer already publishing finishes (it can't be cancelled half-written).
    The batch ends CANCELLED once none is left. Raises ValueError if it isn't running.
    """
    updated = CngLiteBatch.objects.filter(pk=batch.pk, status=CngLiteBatch.Status.RUNNING).update(
        status=CngLiteBatch.Status.CANCELLING, updated_at=timezone.now()
    )
    if not updated and not batch.is_active:
        raise ValueError("That bulk upload isn't running.")
    batch.refresh_from_db()
    # Don't wait for the coordinator's next look: nothing running means it's over now.
    # On demand its servers are to be deleted, which GeoHosting takes a while over:
    # that is the coordinator's, not this request's.
    if not batch.on_demand:
        step_batch(batch.pk)
        batch.refresh_from_db()
    return batch


def _requeue_and_run(batch, jobs):
    """Queue `jobs` of a finished `batch` again, and start running it.

    A job that got far enough to stage its source may have left files in
    its folder, so it replaces them; one that never got that far still
    doesn't. Shared by retry_failed and restart_batch - the only
    difference between them is which jobs qualify.
    """
    for job in jobs:
        CngLiteJob.objects.filter(pk=job.pk).update(
            status=CngLiteJobStatus.QUEUED,
            replace_existing=job.replace_existing or bool(job.source_key),
            source_key="",
            instance_server=None,
            progress=0,
            error="",
            message="Waiting for a processing server",
            outcome="",
            cng_job_id="",
            cng_results=None,
            cng_errors=None,
            output_keys=None,
            output_size=0,
            completed_at=None,
            updated_at=timezone.now(),
        )
    CngLiteBatch.objects.filter(pk=batch.pk).update(
        status=CngLiteBatch.Status.RUNNING,
        completed_at=None,
        # The layers queued again belong in the VRT too: build it again.
        vrt={"state": bulk_vrt.PENDING} if batch.create_vrt else {},
        updated_at=timezone.now(),
    )
    batch.refresh_from_db()
    _start_coordinator(batch.pk)
    return batch


def _check_nothing_else_running(batch):
    if CngLiteBatch.objects.filter(owner=batch.owner, status__in=CngLiteBatch.ACTIVE).exists():
        raise ValueError("A bulk upload is already running: wait for it, or cancel it.")


def retry_failed(batch):
    """Queue a finished batch's failed layers again, and start running it.

    Raises ValueError if the batch is running or nothing failed.
    """
    if batch.is_active:
        raise ValueError("That bulk upload is still running.")
    failed = list(batch.jobs.filter(status=CngLiteJobStatus.FAILED))
    if not failed:
        raise ValueError("Nothing failed in that bulk upload.")
    _check_nothing_else_running(batch)
    return _requeue_and_run(batch, failed)


def _finish_stuck_cancelling(batch):
    """Finish cancelling a batch nothing is driving any more, as CngLiteJobStatus.CANCELLED.

    Its coordinator calls _stop (cancel_job) on every running job once the
    batch is CANCELLING - but if it died before it got to one (the same
    silent death this is all for), that job is left active, never even
    asked to stop. So first, any of its jobs still cancellable (not
    publishing or otherwise genuinely unstoppable) that isn't CANCELLING
    yet is asked now, exactly as the coordinator would have. What's left -
    the same ones a restart would already finish this way (see
    resume_interrupted_conversions) - is finished as CANCELLED, but only
    once CANCELLING and gone untouched for CLOUDNATIVEGIS_BULK_CANCEL_STUCK_AFTER:
    a healthy cancel usually resolves within a poll or two on its own
    (asking just now counts as touching it, so it gets that long to), and
    racing whatever might still be finishing it - two different threads
    both call finish_job on the same job, one of them about to requeue it -
    is worse than waiting. Raises ValueError if any job is still active in
    some other, genuinely unstoppable way (e.g. publishing): that isn't
    this function's to resolve.
    """
    for job in batch.jobs.filter(status__in=CANCELLABLE_CNG_LITE_JOB_STATUSES):
        _stop(job)
    jobs = list(batch.jobs.filter(status__in=ACTIVE_CNG_LITE_JOB_STATUSES))
    stuck = [job for job in jobs if job.status == CngLiteJobStatus.CANCELLING]
    if len(stuck) != len(jobs):
        raise ValueError("That bulk upload is still cancelling: a layer is still being worked on.")
    cutoff = timezone.now() - timedelta(seconds=settings.CLOUDNATIVEGIS_BULK_CANCEL_STUCK_AFTER)
    if any(job.updated_at >= cutoff for job in stuck):
        raise ValueError("That bulk upload is still cancelling: give it a moment.")
    for job in stuck:
        # Claimed by this call only: anything else already finishing it is left alone.
        claimed = CngLiteJob.objects.filter(
            pk=job.pk, status=CngLiteJobStatus.CANCELLING, updated_at__lt=cutoff
        ).update(updated_at=timezone.now())
        if not claimed:
            continue
        shutil.rmtree(job_directory(job.kind, job.id), ignore_errors=True)
        finish_job(job, CngLiteJobStatus.CANCELLED, message="Conversion cancelled")
    step_batch(batch.pk)  # nothing active left: finishes the batch itself as cancelled
    batch.refresh_from_db()


def restart_batch(batch):
    """Finish cancelling a batch if nothing is still doing that, queue its unfinished
    layers again, and start running it.

    A batch stuck at `cancelling` - nothing left to drive it, e.g. after a
    restart - is finished first (see _finish_stuck_cancelling); once
    cancelled, its layers are either done or cancelled, none still running,
    so there is nothing left for a stray thread to race. On demand, that can
    still leave it cancelling - its servers take GeoHosting a while to
    delete - in which case this only gets that moving again (the coordinator
    wasn't running it any more either); restarting the layers themselves
    waits for a later call, once it is actually done. Raises ValueError if
    the batch isn't cancelled or cancelling, a layer is still genuinely
    running, or every layer was already done (nothing to restart).
    """
    if batch.status == CngLiteBatch.Status.CANCELLING:
        _finish_stuck_cancelling(batch)
        if batch.status == CngLiteBatch.Status.CANCELLING:
            _start_coordinator(batch.pk)
            raise ValueError(
                "Still finishing cancelling: its servers are still being deleted. "
                "Try restarting again once it shows as cancelled."
            )
    if batch.status != CngLiteBatch.Status.CANCELLED:
        raise ValueError("Only a cancelled bulk upload can be restarted.")
    unfinished = list(
        batch.jobs.filter(status__in=[CngLiteJobStatus.CANCELLED, CngLiteJobStatus.FAILED])
    )
    if not unfinished:
        raise ValueError("Nothing to restart: every layer already finished.")
    _check_nothing_else_running(batch)
    return _requeue_and_run(batch, unfinished)


def resume_batches():
    """Run every batch a restart left unfinished, to its end; returns how many.

    For when nothing else is running conversions (see the resume_conversions
    command): the jobs a batch had running are resumed first, by
    resume_interrupted_conversions, so what is left is its queued jobs.
    """
    batches = list(
        CngLiteBatch.objects.filter(status__in=CngLiteBatch.ACTIVE).order_by("created_at")
    )
    for batch in batches:
        logger.info("Resuming bulk upload %s", batch.id)
        if batch.vrt.get("state") == bulk_vrt.BUILDING:
            # Interrupted partway: nothing else is building it now.
            CngLiteBatch.objects.filter(pk=batch.pk).update(vrt={"state": bulk_vrt.PENDING})
        run_batch(batch.id)
    return len(batches)
