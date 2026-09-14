"""Django app configuration for S3 app."""

from django.apps import AppConfig


class S3Config(AppConfig):
    """Configuration for the S3 storage app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.s3"
    label = "cloudbench_s3"
    verbose_name = "S3 Storage"
