"""Admin registration for S3 connections and CloudNativeGIS Lite jobs."""

from django.contrib import admin, messages

from apps.core.admin import mask_secret
from apps.core.geohosting import GeoHostingError

from .models import CngLiteJob, CngLiteJobLog, CngLiteServer, S3Connection


@admin.register(S3Connection)
class S3ConnectionAdmin(admin.ModelAdmin):
    verbose_name = "S3 Connection"
    list_display = [
        "name",
        "owner",
        "endpoint",
        "bucket",
        "region",
        "use_ssl",
        "path_style",
        "is_active",
        "created_at",
    ]
    list_filter = ["use_ssl", "path_style", "is_active"]
    search_fields = ["name", "endpoint", "bucket", "owner__username"]
    readonly_fields = ["id", "masked_access_key", "masked_secret_key", "created_at", "updated_at"]
    # access_key/secret_key are encrypted at rest (see apps/core/fields.py) —
    # excluded here so the admin never displays them in plaintext, even to
    # staff; masked_* below shows just enough to recognize which key it is.
    exclude = ["access_key", "secret_key"]

    @admin.display(description="Access key")
    def masked_access_key(self, obj: S3Connection) -> str:
        return mask_secret(obj.access_key)

    @admin.display(description="Secret key")
    def masked_secret_key(self, obj: S3Connection) -> str:
        return mask_secret(obj.secret_key)


class CngLiteJobLogInline(admin.TabularInline):
    """The job's requests to GeoHosting / CloudNativeGIS (read-only)."""

    model = CngLiteJobLog
    extra = 0
    can_delete = False
    fields = readonly_fields = (
        "created_at",
        "step",
        "target",
        "method",
        "url",
        "status_code",
        "duration_ms",
        "error",
        "request_payload",
        "response_payload",
    )

    def has_add_permission(self, _request, _obj=None):
        return False


@admin.register(CngLiteJob)
class CngLiteJobAdmin(admin.ModelAdmin):
    verbose_name = "CloudNativeGIS Lite Job"
    inlines = [CngLiteJobLogInline]
    list_display = [
        "id",
        "kind",
        "owner",
        "bucket",
        "status",
        "progress",
        "instance_id",
        "auto_destroy",
        "created_at",
        "completed_at",
    ]
    list_select_related = ["owner", "instance_server"]
    ordering = ["-created_at"]
    list_filter = ["kind", "status", "auto_destroy"]
    search_fields = [
        "id",
        "instance_server__instance_id",
        "owner__username",
        "connection__name",
        "bucket",
        "source_name",
        "output_key",
    ]
    readonly_fields = [
        "id",
        "kind",
        "owner",
        "connection",
        "bucket",
        "source_name",
        "source_key",
        "output_key",
        "input_size",
        "output_size",
        "cloudnativegis_url",
        "masked_cloudnativegis_api_token",
        "hetzner_server_id",
        "instance_server",
        "auto_destroy",
        "cng_job_id",
        "cng_results",
        "cng_errors",
        "depends_on",
        "outcome",
        "created_at",
        "updated_at",
        "completed_at",
    ]
    # Encrypted at rest like S3Connection's keys - never shown in plaintext.
    exclude = ["cloudnativegis_api_token"]

    @admin.display(description="CloudNativeGIS API token")
    def masked_cloudnativegis_api_token(self, obj: CngLiteJob) -> str:
        return mask_secret(obj.cloudnativegis_api_token)

    @admin.display(description="Instance ID", ordering="instance_server__instance_id")
    def instance_id(self, obj: CngLiteJob):
        """Its on-demand server's GeoHosting id, if it has one."""
        return obj.instance_server.instance_id if obj.instance_server_id else None


class CngLiteServerJobInline(admin.TabularInline):
    """The jobs that ran on the server (read-only)."""

    model = CngLiteJob
    fk_name = "instance_server"
    extra = 0
    can_delete = False
    show_change_link = True
    fields = readonly_fields = ("id", "kind", "source_name", "status", "created_at")

    def has_add_permission(self, _request, _obj=None):
        return False


@admin.register(CngLiteServer)
class CngLiteServerAdmin(admin.ModelAdmin):
    """On-demand servers, as GeoHosting last answered about them (read-only)."""

    verbose_name = "CloudNativeGIS Lite Server"
    inlines = [CngLiteServerJobInline]
    actions = ["sync_from_geohosting"]
    list_display = [
        "instance_id",
        "owner",
        "status",
        "type_id",
        "url",
        "auto_destroy",
        "created",
        "updated_at",
    ]
    list_filter = ["status", "auto_destroy"]
    search_fields = ["instance_id", "owner__username", "url"]
    readonly_fields = [
        "instance_id",
        "owner",
        "status",
        "url",
        "masked_api_token",
        "type_id",
        "specification",
        "error",
        "auto_destroy",
        "created",
        "created_at",
        "updated_at",
    ]
    # Encrypted at rest like the job's token - never shown in plaintext.
    exclude = ["api_token"]

    def has_add_permission(self, _request):
        return False

    @admin.action(description="Sync from GeoHosting")
    def sync_from_geohosting(self, request, queryset):
        """Ask GeoHosting about the selected servers again (see CngLiteServer.sync_from_geohosting)."""
        synced = 0
        for server in queryset.select_related("owner"):
            try:
                server.sync_from_geohosting()
            except GeoHostingError as exc:
                self.message_user(request, f"{server}: {exc}", level=messages.ERROR)
            else:
                synced += 1
        if synced:
            self.message_user(
                request, f"{synced} server(s) synced from GeoHosting.", level=messages.SUCCESS
            )

    @admin.display(description="API token")
    def masked_api_token(self, obj: CngLiteServer) -> str:
        return mask_secret(obj.api_token)
