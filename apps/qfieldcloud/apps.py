"""Django app configuration for QFieldCloud app."""

from django.apps import AppConfig


class QfieldcloudConfig(AppConfig):
    """Configuration for the QFieldCloud integration app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.qfieldcloud"
    label = "cloudbench_qfieldcloud"
    verbose_name = "QFieldCloud Integration"
