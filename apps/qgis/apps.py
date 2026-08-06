"""Django app configuration for QGIS app."""

from django.apps import AppConfig


class QgisConfig(AppConfig):
    """Configuration for the QGIS project management app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.qgis"
    label = "cloudbench_qgis"
    verbose_name = "QGIS Project Management"
