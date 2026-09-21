"""Custom Django model fields."""

from django.db import models

from .crypto import decrypt, encrypt


class EncryptedCharField(models.CharField):
    """A CharField whose value is encrypted at rest, transparent to Python code.

    Not usable in `.filter(field=value)` lookups — Fernet encryption isn't
    deterministic (the same plaintext produces different ciphertext each
    time), so an equality filter on this field will never match. Only look
    rows up by some other key (e.g. id) and read this field off the result.
    """

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("max_length", 500)
        super().__init__(*args, **kwargs)

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if not value:
            return value
        return encrypt(value)

    def from_db_value(self, value, expression, connection):
        if not value:
            return value
        return decrypt(value)
