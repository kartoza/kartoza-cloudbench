"""Django settings for testing environment.

Optimized for fast test execution with isolated configuration.
"""

from .base import *  # noqa: F401, F403

# Override debug for testing
DEBUG = False

# Use in-memory SQLite for faster tests
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# Faster password hashing for tests
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# Disable migrations for faster test startup
class DisableMigrations:
    def __contains__(self, item: str) -> bool:
        return True

    def __getitem__(self, item: str) -> None:
        return None


MIGRATION_MODULES = DisableMigrations()

# Use test-specific config directory
import tempfile

_test_dir = tempfile.mkdtemp(prefix="cloudbench-test-")
CLOUDBENCH_CONFIG_DIR = _test_dir
CLOUDBENCH_DATA_DIR = _test_dir
CLOUDBENCH_CACHE_DIR = _test_dir

# Disable logging during tests (can be overridden)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "handlers": {
        "null": {
            "class": "logging.NullHandler",
        },
    },
    "root": {
        "handlers": ["null"],
        "level": "CRITICAL",
    },
}

# Test-specific REST framework settings
# Use the same auth settings as production to properly test authentication
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PAGINATION_CLASS": None,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

# Disable CORS checking in tests
CORS_ALLOW_ALL_ORIGINS = True

# Chunked upload test settings
UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1MB for faster tests
UPLOAD_MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB for tests
