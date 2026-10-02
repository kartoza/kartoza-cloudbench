"""Admin registration for saved GeoServer connections."""

from django.contrib import admin

from apps.core.admin import ConnectionAdmin

from .models import GeoServerConnection


@admin.register(GeoServerConnection)
class GeoServerConnectionAdmin(ConnectionAdmin):
    secret_fields = ("password",)
    list_display = ["name", "owner", "url", "is_active", "created_at"]
    search_fields = [*ConnectionAdmin.search_fields, "url"]
