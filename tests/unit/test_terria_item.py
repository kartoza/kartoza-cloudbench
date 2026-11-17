"""A Terria catalog item carries its layer's WGS84 bbox, so the 3D globe can fly to it."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient

from apps.terria.views import generate_terria_item

LAYER = {"name": "freguesias", "title": "Freguesias"}


def test_item_has_the_layer_rectangle():
    item = generate_terria_item(
        LAYER, "https://gs", "demo", {"minx": -8.6, "miny": 38.6, "maxx": -8.3, "maxy": 38.9}
    )
    assert item["rectangle"] == {"west": -8.6, "south": 38.6, "east": -8.3, "north": 38.9}
    assert item["url"] == "https://gs/demo/wms"


def test_item_without_a_bbox_has_no_rectangle():
    assert "rectangle" not in generate_terria_item(LAYER, "https://gs", "demo")
    assert "rectangle" not in generate_terria_item(LAYER, "https://gs", "demo", {"minx": 1})


@pytest.mark.django_db
def test_layer_catalog_uses_the_wgs84_bbox(django_user_model):
    client = APIClient()
    client.force_authenticate(user=django_user_model.objects.create(username="terria-owner"))
    geoserver = Mock()
    geoserver.get_layer.return_value = LAYER
    geoserver.get_layer_metadata.return_value = {
        "bbox": {"minx": -50000, "miny": -120000, "maxx": -20000, "maxy": -90000},
        "latLonBbox": {"minx": -8.6, "miny": 38.6, "maxx": -8.3, "maxy": 38.9},
    }
    config = Mock()
    config.get_connection.return_value = Mock(url="https://gs")
    with (
        patch("apps.terria.views.get_config", return_value=config),
        patch("apps.terria.views.get_geoserver_client", return_value=geoserver),
    ):
        response = client.get("/api/terria/layer/c/demo/freguesias")
    assert response.status_code == 200
    assert response.json()["rectangle"]["west"] == -8.6
