"""Django app configuration for AI app."""

from django.apps import AppConfig


class AiConfig(AppConfig):
    """Configuration for the AI query app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ai"
    label = "cloudbench_ai"
    verbose_name = "AI Query with Ollama"
