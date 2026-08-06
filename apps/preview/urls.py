"""URL configuration for preview app."""

from django.urls import path

from . import views

urlpatterns = [
    # Start preview session
    path("preview/", views.StartPreviewView.as_view(), name="start_preview"),
    # Get layer info for preview
    path("preview/<str:session_id>/api/layer", views.PreviewLayerView.as_view(), name="preview_layer"),
    # Get metadata for preview
    path("preview/<str:session_id>/api/metadata", views.PreviewMetadataView.as_view(), name="preview_metadata"),
]
