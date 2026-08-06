"""Django app configuration for search app."""

from django.apps import AppConfig


class SearchConfig(AppConfig):
    """Configuration for the universal search app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.search"
    label = "cloudbench_search"
    verbose_name = "Universal Search"
