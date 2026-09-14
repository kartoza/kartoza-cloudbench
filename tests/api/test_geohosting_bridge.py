"""API tests for the GeoHosting instance-sync bridge endpoint.

This endpoint replaces the old in-process ConfigManager monkeypatch —
GeoHosting now pushes instance connection state here explicitly instead of
CloudBench pulling it from GeoHosting's database.
"""

import pytest
from django.test import RequestFactory
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.config import get_config
from apps.core.sso_auth import SignedSSOTokenAuthentication

SERVICE_TOKEN = "test-service-token"


@pytest.fixture(autouse=True)
def _service_token(settings):
    settings.CLOUDBENCH_SERVICE_TOKEN = SERVICE_TOKEN


def _auth_headers():
    return {"HTTP_AUTHORIZATION": f"Bearer {SERVICE_TOKEN}"}


@pytest.mark.django_db
@pytest.mark.api
class TestGeoHostingInstanceView:
    """Tests for /api/geohosting/instances/."""

    def test_post_requires_service_token(self, api_client: APIClient) -> None:
        """No Authorization header at all is rejected."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "100",
                "instance_id": 1,
                "product": "geoserver",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_post_rejects_wrong_token(self, api_client: APIClient) -> None:
        """A non-matching service token is rejected."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "101",
                "instance_id": 1,
                "product": "geoserver",
            },
            format="json",
            HTTP_AUTHORIZATION="Bearer wrong-token",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_post_adds_geoserver_connection(self, api_client: APIClient) -> None:
        """A GeoServer instance is added to config.connections."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "102",
                "instance_id": 1,
                "product": "geoserver",
                "name": "my-geoserver",
                "url": "https://my-geoserver.example.com",
                "username": "admin",
                "password": "secret",
                "is_active": True,
            },
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_200_OK

        config = get_config("102").config
        conn = next(c for c in config.connections if c.id == "geohosting_1")
        assert conn.url == "https://my-geoserver.example.com/geoserver"
        assert conn.password == "secret"
        assert conn.is_active is True

    def test_post_adds_geonode_connection(self, api_client: APIClient) -> None:
        """A GeoNode instance is added to config.geonode_connections."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "103",
                "instance_id": 2,
                "product": "geonode",
                "name": "my-geonode",
                "url": "https://my-geonode.example.com",
                "username": "admin",
                "password": "secret",
                "is_active": False,
            },
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_200_OK

        config = get_config("103").config
        conn = next(
            c for c in config.geonode_connections if c.id == "geohosting_2"
        )
        assert conn.url == "https://my-geonode.example.com"

    def test_post_adds_postgis_connection(self, api_client: APIClient) -> None:
        """A PostGIS instance is added to config.pg_services."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "104",
                "instance_id": 3,
                "product": "postgis",
                "name": "my-postgis",
                "url": "https://my-postgis.example.com",
                "username": "admin",
                "password": "secret",
                "is_active": True,
            },
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_200_OK

        config = get_config("104").config
        svc = next(s for s in config.pg_services if s.id == "geohosting_3")
        assert svc.host == "my-postgis.example.com"
        assert svc.dbname == "gis"

    def test_post_does_not_overwrite_existing_password(
        self, api_client: APIClient
    ) -> None:
        """A later sync must not clobber a non-empty password."""
        payload = {
            "owner_user_id": "105",
            "instance_id": 4,
            "product": "geoserver",
            "name": "my-geoserver",
            "url": "https://my-geoserver.example.com",
            "username": "admin",
            "password": "first-secret",
            "is_active": True,
        }
        api_client.post(
            "/api/geohosting/instances/", payload, format="json",
            **_auth_headers()
        )

        payload["password"] = "second-secret"
        api_client.post(
            "/api/geohosting/instances/", payload, format="json",
            **_auth_headers()
        )

        config = get_config("105").config
        conn = next(c for c in config.connections if c.id == "geohosting_4")
        assert conn.password == "first-secret"

    def test_post_fills_blank_password(self, api_client: APIClient) -> None:
        """A blank password on an existing connection can be filled in."""
        payload = {
            "owner_user_id": "106",
            "instance_id": 5,
            "product": "geoserver",
            "name": "my-geoserver",
            "url": "https://my-geoserver.example.com",
            "username": "admin",
            "password": "",
            "is_active": True,
        }
        api_client.post(
            "/api/geohosting/instances/", payload, format="json",
            **_auth_headers()
        )

        payload["password"] = "filled-in"
        api_client.post(
            "/api/geohosting/instances/", payload, format="json",
            **_auth_headers()
        )

        config = get_config("106").config
        conn = next(c for c in config.connections if c.id == "geohosting_5")
        assert conn.password == "filled-in"

    def test_post_missing_fields(self, api_client: APIClient) -> None:
        """Missing required fields is a 400, not a 500."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {"owner_user_id": "107"},
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_post_unknown_product(self, api_client: APIClient) -> None:
        """An unrecognised product type is a 400, not a silent no-op."""
        response = api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "108",
                "instance_id": 6,
                "product": "not-a-real-product",
            },
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_removes_connection(self, api_client: APIClient) -> None:
        """DELETE removes a previously-added connection."""
        api_client.post(
            "/api/geohosting/instances/",
            {
                "owner_user_id": "109",
                "instance_id": 7,
                "product": "geoserver",
                "name": "to-delete",
                "url": "https://to-delete.example.com",
                "username": "admin",
                "password": "secret",
                "is_active": True,
            },
            format="json",
            **_auth_headers(),
        )
        assert any(
            c.id == "geohosting_7"
            for c in get_config("109").config.connections
        )

        response = api_client.delete(
            "/api/geohosting/instances/7/?owner_user_id=109",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not any(
            c.id == "geohosting_7"
            for c in get_config("109").config.connections
        )

    def test_delete_requires_owner_user_id(self, api_client: APIClient) -> None:
        """DELETE without owner_user_id is a 400, not a silent no-op."""
        response = api_client.delete(
            "/api/geohosting/instances/7/",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
@pytest.mark.api
class TestGeoHostingSSOTokenView:
    """Tests for /api/geohosting/sso-token/."""

    def test_requires_service_token(self, api_client: APIClient) -> None:
        """No Authorization header at all is rejected."""
        response = api_client.post(
            "/api/geohosting/sso-token/",
            {"owner_user_id": "42"},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_requires_owner_user_id(self, api_client: APIClient) -> None:
        """A missing owner_user_id is a 400, not a token for nobody."""
        response = api_client.post(
            "/api/geohosting/sso-token/",
            {},
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_a_token_that_authenticates_as_that_user(
        self, api_client: APIClient
    ) -> None:
        """The minted token round-trips through SignedSSOTokenAuthentication."""
        response = api_client.post(
            "/api/geohosting/sso-token/",
            {"owner_user_id": "42"},
            format="json",
            **_auth_headers(),
        )
        assert response.status_code == status.HTTP_200_OK
        token = response.data["token"]

        request = RequestFactory().get(
            "/", HTTP_AUTHORIZATION=f"Token {token}"
        )
        user, _ = SignedSSOTokenAuthentication().authenticate(request)
        assert user.id == "42"
