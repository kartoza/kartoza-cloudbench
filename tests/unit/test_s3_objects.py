"""S3 object/folder delete endpoint."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_delete_object_deletes_a_single_key():
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    with patch("apps.s3.views.get_s3_client") as get_client:
        response = api.delete("/api/s3/objects/s3-one/folder/roads.pmtiles")

    assert response.status_code == 204
    get_client.return_value.delete_object.assert_called_once_with("folder/roads.pmtiles")
    get_client.return_value.delete_prefix.assert_not_called()


@pytest.mark.django_db
def test_delete_folder_deletes_the_whole_prefix():
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    with patch("apps.s3.views.get_s3_client") as get_client:
        response = api.delete("/api/s3/objects/s3-one/folder/roads/")

    assert response.status_code == 204
    get_client.return_value.delete_prefix.assert_called_once_with("folder/roads/")
    get_client.return_value.delete_object.assert_not_called()
