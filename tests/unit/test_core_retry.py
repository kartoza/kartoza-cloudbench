"""apps.core.retry: retrying a write sqlite's writer lock, or a connection, refuses."""

from unittest.mock import patch

import httpx
import pytest
from django.db import OperationalError

from apps.core import retry as retry_module
from apps.core.retry import retry_if_locked, retry_transient_request


def test_returns_the_calls_result():
    assert retry_if_locked(lambda: 42) == 42


def test_retries_a_locked_database_and_then_succeeds():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise OperationalError("database is locked")
        return "done"

    with patch.object(retry_module.time, "sleep") as sleep:
        assert retry_if_locked(flaky) == "done"

    assert len(calls) == 3
    assert sleep.call_count == 2


def test_gives_up_after_the_last_retry():
    with (
        patch.object(retry_module.time, "sleep"),
        pytest.raises(OperationalError, match="database is locked"),
    ):
        retry_if_locked(lambda: (_ for _ in ()).throw(OperationalError("database is locked")))


def test_doesnt_retry_a_different_operational_error():
    def broken():
        raise OperationalError("no such table: foo")

    with (
        patch.object(retry_module.time, "sleep") as sleep,
        pytest.raises(OperationalError, match="no such table"),
    ):
        retry_if_locked(broken)

    sleep.assert_not_called()


def test_passes_args_and_kwargs_through():
    def add(a, b, *, c):
        return a + b + c

    assert retry_if_locked(add, 1, 2, c=3) == 6


# -- retry_transient_request --------------------------------------------------


def test_retries_a_refused_connection_and_then_succeeds():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 2:
            raise httpx.ConnectError("Connection refused")
        return "done"

    with patch.object(retry_module.time, "sleep") as sleep:
        assert retry_transient_request(flaky) == "done"

    assert len(calls) == 2
    assert sleep.call_count == 1


def test_request_retry_gives_up_after_the_last_try():
    def broken():
        raise httpx.ReadError("Connection reset")

    with (
        patch.object(retry_module.time, "sleep") as sleep,
        pytest.raises(httpx.ReadError),
    ):
        retry_transient_request(broken)

    assert sleep.call_count == retry_module.REQUEST_RETRIES - 1


def test_request_retry_doesnt_retry_a_real_response():
    def refused(*, response):
        raise httpx.HTTPStatusError("not found", request=None, response=response)

    with (
        patch.object(retry_module.time, "sleep") as sleep,
        pytest.raises(httpx.HTTPStatusError),
    ):
        retry_transient_request(refused, response=httpx.Response(404))

    sleep.assert_not_called()
