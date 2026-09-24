"""Admin registration for S3 connections and CloudNativeGIS Lite jobs."""

from django.contrib import admin

from .models import CngLiteJob, LayerCollection, LayerCollectionItem, S3Connection


def _mask(value: str) -> str:
    """Shows just enough of a secret to recognize it, not enough to use it."""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


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
        return _mask(obj.access_key)

    @admin.display(description="Secret key")
    def masked_secret_key(self, obj: S3Connection) -> str:
        return _mask(obj.secret_key)


@admin.register(CngLiteJob)
class CngLiteJobAdmin(admin.ModelAdmin):
    verbose_name = "CloudNativeGIS Lite Job"
    list_display = [
        "id",
        "kind",
        "owner_id",
        "bucket",
        "status",
        "progress",
        "created_at",
        "completed_at",
    ]
    list_filter = ["kind", "status"]
    search_fields = ["id", "owner_id", "connection_id", "bucket", "source_name", "output_key"]
    readonly_fields = [
        "id",
        "kind",
        "owner_id",
        "connection_id",
        "bucket",
        "source_name",
        "source_key",
        "output_key",
        "input_size",
        "output_size",
        "created_at",
        "updated_at",
        "completed_at",
    ]


class LayerCollectionItemInline(admin.TabularInline):
    model = LayerCollectionItem
    extra = 0
    readonly_fields = ["name", "key", "format"]
    can_delete = False


@admin.register(LayerCollection)
class LayerCollectionAdmin(admin.ModelAdmin):
    verbose_name = "Layer Collection"
    list_display = ["name", "owner_id", "bucket", "source_name", "created_at"]
    search_fields = ["name", "owner_id", "connection_id", "bucket", "source_name"]
    readonly_fields = [
        "id",
        "owner_id",
        "connection_id",
        "bucket",
        "name",
        "source_name",
        "created_at",
    ]
    inlines = [LayerCollectionItemInline]
