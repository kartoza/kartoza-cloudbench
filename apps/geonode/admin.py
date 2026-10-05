"""Admin registration for saved GeoNode connections."""

from django.contrib import admin

from apps.core.admin import ConnectionAdmin

from .models import GeoNodeConnection


@admin.register(GeoNodeConnection)
class GeoNodeConnectionAdmin(ConnectionAdmin):
    secret_fields = ("password", "api_key")
    list_display = ["name", "owner", "url", "is_active", "created_at"]
    search_fields = [*ConnectionAdmin.search_fields, "url"]
