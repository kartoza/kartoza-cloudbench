"""Several GeoTIFFs published as one mosaic: a collection with a STAC item per tile."""

import io
import json
from datetime import datetime
from functools import partial
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, quote, unquote, urlparse

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.s3 import mosaic, portolan, portolan_mosaic
from apps.s3.cng_lite import TargetExists, job_directory
from apps.s3.models import CngLiteJob, S3Connection

WGS84 = 'GEOGCRS["WGS 84",ID["EPSG",4326]]'
UTM = 'PROJCRS["WGS 84 / UTM zone 35S",ID["EPSG",32735]]'


def header(crs=WGS84, bands=1, dtype="Float32", nodata=-99999.0, date=None):
    return {
        "coordinateSystem": {"wkt": crs},
        "bands": [{"type": dtype, "noDataValue": nodata} for _ in range(bands)],
        "metadata": {"": {"TIFFTAG_DATETIME": date}} if date else {},
    }


def tiff(name, body=b"fixture"):
    return SimpleUploadedFile(name, b"II*\x00" + body, "image/tiff")


# -- Checks before converting --------------------------------------------------


def test_matching_tiles_pass():
    mosaic.check_tiles([("a.tif", header()), ("b.tif", header())])


@pytest.mark.parametrize(
    "odd, message",
    [
        (header(crs=UTM), "b.tif is in EPSG:32735, but a.tif is in EPSG:4326"),
        (header(bands=3), "b.tif has 3 band(s), but a.tif has 1"),
        (header(dtype="Int16"), "b.tif's data type (Int16) differs from a.tif's (Float32)"),
        (header(nodata=0), "b.tif's nodata value (0) differs from a.tif's (-99999.0)"),
        (header(crs=""), "b.tif has no coordinate reference system"),
    ],
)
def test_mismatched_tiles_are_refused_naming_the_odd_one(odd, message):
    with pytest.raises(
        mosaic.MosaicMismatch, match=message.replace("(", r"\(").replace(")", r"\)")
    ):
        mosaic.check_tiles([("a.tif", header()), ("b.tif", odd)])


def test_tiff_datetime_from_its_date_tag():
    assert mosaic.tiff_datetime(header(date="2020:03:15 10:20:30")) == "2020-03-15T10:20:30Z"
    assert mosaic.tiff_datetime(header(date="yesterday")) is None
    assert mosaic.tiff_datetime(header()) is None


# -- Starting a mosaic ---------------------------------------------------------


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="mosaic-owner")


def make_connection(owner):
    """The S3 connection the tiles go to (get_s3_client itself is patched)."""
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


@pytest.fixture
def connection(owner):
    return make_connection(owner)


# A job first waits for its CloudNativeGIS to answer /health (CngLiteJob.provision).
healthy = partial(patch, "apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200))


@pytest.fixture
def staging(settings, tmp_path):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    s3_client = Mock(bucket="bucket")
    s3_client.list_objects.return_value = {"objects": []}  # the target folder is new
    s3_client.generate_presigned_url.return_value = "http://minio:9000/bucket/staged.tif"
    with (
        patch("apps.s3.mosaic.get_s3_client", return_value=s3_client),
        patch("apps.s3.mosaic.threading.Thread") as thread,
        patch("apps.s3.mosaic.read_header", return_value=header()) as read,
    ):
        yield {"s3": s3_client, "thread": thread, "read": read, "tmp": tmp_path}


@pytest.mark.django_db
def test_start_mosaic_stages_the_tiles_as_one_job(staging, owner, connection):
    job = mosaic.start_mosaic(
        [tiff("north.tif"), tiff("south.tif")], "Elevation 2024", "maps", str(connection.id), owner
    )

    job.refresh_from_db()
    assert job.kind == "mosaic"
    assert job.source_name == "Elevation 2024"
    assert job.output_key == "maps/elevation-2024"  # the collection folder
    assert job.layers == ["north.tif", "south.tif"]  # shown as per-tile progress
    assert job.source_key == f"maps/sources/{job.id}"
    assert job.input_size == 2 * len(b"II*\x00fixture")
    staged = job_directory("mosaic", job.id) / "tiles"
    assert sorted(p.name for p in staged.iterdir()) == ["north.tif", "south.tif"]
    staging["thread"].assert_called_once()
    assert staging["thread"].call_args.kwargs["target"] == mosaic.run_mosaic


@pytest.mark.django_db
@pytest.mark.parametrize(
    "files, message",
    [
        ([tiff("only.tif")], "at least two"),
        ([tiff("same.tif"), tiff("same.tif")], "same name"),
        ([tiff("a.tif"), SimpleUploadedFile("b.tif", b"PK\x03\x04zip")], "not a valid TIFF"),
    ],
)
def test_start_mosaic_refuses_bad_uploads(staging, owner, connection, files, message):
    with pytest.raises(ValueError, match=message):
        mosaic.start_mosaic(files, "m", "", str(connection.id), owner)
    assert not CngLiteJob.objects.exists()


@pytest.mark.django_db
def test_mismatched_tiles_leave_nothing_behind(staging, owner, connection):
    staging["read"].side_effect = [header(), header(crs=UTM)]
    with pytest.raises(mosaic.MosaicMismatch):
        mosaic.start_mosaic([tiff("a.tif"), tiff("b.tif")], "m", "", str(connection.id), owner)
    assert not CngLiteJob.objects.exists()
    assert not list((staging["tmp"] / "mosaic").glob("*/tiles"))
    staging["thread"].assert_not_called()


@pytest.mark.django_db
def test_existing_folder_needs_confirming(staging, owner, connection):
    staging["s3"].list_objects.return_value = {"objects": [{"key": "m/collection.json"}]}
    tiles = [tiff("a.tif"), tiff("b.tif")]
    with pytest.raises(TargetExists):
        mosaic.start_mosaic(tiles, "m", "", str(connection.id), owner)
    tiles = [tiff("a.tif"), tiff("b.tif")]
    job = mosaic.start_mosaic(tiles, "m", "", str(connection.id), owner, replace=True)
    assert job.replace_existing


@pytest.mark.django_db
def test_mosaic_endpoint(staging, owner, connection):
    api = APIClient()
    api.force_authenticate(user=owner)
    url = f"/api/s3/mosaic/{connection.id}"

    accepted = api.post(
        url,
        {"files": [tiff("a.tif"), tiff("b.tif")], "name": "Mosaic", "license": "CC-BY-4.0"},
        format="multipart",
    )
    assert accepted.status_code == 202
    assert accepted.json()["conversionJobId"] == str(CngLiteJob.objects.get().id)

    staging["read"].side_effect = [header(), header(bands=3)]
    refused = api.post(
        url, {"files": [tiff("c.tif"), tiff("d.tif")], "name": "Other"}, format="multipart"
    )
    assert refused.status_code == 400
    assert "d.tif has 3 band(s)" in refused.json()["error"]

    staging["read"].side_effect = None
    staging["s3"].list_objects.return_value = {"objects": [{"key": "mosaic/x"}]}
    conflict = api.post(
        url, {"files": [tiff("a.tif"), tiff("b.tif")], "name": "Mosaic"}, format="multipart"
    )
    assert conflict.status_code == 409


# -- Converting (in CloudNativeGIS) and publishing ------------------------------


class FakeS3:
    """An in-memory bucket: just what the mosaic pipeline and catalog use."""

    bucket = "bucket"
    bucket_url = "http://minio:9000/bucket"

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}
        self.client = Mock()
        self.client.upload_fileobj.side_effect = self._upload
        self.client.delete_objects.side_effect = self._delete_objects
        self.client.get_object.side_effect = self._get_range
        self.expirations: list[int] = []

    def _upload(self, source, bucket, key, ExtraArgs=None):
        self.objects[key] = source.read()
        self.content_types[key] = (ExtraArgs or {}).get("ContentType")

    def _delete_objects(self, Bucket, Delete):
        for entry in Delete["Objects"]:
            self.objects.pop(entry["Key"], None)

    def put_object(self, key, body, content_type=None):
        self.objects[key] = body if isinstance(body, bytes) else body.encode()
        self.content_types[key] = content_type

    def get_object(self, key):
        return self.objects[key]

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


def _output(size):
    return {"size": size, "sha256": f"{size:064x}"}


def _uploads(payload, outputs):
    """Each upload URL in a mosaic job, with the output reported for it."""
    for tile, output in zip(payload["tiles"], outputs["tiles"], strict=True):
        yield tile["data_upload"], output["data"]
        if "web" in output:
            yield tile["web_upload"], output["web"]
    yield payload["vrt"]["upload"], outputs["vrt"]
    if "merged" in outputs:
        yield payload["merged"]["upload"], outputs["merged"]
    yield payload["thumbnail"]["upload"], outputs["thumbnail"]


def _cng(outputs_for, s3, tamper=None):
    """A CloudNativeGIS that runs one mosaic job: uploads its outputs, reports them.

    `tamper(url, body)` may change what actually lands in the bucket (None:
    nothing uploaded) - to check CloudBench doesn't take the report on trust.
    """
    submitted = []

    def respond(request):
        if request.url.path == "/api/v1/mosaic":
            submitted.append(json.loads(request.content))
            return httpx.Response(202, json={"job_id": "cng-1", "status": "processing"})
        if request.url.path == "/api/v1/jobs/cng-1":
            outputs = outputs_for(submitted[0])
            for url, output in _uploads(submitted[0], outputs):
                body = (b"II*\x00" if ".tif?" in url else b"x").ljust(output["size"], b"\0")
                body = tamper(url, body) if tamper else body
                if body is not None:
                    s3.presigned_put(url, body)
            return httpx.Response(200, json={"status": "done", "results": [], "outputs": outputs})
        return httpx.Response(404)

    return (
        httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond)),
        submitted,
    )


def _outputs(payload):
    """What CloudNativeGIS reports once it has uploaded a mosaic's files."""
    outputs = {
        "tiles": [
            {
                "id": tile["id"],
                "bbox": [20.0 + i, -11.0, 21.0 + i, -10.0],
                "data": _output(100 + i),
                **({"web": _output(200 + i)} if tile.get("web_upload") else {}),
            }
            for i, tile in enumerate(payload["tiles"])
        ],
        "vrt": _output(7),
        "thumbnail": _output(9),
    }
    if payload["merged"]:
        outputs["merged"] = _output(300)
    return outputs


def _run(owner, settings, tmp_path, s3=None, merge_limit=None, replace=False, tamper=None):
    settings.UPLOAD_TEMP_DIR = str(tmp_path / "staging")
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    if merge_limit is not None:
        settings.MOSAIC_MERGE_MAX_BYTES = merge_limit
    s3 = s3 or FakeS3()
    headers = [header(date="2021:05:01 00:00:00"), header()]
    with (
        patch("apps.s3.mosaic.get_s3_client", return_value=s3),
        patch("apps.s3.mosaic.threading.Thread"),
        patch("apps.s3.mosaic.read_header", side_effect=headers),
    ):
        job = mosaic.start_mosaic(
            [tiff("Tile 0.tif"), tiff("Tile 1.tif")],
            "Test Mosaic",
            "maps",
            str(make_connection(owner).id),
            owner,
            "CC-BY-4.0",
            replace=replace,
        )
    client, submitted = _cng(_outputs, s3, tamper)
    with (
        healthy(),
        patch("apps.s3.mosaic.get_s3_client", return_value=s3),
        patch("apps.s3.mosaic.read_header", side_effect=headers),
        patch("apps.s3.mosaic.httpx.Client", return_value=client),
        patch("apps.s3.mosaic.close_old_connections"),
        patch("apps.s3.cng_lite.time.sleep"),
    ):
        mosaic.run_mosaic(job.id)
    job.refresh_from_db()
    return job, s3, submitted


@pytest.mark.django_db
def test_cloudnativegis_builds_the_mosaic_straight_into_the_bucket(owner, settings, tmp_path):
    job, s3, submitted = _run(owner, settings, tmp_path)

    assert job.status == "completed", job.error
    assert job.message == "Published a mosaic of 2 tiles to the catalog"
    assert not job_directory("mosaic", job.id).exists()
    # One job for the whole mosaic: each tile read from where it was staged,
    # each output written to its final key through a presigned PUT.
    [payload] = submitted
    folder = "maps/test-mosaic"
    assert [t["id"] for t in payload["tiles"]] == ["tile-0", "tile-1"]
    assert payload["tiles"][0]["source"] == (
        f"http://minio:9000/bucket/maps/sources/{job.id}/Tile 0.tif?method=get_object"
    )
    cog_type = quote(portolan.COG_MEDIA_TYPE)
    assert payload["tiles"][0]["data_upload"] == (
        f"http://minio:9000/bucket/{folder}/tile-0/tile-0.tif?method=put_object&type={cog_type}"
    )
    assert "web_upload" not in payload["tiles"][0]  # merged instead
    assert payload["vrt"]["name"] == "test-mosaic.vrt"
    assert payload["merged"]["upload"].endswith(
        f"{folder}/test-mosaic_3857.tif?method=put_object&type={cog_type}"
    )
    # Each upload is signed with the only content type it may carry.
    assert payload["vrt"]["upload"].endswith(
        "test-mosaic.vrt?method=put_object&type=application/xml"
    )
    assert payload["thumbnail"]["upload"].endswith(
        f"{folder}/thumbnail.png?method=put_object&type=image/png"
    )
    # ...and none outlives the time CloudBench waits for the job.
    assert set(s3.expirations) == {settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT + 300}
    # The staged tiles are the only large files CloudBench itself wrote.
    assert s3.content_types[f"maps/sources/{job.id}/Tile 1.tif"] == "image/tiff"

    collection = s3.json(f"{folder}/collection.json")
    assert collection["id"] == folder
    # Tiles are items, never collection-level data (Portolan: Raster Collections).
    assert not any("data" in asset["roles"] for asset in collection["assets"].values())
    item_links = [link for link in collection["links"] if link["rel"] == "item"]
    assert [link["href"] for link in item_links] == ["./tile-0/tile-0.json", "./tile-1/tile-1.json"]
    assets = collection["assets"]
    assert set(assets) == {"visual", "mosaic-vrt", "thumbnail", "style-default", "items"}
    assert assets["visual"]["href"] == "./test-mosaic_3857.tif"
    assert assets["visual"]["type"] == portolan.COG_MEDIA_TYPE
    # Checksums and sizes come from what CloudNativeGIS uploaded.
    assert assets["visual"]["file:size"] == 300
    assert assets["visual"]["file:checksum"] == "1220" + f"{300:064x}"
    assert assets["mosaic-vrt"]["roles"] == ["metadata"]
    assert assets["items"]["roles"] == ["collection-mirror"]
    assert assets["items"]["file:size"] == len(s3.objects[f"{folder}/items.parquet"])
    assert collection["extent"]["spatial"]["bbox"] == [[20.0, -11.0, 22.0, -10.0]]

    item = s3.json(f"{folder}/tile-0/tile-0.json")
    assert item["bbox"] == [20.0, -11.0, 21.0, -10.0]
    assert item["properties"]["datetime"] == "2021-05-01T00:00:00Z"  # from its TIFF date tag
    assert item["assets"]["data"]["file:size"] == 100
    later = s3.json(f"{folder}/tile-1/tile-1.json")
    assert later["properties"]["datetime"].startswith(job.created_at.strftime("%Y-%m-%d"))
    root = s3.json("catalog.json")
    assert any(link["href"] == f"./{folder}/collection.json" for link in root["links"])
    assert {k["name"] for k in job.output_keys} >= {
        "tile-0.tif",
        "test-mosaic.vrt",
        "test-mosaic_3857.tif",
        "items.parquet",
    }


@pytest.mark.django_db
def test_mosaic_over_the_merge_limit_renders_from_its_tiles(owner, settings, tmp_path):
    job, s3, submitted = _run(owner, settings, tmp_path, merge_limit=0)

    assert job.status == "completed", job.error
    [payload] = submitted
    assert payload["merged"] is None
    assert (
        "maps/test-mosaic/tile-1/tile-1_3857.tif?method=put_object"
        in (payload["tiles"][1]["web_upload"])
    )
    collection = s3.json("maps/test-mosaic/collection.json")
    assert "visual" not in collection["assets"]
    item = s3.json("maps/test-mosaic/tile-1/tile-1.json")
    assert item["assets"]["visual"]["href"] == "./tile-1_3857.tif"
    assert item["assets"]["visual"]["file:size"] == 201


@pytest.mark.django_db
def test_replacing_a_mosaic_drops_the_old_ones_leftovers(owner, settings, tmp_path):
    s3 = FakeS3()
    # An earlier mosaic here had a third tile, gone from this one.
    s3.objects["maps/test-mosaic/old-tile/old-tile.tif"] = b"old"
    s3.objects["maps/test-mosaic/tile-0/tile-0.tif"] = b"rewritten by CloudNativeGIS"
    job, s3, _submitted = _run(owner, settings, tmp_path, s3=s3, replace=True)

    assert job.status == "completed", job.error
    assert "maps/test-mosaic/old-tile/old-tile.tif" not in s3.objects
    assert "maps/test-mosaic/tile-0/tile-0.tif" in s3.objects  # this mosaic's
    assert "maps/test-mosaic/collection.json" in s3.objects


@pytest.mark.django_db
@pytest.mark.parametrize(
    "tamper, error",
    [
        # Reported uploaded, but never arrived.
        (lambda url, body: None if "tile-1.tif" in url else body, "isn't there"),
        # Arrived short.
        (lambda url, body: body[:50] if "tile-0.tif" in url else body, "is 50 bytes"),
        # Arrived, but isn't a COG at all.
        (
            lambda url, body: b"<html>".ljust(len(body), b" ") if "_3857.tif" in url else body,
            "isn't a TIFF",
        ),
    ],
)
def test_outputs_are_checked_in_the_bucket_not_taken_on_trust(
    owner, settings, tmp_path, tamper, error
):
    job, s3, _submitted = _run(owner, settings, tmp_path, tamper=tamper)

    assert job.status == "failed"
    assert error in job.error
    # Nothing published, and the new mosaic's folder isn't left half-written.
    assert not [key for key in s3.objects if key.startswith("maps/test-mosaic/")]
    assert "catalog.json" not in s3.objects


@pytest.mark.django_db
def test_a_failed_check_leaves_a_replaced_mosaic_to_look_into(owner, settings, tmp_path):
    s3 = FakeS3()
    s3.objects["maps/test-mosaic/collection.json"] = b"{}"  # the mosaic being replaced

    job, s3, _submitted = _run(
        owner,
        settings,
        tmp_path,
        s3=s3,
        replace=True,
        tamper=lambda url, body: None if "thumbnail" in url else body,
    )

    assert job.status == "failed"
    assert "maps/test-mosaic/collection.json" in s3.objects


@pytest.mark.django_db
def test_failed_mosaic_fails_the_job_and_cleans_up(owner, connection, settings, tmp_path, staging):
    job = mosaic.start_mosaic([tiff("a.tif"), tiff("b.tif")], "m", "", str(connection.id), owner)

    def respond(request):
        if request.url.path == "/api/v1/mosaic":
            return httpx.Response(202, json={"job_id": "cng-0"})
        return httpx.Response(200, json={"status": "failed", "detail": "gdalwarp failed"})

    client = httpx.Client(base_url="http://cloudnativegis/", transport=httpx.MockTransport(respond))
    with (
        healthy(),
        patch("apps.s3.mosaic.httpx.Client", return_value=client),
        patch("apps.s3.mosaic.close_old_connections"),
    ):
        mosaic.run_mosaic(job.id)

    job.refresh_from_db()
    assert job.status == "failed"
    assert "gdalwarp failed" in job.error
    assert not job_directory("mosaic", job.id).exists()


# -- The item mirror (items.parquet) ---------------------------------------------


def _item(tile_id, west, south, date="2021-05-01T00:00:00Z"):
    return portolan_mosaic.build_item_json(
        folder="maps/dem",
        tile={
            "id": tile_id,
            "title": tile_id.title(),
            "bbox": [west, south, west + 1, south + 1],
            "datetime": date,
            "data": {"filename": f"{tile_id}.tif", "file": {"size": 10, "checksum": "1220ab"}},
        },
    )


def test_item_mirror_reproduces_the_items_as_stac_geoparquet(tmp_path):
    import duckdb

    # A 2x2 grid, given out of spatial order.
    items = [_item("ne", 1, 1), _item("sw", 0, 0), _item("nw", 0, 1), _item("se", 1, 0)]
    path = tmp_path / "items.parquet"
    portolan_mosaic.write_item_mirror(items, path)

    con = duckdb.connect()
    rows = con.execute(
        "SELECT id, geometry, bbox, epoch(datetime), title, assets, links, collection, "
        f"stac_version FROM '{path}'"
    ).fetchall()
    # One row per item, sorted along a Hilbert curve: neighbours stay together.
    assert [row[0] for row in rows] == ["sw", "nw", "ne", "se"]
    by_id = {row[0]: row for row in rows}
    for item in items:
        row = by_id[item["id"]]
        # Geometry vertex for vertex, bbox and datetime exactly as the item's.
        assert bytes(row[1]) == portolan_mosaic._polygon_wkb(item["geometry"])
        assert list(row[2].values()) == item["bbox"]
        expected = datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00"))
        assert row[3] == expected.timestamp()
        assert row[4] == item["properties"]["title"]
        assert row[7] == "maps/dem" and row[8] == "1.1.0"
    # Hrefs relative to the mirror in the collection folder, not to each item.
    assert by_id["sw"][5]["data"]["href"] == "./sw/sw.tif"
    assert by_id["sw"][5]["data"]["file:checksum"] == "1220ab"
    assert {link["rel"]: link["href"] for link in by_id["sw"][6]}["collection"] == (
        "./collection.json"
    )

    metadata = dict(
        con.execute(
            f"SELECT decode(key), decode(value) FROM parquet_kv_metadata('{path}')"
        ).fetchall()
    )
    geo = json.loads(metadata["geo"])
    assert geo["version"] == "1.1.0" and geo["primary_column"] == "geometry"
    assert geo["columns"]["geometry"]["encoding"] == "WKB"
    assert geo["columns"]["geometry"]["covering"]["bbox"]["xmin"] == ["bbox", "xmin"]
    assert geo["columns"]["geometry"]["bbox"] == [0, 0, 2, 2]
    assert json.loads(metadata["stac-geoparquet"]) == {"version": "1.1.0"}
    # Per-row-group min/max on the covering column, for readers to skip row groups.
    stats = con.execute(
        f"SELECT stats_min, stats_max FROM parquet_metadata('{path}') "
        "WHERE path_in_schema = 'bbox, xmin'"
    ).fetchall()
    assert stats and float(stats[0][0]) == 0 and float(stats[0][1]) == 1


def test_polygon_wkb_is_standard_little_endian_wkb():
    item = _item("t", 20, -11)
    wkb = portolan_mosaic._polygon_wkb(item["geometry"])
    assert wkb[:9] == b"\x01\x03\x00\x00\x00\x01\x00\x00\x00"  # LE, Polygon, 1 ring
    assert len(wkb) == 9 + 4 + 5 * 16


# -- How long a mosaic's job (and its presigned URLs) may take --------------------


def test_job_timeout_scales_with_the_upload(settings):
    settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 1800
    settings.MOSAIC_TIMEOUT_PER_GB = 300
    settings.MOSAIC_MAX_TIMEOUT = 6 * 3600
    gb = 1024**3

    assert mosaic.job_timeout(30 * 1024**2) == 1800 + 9  # small: about the base
    assert mosaic.job_timeout(8 * gb) == 1800 + 8 * 300  # 70 minutes for 8 GB
    assert mosaic.job_timeout(500 * gb) == 6 * 3600  # capped

    # A cap set below the base never shortens the base.
    settings.MOSAIC_MAX_TIMEOUT = 600
    assert mosaic.job_timeout(8 * gb) == 1800


@pytest.mark.django_db
def test_a_big_mosaics_urls_last_as_long_as_its_job(owner, settings, tmp_path):
    settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 1800
    settings.MOSAIC_TIMEOUT_PER_GB = 300
    with patch("apps.s3.mosaic.job_timeout", return_value=9000) as timeout:
        job, s3, _submitted = _run(owner, settings, tmp_path)

    assert job.status == "completed", job.error
    timeout.assert_called_once_with(job.input_size)
    assert set(s3.expirations) == {9000 + mosaic.URL_MARGIN}
