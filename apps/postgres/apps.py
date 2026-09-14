"""Django app configuration for PostgreSQL app."""

from django.apps import AppConfig


class PostgresConfig(AppConfig):
    """Configuration for the PostgreSQL/PostGIS app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.postgres"
    label = "cloudbench_postgres"
    verbose_name = "PostgreSQL/PostGIS Integration"
