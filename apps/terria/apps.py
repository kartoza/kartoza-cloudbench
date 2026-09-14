"""Django app configuration for Terria app."""

from django.apps import AppConfig


class TerriaConfig(AppConfig):
    """Configuration for the Terria 3D viewer integration app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.terria"
    label = "cloudbench_terria"
    verbose_name = "Terria 3D Viewer Integration"
