"""Uploads from the browser straight into the bucket, as S3 multipart uploads.

The browser sends a file in chunks; each chunk is passed on to the bucket as
one part of a multipart upload as it arrives, and nothing is written to
CloudBench's disk or held beyond the one chunk. Unlike a relay to GeoServer
or GeoNode, S3 keeps the parts: a chunk can come to any worker, in any
order, be sent again after a dropped connection, or come much later - the
upload goes on until it's completed or aborted.

Its state is an UploadSession row: the S3 connection (connection_id), the
object key (store_name), the multipart UploadId (upload_dir, prefixed with
UPLOAD_ID_PREFIX), what kind of upload it is (workspace: PLAIN, SHAPEFILE...), and the
chunks received. The parts' ETags are asked of S3 (ListParts) when it's
completed.

What has to be read or rewritten before it's published is, in the bucket,
never on disk: a GeoPackage's layers are read where it landed (GDAL's
/vsis3/, which fetches only the pages it needs), and a shapefile's ZIP is
written straight into the bucket from its parts there (or from the ZIP
uploaded, read with range requests). Still staged on disk (S3UploadView and
friends): mosaics, and the style editor's saves.
"""

import io
import logging
import math
import mimetypes
import threading
import zipfile
from dataclasses import dataclass
from datetime import timedelta
from pathlib import PurePosixPath

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.upload.models import UploadSession

from . import cog, copc, pmtiles, portolan
from .client import get_s3_client
from .cng_lite import check_target, source_object_key, sources_directory_key
from .geopackage import GPKG_MAGIC, read_contents
from .models import CngLiteJob

logger = logging.getLogger(__name__)
User = get_user_model()

UPLOAD_ID_PREFIX = "s3-multipart:"
# S3's bounds on a multipart upload's parts.
MIN_PART_SIZE = 5 * 1024 * 1024
MAX_PARTS = 10_000
# An upload not completed in this long is aborted (S3 keeps, and bills,
# the parts of an incomplete one until then).
STALE_AFTER = timedelta(days=1)

# What an upload is (UploadSession.workspace):
PLAIN = ""  # one file, to its key
SHAPEFILE = "shapefile"  # a .shp and its parts, zipped to the key's .zip
PART = "part"  # one of a shapefile's other parts (completed with its .shp)
INSPECT = "inspect"  # a GeoPackage, to read its contents before converting
SHAPEFILE_PMTILES = "pmtiles-shapefile"  # a shapefile (parts or ZIP) -> PMTiles
# Single files converted: kind -> (module, files taken, how they start).
CONVERSIONS = {
    "cog": (cog, (".tif", ".tiff"), cog.TIFF_MAGIC),
    "copc": (copc, copc.SUFFIXES, (copc.LAS_MAGIC,)),
    "pmtiles": (pmtiles, tuple(pmtiles.VECTOR_FILE_TYPES), None),
}
# How a kind's (first) file starts: kind -> (magic, refusal).
_MAGIC = {
    "cog": (cog.TIFF_MAGIC, "The file is not a valid TIFF."),
    "copc": ((copc.LAS_MAGIC,), "The file is not a valid LAS/LAZ point cloud."),
    INSPECT: ((GPKG_MAGIC,), "The file is not a valid GeoPackage (not a SQLite database)."),
}
ZIP_MAGIC = (b"PK\x03\x04",)


class MultipartError(Exception):
    """An upload that can't go ahead, or a chunk that can't be taken."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Completed:
    """What a completed upload made: an object, and for a conversion its job."""

    key: str
    size: int
    job: CngLiteJob | None = None
    # A GeoPackage's contents (geopackage.read_contents), for INSPECT.
    inspection: dict | None = None


def part_size(file_size: int) -> int:
    """The chunk size for a file: 5 MB, more for a file of over 10 000 of those."""
    size = max(settings.UPLOAD_CHUNK_SIZE, MIN_PART_SIZE)
    if math.ceil(file_size / size) > MAX_PARTS:
        size = math.ceil(file_size / MAX_PARTS / (1024 * 1024)) * 1024 * 1024
    return size


def _is_shapefile(filename: str) -> bool:
    return filename.lower().endswith((".shp", ".zip"))


def kind_of(target_format: str | None, filename: str, companions: list[str]) -> str:
    """The kind of upload asked for (PLAIN, SHAPEFILE...); checks the files fit it."""
    lower = filename.lower()
    if companions and not lower.endswith(".shp"):
        raise MultipartError("Multiple files are supported only for matching shapefile components.")
    if not target_format:
        return SHAPEFILE if companions else PLAIN
    if target_format == INSPECT:
        if not lower.endswith(".gpkg"):
            raise MultipartError("Select a GeoPackage (.gpkg) file.")
        kind = INSPECT
    elif target_format == "pmtiles" and _is_shapefile(lower):
        kind = SHAPEFILE_PMTILES
    elif target_format in CONVERSIONS and not companions:
        _module, suffixes, _magic = CONVERSIONS[target_format]
        if not lower.endswith(suffixes):
            raise MultipartError(
                f"A {target_format.upper()} conversion takes {', '.join(suffixes)} files."
            )
        kind = target_format
    else:
        raise MultipartError(f"{target_format} conversions aren't uploaded this way")
    if not CngLiteJob.is_valid():
        raise MultipartError("CloudNativeGIS is not configured.")
    return kind


def _module(kind: str):
    """The conversion module of a kind; None for a plain upload."""
    if kind in CONVERSIONS:
        return CONVERSIONS[kind][0]
    if kind in (INSPECT, SHAPEFILE_PMTILES):
        return pmtiles
    return None


def _zip_name(filename: str) -> str:
    return f"{PurePosixPath(filename).stem}.zip"


def keys(kind: str, key: str, filename: str, session_id) -> tuple[str, str]:
    """(where the uploaded file goes, where the published object ends up).

    A shapefile's parts go to a sources folder for the upload, beside its
    target, and its ZIP to the target. A conversion's file goes to its
    job's source key (the session id is the job's id).
    """
    module = _module(kind)
    if kind == SHAPEFILE:
        zipped = str(PurePosixPath(key).with_suffix(".zip"))
        return f"{sources_directory_key(zipped, session_id)}/{filename}", zipped
    if module is None:
        return key, key
    output = module.output_key(key)
    if kind == SHAPEFILE_PMTILES:
        source = source_object_key(output, session_id, _zip_name(filename))
        if filename.lower().endswith(".zip"):
            # The ZIP uploaded is rewritten to the source key, so it lands apart.
            folder = sources_directory_key(output, session_id)
            return f"{folder}/upload/{filename}", source
        # The parts are kept as they are, beside the ZIP made of them.
        return f"{sources_directory_key(output, session_id)}/{filename}", source
    source = source_object_key(output, session_id, filename)
    return source, source


def content_type(kind: str, filename: str, style: bool) -> str:
    if style:
        return portolan.STYLE_MEDIA_TYPE
    if kind == "pmtiles":
        return pmtiles.VECTOR_FILE_TYPES[PurePosixPath(filename).suffix.lower()]
    if kind == "cog":
        return "image/tiff"
    if kind == "copc":
        return "application/vnd.las"
    if kind == INSPECT:
        return portolan.GEOPACKAGE_MEDIA_TYPE
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def _check_shapefile(filename: str, file_size: int, companions: list[dict]) -> None:
    names = [filename, *(c["filename"] for c in companions)]
    try:
        pmtiles.shapefile_components(names)
    except ValueError as exc:
        raise MultipartError(str(exc)) from exc
    if file_size + sum(c["fileSize"] for c in companions) > settings.UPLOAD_MAX_FILE_SIZE:
        raise MultipartError("The shapefile components exceed the upload size limit.", status=413)


def start(
    user,
    connection_id: str,
    filename: str,
    file_size: int,
    key: str,
    target_format,
    replace,
    companions: list[dict] | None = None,
) -> tuple[UploadSession, list[UploadSession]]:
    """Open a multipart upload (one per file), once all that can be checked first is.

    `companions` are a .shp's other parts ([{filename, fileSize}]). Returns
    the session of the file and those of its companions. Raises
    MultipartError, TargetExists (a conversion's layer folder holds data and
    `replace` isn't set), or ValueError (no such connection).
    """
    filename = PurePosixPath(filename or "").name
    companions = [
        {"filename": PurePosixPath(c.get("filename") or "").name, "fileSize": c.get("fileSize")}
        for c in companions or []
    ]
    if not filename or not isinstance(file_size, int) or file_size <= 0:
        raise MultipartError("filename and fileSize are required")
    if any(not c["filename"] or not isinstance(c["fileSize"], int) for c in companions):
        raise MultipartError("Each companion file needs a filename and fileSize")
    if file_size > settings.UPLOAD_MAX_FILE_SIZE:
        raise MultipartError("The file exceeds the upload size limit.", status=413)
    kind = kind_of(target_format, filename, [c["filename"] for c in companions])
    if companions or (kind == SHAPEFILE_PMTILES and filename.lower().endswith(".shp")):
        _check_shapefile(filename, file_size, companions)
    key = (key or filename).lstrip("/")
    s3_client = get_s3_client(connection_id, user)
    module = _module(kind)
    if module is not None:
        check_target(s3_client, module.output_key(key), filename, replace)
    abort_stale(user)

    files = [
        (filename, file_size, kind),
        *((c["filename"], c["fileSize"], PART) for c in companions),
    ]
    sessions = []
    main = None
    for name, size, file_kind in files:
        session = UploadSession(
            # A lightweight stand-in user (trusted-header auth) has no row to point to.
            user=user if isinstance(user, User) else None,
            filename=name,
            file_size=size,
            chunk_size=part_size(size),
            total_chunks=math.ceil(size / part_size(size)) if size else 1,
            connection_id=connection_id,
            workspace=file_kind,
        )
        # Every file of an upload goes where its first file's id says.
        upload_id = main.session_id if main else session.session_id
        session.store_name = keys(kind, key, filename, upload_id)[0]
        if main:
            session.store_name = f"{PurePosixPath(main.store_name).parent}/{name}"
        if len(session.store_name) > UploadSession._meta.get_field("store_name").max_length:
            raise MultipartError("The key is too long.")
        style = kind == PLAIN and portolan.layer_style(s3_client, key) is not None
        if kind in (SHAPEFILE, SHAPEFILE_PMTILES) or file_kind == PART:
            ctype = (
                "application/zip" if name.lower().endswith(".zip") else "application/octet-stream"
            )
        else:
            ctype = content_type(kind, name, style)
        created = s3_client.client.create_multipart_upload(
            Bucket=s3_client.bucket, Key=session.store_name, ContentType=ctype
        )
        session.upload_dir = UPLOAD_ID_PREFIX + created["UploadId"]
        session.save()
        main = main or session
        sessions.append(session)
    return sessions[0], sessions[1:]


def is_multipart(session: UploadSession) -> bool:
    return session.upload_dir.startswith(UPLOAD_ID_PREFIX)


def _upload_id(session: UploadSession) -> str:
    return session.upload_dir.removeprefix(UPLOAD_ID_PREFIX)


def expected_size(session: UploadSession, index: int) -> int:
    """How big chunk `index` must be: the chunk size, but the last one what's left."""
    return min(session.chunk_size, session.file_size - index * session.chunk_size)


def send_part(user, session: UploadSession, index: int, data: bytes) -> int:
    """Pass chunk `index` on to the bucket as a part; returns how many are in.

    A chunk sent again replaces its part (S3 keeps the last one), so a
    retry after a dropped connection is safe. A converted file's first
    chunk must start as its file type does.
    """
    if session.completed or session.error:
        raise MultipartError("This upload has ended", status=409)
    if not 0 <= index < session.total_chunks:
        raise MultipartError(f"Chunk {index} isn't one of this upload's {session.total_chunks}")
    if len(data) != expected_size(session, index):
        raise MultipartError(
            f"Chunk {index} is {len(data)} bytes, not {expected_size(session, index)}"
        )
    if index == 0:
        magic, refusal = _MAGIC.get(session.workspace, (None, ""))
        if session.workspace == SHAPEFILE_PMTILES and session.filename.lower().endswith(".zip"):
            magic, refusal = ZIP_MAGIC, "The shapefile ZIP is invalid, encrypted, or unsupported."
        if magic and not data.startswith(magic):
            raise MultipartError(refusal)
    s3_client = get_s3_client(session.connection_id, user)
    s3_client.client.upload_part(
        Bucket=s3_client.bucket,
        Key=session.store_name,
        UploadId=_upload_id(session),
        PartNumber=index + 1,
        Body=data,
    )
    with transaction.atomic():
        session = UploadSession.objects.select_for_update().get(pk=session.pk)
        if index not in session.received_chunks:
            session.received_chunks = sorted([*session.received_chunks, index])
            session.save(update_fields=["received_chunks"])
    return len(session.received_chunks)


def companions_of(session: UploadSession) -> list[UploadSession]:
    """The other parts of a shapefile `session` is the .shp of, in its folder."""
    if session.workspace not in (SHAPEFILE, SHAPEFILE_PMTILES):
        return []
    return list(
        UploadSession.objects.filter(
            user_id=session.user_id,
            connection_id=session.connection_id,
            workspace=PART,
            upload_dir__startswith=UPLOAD_ID_PREFIX,
            store_name__startswith=f"{PurePosixPath(session.store_name).parent}/",
        ).order_by("filename")
    )


def _parts(s3_client, session: UploadSession) -> list[dict]:
    """The parts S3 holds, as CompleteMultipartUpload takes them (with any checksums)."""
    parts, marker = [], 0
    while True:
        page = s3_client.client.list_parts(
            Bucket=s3_client.bucket,
            Key=session.store_name,
            UploadId=_upload_id(session),
            PartNumberMarker=marker,
        )
        for part in page.get("Parts", []):
            parts.append(
                {k: v for k, v in part.items() if k == "ETag" or k.startswith("Checksum")}
                | {"PartNumber": part["PartNumber"]}
            )
        if not page.get("IsTruncated"):
            return parts
        marker = page["NextPartNumberMarker"]


def _join(s3_client, session: UploadSession) -> None:
    """Complete one file's multipart upload, and check what the bucket holds."""
    if not session.is_complete():
        missing = sorted(set(range(session.total_chunks)) - set(session.received_chunks))
        raise MultipartError(f"Chunks missing from {session.filename}: {missing[:10]}")
    parts = _parts(s3_client, session)
    if [p["PartNumber"] for p in parts] != list(range(1, session.total_chunks + 1)):
        raise MultipartError("The bucket doesn't hold every part; send the missing ones again")
    s3_client.client.complete_multipart_upload(
        Bucket=s3_client.bucket,
        Key=session.store_name,
        UploadId=_upload_id(session),
        MultipartUpload={"Parts": parts},
    )
    size = s3_client.get_object_info(session.store_name)["contentLength"]
    if size != session.file_size:
        session.error = f"The bucket holds {size} bytes, not {session.file_size}"
        session.save(update_fields=["error"])
        raise MultipartError(session.error, status=502)
    session.completed = True
    session.save(update_fields=["completed"])


def complete(user, session: UploadSession, key: str, job_fields: dict) -> Completed:
    """Join the parts into the object(s), and do what the kind of upload asks.

    `key` must be the one the upload started with (where its objects go
    follows from it). `job_fields` are a conversion's CngLiteJob fields
    (license, server, replace...). A conversion's job is started; a
    GeoPackage's is left pending, with its contents read, for the layers to
    be picked (geopackage_convert.start_geopackage_conversion).
    """
    kind = session.workspace
    if kind == PART:
        raise MultipartError("Complete the upload of the .shp, which completes its parts")
    if session.completed:
        raise MultipartError("This upload is already complete", status=409)
    if session.error:
        raise MultipartError(session.error, status=409)
    key = (key or session.filename).lstrip("/")
    upload_key, target_key = keys(kind, key, session.filename, session.session_id)
    if upload_key != session.store_name:
        raise MultipartError("This isn't what the upload was started for")
    module = _module(kind)
    s3_client = get_s3_client(session.connection_id, user)
    if module is not None:
        check_target(
            s3_client,
            module.output_key(key),
            session.filename,
            job_fields.get("replace_existing", False),
        )

    companions = companions_of(session)
    for each in (session, *companions):
        _join(s3_client, each)
    input_size = session.file_size + sum(c.file_size for c in companions)

    if kind in (SHAPEFILE, SHAPEFILE_PMTILES):
        # Named as the upload's (a plain one) or the job's (a conversion), as staged ones are.
        identifier = session.session_id if module else PurePosixPath(session.filename).stem
        try:
            size = _zip_shapefile(s3_client, session, companions, target_key, identifier)
        except ValueError as exc:
            # Not a shapefile it can publish: nothing to keep.
            for each in (session, *companions):
                s3_client.delete_object(each.store_name)
            raise MultipartError(str(exc)) from exc
        if kind == SHAPEFILE or session.filename.lower().endswith(".zip"):
            # The ZIP is what's kept: drop what it was made from (as a staged
            # upload never stored it).
            for each in (session, *companions):
                s3_client.delete_object(each.store_name)
    else:
        size = session.file_size

    if module is None:
        style_of = kind == PLAIN and portolan.layer_style(s3_client, key)
        if style_of:
            portolan.record_style(s3_client, key, style_of, s3_client.get_object(key))
        return Completed(key=target_key, size=size)

    job = CngLiteJob.objects.create(
        id=session.session_id,
        kind=module.KIND,
        owner=user,
        connection_id=session.connection_id,
        bucket=s3_client.bucket,
        source_name=session.filename,
        output_key=module.output_key(key),
        input_size=input_size,
        source_key=target_key,
        **({"message": "Waiting for layer selection"} if kind == INSPECT else {}),
        **job_fields,
    )
    if kind != INSPECT:
        threading.Thread(target=module.run_conversion, args=(job.id,), daemon=True).start()
        return Completed(key=job.output_key, size=input_size, job=job)
    # Read where it landed: only the pages holding its gpkg_* tables are fetched.
    try:
        inspection = read_contents(*s3_client.gdal_path(target_key))
    except ValueError as exc:
        # Unreadable: nothing to convert, so nothing to keep.
        s3_client.delete_object(target_key)
        job.delete()
        raise MultipartError(str(exc)) from exc
    return Completed(key=job.output_key, size=input_size, job=job, inspection=inspection)


class _ObjectReader(io.RawIOBase):
    """An object in the bucket as a seekable, read-only file, read with range requests."""

    def __init__(self, s3_client, key: str):
        self.s3, self.key = s3_client, key
        self.size = s3_client.get_object_info(key)["contentLength"]
        self.position = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.position, io.SEEK_END: self.size}[whence]
        self.position = max(0, base + offset)
        return self.position

    def readinto(self, buffer):
        if self.position >= self.size or not len(buffer):
            return 0
        end = min(self.position + len(buffer), self.size) - 1
        data = self.s3.client.get_object(
            Bucket=self.s3.bucket, Key=self.key, Range=f"bytes={self.position}-{end}"
        )["Body"].read()
        buffer[: len(data)] = data
        self.position += len(data)
        return len(data)


class _MultipartWriter(io.RawIOBase):
    """A write-only, unseekable file into a new object, sent as a multipart upload."""

    def __init__(self, s3_client, key: str, content_type: str):
        self.s3, self.key = s3_client, key
        self.buffer = bytearray()
        self.parts: list[dict] = []
        self.written = 0
        self.upload_id = s3_client.client.create_multipart_upload(
            Bucket=s3_client.bucket, Key=key, ContentType=content_type
        )["UploadId"]

    def writable(self):
        return True

    def write(self, data):
        self.buffer += data
        self.written += len(data)
        while len(self.buffer) >= MIN_PART_SIZE:
            self._send(bytes(self.buffer[:MIN_PART_SIZE]))
            del self.buffer[:MIN_PART_SIZE]
        return len(data)

    def _send(self, data: bytes):
        number = len(self.parts) + 1
        sent = self.s3.client.upload_part(
            Bucket=self.s3.bucket,
            Key=self.key,
            UploadId=self.upload_id,
            PartNumber=number,
            Body=data,
        )
        # With any checksum it was sent with, which completing it may need.
        self.parts.append(
            {k: v for k, v in sent.items() if k == "ETag" or k.startswith("Checksum")}
            | {"PartNumber": number}
        )

    def finish(self) -> int:
        """Complete the object; returns its size."""
        if self.buffer or not self.parts:
            self._send(bytes(self.buffer))
            self.buffer.clear()
        self.s3.client.complete_multipart_upload(
            Bucket=self.s3.bucket,
            Key=self.key,
            UploadId=self.upload_id,
            MultipartUpload={"Parts": self.parts},
        )
        return self.written

    def abort(self):
        self.s3.client.abort_multipart_upload(
            Bucket=self.s3.bucket, Key=self.key, UploadId=self.upload_id
        )


def _zip_shapefile(s3_client, session, companions, target_key, identifier) -> int:
    """Write the shapefile's ZIP to `target_key`, from what's in the bucket; its size.

    From its parts (a .shp and its companions), or from the ZIP uploaded,
    validated as a staged one is (pmtiles.prepare_shapefile). Raises
    ValueError for a shapefile that isn't one.
    """
    if session.filename.lower().endswith(".shp"):
        files = {each.filename: each for each in (session, *companions)}
        components = pmtiles.shapefile_components(list(files))

        def opener(name):
            return lambda: s3_client.get_object_stream(files[name].store_name)

        openers = {suffix: opener(name) for suffix, name in components.items()}
        return _write_zip(s3_client, target_key, identifier, openers)
    source = io.BufferedReader(_ObjectReader(s3_client, session.store_name), 1024 * 1024)
    try:
        with zipfile.ZipFile(source) as archive:
            sidecars = pmtiles.zip_sidecars(archive)
            openers = {
                suffix: (lambda entry=entry: archive.open(entry))
                for suffix, entry in sidecars.items()
            }
            return _write_zip(s3_client, target_key, identifier, openers)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise ValueError("The shapefile ZIP is invalid, encrypted, or unsupported.") from exc


def _write_zip(s3_client, target_key, identifier, openers) -> int:
    writer = _MultipartWriter(s3_client, target_key, "application/zip")
    try:
        pmtiles.write_shapefile_zip(writer, identifier, openers)
    except BaseException:
        writer.abort()
        raise
    return writer.finish()


def abort(user, session: UploadSession, reason: str = "Cancelled") -> None:
    """Abort the multipart upload, and its parts' if it's a .shp: S3 drops what it has."""
    if session.completed:
        raise MultipartError("This upload is already complete", status=409)
    s3_client = None
    for each in (session, *companions_of(session)):
        if each.completed or each.error:
            continue
        try:
            s3_client = s3_client or get_s3_client(each.connection_id, user)
            s3_client.client.abort_multipart_upload(
                Bucket=s3_client.bucket, Key=each.store_name, UploadId=_upload_id(each)
            )
        except Exception:
            # Gone already, or the connection was deleted: nothing to keep.
            logger.warning("Aborting S3 upload %s failed", each.session_id, exc_info=True)
        each.error = reason
        each.save(update_fields=["error"])


def abort_stale(user) -> None:
    """Abort `user`'s uploads left incomplete for longer than STALE_AFTER."""
    if not isinstance(user, User):
        return
    stale = UploadSession.objects.filter(
        user=user,
        upload_dir__startswith=UPLOAD_ID_PREFIX,
        completed=False,
        error="",
        created_at__lt=timezone.now() - STALE_AFTER,
    )
    for session in stale:
        session.refresh_from_db()
        if not session.error:  # not already aborted with its .shp
            abort(user, session, reason="Abandoned")
