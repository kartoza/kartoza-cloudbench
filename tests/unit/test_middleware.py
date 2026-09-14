"""Unit tests for the CSP frame-ancestors middleware."""

import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from apps.core.middleware import FrameAncestorsMiddleware


def _get_response(request):
    return HttpResponse("ok")


@pytest.mark.unit
class TestFrameAncestorsMiddleware:
    """Tests for FrameAncestorsMiddleware."""

    def test_defaults_to_self_only(self, settings) -> None:
        """No configured ancestors means only same-origin framing."""
        settings.CLOUDBENCH_FRAME_ANCESTORS = []
        middleware = FrameAncestorsMiddleware(_get_response)
        response = middleware(RequestFactory().get("/"))

        assert response["Content-Security-Policy"] == "frame-ancestors 'self'"

    def test_includes_configured_origins(self, settings) -> None:
        """Configured origins are appended after 'self'."""
        settings.CLOUDBENCH_FRAME_ANCESTORS = [
            "https://geohosting.example.com"
        ]
        middleware = FrameAncestorsMiddleware(_get_response)
        response = middleware(RequestFactory().get("/"))

        assert response["Content-Security-Policy"] == (
            "frame-ancestors 'self' https://geohosting.example.com"
        )
