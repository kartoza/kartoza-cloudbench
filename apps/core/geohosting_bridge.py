"""Endpoint for GeoHosting to push instance connection state into CloudBench.

Replaces the old in-process ``ConfigManager.post_process_config``
monkeypatch that used to run inside GeoHosting's Django process and pull
``Instance`` rows via the ORM. Now that CloudBench is a separate service
with no access to GeoHosting's database, GeoHosting pushes connection state
explicitly whenever an instance's status changes.
"""

from django.conf import settings
from django.contrib.auth.models import User
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.connections.models import GeoServerConnection
from apps.geonode.models import GeoNodeConnection
from apps.postgres.models import PostgresService

from .sso_auth import sign_sso_token


def get_user(username: str) -> User:
    """Get the Django user for the given username, creating it if needed."""
    user, _ = User.objects.get_or_create(username=username)
    return user


class ProductNames:
    """Product name constants as sent by GeoHosting."""

    GEOSERVER = "geoserver"
    GEONODE = "geonode"
    POSTGIS = "postgis"


class HasServiceToken(permissions.BasePermission):
    """Allow only requests carrying the shared GeoHosting service token."""

    def has_permission(self, request, _view):
        token = settings.CLOUDBENCH_SERVICE_TOKEN
        if not token:
            return False
        return request.META.get("HTTP_AUTHORIZATION") == f"Bearer {token}"


def _connection_id(instance_id) -> str:
    return f"geohosting_{instance_id}"


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
        owner_username = str(data.get("owner_username") or "")
        instance_id = data.get("instance_id")
        product = (data.get("product") or "").lower()
        if not owner_username or not instance_id or not product:
            return Response(
                {"detail": ("owner_username, instance_id and product are required.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = data.get("name", "")
        url = data.get("url", "")
        username = data.get("username", "")
        password = data.get("password", "")
        is_active = bool(data.get("is_active", False))

        if product == ProductNames.GEOSERVER:
            model = GeoServerConnection
            fields = {"url": f"{url}/geoserver", "username": username}
        elif product == ProductNames.GEONODE:
            model = GeoNodeConnection
            fields = {"url": url, "username": username}
        elif product == ProductNames.POSTGIS:
            model = PostgresService
            fields = {
                "host": url.removeprefix("https://").removeprefix("http://"),
                "port": 5432,
                "dbname": "gis",
                "user": username,
                "sslmode": "require",
            }
        else:
            return Response(
                {"detail": f"Unknown product '{product}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        owner = get_user(owner_username)
        conn_id = _connection_id(instance_id)
        existing = model.objects.filter(owner=owner, connection_id=conn_id).first()
        if existing is None:
            model.objects.create(
                owner=owner,
                connection_id=conn_id,
                name=name,
                password=password,
                is_active=is_active,
                **fields,
            )
        elif not existing.password and password:
            existing.password = password
            existing.save()
        return Response({"status": "ok"}, status=status.HTTP_200_OK)

    def delete(self, request, instance_id):
        """Remove a GeoHosting instance's connection from CloudBench."""
        owner_username = str(request.query_params.get("owner_username") or "")
        if not owner_username:
            return Response(
                {"detail": "owner_username is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        owner = get_user(owner_username)
        conn_id = _connection_id(instance_id)
        for model in (GeoServerConnection, GeoNodeConnection, PostgresService):
            model.objects.filter(owner=owner, connection_id=conn_id).delete()
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
        """Sign a token for the given GeoHosting user."""
        owner_username = str(request.data.get("owner_username") or "")
        if not owner_username:
            return Response(
                {"detail": "owner_username is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        get_user(owner_username)
        return Response({"token": sign_sso_token(owner_username)})
