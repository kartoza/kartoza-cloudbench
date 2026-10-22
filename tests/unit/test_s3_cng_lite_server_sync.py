"""CngLiteServer.sync_from_geohosting, and its admin action."""

import uuid
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from django.urls import reverse

from apps.core.geohosting import GeoHostingClient, GeoHostingError
from apps.s3.models import CngLiteServer

pytestmark = pytest.mark.django_db


@pytest.fixture
def server(settings, django_user_model):
    settings.CLOUDBENCH_ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.GEOHOSTING_URL = "http://geohosting"
    settings.GEOHOSTING_CLIENT_ID = "cloudbench"
    settings.GEOHOSTING_CLIENT_SECRET = "secret"
    return CngLiteServer.objects.create(
        instance_id=uuid.uuid4(),
        owner=django_user_model.objects.create(username="tim"),
        status=CngLiteServer.Status.PROVISIONING,
        auto_destroy=False,
    )


def answer(server, status, **extra):
    """GeoHosting's answer about `server`."""
    return {"server_id": str(server.instance_id), "status": status, **extra}


def test_saves_geohostings_answer(server):
    ready = answer(server, "ready", url="http://10.0.0.5:8000/", token="server-token")
    with patch.object(GeoHostingClient, "get_server", return_value=ready) as get_server:
        server.sync_from_geohosting()

    get_server.assert_called_once_with(server.instance_id)
    assert server.status == "ready"
    assert server.url == "http://10.0.0.5:8000"
    assert server.api_token == "server-token"
    # Kept as it was started.
    assert server.auto_destroy is False


def test_forgotten_when_geohosting_has_none(server):
    server.api_token = "server-token"
    server.save()
    with patch.object(GeoHostingClient, "get_server", return_value=None):
        server.sync_from_geohosting()

    server.refresh_from_db()
    assert server.status == "deleted"
    assert server.api_token == ""


def run_action(client, *servers):
    return client.post(
        reverse("admin:cloudbench_s3_cngliteserver_changelist"),
        {"action": "sync_from_geohosting", "_selected_action": [s.pk for s in servers]},
        follow=True,
    )


def test_admin_action(admin_client, server):
    with patch.object(GeoHostingClient, "get_server", return_value=answer(server, "deleting")):
        response = run_action(admin_client, server)

    server.refresh_from_db()
    assert server.status == "deleting"
    assert "1 server(s) synced from GeoHosting." in response.content.decode()


def test_admin_action_reports_an_error(admin_client, server):
    with patch.object(
        GeoHostingClient, "get_server", side_effect=GeoHostingError("GeoHosting is down")
    ):
        response = run_action(admin_client, server)

    server.refresh_from_db()
    assert server.status == "provisioning"
    assert "GeoHosting is down" in response.content.decode()
