"""Views for chunked file upload.

Provides endpoints for:
- Initializing upload sessions
- Uploading file chunks
- Tracking progress
- Canceling uploads

The chunks are put together on disk by whoever uses them (the PostgreSQL import).

Uploads to GeoServer/GeoNode don't use these: they're relayed straight to the
target, never stored (RelayUploadView and below, apps/upload/relay.py).
"""

import re
import shutil
from pathlib import Path

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import connection, transaction
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import get_cache_dir
from apps.core.exceptions import GeoServerError, UploadError
from apps.geonode.client import ZIP_FILE, get_geonode_client
from apps.geoserver.client import get_geoserver_client, upload_store_type

from . import relay
from .models import UploadSession

User = get_user_model()

STORE_NAME = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _get_session(session_id: str) -> UploadSession | None:
    """Look up an upload session; a malformed (non-UUID) id is just not found."""
    try:
        return UploadSession.objects.filter(session_id=session_id).first()
    except (ValueError, ValidationError):
        return None


def _assemble_file(session: UploadSession) -> Path:
    if not session.is_complete():
        missing = set(range(session.total_chunks)) - set(session.received_chunks)
        raise UploadError(f"Missing chunks: {missing}", str(session.session_id))

    upload_dir = Path(session.upload_dir)
    final_path = upload_dir / session.filename
    with open(final_path, "wb") as outfile:
        for i in range(session.total_chunks):
            chunk_path = upload_dir / f"chunk_{i:06d}"
            with open(chunk_path, "rb") as chunk:
                outfile.write(chunk.read())

    session.completed = True
    session.save(update_fields=["completed"])
    return final_path


class UploadInitView(APIView):
    """Initialize a chunked upload session."""

    def post(self, request):
        """Create a new upload session.

        Expected body:
        {
            "filename": "data.shp.zip",
            "fileSize": 1048576,
            "chunkSize": 524288,
            "workspace": "topp",
            "connectionId": "conn_123",
            "storeName": "my_store"
        }
        """
        filename = request.data.get("filename")
        file_size = request.data.get("fileSize")
        chunk_size = request.data.get("chunkSize", 5 * 1024 * 1024)
        workspace = request.data.get("workspace", "")
        connection_id = request.data.get("connectionId", "")
        store_name = request.data.get("storeName", "")

        if not filename or not file_size:
            return Response(
                {"error": "filename and fileSize are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_size = getattr(settings, "UPLOAD_MAX_FILE_SIZE", 10 * 1024 * 1024 * 1024)
        if file_size > max_size:
            return Response(
                {"error": f"File too large. Maximum size is {max_size} bytes"},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        total_chunks = (file_size + chunk_size - 1) // chunk_size

        session = UploadSession(
            # request.user may be a lightweight stand-in from a trusted-
            # header/token auth path, not a real User row this FK can
            # point to, since CloudBench doesn't require a user table.
            user=request.user if isinstance(request.user, User) else None,
            filename=filename,
            file_size=file_size,
            chunk_size=chunk_size,
            total_chunks=total_chunks,
            workspace=workspace,
            connection_id=connection_id,
            store_name=store_name,
        )
        cache_dir = get_cache_dir()
        upload_dir = cache_dir / "uploads" / str(session.session_id)
        upload_dir.mkdir(parents=True, exist_ok=True)
        session.upload_dir = str(upload_dir)
        session.save()

        return Response(
            {
                "sessionId": str(session.session_id),
                "filename": session.filename,
                "fileSize": session.file_size,
                "chunkSize": session.chunk_size,
                "totalChunks": session.total_chunks,
            },
            status=status.HTTP_201_CREATED,
        )


class UploadChunkView(APIView):
    """Upload a single chunk."""

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        """Upload a chunk.

        Expected form data:
        - sessionId: Upload session ID
        - chunkIndex: Zero-based chunk index
        - chunk: The chunk data (file)
        """
        session_id = request.data.get("sessionId")
        chunk_index = request.data.get("chunkIndex")
        chunk_file = request.FILES.get("chunk")

        if not session_id or chunk_index is None or not chunk_file:
            return Response(
                {"error": "sessionId, chunkIndex, and chunk are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            chunk_index = int(chunk_index)
        except ValueError:
            return Response(
                {"error": "chunkIndex must be an integer"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = _get_session(session_id)
        if not session:
            return Response(
                {"error": "Upload session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if chunk_index < 0 or chunk_index >= session.total_chunks:
            return Response(
                {"error": f"Invalid chunk index. Must be 0-{session.total_chunks - 1}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            chunk_data = chunk_file.read()
            chunk_path = Path(session.upload_dir) / f"chunk_{chunk_index:06d}"
            with open(chunk_path, "wb") as f:
                f.write(chunk_data)

            with transaction.atomic():
                session = UploadSession.objects.select_for_update().get(session_id=session_id)
                if chunk_index not in session.received_chunks:
                    session.received_chunks = session.received_chunks + [chunk_index]
                    session.save(update_fields=["received_chunks"])

            return Response(
                {
                    "sessionId": session_id,
                    "chunkIndex": chunk_index,
                    "receivedChunks": len(session.received_chunks),
                    "totalChunks": session.total_chunks,
                    "progress": session.progress,
                }
            )
        except UploadError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UploadProgressView(APIView):
    """Get upload progress for a session."""

    def get(self, _request, session_id):
        """Get upload progress."""
        session = _get_session(session_id)
        if not session:
            return Response(
                {"error": "Upload session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "sessionId": str(session.session_id),
                "filename": session.filename,
                "fileSize": session.file_size,
                "receivedChunks": len(session.received_chunks),
                "totalChunks": session.total_chunks,
                "bytesReceived": session.bytes_received,
                "progress": session.progress,
                "completed": session.completed,
                "error": session.error,
            }
        )


class UploadCancelView(APIView):
    """Cancel an upload session."""

    def delete(self, _request, session_id):
        """Cancel and clean up an upload session."""
        session = _get_session(session_id)
        if not session:
            return Response(
                {"error": "Upload session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        upload_dir = Path(session.upload_dir)
        if upload_dir.exists():
            shutil.rmtree(upload_dir, ignore_errors=True)
        session.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


# === Uploads relayed straight to GeoServer/GeoNode (apps/upload/relay.py) ===

GEOSERVER = "geoserver"
GEONODE = "geonode"
MIN_CHUNK_SIZE = 1024 * 1024
MAX_CHUNK_SIZE = 50 * 1024 * 1024
CANCELLED_MESSAGE = "Cancelled"


def _own_session(request, session_id: str) -> UploadSession | None:
    """The session if it's the requesting user's (a stand-in user owns none)."""
    session = _get_session(session_id)
    if not session:
        return None
    if session.user_id is None:
        return None if isinstance(request.user, User) else session
    return session if getattr(request.user, "pk", None) == session.user_id else None


def _record_end(session_id: str):
    """What a relay calls when its upload ends: note it on the session row."""

    def on_done(state: str, error: str) -> None:
        try:
            UploadSession.objects.filter(session_id=session_id).update(
                completed=state == relay.COMPLETED,
                error=CANCELLED_MESSAGE if state == relay.CANCELLED else error,
            )
        finally:
            # The relay's thread has its own connection: don't leave it open.
            connection.close()

    return on_done


def _geoserver_sender(request, data: dict, filename: str, size: int, response_timeout: int):
    """Check a GeoServer upload can go ahead; returns (store name, workspace, send)."""
    workspace = data.get("workspace") or ""
    store_name = data.get("storeName") or Path(filename).stem
    if not workspace:
        raise UploadError("workspace is required")
    if not upload_store_type(filename):
        raise UploadError(f"Unsupported file type: {filename}")
    if not STORE_NAME.match(store_name):
        raise UploadError(
            "Store name must contain only letters, numbers, underscores, hyphens and dots"
        )
    client = get_geoserver_client(data.get("connectionId", ""), request.user)
    # Known before any data is sent: GeoServer only answers once it's all in.
    client.get_workspace(workspace)

    def send(content):
        try:
            return client.upload_store_file(
                workspace, store_name, filename, content, size, response_timeout
            )
        except GeoServerError as e:
            if e.status_code is None:  # no answer: the connection broke
                raise UploadError(f"Lost the connection to GeoServer: {e.message}") from e
            raise

    return store_name, workspace, send


def _geonode_sender(request, data: dict, filename: str, size: int, response_timeout: int):
    """Check a GeoNode upload can go ahead; returns send."""
    upload_type = data.get("uploadType", "dataset")
    if upload_type not in ("dataset", "document"):
        raise UploadError("uploadType must be dataset or document")
    client = get_geonode_client(data.get("connectionId", ""), request.user)
    # GeoNode only judges the size once it has the whole file: check first.
    limits = [
        client.get_upload_size_limit(f"{upload_type}_upload_size"),
        client.get_upload_size_limit("file_upload_handler"),
    ]
    limit = min((lim for lim in limits if lim), default=None)
    if limit and size > limit:
        raise UploadTooLarge(
            f"This GeoNode accepts {upload_type}s up to {_megabytes(limit)} "
            f"({_megabytes(size)} given). Its administrator can raise the limit "
            "under Upload size limits."
        )
    title = data.get("title") or None
    abstract = data.get("abstract") or None
    zipped_dataset = upload_type == "dataset" and filename.lower().endswith(".zip")
    # Asked each time: GeoNodes differ, and one can be upgraded.
    zip_field = client.zip_upload_field() if zipped_dataset else ZIP_FILE

    def send(content):
        try:
            if upload_type == "document":
                return client.upload_document(
                    content, filename, size, response_timeout, title=title, abstract=abstract
                )
            return client.upload_dataset(
                content,
                filename,
                size,
                response_timeout,
                title=title,
                abstract=abstract,
                zip_field=zip_field,
            )
        except httpx.TransportError as e:
            raise UploadError(f"Lost the connection to GeoNode: {e}") from e

    return send


def _megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):,.0f} MB"


class UploadTooLarge(UploadError):
    """The target won't take a file this big."""


class RelayUploadView(APIView):
    """Start an upload relayed straight to GeoServer or GeoNode."""

    def post(self, request):
        """Check the upload can go ahead, open the request to the target.

        Expected body:
        {
            "target": "geoserver" | "geonode",
            "connectionId": "conn_123",
            "filename": "roads.zip",
            "fileSize": 1048576,
            "chunkSize": 5242880,              // optional
            // GeoServer
            "workspace": "topp",
            "storeName": "roads",              // optional: the file's name
            // GeoNode
            "uploadType": "dataset" | "document",
            "title": "Roads",                  // optional
            "abstract": "..."                  // optional
        }
        """
        data = request.data
        target = data.get("target")
        filename = Path(data.get("filename") or "").name
        try:
            file_size = int(data.get("fileSize") or 0)
            chunk_size = int(data.get("chunkSize") or settings.UPLOAD_CHUNK_SIZE)
        except (TypeError, ValueError):
            return Response(
                {"error": "fileSize and chunkSize must be numbers"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if target not in (GEOSERVER, GEONODE):
            return Response(
                {"error": "target must be geoserver or geonode"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not filename or file_size <= 0:
            return Response(
                {"error": "filename and fileSize are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE:
            return Response(
                {"error": f"chunkSize must be {MIN_CHUNK_SIZE}-{MAX_CHUNK_SIZE} bytes"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        max_size = settings.UPLOAD_MAX_FILE_SIZE
        if file_size > max_size:
            return Response(
                {"error": f"File too large. Maximum size is {max_size} bytes"},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        response_timeout = settings.UPLOAD_RELAY_RESPONSE_TIMEOUT
        store_name = workspace = ""
        try:
            if target == GEOSERVER:
                store_name, workspace, send = _geoserver_sender(
                    request, data, filename, file_size, response_timeout
                )
            else:
                send = _geonode_sender(request, data, filename, file_size, response_timeout)
        except UploadTooLarge as e:
            return Response({"error": str(e)}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        except UploadError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:  # unknown connection
            return Response({"error": str(e)}, status=status.HTTP_404_NOT_FOUND)
        except GeoServerError as e:
            message = "Workspace not found" if e.status_code == 404 else str(e)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)

        session = UploadSession.objects.create(
            user=request.user if isinstance(request.user, User) else None,
            filename=filename,
            file_size=file_size,
            chunk_size=chunk_size,
            total_chunks=-(-file_size // chunk_size),
            upload_dir="",
            workspace=workspace,
            connection_id=data.get("connectionId", ""),
            store_name=store_name,
        )
        session_id = str(session.session_id)
        relay.Relay(
            session_id, file_size, chunk_size, send, on_done=_record_end(session_id)
        ).start()
        return Response(
            {
                "sessionId": session_id,
                "chunkSize": chunk_size,
                "totalChunks": session.total_chunks,
                "storeName": store_name,
            },
            status=status.HTTP_201_CREATED,
        )


def _relay_reply(reply: dict) -> Response:
    if reply.pop("ok"):
        return Response(reply)
    return Response(reply, status=reply.pop("status", 500))


class RelayChunkView(APIView):
    """Send one chunk of a relayed upload (the raw bytes as the body)."""

    def put(self, request, session_id, index):
        session = _own_session(request, session_id)
        if not session:
            return Response({"error": "Upload not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            length = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            length = 0
        if length > session.chunk_size:
            return Response(
                {"error": f"A chunk is at most {session.chunk_size} bytes"},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        # Read the stream, not request.body/data: no size cap, nothing spooled to disk.
        data = request._request.read(length) if length else b""
        try:
            return _relay_reply(relay.send_chunk(session_id, index, data))
        except relay.RelayGone:
            return Response(
                {"error": "The upload is no longer running; start it again", "state": "failed"},
                status=status.HTTP_410_GONE,
            )
        except TimeoutError:
            return Response(
                {"error": "Timed out waiting for the target"},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )


class RelayStatusView(APIView):
    """The state of a relayed upload, or cancel it."""

    def get(self, request, session_id):
        session = _own_session(request, session_id)
        if not session:
            return Response({"error": "Upload not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            return _relay_reply(relay.get_status(session_id))
        except relay.RelayGone:
            # The relay finished long ago, or its worker died: the row tells.
            if session.completed:
                state, error = relay.COMPLETED, ""
            elif session.error == CANCELLED_MESSAGE:
                state, error = relay.CANCELLED, ""
            else:
                state = relay.FAILED
                error = session.error or "The upload was interrupted; start it again"
            return Response({"state": state, "error": error, "result": None})

    def delete(self, request, session_id):
        session = _own_session(request, session_id)
        if not session:
            return Response({"error": "Upload not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            return _relay_reply(relay.cancel(session_id))
        except relay.RelayGone:
            return Response(status=status.HTTP_204_NO_CONTENT)
