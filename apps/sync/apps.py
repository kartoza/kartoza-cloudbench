"""Django app configuration for sync app."""

from django.apps import AppConfig


class SyncConfig(AppConfig):
    """Configuration for the server synchronization app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sync"
    label = "cloudbench_sync"
    verbose_name = "Server Synchronization"
