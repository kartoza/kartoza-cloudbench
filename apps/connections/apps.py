"""Django app configuration for connections app."""

from django.apps import AppConfig


class ConnectionsConfig(AppConfig):
    """Configuration for the connections app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.connections"
    label = "cloudbench_connections"
    verbose_name = "GeoServer Connections"
