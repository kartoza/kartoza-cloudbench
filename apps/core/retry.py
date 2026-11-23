"""Retrying what a flaky database or connection may only refuse for a moment.

SQLite allows only one writer at a time; under enough concurrent writers
(e.g. a bulk upload's several on-demand servers each saving their job's
progress at once) one can still be refused with "database is locked" even
past the connection's own busy_timeout (see cloudbench.settings.base).
Likewise a real on-demand server, or real remote storage, can refuse a
connection for a moment (just started, or a network hiccup) and work fine
the next. Retrying a few times, with a short wait, is cheaper than failing
a whole conversion over what is usually gone a moment later.
"""

import logging
import time

import httpx
from django.db import OperationalError

logger = logging.getLogger(__name__)

# How many tries in total (the first, plus this many retries), and how long
# to wait between them.
RETRIES = 10
RETRY_DELAY = 0.5


def _is_locked(exc: OperationalError) -> bool:
    return "database is locked" in str(exc)


def retry_if_locked(fn, *args, **kwargs):
    """Call fn(*args, **kwargs), retrying if sqlite's writer lock refuses it.

    Only "database is locked" is retried - any other OperationalError (or
    any other exception) is raised at once, as is "database is locked"
    itself once RETRIES tries are used up.
    """
    for attempt in range(1, RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except OperationalError as exc:
            if not _is_locked(exc) or attempt == RETRIES:
                raise
            logger.warning(
                "Database is locked (attempt %d/%d), retrying: %s", attempt, RETRIES, exc
            )
            time.sleep(RETRY_DELAY)


# A connection-level hiccup only, never retried past this many tries in
# total, with this long between them.
REQUEST_RETRIES = 3
REQUEST_RETRY_DELAY = 2.0


def retry_transient_request(fn, *args, **kwargs):
    """Call fn(*args, **kwargs), retrying a transient connection failure.

    Only httpx.TransportError - the request never got a response at all
    (refused, reset, timed out, ...) - is retried; a real HTTP response
    (even an error one) or anything else is raised at once. For an
    idempotent call only (a GET, or a POST safe to repeat): retrying
    something that already landed risks doing it twice.
    """
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except httpx.TransportError as exc:
            if attempt == REQUEST_RETRIES:
                raise
            logger.warning(
                "Connection failed (attempt %d/%d), retrying: %s",
                attempt,
                REQUEST_RETRIES,
                exc,
            )
            time.sleep(REQUEST_RETRY_DELAY)
