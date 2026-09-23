"""Unit tests for apps.core.exceptions."""

from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError

from apps.core.exceptions import (
    ConfigError,
    GeoServerError,
    S3Error,
    UploadError,
    custom_exception_handler,
    handle_geoserver_error,
    handle_s3_error,
)


class TestCustomExceptionHandler:
    """Tests for custom_exception_handler."""

    def test_returns_none_for_unhandled_exception_types(self) -> None:
        """A plain Python exception isn't a DRF APIException, so DRF's own
        handler declines it (returns None) and this handler passes that through."""
        assert custom_exception_handler(ValueError("boom"), {}) is None

    def test_standardizes_string_detail_into_error_key(self) -> None:
        response = custom_exception_handler(NotFound("Connection not found"), {})
        assert response is not None
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.data == {"error": "Connection not found"}

    def test_keeps_dict_detail_under_detail_key(self) -> None:
        exc = ValidationError({"name": ["This field is required."]})
        response = custom_exception_handler(exc, {})
        assert response is not None
        assert response.data["detail"] == {"name": ["This field is required."]}
        assert "error" in response.data

    def test_keeps_list_detail_under_detail_key(self) -> None:
        exc = ValidationError(["First error", "Second error"])
        response = custom_exception_handler(exc, {})
        assert response is not None
        assert response.data["detail"] == ["First error", "Second error"]


class TestCustomExceptionClasses:
    """Tests for the small exception dataclass-like carriers."""

    def test_geoserver_error_carries_status_code(self) -> None:
        exc = GeoServerError("layer not found", status_code=404)
        assert exc.message == "layer not found"
        assert exc.status_code == 404
        assert str(exc) == "layer not found"

    def test_s3_error_carries_operation(self) -> None:
        exc = S3Error("bucket missing", operation="list_objects")
        assert exc.message == "bucket missing"
        assert exc.operation == "list_objects"

    def test_config_error_is_a_plain_exception(self) -> None:
        assert isinstance(ConfigError("bad config"), Exception)

    def test_upload_error_carries_session_id(self) -> None:
        exc = UploadError("upload failed", session_id="abc-123")
        assert exc.message == "upload failed"
        assert exc.session_id == "abc-123"


class TestErrorResponseHelpers:
    """Tests for handle_geoserver_error / handle_s3_error."""

    def test_handle_geoserver_error_uses_exception_status_code(self) -> None:
        response = handle_geoserver_error(GeoServerError("timed out", status_code=504))
        assert response.status_code == 504
        assert response.data == {"error": "timed out", "type": "geoserver_error"}

    def test_handle_geoserver_error_defaults_to_bad_gateway(self) -> None:
        response = handle_geoserver_error(GeoServerError("unreachable"))
        assert response.status_code == status.HTTP_502_BAD_GATEWAY

    def test_handle_s3_error_reports_operation_and_bad_gateway(self) -> None:
        response = handle_s3_error(S3Error("access denied", operation="get_object"))
        assert response.status_code == status.HTTP_502_BAD_GATEWAY
        assert response.data == {
            "error": "access denied",
            "operation": "get_object",
            "type": "s3_error",
        }
