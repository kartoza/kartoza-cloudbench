"""Admin registration for saved QFieldCloud connections."""

from django.contrib import admin

from apps.core.admin import ConnectionAdmin

from .models import QFieldCloudConnection


@admin.register(QFieldCloudConnection)
class QFieldCloudConnectionAdmin(ConnectionAdmin):
    secret_fields = ("password", "token")
    list_display = ["name", "owner", "url", "is_active", "created_at"]
    search_fields = [*ConnectionAdmin.search_fields, "url"]
