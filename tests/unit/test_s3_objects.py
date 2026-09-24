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


def _catalog_client(child_folders):
    import json

    client = Mock()
    client.get_object.return_value = json.dumps(
        {
            "type": "Catalog",
            "links": [{"rel": "root", "href": "./catalog.json"}]
            + [{"rel": "child", "href": f"./{f}/collection.json"} for f in child_folders],
        }
    )
    return client


def _written_child_hrefs(client):
    import json

    body = json.loads(client.put_object.call_args.kwargs["body"])
    return [link["href"] for link in body["links"] if link["rel"] == "child"]


@pytest.mark.django_db
def test_delete_folder_removes_its_collection_from_root_catalog():
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    client = _catalog_client(["folder/roads", "folder/roads2", "rivers"])
    with patch("apps.s3.views.get_s3_client", return_value=client):
        response = api.delete("/api/s3/objects/s3-one/folder/roads/")

    assert response.status_code == 204
    assert _written_child_hrefs(client) == [
        "./folder/roads2/collection.json",
        "./rivers/collection.json",
    ]


@pytest.mark.django_db
def test_delete_parent_folder_removes_every_nested_collection():
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    client = _catalog_client(["folder/roads", "folder/rivers", "other"])
    with patch("apps.s3.views.get_s3_client", return_value=client):
        api.delete("/api/s3/objects/s3-one/folder/")

    assert _written_child_hrefs(client) == ["./other/collection.json"]


@pytest.mark.django_db
def test_delete_unrelated_object_leaves_root_catalog_untouched():
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, is_authenticated=True))
    client = _catalog_client(["folder/roads"])
    with patch("apps.s3.views.get_s3_client", return_value=client):
        api.delete("/api/s3/objects/s3-one/folder/roads/roads.pmtiles")

    client.put_object.assert_not_called()
