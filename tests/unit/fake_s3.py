"""Test doubles for conversions whose results CloudNativeGIS uploads itself."""

import hashlib
import io
import json
from unittest.mock import Mock
from urllib.parse import parse_qs, quote, unquote, urlparse

import httpx


class FakeS3:
    """An in-memory bucket: just what the pipelines and the catalog use."""

    bucket = "bucket"
    bucket_url = "http://minio:9000/bucket"

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}
        self.client = Mock()
        self.client.upload_fileobj.side_effect = self._upload
        self.client.delete_objects.side_effect = self._delete_objects
        self.client.get_object.side_effect = self._get_range
        self.client.copy.side_effect = self._copy
        self.expirations: list[int] = []

    def _upload(self, source, bucket, key, ExtraArgs=None):
        self.objects[key] = source.read()
        self.content_types[key] = (ExtraArgs or {}).get("ContentType")

    def _copy(self, source, bucket, key):
        self.objects[key] = self.objects[source["Key"]]
        self.content_types[key] = self.content_types.get(source["Key"])

    def _delete_objects(self, Bucket, Delete):
        for entry in Delete["Objects"]:
            self.objects.pop(entry["Key"], None)

    def put_object(self, key, body, content_type=None):
        self.objects[key] = body if isinstance(body, bytes) else body.encode()
        self.content_types[key] = content_type
        return {"etag": hashlib.md5(self.objects[key]).hexdigest()}

    def get_object(self, key):
        return self.objects[key]

    def delete_object(self, key):
        self.objects.pop(key, None)

    def list_objects(self, prefix="", delimiter="/", max_keys=1000, continuation_token=None):
        keys = [key for key in self.objects if key.startswith(prefix)][:max_keys]
        return {"objects": [{"key": key} for key in keys], "isTruncated": False}

    def _get_range(self, Bucket, Key, Range):
        start, end = (int(n) for n in Range.removeprefix("bytes=").split("-"))
        return {"Body": io.BytesIO(self.objects[Key][start : end + 1])}

    def get_object_info(self, key):
        return {"contentLength": len(self.objects[key]), "contentType": self.content_types[key]}

    def generate_presigned_url(self, key, expiration=3600, method="get_object", content_type=None):
        self.expirations.append(expiration)
        url = f"http://minio:9000/bucket/{key}?method={method}"
        return f"{url}&type={quote(content_type)}" if content_type else url

    def presigned_put(self, url, body):
        """What S3 does with a PUT to one of this bucket's presigned URLs."""
        parsed = urlparse(url)
        key = unquote(parsed.path.removeprefix("/bucket/"))
        self.objects[key] = body
        self.content_types[key] = parse_qs(parsed.query)["type"][0]

    def delete_prefix(self, prefix):
        for key in [k for k in self.objects if k.startswith(prefix)]:
            del self.objects[key]

    def json(self, key):
        return json.loads(self.objects[key])


def key_of(url: str) -> str:
    """The object key a FakeS3 presigned URL is for."""
    return unquote(urlparse(url).path.removeprefix("/bucket/"))


def converting_cng(
    s3, endpoint, results, *, inspection=None, errors=(), detail=None, tamper=None, lost=()
):
    """A CloudNativeGIS that converts one job and uploads its results itself.

    `results` maps each layer (None for a single-layer source) to its
    files: {role: (bytes, info)}. For every upload URL the job was given
    for one of those, the bytes are PUT into `s3`, and the finished job
    reports each file's size, SHA-256 and info as `outputs`. `tamper(url,
    body)` changes what actually lands (None: nothing) - CloudBench mustn't
    take the report on trust. `detail`, if given, is reported mid-way.
    Paths in `lost` 404, as for a CloudNativeGIS that restarted.

    Returns (httpx client, submitted payloads).
    """
    submitted = []
    polls = []

    def respond(request):
        path = request.url.path
        if path in lost:
            return httpx.Response(404, json={"detail": "Job not found"})
        if path == f"/api/v1/{endpoint}":
            submitted.append(json.loads(request.content))
            return httpx.Response(202, json={"job_id": "cng-1", "status": "processing"})
        if path == "/api/v1/gpkg/layers":
            return httpx.Response(200, json=inspection or {"layers": [], "rasterTables": []})
        if path == "/api/v1/jobs/cng-1":
            polls.append(1)
            if detail and len(polls) == 1:
                return httpx.Response(200, json={"status": "processing", **detail})
            layers = []
            for spec in submitted[0]["uploads"]:
                files = results.get(spec.get("layer"))
                if files is None:
                    continue
                reported = {}
                for role, target in spec["files"].items():
                    if role not in files:
                        continue
                    body, info = files[role]
                    landed = tamper(target["url"], body) if tamper else body
                    if landed is not None:
                        s3.presigned_put(target["url"], landed)
                    reported[role] = {
                        "size": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(),
                        "info": info,
                    }
                layers.append(
                    {**({"layer": spec["layer"]} if "layer" in spec else {}), "files": reported}
                )
            return httpx.Response(
                200,
                json={
                    "status": "done",
                    "results": [],
                    "errors": list(errors),
                    "outputs": {"layers": layers},
                },
            )
        return httpx.Response(404)

    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))
    return client, submitted
