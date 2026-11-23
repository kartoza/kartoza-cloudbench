"""The bulk upload API."""

import logging
import uuid
from datetime import timedelta

from botocore.exceptions import BotoCoreError, ClientError
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import bulk
from .models import CngLiteBatch, S3Connection
from .views import _requested_auto_destroy, _requested_server_type_id

logger = logging.getLogger(__name__)

# Bulk uploads stay in the list (the Jobs panel) this long after they finish.
RECENT_BATCHES_WINDOW = timedelta(hours=24)
RECENT_BATCHES_LIMIT = 20


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


def _connection(request, conn_id):
    """The user's S3 connection `conn_id`, or None (not theirs, or no such id)."""
    try:
        return S3Connection.objects.filter(pk=uuid.UUID(str(conn_id)), owner=request.user).first()
    except ValueError:
        return None


def _batch(request, batch_id):
    """The user's bulk upload `batch_id`, or None."""
    try:
        return CngLiteBatch.objects.filter(pk=uuid.UUID(str(batch_id)), owner=request.user).first()
    except ValueError:
        return None


def _destination(data):
    """Where layers go, from a request: {destination, destination_prefix} for apps.s3.bulk.

    `destination` is "beside" (next to each file), "root" (the bucket's top
    level) or "folder" (`destinationPrefix`); left out, a prefix means a folder.
    """
    return {
        "destination": data.get("destination") or None,
        "destination_prefix": str(data.get("destinationPrefix") or ""),
    }


def _source_connection(request, data):
    """The connection a request reads its folder from: (id or None, error response or None).

    `sourceConnectionId` names another of the user's connections than the
    URL's (where the layers go); left out, the folder is in the URL's own.
    """
    source_id = data.get("sourceConnectionId")
    if not source_id:
        return None, None
    if _connection(request, source_id) is None:
        return None, _error("Source S3 connection not found", status.HTTP_404_NOT_FOUND)
    return str(source_id), None


class S3BulkFoldersView(APIView):
    """The folders of a connection's bucket that bulk upload can convert."""

    def get(self, request, conn_id):
        """GET ?prefix= -> {folders: [{prefix, name}]}: its subfolders, but not CloudBench's own.

        Published layers, layer groups and staged sources are left out (see
        apps.s3.bulk.list_folders).
        """
        if _connection(request, conn_id) is None:
            return _error("S3 connection not found", status.HTTP_404_NOT_FOUND)
        try:
            folders = bulk.list_folders(
                request.user, conn_id, request.query_params.get("prefix", "")
            )
        except (ClientError, BotoCoreError) as exc:
            return _error(str(exc), status.HTTP_502_BAD_GATEWAY)
        return Response({"folders": folders})


class S3BulkPreviewView(APIView):
    """What bulk upload would do with a folder of a connection's bucket."""

    def post(self, request, conn_id):
        """POST {prefix, destination, destinationPrefix, recursive, sourceConnectionId} -> the folder's files.

        The layers would go into the URL's connection; `prefix` is a folder of
        `sourceConnectionId`'s bucket, if given (else of the same).
        `destination`: "beside", "root" or "folder" (see apps.s3.bulk.destination_mode).

        Each says its conversion (or why it's left alone) and whether its
        layer already exists - see apps.s3.bulk.preview. Reads the bucket only.
        """
        if _connection(request, conn_id) is None:
            return _error("S3 connection not found", status.HTTP_404_NOT_FOUND)
        data = request.data
        source_id, error = _source_connection(request, data)
        if error:
            return error
        try:
            return Response(
                bulk.preview(
                    request.user,
                    conn_id,
                    str(data.get("prefix") or ""),
                    recursive=bool(data.get("recursive")),
                    source_connection_id=source_id,
                    **_destination(data),
                )
            )
        except ValueError as exc:
            return _error(str(exc))
        except (ClientError, BotoCoreError) as exc:
            return _error(str(exc), status.HTTP_502_BAD_GATEWAY)


class S3BulkStartView(APIView):
    """Start a bulk upload of a folder's layers."""

    def post(self, request, conn_id):
        """POST -> 202 and the batch.

        {prefix, files: [keys from the preview], concurrency, license,
        licenseUrl, destination: "beside" | "root" | "folder", destinationPrefix,
        onExists: "skip" | "replace" | "stop", recursive, sourceConnectionId,
        createVrt, vrtName, serverTypeId, autoDestroy}. `createVrt` also publishes
        a VRT collection `vrtName` of the converted GeoTIFFs (see apps.s3.bulk_vrt).
        On demand, `concurrency` is the number of servers started, as `serverTypeId`
        (required), deleted when done unless `autoDestroy` is "false".
        The layers go into the URL's connection, from a folder of
        `sourceConnectionId`'s bucket if given. 400 for what can't be
        started (see apps.s3.bulk.start_batch).
        """
        if _connection(request, conn_id) is None:
            return _error("S3 connection not found", status.HTTP_404_NOT_FOUND)
        data = request.data
        source_id, error = _source_connection(request, data)
        if error:
            return error
        files = data.get("files")
        if not isinstance(files, list) or not all(isinstance(key, str) for key in files):
            return _error("files must be a list of the folder's file keys.")
        try:
            concurrency = int(data.get("concurrency"))
        except (TypeError, ValueError):
            return _error("concurrency must be a number.")
        try:
            batch = bulk.start_batch(
                request.user,
                conn_id,
                prefix=str(data.get("prefix") or ""),
                files=files,
                concurrency=concurrency,
                license_id=str(data.get("license") or "other"),
                license_url=str(data.get("licenseUrl") or ""),
                on_exists=str(data.get("onExists") or CngLiteBatch.OnExists.SKIP),
                recursive=bool(data.get("recursive")),
                source_connection_id=source_id,
                create_vrt=bool(data.get("createVrt")),
                vrt_name=str(data.get("vrtName") or ""),
                server_type_id=_requested_server_type_id(data),
                auto_destroy=_requested_auto_destroy(data),
                **_destination(data),
            )
        except ValueError as exc:
            return _error(str(exc))
        except (ClientError, BotoCoreError) as exc:
            return _error(str(exc), status.HTTP_502_BAD_GATEWAY)
        return Response(batch.to_dict(), status=status.HTTP_202_ACCEPTED)


class S3BulkListView(APIView):
    """The user's bulk uploads."""

    def get(self, request):
        """GET -> the running ones and those finished in the last 24 h, newest first."""
        batches = (
            CngLiteBatch.objects.filter(owner=request.user)
            .filter(
                Q(status__in=CngLiteBatch.ACTIVE)
                | Q(completed_at__gte=timezone.now() - RECENT_BATCHES_WINDOW)
            )
            .order_by("-created_at")[:RECENT_BATCHES_LIMIT]
        )
        return Response([batch.to_dict() for batch in batches])


class S3BulkDetailView(APIView):
    """One bulk upload: its progress, and cancelling it."""

    def get(self, request, batch_id):
        """GET -> the batch, each layer with its status and progress."""
        batch = _batch(request, batch_id)
        if batch is None:
            return _error("Bulk upload not found", status.HTTP_404_NOT_FOUND)
        return Response(batch.to_dict())

    def delete(self, request, batch_id):
        """DELETE -> cancel it: waiting layers at once, running ones when they can stop."""
        batch = _batch(request, batch_id)
        if batch is None:
            return _error("Bulk upload not found", status.HTTP_404_NOT_FOUND)
        try:
            batch = bulk.cancel_batch(batch)
        except ValueError as exc:
            return _error(str(exc), status.HTTP_409_CONFLICT)
        return Response(batch.to_dict())


class S3BulkRetryView(APIView):
    """Convert the layers that failed again."""

    def post(self, request, batch_id):
        """POST -> the batch, running again; 409 if it's running or nothing failed."""
        batch = _batch(request, batch_id)
        if batch is None:
            return _error("Bulk upload not found", status.HTTP_404_NOT_FOUND)
        try:
            batch = bulk.retry_failed(batch)
        except ValueError as exc:
            return _error(str(exc), status.HTTP_409_CONFLICT)
        return Response(batch.to_dict())


class S3BulkRestartView(APIView):
    """Convert a cancelled batch's unfinished layers again."""

    def post(self, request, batch_id):
        """POST -> the batch, running again.

        409 if it isn't cancelled (or stuck cancelling - see
        apps.s3.bulk.restart_batch) or nothing's left to do.
        """
        batch = _batch(request, batch_id)
        if batch is None:
            return _error("Bulk upload not found", status.HTTP_404_NOT_FOUND)
        try:
            batch = bulk.restart_batch(batch)
        except ValueError as exc:
            return _error(str(exc), status.HTTP_409_CONFLICT)
        return Response(batch.to_dict())
