"""Shared utility functions for Kartoza CloudBench."""

import fcntl
import os
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from django.contrib.auth.models import User

# Config directory name — kept here to avoid circular imports with config.py
CONFIG_DIR = "config"
DATA_DIR = "data"
CACHE_DIR = "cache"


def get_data_folder() -> str:
    """Root folder that per-user data folders live under."""
    return os.environ.get("CLOUDBENCH_DATA_FOLDER") or os.path.join(str(Path.home()))


def get_cloudbench_config_path(filename: str, user: "User") -> str:
    """Build an XDG-compliant config file path for the given user.

    Path: ${CLOUDBENCH_DATA_FOLDER}/<username>/config/<filename>
    """
    return os.path.join(get_data_folder(), user.username, CONFIG_DIR, filename)


def get_cloudbench_data_path(filename: str, user: "User") -> str:
    """Build an XDG-compliant data file path for the given user.

    Path: ${CLOUDBENCH_DATA_FOLDER}/<username>/data/<filename>
    """
    return os.path.join(get_data_folder(), user.username, DATA_DIR, filename)


def get_cloudbench_cache_path(filename: str, user: "User") -> str:
    """Build an XDG-compliant cache file path for the given user.

    Path: ${CLOUDBENCH_DATA_FOLDER}/<username>/cache/<filename>
    """
    return os.path.join(get_data_folder(), user.username, CACHE_DIR, filename)


@contextmanager
def file_lock(path: str, exclusive: bool = True) -> Generator[None, None, None]:
    """Context manager for cross-process file locking.

    Uses a sibling .lock file so the data file itself is never held open
    while locked. Acquires an exclusive lock for writes, shared for reads.

    Usage:
        with file_lock(path):           # exclusive (write)
            ...
        with file_lock(path, exclusive=False):  # shared (read)
            ...
    """
    lock_path = path + ".lock"
    mode = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file, mode)
        try:
            yield
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
