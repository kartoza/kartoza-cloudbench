"""Unit tests for apps.core.views (settings and providers endpoints)."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def isolated_user_config(tmp_path):
    """Point get_config/get_providers_manager at an isolated directory.

    Mirrors tests/conftest.py's config_manager/providers_manager fixtures:
    apps.core.utilities.get_data_folder reads CLOUDBENCH_DATA_FOLDER, not
    the XDG_* vars.
    """
    with patch.dict("os.environ", {"CLOUDBENCH_DATA_FOLDER": str(tmp_path)}):
        yield


@pytest.fixture
def api_client_as(isolated_user_config):
    def _make(username: str = "alice") -> APIClient:
        client = APIClient()
        client.force_authenticate(user=Mock(username=username, is_authenticated=True))
        return client

    return _make


class TestFrontendConfigView:
    def test_returns_none_for_unset_overrides(self, api_client_as):
        response = api_client_as().get("/api/frontend-config/")
        assert response.status_code == 200
        assert response.data == {
            "createGeoServerUrl": None,
            "createPostgisUrl": None,
            "createGeoNodeUrl": None,
        }

    def test_reads_overrides_from_environment(self, api_client_as):
        with patch.dict("os.environ", {"VITE_CREATE_GEOSERVER_URL": "https://example.com/add"}):
            response = api_client_as().get("/api/frontend-config/")
        assert response.data["createGeoServerUrl"] == "https://example.com/add"


class TestProvidersView:
    def test_lists_default_providers(self, api_client_as):
        response = api_client_as().get("/api/providers/")
        assert response.status_code == 200
        ids = {p["id"] for p in response.data["providers"]}
        assert "geoserver" in ids
        assert "iceberg" in ids

    def test_put_updates_enabled_state(self, api_client_as):
        client = api_client_as()
        response = client.put(
            "/api/providers/", {"providers": [{"id": "iceberg", "enabled": True}]}, format="json"
        )
        assert response.status_code == 200
        iceberg = next(p for p in response.data["providers"] if p["id"] == "iceberg")
        assert iceberg["enabled"] is True

        # Persisted, not just echoed back.
        again = client.get("/api/providers/")
        iceberg_again = next(p for p in again.data["providers"] if p["id"] == "iceberg")
        assert iceberg_again["enabled"] is True

    def test_put_ignores_updates_missing_id_or_enabled(self, api_client_as):
        client = api_client_as()
        response = client.put(
            "/api/providers/",
            {"providers": [{"id": "iceberg"}, {"enabled": True}]},
            format="json",
        )
        assert response.status_code == 200
        iceberg = next(p for p in response.data["providers"] if p["id"] == "iceberg")
        assert iceberg["enabled"] is False  # unchanged from the default

    def test_providers_are_scoped_per_user(self, api_client_as):
        api_client_as("alice").put(
            "/api/providers/", {"providers": [{"id": "iceberg", "enabled": True}]}, format="json"
        )
        bob_response = api_client_as("bob").get("/api/providers/")
        iceberg = next(p for p in bob_response.data["providers"] if p["id"] == "iceberg")
        assert iceberg["enabled"] is False


class TestSettingsView:
    def test_returns_defaults(self, api_client_as):
        response = api_client_as().get("/api/settings/")
        assert response.status_code == 200
        assert response.data["theme"] == "default"
        assert response.data["pingIntervalSecs"] == 60

    def test_put_updates_theme_and_ping_interval(self, api_client_as):
        client = api_client_as()
        response = client.put(
            "/api/settings/",
            {"theme": "dark", "pingIntervalSecs": 120, "lastLocalPath": "/data"},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["theme"] == "dark"
        assert response.data["pingIntervalSecs"] == 120
        assert response.data["lastLocalPath"] == "/data"

    def test_put_clamps_ping_interval_to_valid_range(self, api_client_as):
        client = api_client_as()
        too_low = client.put("/api/settings/", {"pingIntervalSecs": 1}, format="json")
        assert too_low.data["pingIntervalSecs"] == 10

        too_high = client.put("/api/settings/", {"pingIntervalSecs": 10000}, format="json")
        assert too_high.data["pingIntervalSecs"] == 600

    def test_put_persists_across_requests(self, api_client_as):
        client = api_client_as()
        client.put("/api/settings/", {"theme": "dark"}, format="json")
        response = client.get("/api/settings/")
        assert response.data["theme"] == "dark"
