"""API tests for core endpoints (settings, providers)."""

import pytest
from django.test import Client
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def api_client(authenticated_api_client: APIClient) -> APIClient:
    """These endpoints require authentication, so use the logged-in client."""
    return authenticated_api_client


@pytest.mark.django_db
@pytest.mark.api
class TestSettingsAPI:
    """Tests for /api/settings/ endpoint."""

    def test_get_settings(self, api_client: APIClient) -> None:
        """Test getting application settings."""
        response = api_client.get("/api/settings/")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "theme" in data
        assert "pingIntervalSecs" in data
        assert "lastLocalPath" in data

    def test_update_settings_theme(self, api_client: APIClient) -> None:
        """Test updating theme setting."""
        response = api_client.put(
            "/api/settings/",
            {"theme": "dark"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["theme"] == "dark"

    def test_update_settings_ping_interval(self, api_client: APIClient) -> None:
        """Test updating ping interval setting."""
        response = api_client.put(
            "/api/settings/",
            {"pingIntervalSecs": 120},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["pingIntervalSecs"] == 120

    def test_update_settings_ping_interval_clamped(self, api_client: APIClient) -> None:
        """Test that ping interval is clamped to valid range."""
        # Too low
        response = api_client.put(
            "/api/settings/",
            {"pingIntervalSecs": 1},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["pingIntervalSecs"] == 10  # Minimum is 10

        # Too high
        response = api_client.put(
            "/api/settings/",
            {"pingIntervalSecs": 9999},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["pingIntervalSecs"] == 600  # Maximum is 600


@pytest.mark.django_db
@pytest.mark.api
class TestProvidersAPI:
    """Tests for /api/providers/ endpoint."""

    def test_get_providers(self, api_client: APIClient) -> None:
        """Test getting all providers."""
        response = api_client.get("/api/providers/")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "providers" in data
        assert len(data["providers"]) > 0

    def test_providers_structure(self, api_client: APIClient) -> None:
        """Test provider response structure."""
        response = api_client.get("/api/providers/")
        data = response.json()

        for provider in data["providers"]:
            assert "id" in provider
            assert "name" in provider
            assert "description" in provider
            assert "enabled" in provider
            assert "experimental" in provider

    def test_default_enabled_providers(self, api_client: APIClient) -> None:
        """Test that correct providers are enabled by default."""
        response = api_client.get("/api/providers/")
        data = response.json()

        enabled = {p["id"] for p in data["providers"] if p["enabled"]}
        assert "geoserver" in enabled
        assert "postgres" in enabled
        assert "geonode" in enabled

    def test_update_provider_enabled(self, api_client: APIClient) -> None:
        """Test enabling a disabled provider."""
        response = api_client.put(
            "/api/providers/",
            {"providers": [{"id": "s3", "enabled": True}]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK

        # Verify the change
        data = response.json()
        s3_provider = next(p for p in data["providers"] if p["id"] == "s3")
        assert s3_provider["enabled"] is True

    def test_update_multiple_providers(self, api_client: APIClient) -> None:
        """Test updating multiple providers at once."""
        response = api_client.put(
            "/api/providers/",
            {
                "providers": [
                    {"id": "s3", "enabled": True},
                    {"id": "iceberg", "enabled": True},
                ]
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        s3 = next(p for p in data["providers"] if p["id"] == "s3")
        iceberg = next(p for p in data["providers"] if p["id"] == "iceberg")
        assert s3["enabled"] is True
        assert iceberg["enabled"] is True

    def test_disable_provider(self, api_client: APIClient) -> None:
        """Test disabling an enabled provider."""
        response = api_client.put(
            "/api/providers/",
            {"providers": [{"id": "geoserver", "enabled": False}]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        geoserver = next(p for p in data["providers"] if p["id"] == "geoserver")
        assert geoserver["enabled"] is False


@pytest.mark.django_db
@pytest.mark.api
class TestHealthCheck:
    """Tests for health check endpoint."""

    def test_health_check(self, django_client: Client) -> None:
        """Test health check returns OK."""
        response = django_client.get("/health/")
        assert response.status_code == status.HTTP_200_OK
        assert response.content == b"OK"
