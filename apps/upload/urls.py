"""URL configuration for upload app."""

from django.urls import path

from . import views

urlpatterns = [
    # Chunked upload endpoints
    path("upload/init", views.UploadInitView.as_view(), name="upload-init"),
    path("upload/chunk", views.UploadChunkView.as_view(), name="upload-chunk"),
    path("upload/complete", views.UploadCompleteView.as_view(), name="upload-complete"),
    path(
        "upload/session/<str:session_id>/progress",
        views.UploadProgressView.as_view(),
        name="upload-progress",
    ),
    path(
        "upload/session/<str:session_id>",
        views.UploadCancelView.as_view(),
        name="upload-cancel",
    ),
    # Background work on an uploaded file (e.g. a PostGIS import): its status
    path("upload/jobs/<uuid:job_id>", views.UploadJobView.as_view(), name="upload-job"),
    # Simple upload endpoint
    path("upload", views.SimpleUploadView.as_view(), name="upload-simple"),
]
