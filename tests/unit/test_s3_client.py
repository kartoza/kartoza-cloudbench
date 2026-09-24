"""Unit tests for the S3 client (botocore Stubber, no network)."""

import io
from datetime import UTC, datetime

import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber

from apps.s3 import client as s3
from apps.s3.models import S3Connection

WHEN = datetime(2024, 1, 2, 3, 4, 5, tzinfo=UTC)


@pytest.fixture
def s3client():
    client = s3.S3Client("minio.test:9000", "key", "secret", use_ssl=False)
    with Stubber(client.client) as stubber:
        client.stubber = stubber
        yield client
        stubber.assert_no_pending_responses()


@pytest.mark.unit
class TestS3Client:
    def test_endpoint_scheme(self):
        plain = s3.S3Client("minio.test:9000", "k", "s", use_ssl=False)
        assert plain.client.meta.endpoint_url == "http://minio.test:9000"
        secure = s3.S3Client("s3.test", "k", "s", use_ssl=True, path_style=False)
        assert secure.client.meta.endpoint_url == "https://s3.test"
        explicit = s3.S3Client("http://explicit.test", "k", "s")
        assert explicit.client.meta.endpoint_url == "http://explicit.test"

    def test_dataclasses(self):
        obj = s3.S3Object("k", 1, "t", "e", is_directory=True)
        assert obj.to_dict()["isDirectory"] is True
        assert s3.S3Bucket("b").to_dict() == {"name": "b", "creationDate": None}

    def test_test_connection_ok(self, s3client):
        s3client.stubber.add_response("list_buckets", {"Buckets": []})
        assert s3client.test_connection() == (True, "Connection successful")

    def test_test_connection_client_error(self, s3client):
        s3client.stubber.add_client_error("list_buckets", "AccessDenied")
        ok, msg = s3client.test_connection()
        assert not ok and "AccessDenied" in msg

    def test_test_connection_other_error(self, monkeypatch):
        client = s3.S3Client("x.test", "k", "s")
        monkeypatch.setattr(
            client.client, "list_buckets", lambda: (_ for _ in ()).throw(OSError("net"))
        )
        assert client.test_connection() == (False, "net")

    def test_list_buckets(self, s3client):
        s3client.stubber.add_response(
            "list_buckets",
            {"Buckets": [{"Name": "a", "CreationDate": WHEN}, {"Name": "b"}]},
        )
        buckets = s3client.list_buckets()
        assert buckets[0].creation_date == WHEN.isoformat()
        assert buckets[1].creation_date is None

    def test_list_objects(self, s3client):
        s3client.stubber.add_response(
            "list_objects_v2",
            {
                "Contents": [
                    {"Key": "dir/a.txt", "Size": 5, "LastModified": WHEN, "ETag": '"abc"'},
                    {"Key": "dir/b.txt"},
                ],
                "CommonPrefixes": [{"Prefix": "dir/sub/"}],
                "IsTruncated": True,
                "NextContinuationToken": "next",
                "KeyCount": 2,
            },
            {
                "Bucket": "bkt",
                "MaxKeys": 10,
                "Prefix": "dir/",
                "Delimiter": "/",
                "ContinuationToken": "tok",
            },
        )
        result = s3client.list_objects("bkt", prefix="dir/", max_keys=10, continuation_token="tok")
        assert result["objects"][0]["etag"] == "abc"
        assert result["objects"][1]["lastModified"] == ""
        assert result["prefixes"] == ["dir/sub/"]
        assert result["isTruncated"] is True
        assert result["nextContinuationToken"] == "next"

    def test_list_objects_minimal_params(self, s3client):
        s3client.stubber.add_response("list_objects_v2", {}, {"Bucket": "bkt", "MaxKeys": 1000})
        assert s3client.list_objects("bkt", delimiter="")["objects"] == []

    def test_get_object_and_stream(self, s3client):
        for _ in range(2):
            s3client.stubber.add_response(
                "get_object", {"Body": _body(b"hello")}, {"Bucket": "b", "Key": "k"}
            )
        assert s3client.get_object("b", "k") == b"hello"
        assert s3client.get_object_stream("b", "k").read() == b"hello"

    def test_get_object_info(self, s3client):
        s3client.stubber.add_response(
            "head_object",
            {
                "ContentLength": 3,
                "ContentType": "text/plain",
                "LastModified": WHEN,
                "ETag": '"e"',
                "Metadata": {"a": "b"},
            },
        )
        info = s3client.get_object_info("b", "k")
        assert info == {
            "contentLength": 3,
            "contentType": "text/plain",
            "lastModified": WHEN.isoformat(),
            "etag": "e",
            "metadata": {"a": "b"},
        }

    def test_put_object_with_options(self, s3client):
        s3client.stubber.add_response(
            "put_object",
            {"ETag": '"e"', "VersionId": "v1"},
            {
                "Bucket": "b",
                "Key": "k",
                "Body": b"x",
                "ContentType": "text/plain",
                "Metadata": {"a": "b"},
            },
        )
        result = s3client.put_object("b", "k", b"x", content_type="text/plain", metadata={"a": "b"})
        assert result == {"etag": "e", "versionId": "v1"}

    def test_delete_and_copy(self, s3client):
        s3client.stubber.add_response("delete_object", {}, {"Bucket": "b", "Key": "k"})
        assert s3client.delete_object("b", "k") is True
        s3client.stubber.add_response("copy_object", {"CopyObjectResult": {"ETag": '"c"'}})
        assert s3client.copy_object("b", "k", "b2", "k2") == {"etag": "c"}

    def test_presigned_url(self):
        client = s3.S3Client("s3.test", "k", "s")
        url = client.generate_presigned_url("b", "key.txt", expiration=60)
        assert url.startswith("https://s3.test/b/key.txt") and "X-Amz-Signature" in url

    def test_client_errors_propagate(self, s3client):
        s3client.stubber.add_client_error("delete_object", "NoSuchKey")
        with pytest.raises(ClientError):
            s3client.delete_object("b", "k")


def _body(data: bytes):
    from botocore.response import StreamingBody

    return StreamingBody(io.BytesIO(data), len(data))


@pytest.mark.unit
class TestS3ClientManager:
    @pytest.fixture(autouse=True)
    def _reset(self):
        s3.S3ClientManager._instance = None
        yield
        s3.S3ClientManager._instance = None

    @pytest.fixture
    def owner(self, django_user_model):
        return django_user_model.objects.create(username="alice")

    @pytest.fixture
    def conn(self, owner):
        return S3Connection.objects.create(
            owner=owner,
            name="sandbox",
            endpoint="s3.test",
            bucket="b",
            access_key="k",
            secret_key="s",
        )

    @pytest.mark.django_db
    def test_unknown_connection(self, owner):
        with pytest.raises(ValueError, match="not found"):
            s3.get_s3_client("x", owner)

    @pytest.mark.django_db
    def test_other_users_connection_is_not_found(self, conn, django_user_model):
        bob = django_user_model.objects.create(username="bob")
        with pytest.raises(ValueError, match="not found"):
            s3.get_s3_client(str(conn.id), bob)

    @pytest.mark.django_db
    def test_cache_remove_and_clear(self, conn, owner):
        conn_id = str(conn.id)
        first = s3.get_s3_client(conn_id, owner)
        assert s3.get_s3_client(conn_id, owner) is first
        assert first.region == "us-east-1"
        s3.S3ClientManager().remove_client(conn_id, owner)
        second = s3.get_s3_client(conn_id, owner)
        assert second is not first
        s3.S3ClientManager().clear_all()
        assert s3.get_s3_client(conn_id, owner) is not second
