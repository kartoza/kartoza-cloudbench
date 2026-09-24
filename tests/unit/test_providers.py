"""Unit tests for providers configuration management.

Tests the ProvidersManager and provider enablement/disablement.
"""

import json
import os

from django.contrib.auth.models import User

from apps.core.providers import (
    DEFAULT_PROVIDERS,
    ProviderConfig,
    ProvidersConfig,
    ProvidersManager,
    get_providers_manager,
    is_provider_enabled,
)


class TestProviderConfig:
    """Tests for ProviderConfig model."""

    def test_provider_config_creation(self) -> None:
        """Test creating a provider config."""
        config = ProviderConfig(
            id="test_provider",
            name="Test Provider",
            description="A test provider",
            enabled=True,
            experimental=False,
        )
        assert config.id == "test_provider"
        assert config.name == "Test Provider"
        assert config.enabled is True
        assert config.experimental is False

    def test_provider_config_defaults(self) -> None:
        """Test provider config default values."""
        config = ProviderConfig(
            id="test",
            name="Test",
            description="Test",
        )
        assert config.enabled is True
        assert config.experimental is False

    def test_provider_config_serialization(self) -> None:
        """Test provider config serialization."""
        config = ProviderConfig(
            id="test",
            name="Test",
            description="Test",
            enabled=False,
            experimental=True,
        )
        data = config.model_dump()
        assert data["id"] == "test"
        assert data["enabled"] is False
        assert data["experimental"] is True


class TestProvidersConfig:
    """Tests for ProvidersConfig model."""

    def test_providers_config_creation(self) -> None:
        """Test creating a providers config."""
        provider = ProviderConfig(
            id="test",
            name="Test",
            description="Test",
        )
        config = ProvidersConfig(providers=[provider])
        assert len(config.providers) == 1

    def test_providers_config_empty(self) -> None:
        """Test empty providers config."""
        config = ProvidersConfig()
        assert config.providers == []


class TestDefaultProviders:
    """Tests for default provider configuration."""

    def test_default_providers_exist(self) -> None:
        """Test that default providers are defined."""
        assert len(DEFAULT_PROVIDERS) > 0

    def test_default_providers_structure(self) -> None:
        """Test default provider structure."""
        for provider in DEFAULT_PROVIDERS:
            assert "id" in provider
            assert "name" in provider
            assert "description" in provider
            assert "enabled" in provider
            assert "experimental" in provider

    def test_default_enabled_providers(self) -> None:
        """Test which providers are enabled by default."""
        enabled_ids = {p["id"] for p in DEFAULT_PROVIDERS if p["enabled"]}
        assert "geoserver" in enabled_ids
        assert "postgres" in enabled_ids
        assert "geonode" in enabled_ids

    def test_default_experimental_providers(self) -> None:
        """Test which providers are marked experimental."""
        experimental_ids = {p["id"] for p in DEFAULT_PROVIDERS if p["experimental"]}
        assert "s3" in experimental_ids
        assert "iceberg" in experimental_ids
        assert "qgis" in experimental_ids
        assert "qfieldcloud" in experimental_ids
        assert "mergin" in experimental_ids


class TestProvidersManager:
    """Tests for ProvidersManager, one per user (not a singleton)."""

    def test_scoped_per_user(self, providers_manager: ProvidersManager) -> None:
        """Different users must not see each other's provider settings."""
        providers_manager.set_provider_enabled("iceberg", True)

        other_manager = ProvidersManager(User(username="other-user"))
        assert other_manager.is_provider_enabled("iceberg") is False

    def test_list_providers(self, providers_manager: ProvidersManager) -> None:
        """Test listing all providers."""
        providers = providers_manager.list_providers()
        assert len(providers) == len(DEFAULT_PROVIDERS)

    def test_list_enabled_providers(self, providers_manager: ProvidersManager) -> None:
        """Test listing enabled providers."""
        enabled = providers_manager.list_enabled_providers()
        # Should have geoserver, postgres, geonode enabled by default
        enabled_ids = {p.id for p in enabled}
        assert "geoserver" in enabled_ids
        assert "postgres" in enabled_ids
        assert "geonode" in enabled_ids

    def test_get_provider(self, providers_manager: ProvidersManager) -> None:
        """Test getting a provider by ID."""
        provider = providers_manager.get_provider("geoserver")
        assert provider is not None
        assert provider.id == "geoserver"
        assert provider.name == "GeoServer"

    def test_get_nonexistent_provider(self, providers_manager: ProvidersManager) -> None:
        """Test getting a nonexistent provider."""
        provider = providers_manager.get_provider("nonexistent")
        assert provider is None

    def test_is_provider_enabled(self, providers_manager: ProvidersManager) -> None:
        """Test checking if provider is enabled."""
        assert providers_manager.is_provider_enabled("geoserver") is True
        assert providers_manager.is_provider_enabled("iceberg") is False

    def test_set_provider_enabled(self, providers_manager: ProvidersManager) -> None:
        """Test enabling/disabling a provider."""
        # Disable geoserver
        result = providers_manager.set_provider_enabled("geoserver", False)
        assert result is True
        assert providers_manager.is_provider_enabled("geoserver") is False

        # Re-enable geoserver
        result = providers_manager.set_provider_enabled("geoserver", True)
        assert result is True
        assert providers_manager.is_provider_enabled("geoserver") is True

    def test_set_nonexistent_provider_enabled(self, providers_manager: ProvidersManager) -> None:
        """Test setting enabled on nonexistent provider."""
        result = providers_manager.set_provider_enabled("nonexistent", True)
        assert result is False

    def test_get_enabled_provider_ids(self, providers_manager: ProvidersManager) -> None:
        """Test getting set of enabled provider IDs."""
        enabled_ids = providers_manager.get_enabled_provider_ids()
        assert isinstance(enabled_ids, set)
        assert "geoserver" in enabled_ids
        assert "iceberg" not in enabled_ids

    def test_config_persistence(self, providers_manager: ProvidersManager) -> None:
        """Test that config is persisted to disk."""
        # Modify a provider
        providers_manager.set_provider_enabled("s3", True)

        config_path = providers_manager._config_path()
        assert os.path.exists(config_path)

        with open(config_path) as f:
            data = json.load(f)

        s3_provider = next(p for p in data["providers"] if p["id"] == "s3")
        assert s3_provider["enabled"] is True

    def test_config_reload(self, providers_manager: ProvidersManager) -> None:
        """Test reloading config from disk."""
        # Modify and save
        providers_manager.set_provider_enabled("s3", True)

        # Reset singleton and reload
        ProvidersManager._instance = None
        new_manager = ProvidersManager(providers_manager._user)
        assert new_manager.is_provider_enabled("s3") is True

    def test_new_providers_merged(self, providers_manager: ProvidersManager) -> None:
        """Test that new default providers are merged into existing config."""
        # Get config path and add a truncated version
        config_path = providers_manager._config_path()
        os.makedirs(os.path.dirname(config_path), exist_ok=True)

        # Save config with only one provider
        truncated_config = {
            "providers": [
                {
                    "id": "geoserver",
                    "name": "GeoServer",
                    "description": "Test",
                    "enabled": True,
                    "experimental": False,
                }
            ]
        }
        with open(config_path, "w") as f:
            json.dump(truncated_config, f)

        # Reset and reload
        ProvidersManager._instance = None
        new_manager = ProvidersManager(providers_manager._user)

        # Should have all default providers merged in
        providers = new_manager.list_providers()
        provider_ids = {p.id for p in providers}
        assert "geoserver" in provider_ids
        assert "postgres" in provider_ids  # Should be merged from defaults


class TestProviderHelperFunctions:
    """Tests for provider helper functions."""

    def test_get_providers_manager(self, temp_config_dir: str) -> None:
        """get_providers_manager returns a manager scoped to the given user."""
        manager1 = get_providers_manager(User(username="alice"))
        manager1.set_provider_enabled("iceberg", True)

        # Same user -> sees the persisted change; another user doesn't.
        manager2 = get_providers_manager(User(username="alice"))
        assert manager2.is_provider_enabled("iceberg") is True
        other = get_providers_manager(User(username="bob"))
        assert other.is_provider_enabled("iceberg") is False

    def test_is_provider_enabled_helper(self, providers_manager: ProvidersManager) -> None:
        """Test is_provider_enabled helper."""
        assert is_provider_enabled("geoserver", providers_manager._user) is True
        assert is_provider_enabled("iceberg", providers_manager._user) is False
        assert is_provider_enabled("nonexistent", providers_manager._user) is False
