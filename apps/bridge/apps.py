"""Django app configuration for bridge app."""

from django.apps import AppConfig


class BridgeConfig(AppConfig):
    """Configuration for the PostgreSQL to GeoServer bridge app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.bridge"
    label = "cloudbench_bridge"
    verbose_name = "PostgreSQL to GeoServer Bridge"
