"""Django app configuration for GeoServer app."""

from django.apps import AppConfig


class GeoserverConfig(AppConfig):
    """Configuration for the GeoServer app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.geoserver"
    label = "cloudbench_geoserver"
    verbose_name = "GeoServer REST API"
