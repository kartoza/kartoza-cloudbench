"""Custom exception handlers for Kartoza CloudBench."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    """Custom exception handler for consistent error responses.

    Returns errors in the format:
    {
        "error": "Error message",
        "detail": "Optional detailed message"
    }
    """
    # Call REST framework's default exception handler first
    response = exception_handler(exc, context)

    if response is not None:
        # Standardize error format
        error_data = {"error": str(exc)}

        if hasattr(exc, "detail"):
            if isinstance(exc.detail, dict) or isinstance(exc.detail, list):
                error_data["detail"] = exc.detail
            else:
                error_data["error"] = str(exc.detail)

        response.data = error_data

    return response


class GeoServerError(Exception):
    """Exception raised when GeoServer API calls fail."""

    def __init__(self, message: str, status_code: int | None = None):
        """Initialize GeoServer error."""
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class S3Error(Exception):
    """Exception raised when S3 operations fail."""

    def __init__(self, message: str, operation: str | None = None):
        """Initialize S3 error."""
        self.message = message
        self.operation = operation
        super().__init__(message)


class ConfigError(Exception):
    """Exception raised for configuration errors."""

    pass


class UploadError(Exception):
    """Exception raised for upload errors."""

    def __init__(self, message: str, session_id: str | None = None):
        """Initialize upload error."""
        self.message = message
        self.session_id = session_id
        super().__init__(message)


def handle_geoserver_error(exc: GeoServerError) -> Response:
    """Handle GeoServer errors and return appropriate response."""
    status_code = exc.status_code or status.HTTP_502_BAD_GATEWAY
    return Response(
        {"error": exc.message, "type": "geoserver_error"},
        status=status_code,
    )


def handle_s3_error(exc: S3Error) -> Response:
    """Handle S3 errors and return appropriate response."""
    return Response(
        {"error": exc.message, "operation": exc.operation, "type": "s3_error"},
        status=status.HTTP_502_BAD_GATEWAY,
    )
