"""Shared utility functions for Kartoza CloudBench."""

import fcntl
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from django.conf import settings

# Config directory name — kept here to avoid circular imports with config.py
CONFIG_DIR = "config"
DATA_DIR = "data"
CACHE_DIR = "cache"


def get_data_folder(user_id: str = "default") -> str:
    """Build a data folder path for the given user."""

    if settings.CLOUDBENCH_MUST_AUTHENTICATED and user_id in [
        "default", None, "None"
    ]:
        raise ValueError("User ID is required for authenticated access.")

    return os.environ.get("CLOUDBENCH_DATA_FOLDER") or os.path.join(
        str(Path.home())
    )


def get_cloudbench_config_path(filename: str, user_id: str = "default") -> str:
    """Build an XDG-compliant config file path for the given user.

    Path: ${CLOUDBENCH_DATA_FOLDER}/<user_id>/config/<filename>

    Raises ValueError when CLOUDBENCH_MUST_AUTHENTICATED is True and
    user_id is still "default" (i.e., no authenticated user on the thread).
    """
    return os.path.join(
        get_data_folder(user_id), user_id, CONFIG_DIR, filename
    )


def get_cloudbench_data_path(filename: str, user_id: str = "default") -> str:
    """Build an XDG-compliant config file path for the given user.

    Path: ${CLOUDBENCH_DATA_FOLDER}/<user_id>/data/<filename>

    Raises ValueError when CLOUDBENCH_MUST_AUTHENTICATED is True and
    user_id is still "default" (i.e., no authenticated user on the thread).
    """
    return os.path.join(
        get_data_folder(user_id), user_id, DATA_DIR, filename
    )


def get_cloudbench_cache_path(filename: str, user_id: str = "default") -> str:
    """Build an XDG-compliant config file path for the given user.

    Path: ${CLOUDBENCH_DATA_FOLDER}/cache/<user_id>/cache/<filename>

    Raises ValueError when CLOUDBENCH_MUST_AUTHENTICATED is True and
    user_id is still "default" (i.e., no authenticated user on the thread).
    """
    return os.path.join(
        get_data_folder(user_id), user_id, CACHE_DIR, filename
    )


@contextmanager
def file_lock(path: str, exclusive: bool = True) -> Generator[
    None, None, None]:
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
