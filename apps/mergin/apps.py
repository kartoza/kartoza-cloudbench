"""Django app configuration for Mergin Maps app."""

from django.apps import AppConfig


class MerginConfig(AppConfig):
    """Configuration for the Mergin Maps integration app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.mergin"
    label = "cloudbench_mergin"
    verbose_name = "Mergin Maps Integration"
