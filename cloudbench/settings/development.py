"""Development Django settings for Kartoza CloudBench."""

from .base import *  # noqa: F401, F403

DEBUG = True

# Respect DJANGO_ALLOWED_HOSTS when set (e.g. "cloudbench" when this
# service is reached by hostname from another container, such as
# GeoHosting's dev-only proxy — see core/cloudbench_dev_proxy.py in the
# GeoHosting repo). Falls back to plain localhost for non-Docker local
# runs.
ALLOWED_HOSTS = os.environ.get(  # noqa: F405
    "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]"
).split(",")

# In development, allow all CORS origins
CORS_ALLOW_ALL_ORIGINS = True

# Development-specific logging
LOGGING["loggers"]["apps"]["level"] = "DEBUG"  # noqa: F405

# Disable WhiteNoise compression in development for faster reloads
STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"

# Development tools
INSTALLED_APPS += [  # noqa: F405
    # Add any development-only apps here
]

# Django Debug Toolbar (optional, add if needed)
# INSTALLED_APPS += ["debug_toolbar"]
# MIDDLEWARE.insert(0, "debug_toolbar.middleware.DebugToolbarMiddleware")
# INTERNAL_IPS = ["127.0.0.1"]

# Run Celery tasks synchronously in development (no worker needed)
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
