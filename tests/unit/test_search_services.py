"""Universal search is scoped to the requesting user.

apps.search.views passes request.user; the service hands that same User
to get_config (file-based GeoServer config, stored by username) and uses
it directly as the S3Connection owner.
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
        results = SearchService(user).search("sandbox", types=["connection"])

    assert [r.source for r in results] == ["s3"]
    assert results[0].name == "sandbox"


@pytest.mark.django_db
def test_search_does_not_find_another_users_s3_connection(django_user_model):
    owner = django_user_model.objects.create(username="alice")
    bob = django_user_model.objects.create(username="bob")
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
        results = SearchService(bob).search("sandbox", types=["connection"])

    assert results == []


@pytest.mark.django_db
def test_search_service_geoserver_lookup_passes_the_user(django_user_model):
    """get_config is called with the service's own User, not a derived id."""
    user = django_user_model.objects.create(username="alice")
    connection = Mock(id="conn-1", url="https://gs.example.com")
    connection.name = (
        "geoserver-conn"  # "name" is a reserved Mock() kwarg, so set it after construction
    )
    service = SearchService(user)
    with patch("apps.search.services.get_config") as get_config:
        get_config.return_value.list_connections.return_value = [connection]
        results = service._search_connections("geoserver")

    get_config.assert_called_with(user)
    assert [r.source for r in results] == ["geoserver"]
