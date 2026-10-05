"""Shared admin helpers for saved connections."""

from django.contrib import admin, messages

from .db import ConnectionModel, LegacyConnectionImport
from .legacy_connections import delete_backups


def mask_secret(value: str) -> str:
    """Shows just enough of a secret to recognize it, not enough to use it."""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


class ConnectionAdmin(admin.ModelAdmin):
    """Admin for a ConnectionModel subclass.

    The fields named in `secret_fields` are encrypted at rest (see
    apps/core/fields.py) — they're excluded so the admin never displays
    them in plaintext, even to staff; `masked_secrets` shows just enough to
    recognize which key it is.
    """

    secret_fields: tuple[str, ...] = ()
    list_display = ["name", "owner", "connection_id", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["name", "connection_id", "owner__username"]
    readonly_fields = ["id", "masked_secrets", "created_at", "updated_at"]

    def get_exclude(self, _request, _obj=None):
        return self.secret_fields

    @admin.display(description="Secrets")
    def masked_secrets(self, obj: ConnectionModel) -> str:
        return ", ".join(
            f"{name}: {mask_secret(getattr(obj, name))}"
            for name in self.secret_fields
            if getattr(obj, name)
        )


@admin.register(LegacyConnectionImport)
class LegacyConnectionImportAdmin(admin.ModelAdmin):
    """Read-only log of config.json imports, and cleanup of their backups."""

    list_display = [
        "owner",
        "created_at",
        "imported",
        "already_present",
        "invalid_count",
        "backup_path",
        "backup_deleted_at",
    ]
    list_filter = [("backup_deleted_at", admin.EmptyFieldListFilter)]
    search_fields = ["owner__username", "backup_path"]
    actions = ["delete_backup_files"]

    def get_readonly_fields(self, _request, _obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, _request):
        return False

    @admin.display(description="Invalid")
    def invalid_count(self, obj: LegacyConnectionImport) -> int:
        return len(obj.invalid_entries)

    @admin.action(description="Delete backup files (they hold plaintext secrets)")
    def delete_backup_files(self, request, queryset):
        deleted = delete_backups(queryset, log=lambda _message: None)
        self.message_user(request, f"Deleted {deleted} backup files.", messages.SUCCESS)
