"""Uploads straight into the bucket as S3 multipart uploads (apps.s3.multipart)."""

import hashlib
import io
import itertools
import zipfile
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.s3 import multipart
from apps.s3.models import CngLiteJob, S3Connection
from apps.upload.models import UploadSession

MB = 1024 * 1024


class FakeBoto:
    """The multipart calls of a boto3 S3 client, against a dict."""

    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.uploads: dict[str, dict] = {}
        self.aborted: list[str] = []
        self.ranges: list[str] = []
        self.ids = itertools.count(1)

    def create_multipart_upload(self, Bucket, Key, ContentType):  # noqa: N803 - boto3's names
        upload_id = f"up-{next(self.ids)}"
        self.uploads[upload_id] = {"key": Key, "type": ContentType, "parts": {}}
        return {"UploadId": upload_id}

    def upload_part(self, Bucket, Key, UploadId, PartNumber, Body):  # noqa: N803
        upload = self.uploads[UploadId]
        assert upload["key"] == Key
        upload["parts"][PartNumber] = Body
        return {"ETag": f'"{hashlib.md5(Body).hexdigest()}"'}

    def list_parts(self, Bucket, Key, UploadId, PartNumberMarker=0):  # noqa: N803
        # Two parts a page, to be paged through.
        numbers = sorted(n for n in self.uploads[UploadId]["parts"] if n > PartNumberMarker)
        page = numbers[:2]
        return {
            "Parts": [
                {
                    "PartNumber": n,
                    "ETag": f'"{hashlib.md5(self.uploads[UploadId]["parts"][n]).hexdigest()}"',
                    "Size": len(self.uploads[UploadId]["parts"][n]),
                    "ChecksumCRC32": "abc=",
                }
                for n in page
            ],
            "IsTruncated": len(numbers) > 2,
            "NextPartNumberMarker": page[-1] if page else 0,
        }

    def complete_multipart_upload(self, Bucket, Key, UploadId, MultipartUpload):  # noqa: N803
        upload = self.uploads.pop(UploadId)
        parts = MultipartUpload["Parts"]
        assert [p["PartNumber"] for p in parts] == sorted(upload["parts"])
        for part in parts:
            body = upload["parts"][part["PartNumber"]]
            assert part["ETag"] == f'"{hashlib.md5(body).hexdigest()}"'
            assert part.get("ChecksumCRC32", "abc=") == "abc="
        self.objects[Key] = (
            b"".join(upload["parts"][n] for n in sorted(upload["parts"])),
            upload["type"],
        )
        return {}

    def abort_multipart_upload(self, Bucket, Key, UploadId):  # noqa: N803
        self.uploads.pop(UploadId)
        self.aborted.append(UploadId)

    def head_object(self, Bucket, Key):  # noqa: N803
        body, content_type = self.objects[Key]
        return {"ContentLength": len(body), "ContentType": content_type}

    def get_object(self, Bucket, Key, Range=None):  # noqa: N803
        body = self.objects[Key][0]
        if Range:
            start, end = (int(n) for n in Range.removeprefix("bytes=").split("-"))
            body = body[start : end + 1]
            self.ranges.append(Range)
        return {"Body": io.BytesIO(body)}


class FakeS3Client:
    bucket = "bucket"

    def __init__(self):
        self.client = FakeBoto()

    def list_objects(self, prefix="", delimiter="", max_keys=1000, **_kwargs):
        keys = [k for k in self.client.objects if k.startswith(prefix)]
        return {"objects": [{"key": k} for k in keys[:max_keys]]}

    def get_object_info(self, key):
        head = self.client.head_object(Bucket=self.bucket, Key=key)
        return {"contentLength": head["ContentLength"], "contentType": head["ContentType"]}

    def get_object(self, key):
        return self.client.objects[key][0]

    def get_object_stream(self, key):
        return io.BytesIO(self.client.objects[key][0])

    def delete_object(self, key):
        self.client.objects.pop(key, None)
        return True

    def gdal_path(self, key):
        return f"/vsis3/{self.bucket}/{key}", {"AWS_S3_ENDPOINT": "s3:9000"}


@pytest.fixture
def bucket():
    s3 = FakeS3Client()
    with (
        patch("apps.s3.multipart.get_s3_client", return_value=s3),
        patch("apps.s3.views.get_s3_client", return_value=s3),
    ):
        yield s3


class Api:
    """The test user's client, and the multipart endpoints of their connection."""

    def __init__(self, client, conn_id):
        self.client = client
        self.base = f"/api/s3/multipart/{conn_id}"

    def start(self, **body):
        return self.client.post(self.base, body, format="json")

    def put(self, session_id, index, data, base=None):
        return self.client.put(
            f"{base or self.base}/{session_id}/parts/{index}",
            data=data,
            content_type="application/octet-stream",
        )

    def status(self, session_id):
        return self.client.get(f"{self.base}/{session_id}")

    def cancel(self, session_id):
        return self.client.delete(f"{self.base}/{session_id}")

    def complete(self, session_id, **body):
        return self.client.post(f"{self.base}/{session_id}/complete", body, format="json")

    def send_all(self, started, data):
        body = started.json()
        size = body["chunkSize"]
        for i in range(body["totalChunks"]):
            sent = self.put(body["sessionId"], i, data[i * size : (i + 1) * size])
            assert sent.status_code == 200, sent.json()
        return body["sessionId"]


@pytest.fixture
def api(authenticated_api_client, django_user_model):
    owner = django_user_model.objects.get(username="test-user")
    conn = S3Connection.objects.create(owner=owner, name="b", endpoint="s3:9000", bucket="bucket")
    return Api(authenticated_api_client, conn.id)


@pytest.mark.django_db
def test_a_file_goes_straight_into_the_bucket(api, bucket, tmp_path):
    data = bytes(range(256)) * (12 * MB // 256)
    started = api.start(filename="data.bin", fileSize=len(data), key="folder/data.bin")
    assert started.status_code == 201, started.json()
    body = started.json()
    assert body["chunkSize"] == 5 * MB and body["totalChunks"] == 3
    assert body["key"] == "folder/data.bin"
    sid = body["sessionId"]

    # Any order, and a chunk sent again (a retry) just replaces its part.
    for index in (2, 0, 0, 1):
        assert api.put(sid, index, data[index * 5 * MB : (index + 1) * 5 * MB]).status_code == 200
    assert api.status(sid).json()["received"] == [0, 1, 2]

    done = api.complete(sid, key="folder/data.bin")
    assert done.status_code == 201, done.json()
    assert done.json()["key"] == "folder/data.bin" and done.json()["size"] == len(data)
    assert bucket.client.objects["folder/data.bin"] == (data, "application/octet-stream")
    session = UploadSession.objects.get(session_id=sid)
    assert session.completed
    # Nothing on CloudBench's disk.
    assert not (tmp_path / "cache" / "uploads").exists() or not any(
        (tmp_path / "cache" / "uploads").iterdir()
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "index, size, status, error",
    [
        (0, 5 * MB - 1, 400, "not 5242880"),
        (1, 2 * MB + 1, 400, "not 2097152"),
        (2, 1, 400, "isn't one of"),
        (0, 5 * MB + 1, 413, "at most"),
    ],
)
def test_a_chunk_of_the_wrong_size_or_place_is_refused(api, bucket, index, size, status, error):
    sid = api.start(filename="a.bin", fileSize=7 * MB).json()["sessionId"]
    sent = api.put(sid, index, b"x" * size)
    assert sent.status_code == status and error in sent.json()["error"]


@pytest.mark.django_db
def test_completing_with_chunks_missing_is_refused(api, bucket):
    sid = api.start(filename="a.bin", fileSize=7 * MB).json()["sessionId"]
    api.put(sid, 1, b"x" * 2 * MB)
    done = api.complete(sid)
    assert done.status_code == 400 and done.json()["error"] == "Chunks missing from a.bin: [0]"


@pytest.mark.django_db
def test_completing_as_another_upload_is_refused(api, bucket):
    started = api.start(filename="a.bin", fileSize=10, key="x/a.bin")
    sid = api.send_all(started, b"0123456789")
    done = api.complete(sid, key="y/a.bin")
    assert (
        done.status_code == 400 and "isn't what the upload was started for" in done.json()["error"]
    )


@pytest.mark.django_db
def test_a_cog_conversion_uploads_its_source_and_starts(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    data = b"II*\x00" + b"\x00" * (6 * MB)
    fields = {
        "convert": "true",
        "targetFormat": "cog",
        "key": "rasters/dem.tif",
        "license": "CC-BY-4.0",
    }
    started = api.start(filename="dem.tif", fileSize=len(data), **fields)
    assert started.status_code == 201, started.json()
    sid = started.json()["sessionId"]
    assert started.json()["key"] == f"rasters/sources/{sid}/dem.tif"

    api.send_all(started, data)
    with patch("apps.s3.cog.run_conversion") as run:
        done = api.complete(sid, **fields)
    assert done.status_code == 202, done.json()
    assert done.json()["conversionJobId"] == sid
    job = CngLiteJob.objects.get(pk=sid)
    assert job.kind == "cog" and job.source_key == started.json()["key"]
    assert job.input_size == len(data) and job.license == "CC-BY-4.0"
    assert bucket.client.objects[job.source_key] == (data, "image/tiff")
    run.assert_called_once_with(job.id)


@pytest.mark.django_db
def test_a_conversion_checks_the_file_starts_as_its_type(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    started = api.start(filename="dem.tif", fileSize=10, convert="true", targetFormat="cog")
    sent = api.put(started.json()["sessionId"], 0, b"not a tiff")
    assert sent.status_code == 400 and sent.json()["error"] == "The file is not a valid TIFF."


@pytest.mark.django_db
@pytest.mark.parametrize(
    "filename, target, error",
    [
        ("cloud.las", "cog", "A COG conversion takes .tif, .tiff files."),
        ("roads.gpkg", "pmtiles", "A PMTILES conversion takes"),
        ("dem.tif", "mosaic", "mosaic conversions aren't uploaded this way"),
    ],
)
def test_only_single_file_conversions_go_this_way(api, bucket, settings, filename, target, error):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    started = api.start(filename=filename, fileSize=10, convert="true", targetFormat=target)
    assert started.status_code == 400 and error in started.json()["error"]


@pytest.mark.django_db
def test_a_conversion_over_an_existing_layer_asks_first(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    bucket.client.objects["dem/collection.json"] = (b"{}", "application/json")
    fields = {"convert": "true", "targetFormat": "cog", "filename": "dem.tif", "fileSize": 10}
    refused = api.start(**fields)
    assert refused.status_code == 409 and refused.json()["conflict"]["folder"] == "dem"
    assert bucket.client.uploads == {}
    assert api.start(**fields, replace="true").status_code == 201


@pytest.mark.django_db
def test_the_size_limit_is_checked_first(api, bucket, settings):
    settings.UPLOAD_MAX_FILE_SIZE = 100
    started = api.start(filename="a.bin", fileSize=101)
    assert started.status_code == 413
    assert bucket.client.uploads == {}


@pytest.mark.django_db
def test_cancelling_aborts_the_upload(api, bucket):
    sid = api.start(filename="a.bin", fileSize=10).json()["sessionId"]
    assert api.cancel(sid).status_code == 204
    assert bucket.client.aborted == ["up-1"] and bucket.client.uploads == {}
    assert api.put(sid, 0, b"0123456789").status_code == 409


@pytest.mark.django_db
def test_an_upload_left_for_a_day_is_aborted(api, bucket):
    sid = api.start(filename="a.bin", fileSize=10).json()["sessionId"]
    UploadSession.objects.filter(session_id=sid).update(
        created_at=timezone.now() - timedelta(days=1, minutes=1)
    )
    api.start(filename="b.bin", fileSize=10)
    assert bucket.client.aborted == ["up-1"]
    assert UploadSession.objects.get(session_id=sid).error == "Abandoned"


@pytest.mark.django_db
def test_someone_elses_upload_is_not_found(api, bucket, django_user_model):
    sid = api.start(filename="a.bin", fileSize=10).json()["sessionId"]
    other_client = APIClient()
    other_client.force_authenticate(django_user_model.objects.create_user(username="other"))
    other = Api(other_client, api.base.rsplit("/", 1)[1])
    assert other.put(sid, 0, b"0123456789").status_code == 404
    assert other.status(sid).status_code == 404
    assert other.cancel(sid).status_code == 404
    assert other.complete(sid).status_code == 404
    # Nor is it under another connection.
    assert api.put(sid, 0, b"0123456789", base="/api/s3/multipart/c2").status_code == 404


@pytest.mark.django_db
def test_staged_upload_endpoints_leave_it_alone(api, bucket, tmp_path):
    """The disk-staged chunk endpoints don't take a multipart upload's chunks."""
    sid = api.start(filename="a.bin", fileSize=10).json()["sessionId"]
    from django.core.files.uploadedfile import SimpleUploadedFile

    sent = api.client.post(
        "/api/upload/chunk",
        {"sessionId": sid, "chunkIndex": 0, "chunk": SimpleUploadedFile("c", b"0123456789")},
        format="multipart",
    )
    assert sent.status_code == 404
    assert api.client.delete(f"/api/upload/session/{sid}").status_code == 404
    assert UploadSession.objects.filter(session_id=sid).exists()


def test_a_huge_file_gets_bigger_chunks():
    assert multipart.part_size(10 * 1024 * MB) == 5 * MB
    size = multipart.part_size(100 * 1024 * MB)
    assert size % MB == 0 and 100 * 1024 * MB / size <= multipart.MAX_PARTS


# === Shapefiles and GeoPackages, made ready in the bucket ===


SHAPEFILE = {"shp": b"\x00\x00\x27\x0a" + b"s" * 96, "shx": b"x" * 50, "dbf": b"d" * 70}


def send_files(api, started, files):
    """Send the files of a started upload, each to its session."""
    body = started.json()
    for each in [body, *body["companions"]]:
        data = files[each["filename"]]
        size = each["chunkSize"]
        for i in range(each["totalChunks"]):
            sent = api.put(each["sessionId"], i, data[i * size : (i + 1) * size])
            assert sent.status_code == 200, sent.json()
    return body["sessionId"]


def zip_entries(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {info.filename: archive.read(info) for info in archive.infolist()}


@pytest.mark.django_db
def test_a_shapefiles_parts_are_zipped_in_the_bucket(api, bucket):
    files = {f"roads.{ext}": data for ext, data in SHAPEFILE.items()}
    companions = [{"filename": n, "fileSize": len(d)} for n, d in files.items() if n != "roads.shp"]
    started = api.start(
        filename="roads.shp",
        fileSize=len(files["roads.shp"]),
        key="gis/roads.shp",
        companions=companions,
    )
    assert started.status_code == 201, started.json()
    sid = send_files(api, started, files)
    done = api.complete(sid, key="gis/roads.shp")
    assert done.status_code == 201, done.json()
    assert done.json()["key"] == "gis/roads.zip"
    # Named after the file, as a staged upload's ZIP is; the parts are gone.
    assert zip_entries(bucket.client.objects["gis/roads.zip"][0]) == {
        "roads.shp": SHAPEFILE["shp"],
        "roads.shx": SHAPEFILE["shx"],
        "roads.dbf": SHAPEFILE["dbf"],
    }
    assert list(bucket.client.objects) == ["gis/roads.zip"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "names, error",
    [
        (["roads.shp", "roads.shx"], "Select the matching .shp, .shx and .dbf files together"),
        (["roads.shp", "roads.shx", "rivers.dbf"], "Select only the matching components"),
        (["roads.shp", "roads.shx", "roads.shx", "roads.dbf"], "Duplicate shapefile components"),
    ],
)
def test_a_shapefiles_parts_are_checked_first(api, bucket, names, error):
    started = api.start(
        filename=names[0],
        fileSize=10,
        companions=[{"filename": n, "fileSize": 10} for n in names[1:]],
    )
    assert started.status_code == 400 and error in started.json()["error"]
    assert bucket.client.uploads == {}


@pytest.mark.django_db
def test_a_shapefile_converts_from_its_parts(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    files = {f"roads.{ext}": data for ext, data in SHAPEFILE.items()}
    fields = {"convert": "true", "targetFormat": "pmtiles", "key": "gis/roads.shp"}
    started = api.start(
        filename="roads.shp",
        fileSize=len(files["roads.shp"]),
        companions=[
            {"filename": n, "fileSize": len(d)} for n, d in files.items() if n != "roads.shp"
        ],
        **fields,
    )
    sid = send_files(api, started, files)
    with patch("apps.s3.pmtiles.run_conversion") as run:
        done = api.complete(sid, **fields)
    assert done.status_code == 202, done.json()
    job = CngLiteJob.objects.get(pk=sid)
    assert job.source_key == f"gis/sources/{sid}/roads.zip"
    assert job.input_size == sum(len(d) for d in files.values())
    # The ZIP is named after the job, as a staged one is; the parts are kept beside it.
    assert set(zip_entries(bucket.client.objects[job.source_key][0])) == {
        f"{sid}.shp",
        f"{sid}.shx",
        f"{sid}.dbf",
    }
    assert set(bucket.client.objects) == {
        job.source_key,
        *(f"gis/sources/{sid}/{n}" for n in files),
    }
    run.assert_called_once_with(job.id)


def shapefile_zip(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return out.getvalue()


@pytest.mark.django_db
def test_a_shapefile_zip_is_rewritten_in_the_bucket(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    data = shapefile_zip(
        {f"data/Roads.{ext}": d for ext, d in SHAPEFILE.items()} | {"readme.txt": b"hi"}
    )
    fields = {"convert": "true", "targetFormat": "pmtiles", "key": "gis/roads.zip"}
    started = api.start(filename="roads.zip", fileSize=len(data), **fields)
    sid = api.send_all(started, data)
    with patch("apps.s3.pmtiles.run_conversion"):
        done = api.complete(sid, **fields)
    assert done.status_code == 202, done.json()
    job = CngLiteJob.objects.get(pk=sid)
    assert zip_entries(bucket.client.objects[job.source_key][0]) == {
        f"{sid}.{ext}": d for ext, d in SHAPEFILE.items()
    }
    # Read with range requests, and the ZIP uploaded dropped.
    assert bucket.client.ranges
    assert list(bucket.client.objects) == [job.source_key]


@pytest.mark.django_db
def test_a_zip_without_one_shapefile_is_refused_and_dropped(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    data = shapefile_zip({"a.txt": b"not a shapefile"})
    fields = {"convert": "true", "targetFormat": "pmtiles", "key": "gis/roads.zip"}
    sid = api.send_all(api.start(filename="roads.zip", fileSize=len(data), **fields), data)
    done = api.complete(sid, **fields)
    assert done.status_code == 400
    assert done.json()["error"] == "The ZIP must contain exactly one shapefile."
    assert bucket.client.objects == {} and not CngLiteJob.objects.exists()


@pytest.mark.django_db
def test_a_geopackage_is_read_where_it_landed(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    data = b"SQLite format 3\x00" + b"\x00" * 100
    fields = {
        "convert": "true",
        "targetFormat": "inspect",
        "key": "gis/bali.gpkg",
        "license": "CC-BY-4.0",
    }
    sid = api.send_all(api.start(filename="bali.gpkg", fileSize=len(data), **fields), data)
    contents = {"layers": [{"name": "roads"}], "rasterTables": [{"name": "dem"}]}
    with patch("apps.s3.multipart.read_contents", return_value=contents) as read:
        done = api.complete(sid, **fields)
    assert done.status_code == 200, done.json()
    assert done.json() == {
        "jobId": sid,
        "layers": [{"name": "roads"}],
        "rasterTables": [{"name": "dem"}],
        "key": "gis/bali.pmtiles",
    }
    job = CngLiteJob.objects.get(pk=sid)
    assert job.status == "pending" and job.layers is None and job.license == "CC-BY-4.0"
    read.assert_called_once_with(f"/vsis3/bucket/{job.source_key}", {"AWS_S3_ENDPOINT": "s3:9000"})
    assert bucket.client.objects[job.source_key] == (data, "application/geopackage+sqlite3")


@pytest.mark.django_db
def test_an_unreadable_geopackage_is_dropped(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    data = b"SQLite format 3\x00" + b"\x00" * 100
    fields = {"convert": "true", "targetFormat": "inspect", "key": "bali.gpkg"}
    sid = api.send_all(api.start(filename="bali.gpkg", fileSize=len(data), **fields), data)
    with patch("apps.s3.multipart.read_contents", side_effect=ValueError("Could not read it")):
        done = api.complete(sid, **fields)
    assert done.status_code == 400 and done.json()["error"] == "Could not read it"
    assert bucket.client.objects == {} and not CngLiteJob.objects.exists()


@pytest.mark.django_db
def test_a_geopackage_must_start_as_one(api, bucket, settings):
    settings.CLOUDNATIVEGIS_URL = "http://cng"
    started = api.start(filename="bali.gpkg", fileSize=20, convert="true", targetFormat="inspect")
    sent = api.put(started.json()["sessionId"], 0, b"x" * 20)
    assert sent.status_code == 400 and "not a valid GeoPackage" in sent.json()["error"]


@pytest.mark.django_db
def test_cancelling_a_shapefile_aborts_its_parts(api, bucket):
    started = api.start(
        filename="roads.shp",
        fileSize=10,
        companions=[
            {"filename": "roads.shx", "fileSize": 10},
            {"filename": "roads.dbf", "fileSize": 10},
        ],
    )
    assert api.cancel(started.json()["sessionId"]).status_code == 204
    assert sorted(bucket.client.aborted) == ["up-1", "up-2", "up-3"]
    assert bucket.client.uploads == {}
