"""Shared fixtures for integration workflow tests."""

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client(authenticated_api_client: APIClient) -> APIClient:
    """Workflows run as a logged-in user: the testing settings require auth.

    Overrides the anonymous root ``api_client`` so every workflow request is
    scoped to ``test-user``, with its own isolated data folder.
    """
    return authenticated_api_client
