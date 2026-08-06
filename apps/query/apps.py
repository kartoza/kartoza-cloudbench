"""Django app configuration for query app."""

from django.apps import AppConfig


class QueryConfig(AppConfig):
    """Configuration for the visual query builder app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.query"
    label = "cloudbench_query"
    verbose_name = "Visual Query Builder"
