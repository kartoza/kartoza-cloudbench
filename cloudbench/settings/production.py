"""Production Django settings for Kartoza CloudBench."""

import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401, F403

DEBUG = False

# Security settings
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]  # Required in production
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")

CLOUDBENCH_ENCRYPTION_KEY = os.environ.get("CLOUDBENCH_ENCRYPTION_KEY")
if not CLOUDBENCH_ENCRYPTION_KEY:
    raise ImproperlyConfigured(
        "CLOUDBENCH_ENCRYPTION_KEY must be set in production "
        "(generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")"
    )

# HTTPS settings
SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "True").lower() in ("true", "1", "yes")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# HSTS settings
SECURE_HSTS_SECONDS = 31536000  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# CORS settings for production
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")

# Static files - use compressed manifest storage in production
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# Production logging
LOGGING["handlers"]["file"] = {  # noqa: F405
    "class": "logging.FileHandler",
    "filename": os.environ.get("DJANGO_LOG_FILE", "/var/log/cloudbench/django.log"),
    "formatter": "verbose",
}
LOGGING["root"]["handlers"] = ["console", "file"]  # noqa: F405
LOGGING["loggers"]["django"]["level"] = "WARNING"  # noqa: F405
LOGGING["loggers"]["apps"]["level"] = "INFO"  # noqa: F405
