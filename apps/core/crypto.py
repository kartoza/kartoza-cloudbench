"""Symmetric encryption for connection credentials stored at rest.

Used by apps.core.fields.EncryptedCharField. Requires
settings.CLOUDBENCH_ENCRYPTION_KEY (a Fernet key) to be set — see
cloudbench/settings/base.py and production.py.
"""

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def _fernet() -> Fernet:
    key = getattr(settings, "CLOUDBENCH_ENCRYPTION_KEY", None)
    if not key:
        raise ImproperlyConfigured(
            "CLOUDBENCH_ENCRYPTION_KEY is not set — required to store or read encrypted credentials."
        )
    return Fernet(key)


def encrypt(value: str) -> str:
    """Encrypts a plaintext string for storage. Empty/falsy values pass through unchanged."""
    if not value:
        return value
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    """Decrypts a value previously produced by encrypt(). Empty/falsy values pass through unchanged."""
    if not value:
        return value
    return _fernet().decrypt(value.encode()).decode()
