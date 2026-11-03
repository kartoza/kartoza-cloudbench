"""A bulk upload's VRT collection of its converted GeoTIFFs (apps.s3.bulk_vrt)."""

import io
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from apps.s3 import bulk, bulk_vrt, portolan
from apps.s3.models import CngLiteBatch, CngLiteJob, CngLiteJobStatus, S3Connection
from tests.unit.fake_s3 import FakeS3

pytestmark = pytest.mark.skipif(
    not shutil.which("gdalbuildvrt"), reason="GDAL's command-line tools aren't installed"
)

Status = CngLiteJobStatus


def make_cog(directory, name, *, west=300000, srs="EPSG:32735", nodata=-9999):
    """A small real COG's bytes: 100 x 100 pixels of 10 m, its west edge at `west`."""
    raw, cog = directory / f"{name}-raw.tif", directory / f"{name}.tif"
    east = west + 1000
    ullr = ["-a_ullr", str(west), "7000000", str(east), "6999000"]
    subprocess.run(
        [
            "gdal_create",
            *("-outsize", "100", "100", "-bands", "1", "-ot", "Float32", "-burn", "5"),
            *("-a_srs", srs, *ullr, "-a_nodata", str(nodata), "-q", str(raw)),
        ],
        check=True,
    )
    subprocess.run(["gdal_translate", "-of", "COG", "-q", str(raw), str(cog)], check=True)
    return cog.read_bytes()


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


@pytest.fixture
def s3(settings, tmp_path):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    bucket = FakeS3()
    with patch("apps.s3.bulk_vrt.get_s3_client", return_value=bucket):
        yield bucket


@pytest.fixture
def scratch(tmp_path):
    directory = tmp_path / "cogs"
    directory.mkdir()
    return directory


def convert(batch, s3, scratch, name, folder=None, **cog):
    """Publish `name` as a bulk upload would have (a layer folder with its COGs) and a job for it."""
    folder = folder or name
    s3.objects[f"{folder}/{name}.tif"] = make_cog(scratch, name, **cog)
    s3.objects[f"{folder}/{name}_3857.tif"] = b"web"
    s3.objects[f"{folder}/thumbnail.png"] = b"png"
    return CngLiteJob.objects.create(
        batch=batch,
        kind="cog",
        owner=batch.owner,
        connection=batch.connection,
        bucket="bucket",
        source_name=f"{name}.tif",
        output_key=f"{folder}/{name}.tif",
        input_size=1,
        status=Status.COMPLETED,
        output_keys=[
            {"name": f"{name}.tif", "key": f"{folder}/{name}.tif"},
            {"name": f"{name}_3857.tif", "key": f"{folder}/{name}_3857.tif"},
            {"name": "thumbnail.png", "key": f"{folder}/thumbnail.png"},
        ],
    )


@pytest.fixture
def batch(owner, connection):
    return CngLiteBatch.objects.create(
        owner=owner,
        connection=connection,
        source_prefix="incoming/",
        license="CC-BY-4.0",
        create_vrt=True,
        vrt_name="Incoming VRT",
        vrt={"state": "pending"},
    )


@pytest.mark.django_db
def test_the_vrt_collection_covers_every_raster_with_relative_paths(batch, s3, scratch):
    for index, name in enumerate(["a", "b", "c"]):
        convert(batch, s3, scratch, name, west=300000 + index * 1000)

    state = bulk_vrt.publish(batch)

    assert state["state"] == "done"
    assert (state["folder"], state["key"], state["count"]) == (
        "incoming-vrt",
        "incoming-vrt.vrt",
        3,
    )
    vrt = s3.objects["incoming-vrt.vrt"].decode()
    for name in ("a", "b", "c"):
        assert f'relativeToVRT="1">{name}/{name}.tif<' in vrt  # the data COG, not the _3857
    assert "_3857" not in vrt
    assert ".." not in vrt  # /vsis3/ doesn't resolve "../": every path runs down from the VRT
    assert 'rasterXSize="300"' in vrt  # three tiles side by side

    collection = s3.json("incoming-vrt/collection.json")
    asset = collection["assets"]["vrt"]
    assert (asset["href"], asset["roles"]) == ("./incoming-vrt.vrt", ["metadata"])
    assert asset["file:checksum"] == portolan.file_of(s3.objects["incoming-vrt.vrt"])["checksum"]
    assert collection["license"] == "CC-BY-4.0"
    related = [link["href"] for link in collection["links"] if link["rel"] == "related"]
    assert related == ["../a/collection.json", "../b/collection.json", "../c/collection.json"]
    assert [link["rel"] for link in collection["links"]][:2] == ["root", "parent"]
    assert collection["links"][0]["href"] == "../catalog.json"
    assert (
        collection["extent"]["spatial"]["bbox"][0][0]
        < collection["extent"]["spatial"]["bbox"][0][2]
    )
    # Documented, and linked from the root catalog like any layer.
    assert "incoming-vrt.vrt" in s3.objects["incoming-vrt/README.md"].decode()
    assert "incoming-vrt.vrt" in s3.objects["incoming-vrt/AGENTS.md"].decode()
    assert "incoming-vrt" in portolan.published_folders(s3)


@pytest.mark.django_db
def test_the_vrt_folder_is_in_the_folder_the_layers_share(batch, s3, scratch):
    convert(batch, s3, scratch, "a", folder="x/y/a", west=300000)
    convert(batch, s3, scratch, "b", folder="x/y/b", west=301000)
    convert(batch, s3, scratch, "c", folder="x/z/c", west=302000)

    state = bulk_vrt.publish(batch)

    assert state["folder"] == "x/incoming-vrt"
    vrt = s3.objects["x/incoming-vrt.vrt"].decode()
    assert "y/a/a.tif" in vrt and "z/c/c.tif" in vrt and ".." not in vrt
    collection = s3.json("x/incoming-vrt/collection.json")
    assert collection["links"][0]["href"] == "../../catalog.json"


@pytest.mark.django_db
def test_rasters_that_arent_alike_are_left_out_with_why(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    convert(batch, s3, scratch, "odd", west=0, srs="EPSG:4326")

    state = bulk_vrt.publish(batch)

    assert state["state"] == "done"
    assert state["count"] == 2
    assert [item["name"] for item in state["leftOut"]] == ["Odd"]
    assert "EPSG:4326" in state["leftOut"][0]["reason"]
    assert "1 left out" in state["message"]
    vrt = s3.objects["incoming-vrt.vrt"].decode()
    assert "odd.tif" not in vrt
    links = s3.json("incoming-vrt/collection.json")["links"]
    related = [link["href"] for link in links if link["rel"] == "related"]
    assert related == ["../a/collection.json", "../b/collection.json"]


@pytest.mark.django_db
def test_rasters_with_different_nodata_still_share_a_vrt(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000, nodata=-9999)
    convert(batch, s3, scratch, "b", west=301000, nodata=1e20)

    state = bulk_vrt.publish(batch)

    assert (state["state"], state["count"], state["leftOut"]) == ("done", 2, [])
    vrt = s3.objects["incoming-vrt.vrt"].decode()
    assert "a/a.tif" in vrt and "b/b.tif" in vrt


@pytest.mark.django_db
def test_rasters_skipped_for_being_published_already_are_in_the_vrt(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000).delete()  # published by an earlier batch
    CngLiteBatch.objects.filter(pk=batch.pk).update(
        skipped=[
            {"key": "incoming/b.tif", "name": "b.tif", "kind": "cog", "target": "b", "reason": "x"},
            {"key": "incoming/c.tif", "name": "c.tif", "kind": "cog", "target": "c", "reason": "x"},
            {
                "key": "incoming/d.zip",
                "name": "d.zip",
                "kind": "pmtiles",
                "target": "d",
                "reason": "x",
            },
        ]
    )
    batch.refresh_from_db()

    state = bulk_vrt.publish(batch)

    assert (state["state"], state["count"]) == ("done", 2)  # c's COG isn't there; d isn't a raster
    assert "b/b.tif" in s3.objects["incoming-vrt.vrt"].decode()


@pytest.mark.django_db
def test_rasters_with_nothing_alike_say_why(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=0, srs="EPSG:4326")
    before = dict(s3.objects)

    state = bulk_vrt.publish(batch)

    assert state["state"] == "skipped"
    assert "EPSG:" in state["message"] and "aren't alike" in state["message"]
    assert s3.objects == before


@pytest.mark.django_db
def test_fewer_than_two_rasters_make_no_vrt(batch, s3, scratch):
    convert(batch, s3, scratch, "a")
    before = dict(s3.objects)

    state = bulk_vrt.publish(batch)

    assert state["state"] == "skipped"
    assert s3.objects == before


@pytest.mark.django_db
def test_other_rasters_than_this_batchs_cog_jobs_are_left_out(batch, s3, scratch, owner):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    failed = convert(batch, s3, scratch, "c", west=302000)
    failed.status = Status.FAILED
    failed.save()
    vector = convert(batch, s3, scratch, "d", west=303000)
    vector.kind = "pmtiles"
    vector.save()

    state = bulk_vrt.publish(batch)

    assert state["count"] == 2


@pytest.mark.django_db
def test_a_folder_holding_something_else_isnt_overwritten(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    s3.objects["incoming-vrt/notes.txt"] = b"someone's"

    state = bulk_vrt.publish(batch)

    assert state["state"] == "failed"
    assert "incoming-vrt" in state["message"]
    assert "incoming-vrt.vrt" not in s3.objects


@pytest.mark.django_db
def test_a_file_where_the_vrt_goes_isnt_overwritten(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    s3.objects["incoming-vrt.vrt"] = b"someone's"
    s3.content_types["incoming-vrt.vrt"] = "application/xml"

    state = bulk_vrt.publish(batch)

    assert state["state"] == "failed"
    assert s3.objects["incoming-vrt.vrt"] == b"someone's"
    assert "incoming-vrt/collection.json" not in s3.objects


@pytest.mark.django_db
def test_the_first_versions_vrt_inside_the_folder_goes_when_it_is_built_again(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    assert bulk_vrt.publish(batch)["state"] == "done"
    s3.put_object("incoming-vrt/incoming-vrt.vrt", b"<VRTDataset>../a/a.tif</VRTDataset>")

    assert bulk_vrt.publish(batch)["state"] == "done"

    assert "incoming-vrt/incoming-vrt.vrt" not in s3.objects


@pytest.mark.django_db
def test_building_it_again_replaces_its_own_vrt(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    assert bulk_vrt.publish(batch)["state"] == "done"
    convert(batch, s3, scratch, "c", west=302000)

    state = bulk_vrt.publish(batch)

    assert (state["state"], state["count"]) == ("done", 3)
    assert "c/c.tif" in s3.objects["incoming-vrt.vrt"].decode()
    links = [
        link["href"]
        for link in s3.json("catalog.json")["links"]
        if link["rel"] == "child" and "incoming-vrt" in link["href"]
    ]
    assert links == ["./incoming-vrt/collection.json"]  # linked once


@pytest.mark.django_db
def test_a_header_that_didnt_fit_is_read_again_with_more(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    reads = []
    objects = s3.objects

    def stream(key, byte_range=None):
        # What S3 does with a Range: only the first `limit` bytes.
        limit = int(byte_range.removeprefix("bytes=0-")) + 1
        reads.append((key, limit))
        return io.BytesIO(objects[key][:limit])

    s3.get_object_stream = stream
    with patch("apps.s3.bulk_vrt.HEADER_READS", (100, 16 << 20)):
        state = bulk_vrt.publish(batch)

    assert state["state"] == "done"
    assert ("a/a.tif", 100) in reads and ("a/a.tif", 16 << 20) in reads  # too small, then enough


@pytest.mark.django_db
def test_only_the_start_of_each_cog_is_asked_for(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    ranges = []
    real = s3.get_object_stream

    def stream(key, byte_range=None):
        ranges.append(byte_range)
        return real(key, byte_range)

    s3.get_object_stream = stream
    bulk_vrt.publish(batch)

    assert ranges == ["bytes=0-1048575"] * 2  # a small COG's whole header is in the first read


@pytest.mark.parametrize("name", ["", "   "])
def test_the_vrt_needs_a_name(name):
    with pytest.raises(ValueError, match="Name the VRT"):
        bulk_vrt.vrt_id(name)


def test_the_vrt_name_becomes_a_folder_id():
    assert bulk_vrt.vrt_id("My Rasters / 2026") == "my-rasters-2026"


# -- in the scheduler ------------------------------------------------------------------


@pytest.mark.django_db
def test_the_vrt_is_built_when_the_last_layer_is_done(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)

    assert bulk.step_batch(batch.pk) is False

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert batch.vrt["state"] == "done"
    assert batch.to_dict()["vrt"]["key"] == "incoming-vrt.vrt"


@pytest.mark.django_db
def test_it_waits_for_the_layers_still_running(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    running = convert(batch, s3, scratch, "b", west=301000)
    running.status = Status.POLLING
    running.save()

    assert bulk.step_batch(batch.pk) is True

    batch.refresh_from_db()
    assert batch.vrt == {"state": "pending"}
    assert "incoming-vrt.vrt" not in s3.objects


@pytest.mark.django_db
def test_a_cancelled_batch_makes_no_vrt(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    CngLiteBatch.objects.filter(pk=batch.pk).update(status=CngLiteBatch.Status.CANCELLING)

    bulk.step_batch(batch.pk)

    batch.refresh_from_db()
    assert batch.status == "cancelled"
    assert batch.vrt == {"state": "pending"}
    assert "incoming-vrt.vrt" not in s3.objects


@pytest.mark.django_db
def test_a_vrt_that_cant_be_built_doesnt_fail_the_batch(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)

    with patch("apps.s3.bulk_vrt.build_vrt", side_effect=ValueError("gdalbuildvrt failed: boom")):
        bulk.step_batch(batch.pk)

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert batch.vrt["state"] == "failed"
    assert "boom" in batch.vrt["message"]


@pytest.mark.django_db
def test_the_vrt_is_built_once(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    CngLiteBatch.objects.filter(pk=batch.pk).update(vrt={"state": "building"})

    with patch("apps.s3.bulk_vrt.publish") as publish:
        bulk.step_batch(batch.pk)

    publish.assert_not_called()  # someone else is building it


@pytest.mark.django_db
def test_a_restart_builds_an_interrupted_vrt_again(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    CngLiteBatch.objects.filter(pk=batch.pk).update(vrt={"state": "building"})

    assert bulk.resume_batches() == 1

    batch.refresh_from_db()
    assert (batch.status, batch.vrt["state"]) == ("completed", "done")


@pytest.mark.django_db
def test_retrying_builds_the_vrt_again(batch, s3, scratch):
    convert(batch, s3, scratch, "a", west=300000)
    convert(batch, s3, scratch, "b", west=301000)
    failed = convert(batch, s3, scratch, "c", west=302000)
    failed.status = Status.FAILED
    failed.save()
    bulk.step_batch(batch.pk)
    batch.refresh_from_db()
    assert (batch.status, batch.vrt["count"]) == ("partial", 2)

    with patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Mock())):
        bulk.retry_failed(batch)

    batch.refresh_from_db()
    assert batch.vrt == {"state": "pending"}


@pytest.mark.django_db
def test_a_batch_without_a_vrt_has_none(owner, connection):
    batch = CngLiteBatch.objects.create(owner=owner, connection=connection, source_prefix="x/")

    assert batch.to_dict()["vrt"] is None
