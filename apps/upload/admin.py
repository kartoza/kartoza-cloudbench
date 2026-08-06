"""Admin registration for upload sessions."""

from django.contrib import admin

from .models import UploadSession


@admin.register(UploadSession)
class UploadSessionAdmin(admin.ModelAdmin):
    verbose_name = "Cloudbench Upload Session"
    list_display = [
        "session_id",
        "user",
        "filename",
        "workspace",
        "connection_id",
        "total_chunks",
        "completed",
        "created_at",
    ]
    list_filter = ["completed", "workspace"]
    search_fields = [
        "filename", "workspace", "connection_id", "session_id",
        "user__username"
    ]
    readonly_fields = [
        "session_id",
        "user",
        "filename",
        "file_size",
        "chunk_size",
        "total_chunks",
        "received_chunks",
        "upload_dir",
        "workspace",
        "connection_id",
        "store_name",
        "created_at",
        "completed",
        "error",
    ]
