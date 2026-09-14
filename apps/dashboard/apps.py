"""Django app configuration for dashboard app."""

from django.apps import AppConfig


class DashboardConfig(AppConfig):
    """Configuration for the dashboard monitoring app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.dashboard"
    label = "cloudbench_dashboard"
    verbose_name = "Dashboard Monitoring"
