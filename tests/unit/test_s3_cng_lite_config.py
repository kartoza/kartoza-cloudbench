"""CngLiteJob.is_valid/health: whether CloudNativeGIS is usable for conversions."""

from unittest.mock import Mock, patch

import httpx
import pytest
from rest_framework.test import APIClient

from apps.s3.cog import start_conversion as start_cog_conversion
from apps.s3.models import CngLiteJob
from apps.s3.pmtiles import inspect_geopackage
from apps.s3.pmtiles import start_conversion as start_pmtiles_conversion


@pytest.fixture
def static(settings):
    settings.CLOUDNATIVEGIS_ON_DEMAND = False
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    return settings


@pytest.fixture
def on_demand(settings):
    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    return settings


def test_is_valid_with_url(static):
    assert CngLiteJob.is_valid() is True


def test_is_not_valid_without_url(static):
    static.CLOUDNATIVEGIS_URL = ""
    assert CngLiteJob.is_valid() is False


def test_is_never_valid_on_demand(on_demand):
    assert CngLiteJob.is_valid() is False


@pytest.mark.parametrize(
    "response, healthy",
    [
        (httpx.Response(200, json={"status": "ok"}), True),
        (httpx.Response(503), False),
        (httpx.ConnectError("refused"), False),
    ],
)
def test_health_checks_cloudnativegis_url(static, response, healthy):
    with patch("apps.s3.models.httpx.get", side_effect=[response]) as get:
        assert CngLiteJob.health() is healthy
    get.assert_called_once_with("http://cloudnativegis/health", timeout=2.0, follow_redirects=False)


def test_health_is_false_without_url(static):
    static.CLOUDNATIVEGIS_URL = ""
    with patch("apps.s3.models.httpx.get") as get:
        assert CngLiteJob.health() is False
    get.assert_not_called()


def test_health_raises_on_demand(on_demand):
    with patch("apps.s3.models.httpx.get") as get, pytest.raises(NotImplementedError):
        CngLiteJob.health()
    get.assert_not_called()


def tools_status():
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))
    with patch("apps.s3.views.subprocess.run", side_effect=FileNotFoundError):
        response = api.get("/api/s3/conversion/tools")
    assert response.status_code == 200
    return response.json()["tools"]


@pytest.mark.parametrize("healthy", [True, False])
def test_tools_report_cloudnativegis_health(static, healthy):
    with patch("apps.s3.views.CngLiteJob.health", return_value=healthy):
        tools = tools_status()
    assert tools["cloudnativegis"]["available"] is healthy
    assert tools["gdal"]["available"] is healthy


def test_tools_report_cloudnativegis_unavailable_on_demand(on_demand):
    with patch("apps.s3.models.httpx.get") as get:
        tools = tools_status()
    get.assert_not_called()
    assert tools["cloudnativegis"]["available"] is False
    assert tools["gdal"]["available"] is False


@pytest.mark.parametrize(
    "start, name",
    [
        (start_pmtiles_conversion, "roads.zip"),
        (start_cog_conversion, "elevation.tif"),
        (inspect_geopackage, "parcels.gpkg"),
    ],
)
def test_conversions_refuse_to_start_when_not_valid(on_demand, start, name):
    uploaded = type("Upload", (), {"name": name, "size": 1})()
    with pytest.raises(ValueError, match="CloudNativeGIS is not configured"):
        start(uploaded, name, "conn", user=None)
