"""Endpoint for GeoHosting to push instance connection state into CloudBench.

Replaces the old in-process ``ConfigManager.post_process_config``
monkeypatch that used to run inside GeoHosting's Django process and pull
``Instance`` rows via the ORM. Now that CloudBench is a separate service
with no access to GeoHosting's database, GeoHosting pushes connection state
explicitly whenever an instance's status changes.
"""

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .config import get_config
from .models import Connection, GeoNodeConnection, PGService
from .sso_auth import sign_sso_token


class ProductNames:
    """Product name constants as sent by GeoHosting."""

    GEOSERVER = "geoserver"
    GEONODE = "geonode"
    POSTGIS = "postgis"


class HasServiceToken(permissions.BasePermission):
    """Allow only requests carrying the shared GeoHosting service token."""

    def has_permission(self, request, view):
        token = settings.CLOUDBENCH_SERVICE_TOKEN
        if not token:
            return False
        return request.META.get("HTTP_AUTHORIZATION") == f"Bearer {token}"


def _connection_id(instance_id) -> str:
    return f"geohosting_{instance_id}"


def _update_password_if_empty(items, conn_id: str, password: str) -> bool:
    """Fill in a blank password on an existing connection, if one is given."""
    for item in items:
        if item.id == conn_id and not item.password and password:
            item.password = password
            return True
    return False


class GeoHostingInstanceView(APIView):
    """Upsert or remove a GeoHosting-managed connection in CloudBench."""

    permission_classes = [HasServiceToken]

    def post(self, request):
        """Add a connection for a GeoHosting instance.

        Existing connections are left alone except for filling in a blank
        password, so user-edited fields (name, url, username) aren't
        clobbered by a later sync.
        """
        data = request.data
        owner_user_id = str(data.get("owner_user_id") or "")
        instance_id = data.get("instance_id")
        product = (data.get("product") or "").lower()
        if not owner_user_id or not instance_id or not product:
            return Response(
                {
                    "detail": (
                        "owner_user_id, instance_id and product are "
                        "required."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = data.get("name", "")
        url = data.get("url", "")
        username = data.get("username", "")
        password = data.get("password", "")
        is_active = bool(data.get("is_active", False))
        conn_id = _connection_id(instance_id)

        manager = get_config(owner_user_id)
        config = manager.config
        changed = False

        if product == ProductNames.GEOSERVER:
            existing_ids = {c.id for c in config.connections}
            if conn_id not in existing_ids:
                config.connections.append(
                    Connection(
                        id=conn_id,
                        name=name,
                        url=f"{url}/geoserver",
                        username=username,
                        password=password,
                        is_active=is_active,
                    )
                )
                changed = True
            else:
                changed = _update_password_if_empty(
                    config.connections, conn_id, password
                )
        elif product == ProductNames.GEONODE:
            existing_ids = {c.id for c in config.geonode_connections}
            if conn_id not in existing_ids:
                config.geonode_connections.append(
                    GeoNodeConnection(
                        id=conn_id,
                        name=name,
                        url=url,
                        username=username,
                        password=password,
                        is_active=is_active,
                    )
                )
                changed = True
            else:
                changed = _update_password_if_empty(
                    config.geonode_connections, conn_id, password
                )
        elif product == ProductNames.POSTGIS:
            existing_ids = {s.id for s in config.pg_services}
            if conn_id not in existing_ids:
                host = url.removeprefix("https://").removeprefix("http://")
                config.pg_services.append(
                    PGService(
                        id=conn_id,
                        name=name,
                        host=host,
                        port=5432,
                        dbname="gis",
                        user=username,
                        password=password,
                        is_active=is_active,
                        sslmode="require",
                    )
                )
                changed = True
            else:
                changed = _update_password_if_empty(
                    config.pg_services, conn_id, password
                )
        else:
            return Response(
                {"detail": f"Unknown product '{product}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if changed:
            manager.save()
        return Response({"status": "ok"}, status=status.HTTP_200_OK)

    def delete(self, request, instance_id):
        """Remove a GeoHosting instance's connection from CloudBench."""
        owner_user_id = str(request.query_params.get("owner_user_id") or "")
        if not owner_user_id:
            return Response(
                {"detail": "owner_user_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        conn_id = _connection_id(instance_id)
        manager = get_config(owner_user_id)
        config = manager.config
        changed = False

        filtered = [c for c in config.connections if c.id != conn_id]
        if len(filtered) != len(config.connections):
            config.connections = filtered
            changed = True

        filtered = [
            c for c in config.geonode_connections if c.id != conn_id
        ]
        if len(filtered) != len(config.geonode_connections):
            config.geonode_connections = filtered
            changed = True

        filtered = [s for s in config.pg_services if s.id != conn_id]
        if len(filtered) != len(config.pg_services):
            config.pg_services = filtered
            changed = True

        if changed:
            manager.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class GeoHostingSSOTokenView(APIView):
    """Mint a short-lived SSO token for GeoHosting's iframe handoff.

    GeoHosting's backend calls this when its frontend needs to embed
    CloudBench for the logged-in user — the returned token is handed to
    the browser as a URL parameter and used directly against CloudBench's
    own API from then on (see apps/core/sso_auth.py).
    """

    permission_classes = [HasServiceToken]

    def post(self, request):
        """Sign a token for the given GeoHosting user id."""
        owner_user_id = str(request.data.get("owner_user_id") or "")
        if not owner_user_id:
            return Response(
                {"detail": "owner_user_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({"token": sign_sso_token(owner_user_id)})
