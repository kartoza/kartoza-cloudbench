"""Provider configuration management for Kartoza CloudBench.

Controls which provider types are enabled/disabled at startup.
Uses a separate JSON config file for provider settings.
"""

import json
import os
from typing import Any

from pydantic import BaseModel, Field

from .models import ProvidersConfig, ProviderConfig
from .utilities import file_lock

# Provider configuration file name
PROVIDERS_FILE = "providers.json"

# Default provider configurations
DEFAULT_PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "geoserver",
        "name": "GeoServer",
        "description": "OGC-compliant geospatial server for publishing and sharing geospatial data",
        "enabled": True,
        "experimental": False,
    },
    {
        "id": "postgres",
        "name": "PostgreSQL",
        "description": "PostgreSQL database connections via pg_service.conf",
        "enabled": True,
        "experimental": False,
    },
    {
        "id": "geonode",
        "name": "GeoNode",
        "description": "Open source geospatial content management system",
        "enabled": True,
        "experimental": False,
    },
    {
        "id": "s3",
        "name": "S3 Storage",
        "description": "S3-compatible object storage (MinIO, AWS S3, etc.)",
        "enabled": False,
        "experimental": True,
    },
    {
        "id": "iceberg",
        "name": "Apache Iceberg",
        "description": "Apache Iceberg data lakehouse tables",
        "enabled": False,
        "experimental": True,
    },
    {
        "id": "qgis",
        "name": "QGIS Projects",
        "description": "Local QGIS project files",
        "enabled": False,
        "experimental": True,
    },
    {
        "id": "qfieldcloud",
        "name": "QFieldCloud",
        "description": "Cloud-based mobile GIS data synchronization",
        "enabled": False,
        "experimental": True,
    },
    {
        "id": "mergin",
        "name": "Mergin Maps",
        "description": "Field data collection and synchronization platform",
        "enabled": False,
        "experimental": True,
    },
]


class ProvidersManager:
    """Per-user providers configuration manager.

    Manages provider enablement/disablement settings.
    """

    def __init__(self, user_id: str = "default") -> None:
        """Initialise manager for the given user."""
        self._user_id = user_id
        self._config: "ProvidersConfig | None" = None

    @property
    def config(self) -> ProvidersConfig:
        """Get the current providers configuration, loading if necessary."""
        if self._config is None:
            self._config = self._load()
        return self._config

    def reload(self) -> ProvidersConfig:
        """Force reload providers configuration from disk."""
        self._config = self._load()
        return self._config

    def save(self) -> None:
        """Save providers configuration to disk atomically with file locking."""
        if self._config is None:
            return

        path = self._config_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)

        with file_lock(path):
            tmp_path = path + ".tmp"
            with open(tmp_path, "w") as f:
                json.dump(self._config.model_dump(by_alias=True), f, indent=2)
            os.replace(tmp_path, path)

    def _config_path(self) -> str:
        """Get the path to the providers config file."""
        from .utilities import get_cloudbench_config_path
        return get_cloudbench_config_path(PROVIDERS_FILE, self._user_id)

    def _load(self) -> ProvidersConfig:
        """Load providers configuration from disk with file locking."""
        path = self._config_path()

        if not os.path.exists(path):
            # Create default config
            config = ProvidersConfig(
                providers=[ProviderConfig(**p) for p in DEFAULT_PROVIDERS]
            )
            self._config = config
            self.save()
            return config

        with file_lock(path, exclusive=False):
            with open(path) as f:
                data = json.load(f)

        try:
            # Merge with defaults to ensure new providers are added
            loaded_config = ProvidersConfig.model_validate(data)
            loaded_ids = {p.id for p in loaded_config.providers}

            for default_provider in DEFAULT_PROVIDERS:
                if default_provider["id"] not in loaded_ids:
                    loaded_config.providers.append(
                        ProviderConfig(**default_provider)
                    )

            return loaded_config
        except (json.JSONDecodeError, ValueError):
            # Corrupted config, return default
            return ProvidersConfig(
                providers=[ProviderConfig(**p) for p in DEFAULT_PROVIDERS]
            )

    def get_provider(self, provider_id: str) -> ProviderConfig | None:
        """Get a provider configuration by ID."""
        for provider in self.config.providers:
            if provider.id == provider_id:
                return provider
        return None

    def is_provider_enabled(self, provider_id: str) -> bool:
        """Check if a provider is enabled."""
        provider = self.get_provider(provider_id)
        return provider.enabled if provider else False

    def list_providers(self) -> list[ProviderConfig]:
        """List all provider configurations."""
        return list(self.config.providers)

    def list_enabled_providers(self) -> list[ProviderConfig]:
        """List only enabled provider configurations."""
        return [p for p in self.config.providers if p.enabled]

    def set_provider_enabled(self, provider_id: str, enabled: bool) -> bool:
        """Set the enabled state for a provider."""
        for provider in self.config.providers:
            if provider.id == provider_id:
                provider.enabled = enabled
                self.save()
                return True
        return False

    def get_enabled_provider_ids(self) -> set[str]:
        """Get a set of enabled provider IDs for quick lookup."""
        return {p.id for p in self.config.providers if p.enabled}


def get_providers_manager(
        user_id: "str | int" = "default") -> ProvidersManager:
    """Get the ProvidersManager for the given user."""
    return ProvidersManager(str(user_id))


def is_provider_enabled(provider_id: str,
                        user_id: "str | int" = "default") -> bool:
    """Check if a provider is enabled for the given user."""
    return get_providers_manager(user_id).is_provider_enabled(provider_id)
