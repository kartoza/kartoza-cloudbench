"""Universal search: S3 connections must be found by the user's username.

apps.search.views passes request.user.username (matching the file-based
GeoServer config lookup convention, apps.core.config.get_config) — S3
connections are a Django model keyed by owner_id (an int), not username,
so the lookup has to go through the owner relation instead of assuming
the search service's user_id is already numeric.
"""

from unittest.mock import Mock, patch

import pytest

from apps.s3.models import S3Connection
from apps.search.services import SearchService


@pytest.mark.django_db
def test_search_finds_s3_connection_owned_by_the_user(django_user_model):
    user = django_user_model.objects.create(username="alice")
    S3Connection.objects.create(
        owner=user,
        name="sandbox",
        endpoint="https://s3.example.com",
        bucket="sandbox-bucket",
        access_key="key",
        secret_key="secret",
    )

    with patch("apps.search.services.get_config") as get_config:
        get_config.return_value.list_connections.return_value = []
        results = SearchService(user.username).search("sandbox", types=["connection"])

    assert [r.source for r in results] == ["s3"]
    assert results[0].name == "sandbox"


@pytest.mark.django_db
def test_search_does_not_find_another_users_s3_connection(django_user_model):
    owner = django_user_model.objects.create(username="alice")
    django_user_model.objects.create(username="bob")
    S3Connection.objects.create(
        owner=owner,
        name="sandbox",
        endpoint="https://s3.example.com",
        bucket="sandbox-bucket",
        access_key="key",
        secret_key="secret",
    )

    with patch("apps.search.services.get_config") as get_config:
        get_config.return_value.list_connections.return_value = []
        results = SearchService("bob").search("sandbox", types=["connection"])

    assert results == []


@pytest.mark.django_db
def test_search_service_geoserver_lookup_uses_username_not_int():
    """Regression guard: don't reintroduce int(self._user_id) here.

    get_config/get_geoserver_client are keyed by username (see every
    other app's views.py); casting the search service's user_id to int
    would break this GeoServer branch instead of just leaving it alone.
    """
    connection = Mock(id="conn-1", url="https://gs.example.com")
    connection.name = (
        "geoserver-conn"  # "name" is a reserved Mock() kwarg, so set it after construction
    )
    service = SearchService("alice")
    with patch("apps.search.services.get_config") as get_config:
        get_config.return_value.list_connections.return_value = [connection]
        results = service._search_connections("geoserver")

    get_config.assert_called_with("alice")
    assert [r.source for r in results] == ["geoserver"]
