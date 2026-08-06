"""Django app configuration for core app."""

from django.apps import AppConfig


class CoreConfig(AppConfig):
    """Configuration for the core app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "cloudbench_core"
    verbose_name = "CloudBench Core"

    def ready(self):
        """Initialize core services when Django starts."""
        # Import config to ensure it's loaded early
        from . import config  # noqa: F401
