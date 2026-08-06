"""Django app configuration for Apache Iceberg app."""

from django.apps import AppConfig


class IcebergConfig(AppConfig):
    """Configuration for the Apache Iceberg integration app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.iceberg"
    label = "cloudbench_iceberg"
    verbose_name = "Apache Iceberg Integration"
