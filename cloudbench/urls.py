"""URL configuration for Kartoza CloudBench.

All API endpoints are mounted under /api/ to match the existing Go backend.
The React frontend is served from the root URL.
"""

import os

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, HttpResponse
from django.urls import include, path, re_path
from django.views.static import serve


def health_check(request):
    """Health check endpoint for container orchestration."""
    return HttpResponse("OK", content_type="text/plain")


def serve_react_app(request, path=""):
    """Serve React SPA - returns index.html for all non-file routes."""
    static_dir = settings.STATICFILES_DIRS[0]

    # If path points to an actual file, serve it
    if path:
        file_path = os.path.join(static_dir, path)
        if os.path.isfile(file_path):
            return serve(request, path, document_root=static_dir)

    # Otherwise serve index.html (SPA routing)
    index_path = os.path.join(static_dir, "index.html")
    return FileResponse(open(index_path, "rb"), content_type="text/html")


urlpatterns = [
    # Health check
    path("health/", health_check, name="health-check"),
    # Admin interface (optional, can be disabled in production)
    path("admin/", admin.site.urls),
    # API endpoints - matching the existing Go backend paths exactly
    path("api/", include("apps.connections.urls")),
    path("api/", include("apps.geoserver.urls")),
    path("api/", include("apps.gwc.urls")),
    path("api/", include("apps.postgres.urls")),
    path("api/", include("apps.upload.urls")),
    path("api/", include("apps.s3.urls")),
    path("api/", include("apps.ai.urls")),
    path("api/", include("apps.query.urls")),
    path("api/", include("apps.bridge.urls")),
    path("api/", include("apps.sqlview.urls")),
    path("api/", include("apps.sync.urls")),
    path("api/", include("apps.dashboard.urls")),
    path("api/", include("apps.search.urls")),
    path("api/", include("apps.terria.urls")),
    path("api/", include("apps.qfieldcloud.urls")),
    path("api/", include("apps.mergin.urls")),
    path("api/", include("apps.geonode.urls")),
    path("api/", include("apps.iceberg.urls")),
    path("api/", include("apps.qgis.urls")),
    path("api/", include("apps.core.urls")),
    path("api/", include("apps.preview.urls")),
    # Viewer endpoint (Terria/Cesium)
    path("viewer/", include("apps.terria.viewer_urls")),
]

# Serve static files (React frontend) in development and production
# WhiteNoise handles this efficiently in production
if settings.DEBUG:
    from django.conf.urls.static import static

    # Serve media files
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

    # Serve React frontend - but NOT for /api/, /admin/, /health/, /viewer/ paths
    # These are handled by the URL patterns above
    urlpatterns += [
        re_path(
            r"^(?!api/|admin/|health/|viewer/)(?P<path>.*)$",
            serve_react_app,
        ),
    ]
