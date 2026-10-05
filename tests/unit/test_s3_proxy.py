"""The S3 object proxy, read in pieces by cloud-native viewers (COPC, PMTiles)."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient

from apps.s3.models import S3Connection
from apps.s3.views import _byte_range

CONTENT = bytes(range(256)) * 4  # 1024 bytes


@pytest.mark.parametrize(
    "header, expected",
    [
        ("", None),
        ("bytes=0-99", (0, 99)),
        ("bytes=1000-", (1000, 1023)),
        ("bytes=-24", (1000, 1023)),
        ("bytes=1000-5000", (1000, 1023)),  # clipped to the object
        ("bytes=2000-", None),  # past the end: the whole object
        ("bytes=0-9,20-29", None),  # several ranges: the whole object
        ("items=0-9", None),
    ],
)
def test_byte_range(header, expected):
    assert _byte_range(header, len(CONTENT)) == expected


@pytest.fixture
def proxied(django_user_model):
    owner = django_user_model.objects.create(username="proxy-owner")
    connection = S3Connection.objects.create(owner=owner, name="MinIO", endpoint="minio:9000")
    client = Mock()
    client.get_object_info.return_value = {
        "contentType": "application/vnd.laszip+copc",
        "contentLength": len(CONTENT),
    }

    def stream(key, byte_range=None):
        start, end = (
            (int(n) for n in byte_range.removeprefix("bytes=").split("-"))
            if byte_range
            else (0, len(CONTENT) - 1)
        )
        body = Mock()
        body.iter_chunks.return_value = iter([CONTENT[start : end + 1]])
        return body

    client.get_object_stream.side_effect = stream
    api = APIClient()
    api.force_authenticate(user=owner)
    with patch("apps.s3.views.get_s3_client", return_value=client):
        yield api, f"/api/s3/proxy/{connection.id}/lidar/autzen.copc.laz"


def body_of(response):
    return b"".join(response.streaming_content)


@pytest.mark.django_db
def test_proxy_sends_the_requested_byte_range(proxied):
    api, url = proxied

    response = api.get(url, HTTP_RANGE="bytes=377-380")

    assert response.status_code == 206
    assert response["Content-Range"] == f"bytes 377-380/{len(CONTENT)}"
    assert response["Content-Length"] == "4"
    assert response["Accept-Ranges"] == "bytes"
    assert body_of(response) == CONTENT[377:381]


@pytest.mark.django_db
def test_proxy_sends_the_whole_object_without_a_range(proxied):
    api, url = proxied

    response = api.get(url)

    assert response.status_code == 200
    assert response["Content-Length"] == str(len(CONTENT))
    assert response["Accept-Ranges"] == "bytes"
    assert body_of(response) == CONTENT
