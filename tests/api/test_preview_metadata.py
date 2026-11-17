"""The GeoServer layer preview's metadata: the map zooms to its bbox, so it must be WGS84."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient

from apps.preview.views import session_manager


@pytest.mark.django_db
def test_metadata_bbox_is_wgs84_for_a_projected_layer(django_user_model):
    client = APIClient()
    client.force_authenticate(user=django_user_model.objects.create(username="preview-owner"))
    session = session_manager.create_session(conn_id="c", workspace="demo", layer_name="freguesias")
    geoserver = Mock()
    geoserver.get_layer_metadata.return_value = {
        # EPSG:3763 (metres), as GeoServer reports a Portuguese layer's native bbox.
        "bbox": {"minx": -50000.0, "miny": -120000.0, "maxx": -20000.0, "maxy": -90000.0},
        "latLonBbox": {"minx": -8.6, "miny": 38.6, "maxx": -8.3, "maxy": 38.9},
        "resource": {},
    }
    with patch("apps.preview.views.get_geoserver_client", return_value=geoserver):
        response = client.get(f"/api/preview/{session.id}/api/metadata")
    assert response.status_code == 200
    assert response.json()["latlon_bbox"] == {
        "minx": -8.6,
        "miny": 38.6,
        "maxx": -8.3,
        "maxy": 38.9,
    }
