"""Views for core app - settings and providers endpoints."""

import os

from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.response import Response
from rest_framework.views import APIView

from .config import get_config
from .providers import get_providers_manager


class LoginView(ObtainAuthToken):
    """Username/password -> DRF auth token, independent of any existing session."""

    authentication_classes = []


class FrontendConfigView(APIView):
    """Deployment-time config the frontend can't get from its own build.

    Vite's VITE_* env vars are baked into the bundle at `npm run build` and
    can't change without a rebuild. Reading these from the environment at
    request time instead lets a deployment set/change them via .env + a
    container restart — see web/src/config/env.ts.
    """

    def get(self, _request):
        """Return the "Add <type>" external-URL overrides, if configured."""
        return Response(
            {
                "createGeoServerUrl": os.environ.get("VITE_CREATE_GEOSERVER_URL") or None,
                "createPostgisUrl": os.environ.get("VITE_CREATE_POSTGIS_URL") or None,
                "createGeoNodeUrl": os.environ.get("VITE_CREATE_GEONODE_URL") or None,
            }
        )


class ProvidersView(APIView):
    """API endpoint for provider configurations."""

    def get(self, request):
        """Get all provider configurations.

        Returns list of providers with their enabled/experimental status.
        """
        providers = get_providers_manager(request.user.username).list_providers()
        return Response(
            {
                "providers": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "description": p.description,
                        "enabled": p.enabled,
                        "experimental": p.experimental,
                    }
                    for p in providers
                ]
            }
        )

    def put(self, request):
        """Update provider enabled states.

        Expected body:
        {
            "providers": [
                {"id": "geoserver", "enabled": true},
                {"id": "s3", "enabled": false}
            ]
        }
        """
        data = request.data
        providers_updates = data.get("providers", [])
        manager = get_providers_manager(request.user.username)

        for update in providers_updates:
            provider_id = update.get("id")
            enabled = update.get("enabled")
            if provider_id is not None and enabled is not None:
                manager.set_provider_enabled(provider_id, enabled)

        # Return updated list
        providers = manager.list_providers()
        return Response(
            {
                "providers": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "description": p.description,
                        "enabled": p.enabled,
                        "experimental": p.experimental,
                    }
                    for p in providers
                ]
            }
        )


class SettingsView(APIView):
    """API endpoint for application settings."""

    def get(self, request):
        """Get application settings.

        Returns theme, ping interval, and other app-wide settings.
        """
        config = get_config(request.user.username).config
        return Response(
            {
                "theme": config.theme,
                "pingIntervalSecs": config.ping_interval_secs,
                "lastLocalPath": config.last_local_path,
            }
        )

    def put(self, request):
        """Update application settings.

        Expected body:
        {
            "theme": "default",
            "pingIntervalSecs": 60,
            "lastLocalPath": "/path/to/dir"
        }
        """
        data = request.data
        config_manager = get_config(request.user.username)

        if "theme" in data:
            config_manager.config.theme = data["theme"]

        if "pingIntervalSecs" in data:
            interval = int(data["pingIntervalSecs"])
            # Clamp to valid range
            interval = max(10, min(600, interval))
            config_manager.config.ping_interval_secs = interval

        if "lastLocalPath" in data:
            config_manager.config.last_local_path = data["lastLocalPath"]

        config_manager.save()

        return Response(
            {
                "theme": config_manager.config.theme,
                "pingIntervalSecs": config_manager.config.ping_interval_secs,
                "lastLocalPath": config_manager.config.last_local_path,
            }
        )
