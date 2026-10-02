"""Admin registration for saved PostgreSQL services."""

from django.contrib import admin

from apps.core.admin import ConnectionAdmin

from .models import PostgresService


@admin.register(PostgresService)
class PostgresServiceAdmin(ConnectionAdmin):
    secret_fields = ("password",)
    list_display = ["name", "owner", "host", "dbname", "is_active", "created_at"]
    search_fields = [*ConnectionAdmin.search_fields, "host", "dbname"]
