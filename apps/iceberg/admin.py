"""Admin registration for saved Iceberg catalog connections."""

from django.contrib import admin

from apps.core.admin import ConnectionAdmin

from .models import IcebergCatalogConnection


@admin.register(IcebergCatalogConnection)
class IcebergCatalogConnectionAdmin(ConnectionAdmin):
    secret_fields = ("token", "client_secret", "access_key", "secret_key")
    list_display = ["name", "owner", "url", "is_active", "created_at"]
    search_fields = [*ConnectionAdmin.search_fields, "url"]
