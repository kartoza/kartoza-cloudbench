"""Admin registration for upload sessions."""

from django.contrib import admin

from .models import UploadJob, UploadSession


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
    search_fields = ["filename", "workspace", "connection_id", "session_id", "user__username"]
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


@admin.register(UploadJob)
class UploadJobAdmin(admin.ModelAdmin):
    list_display = ["output", "kind", "status", "progress", "target", "user", "created_at"]
    list_filter = ["kind", "status"]
    search_fields = ["output", "source_name", "target", "user__username"]
    readonly_fields = [field.name for field in UploadJob._meta.fields]
