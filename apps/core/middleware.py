"""Custom middleware for Kartoza CloudBench."""

from django.conf import settings
from django.http import HttpResponse


class HealthCheckMiddleware:
    """Serve the container health check before Host header validation.

    Kubernetes' kubelet sends liveness/readiness probes straight to the
    pod's IP rather than the public hostname, so CommonMiddleware's
    ALLOWED_HOSTS check rejects them with DisallowedHost. This middleware
    must be listed first so it runs before that check, keeping
    ALLOWED_HOSTS strict for every other path.
    """

    def __init__(self, get_response):
        """Store the next middleware/view in the chain."""
        self.get_response = get_response

    def __call__(self, request):
        """Short-circuit /health/ requests, otherwise continue as normal."""
        if request.path == "/health/":
            return HttpResponse("OK", content_type="text/plain")
        return self.get_response(request)


class COOPCOEPMiddleware:
    """Middleware to add Cross-Origin isolation headers.

    Required for SharedArrayBuffer support needed by QGIS-js WebAssembly.
    Sets Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.
    """

    def __init__(self, get_response):
        """Initialize middleware."""
        self.get_response = get_response

    def __call__(self, request):
        """Process request and add COOP/COEP headers to response."""
        response = self.get_response(request)

        # Only add headers if enabled in settings
        if getattr(settings, "COOP_COEP_ENABLED", True):
            # Cross-Origin-Opener-Policy: same-origin
            # Required for SharedArrayBuffer
            response["Cross-Origin-Opener-Policy"] = "same-origin"

            # Cross-Origin-Embedder-Policy: require-corp
            # Required for SharedArrayBuffer
            response["Cross-Origin-Embedder-Policy"] = "require-corp"

        return response


class FrameAncestorsMiddleware:
    """Allow specific origins to embed CloudBench in an iframe.

    Replaces django.middleware.clickjacking.XFrameOptionsMiddleware, which
    only supports DENY/SAMEORIGIN and can't express "allow this other
    origin" — GeoHosting embeds CloudBench cross-origin via iframe (see
    kartoza-cloudbench's own README on the SSO handoff). CSP
    frame-ancestors is the modern replacement and takes precedence over
    X-Frame-Options in browsers that support it.
    """

    def __init__(self, get_response):
        """Store the next middleware/view in the chain."""
        self.get_response = get_response

    def __call__(self, request):
        """Add a Content-Security-Policy: frame-ancestors header."""
        response = self.get_response(request)

        ancestors = ["'self'"] + list(getattr(settings, "CLOUDBENCH_FRAME_ANCESTORS", []))
        response["Content-Security-Policy"] = f"frame-ancestors {' '.join(ancestors)}"

        return response
