"""Base Django settings for Kartoza CloudBench.

Settings common to all environments (development, production, testing).
"""

import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-change-me-in-production-abc123xyz789",
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get("DJANGO_DEBUG", "True").lower() in ("true", "1", "yes")

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party apps
    "rest_framework",
    "corsheaders",
    "apps.core",
    "apps.connections",
    "apps.geoserver",
    "apps.gwc",
    "apps.postgres",
    "apps.upload",
    "apps.s3",
    "apps.ai",
    "apps.query",
    "apps.bridge",
    "apps.sqlview",
    "apps.sync",
    "apps.dashboard",
    "apps.search",
    "apps.terria",
    "apps.qfieldcloud",
    "apps.mergin",
    "apps.geonode",
    "apps.iceberg",
    "apps.qgis",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "apps.core.middleware.COOPCOEPMiddleware",
    "apps.core.middleware.FrameAncestorsMiddleware",
]

ROOT_URLCONF = "cloudbench.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "cloudbench.wsgi.application"
ASGI_APPLICATION = "cloudbench.asgi.application"

# Database
# CloudBench uses JSON file-based configuration (no database)
# but Django requires a database for admin/auth if we want those features
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [
    BASE_DIR / "static",
]

# Media files (Uploads)
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# WhiteNoise settings for serving static files
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# Default primary key field type
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Django REST Framework settings
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "apps.core.sso_auth.SignedSSOTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        # TODO: Change to IsAuthenticated once all endpoints are migrated
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_PAGINATION_CLASS": None,
    "EXCEPTION_HANDLER": "apps.core.exceptions.custom_exception_handler",
}

# Session settings for Web UI auth
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 1 week
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

# CSRF settings
CSRF_COOKIE_HTTPONLY = False  # Allow JS to read for API calls
CSRF_COOKIE_SAMESITE = "Lax"

# In production, enable secure cookies
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# CORS settings for React frontend
CORS_ALLOW_ALL_ORIGINS = DEBUG  # In production, specify allowed origins
CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:8080",
).split(",")

# COOP/COEP headers for SharedArrayBuffer (required for QGIS-js WebAssembly)
# Disabled for now - blocks external resources like MapLibre from unpkg.com
# Enable when QGIS-js is needed and all resources are same-origin or have CORP headers
COOP_COEP_ENABLED = False

# CloudBench specific settings
CLOUDBENCH_CONFIG_DIR = os.environ.get(
    "CLOUDBENCH_CONFIG_DIR",
    os.path.expanduser("~/.config/kartoza-cloudbench"),
)

# Encryption settings for credential storage
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
CLOUDBENCH_ENCRYPTION_KEY = os.environ.get("CLOUDBENCH_ENCRYPTION_KEY", "")
CLOUDBENCH_ENCRYPTION_SALT = os.environ.get("CLOUDBENCH_ENCRYPTION_SALT", "cloudbench-v1")
CLOUDBENCH_CONFIG_FILE = os.path.join(CLOUDBENCH_CONFIG_DIR, "config.json")
CLOUDBENCH_DATA_DIR = os.environ.get(
    "CLOUDBENCH_DATA_DIR",
    os.path.expanduser("~/.local/share/kartoza-cloudbench"),
)
CLOUDBENCH_CACHE_DIR = os.environ.get(
    "CLOUDBENCH_CACHE_DIR",
    os.path.expanduser("~/.cache/kartoza-cloudbench"),
)

# Chunked upload settings
UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024  # 5MB chunks
UPLOAD_TEMP_DIR = os.path.join(CLOUDBENCH_CACHE_DIR, "uploads")
UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024  # 10GB max

# Logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {
            "format": "{levelname} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
        "apps": {
            "handlers": ["console"],
            "level": "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
    },
}

CLOUDBENCH_MUST_AUTHENTICATED = False

# The one shared secret between GeoHosting and CloudBench. Used two ways:
# - GeoHosting sends it as "Authorization: Bearer <token>" when calling
#   /api/geohosting/instances/ and /api/geohosting/sso-token/ (see
#   apps/core/geohosting_bridge.py). Empty by default; those endpoints
#   refuse all requests until this is set.
# - It's also the HMAC key used to sign/verify the short-lived SSO tokens
#   handed to GeoHosting's frontend for the iframe handoff (see
#   apps/core/sso_auth.py).
CLOUDBENCH_SERVICE_TOKEN = os.environ.get("CLOUDBENCH_SERVICE_TOKEN", "")

# How long a signed SSO token (see apps/core/sso_auth.py) stays valid
# after being minted, in seconds. Default: 12 hours.
CLOUDBENCH_SSO_TOKEN_MAX_AGE = int(
    os.environ.get("CLOUDBENCH_SSO_TOKEN_MAX_AGE", 60 * 60 * 12)
)

# Origins allowed to embed CloudBench in an iframe (CSP frame-ancestors —
# see apps/core/middleware.py). Comma-separated, e.g.
# "https://geohosting.example.com". Empty means only 'self'.
CLOUDBENCH_FRAME_ANCESTORS = [
    origin
    for origin in os.environ.get("CLOUDBENCH_FRAME_ANCESTORS", "").split(",")
    if origin
]

# Celery
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE