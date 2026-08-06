"""File upload views for GeoServer API."""

from pathlib import Path

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.upload.views import _assemble_file, _get_session

from ..client import get_geoserver_client
from ..tasks import run_geoserver_upload


class GeoServerUploadCompleteView(APIView):
    """Assemble a chunked upload for GeoServer (file kept for the background task)."""

    def post(self, request, conn_id, workspace):
        session_id = request.data.get("sessionId")
        store_name = request.data.get("storeName")

        if not session_id:
            return Response(
                {"error": "sessionId is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = _get_session(session_id)
        if not session:
            return Response(
                {"error": "Upload session not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not session.is_complete():
            missing = session.total_chunks - len(session.received_chunks)
            return Response(
                {"error": f"Upload incomplete. Missing {missing} chunks."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            file_path = _assemble_file(session)
            final_store_name = store_name or session.store_name or Path(session.filename).stem
            return Response({
                "sessionId": session_id,
                "filename": session.filename,
                "fileSize": session.file_size,
                "path": str(file_path),
                "storeName": final_store_name,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class GeoServerUploadStartView(APIView):
    """Dispatch a background task to push an assembled file to GeoServer."""

    def post(self, request, conn_id, workspace):
        file_path = request.data.get("filePath")
        store_name = request.data.get("storeName")

        if not file_path or not store_name:
            return Response(
                {"error": "filePath and storeName are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not Path(file_path).exists():
            return Response(
                {"error": f"File not found: {file_path}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            get_geoserver_client(conn_id, str(request.user.id))
        except Exception:
            return Response(
                {"error": f"Connection not found: {conn_id}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = run_geoserver_upload(
            conn_id, str(request.user.id), workspace, store_name, file_path
        )
        if result.get("status") == "completed":
            return Response(
                {"status": "completed", "storeName": result.get("storeName", ""), "storeType": result.get("storeType", "")},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"status": "failed", "error": result.get("error", "")},
            status=status.HTTP_400_BAD_REQUEST,
        )


class GeoServerUploadStatusView(APIView):
    """Poll the status of a GeoServer upload background task."""

    def get(self, request, job_id):
        result = AsyncResult(job_id)
        job_status = _CELERY_STATE_MAP.get(result.state, result.state.lower())

        resp: dict = {"id": job_id, "status": job_status}

        if result.state == "SUCCESS" and isinstance(result.result, dict):
            if result.result.get("status") == "failed":
                resp["status"] = "failed"
                resp["error"] = result.result.get("error", "")
            else:
                resp["storeName"] = result.result.get("storeName", "")
                resp["storeType"] = result.result.get("storeType", "")
        elif result.state == "FAILURE":
            resp["error"] = str(result.result)

        return Response(resp)
