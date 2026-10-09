"""URL configuration for upload app."""

from django.urls import path

from . import views

urlpatterns = [
    # Chunked upload endpoints
    path("upload/init", views.UploadInitView.as_view(), name="upload-init"),
    path("upload/chunk", views.UploadChunkView.as_view(), name="upload-chunk"),
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
    # Uploads relayed straight to GeoServer/GeoNode
    path("upload/relay", views.RelayUploadView.as_view(), name="upload-relay"),
    path(
        "upload/relay/<str:session_id>/chunks/<int:index>",
        views.RelayChunkView.as_view(),
        name="upload-relay-chunk",
    ),
    path(
        "upload/relay/<str:session_id>",
        views.RelayStatusView.as_view(),
        name="upload-relay-status",
    ),
]
