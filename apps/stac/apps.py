"""Django app configuration for the STAC catalogue app."""

from django.apps import AppConfig


class StacConfig(AppConfig):
    """Configuration for the STAC catalogue app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.stac"
    label = "cloudbench_stac"
    verbose_name = "STAC Catalogue"
