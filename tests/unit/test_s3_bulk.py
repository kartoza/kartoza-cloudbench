"""Bulk upload: a bucket folder's layers converted N at a time (apps.s3.bulk)."""

import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest

from apps.s3 import bulk, bulk_servers
from apps.s3.models import CngLiteBatch, CngLiteJob, CngLiteJobStatus, S3Connection
from tests.unit.fake_s3 import FakeS3, converting_cng

PMTILES = b"PMTiles\x03fixture"
PARQUET = b"PAR1fixture"
PNG = b"\x89PNG\r\n\x1a\nfixture"
COG = b"II*\x00cog-fixture"
COPC = b"LASF".ljust(377, b"\x00") + b"copc" + b"points"
COPC_INFO = {
    "bbox": [1, 2, 3, 4],
    "count": 10,
    "crs": "EPSG:2994",
    "dimensions": [{"name": "X", "size": 8, "type": "floating"}],
}

Status = CngLiteJobStatus


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


@pytest.fixture
def connection(owner):
    return S3Connection.objects.create(
        owner=owner, name="MinIO", endpoint="minio:9000", bucket="bucket"
    )


@pytest.fixture
def s3(settings, tmp_path, connection):
    """A bucket, as the bulk upload and the pipeline both get it."""
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    settings.CLOUDNATIVEGIS_URL = "http://cloudnativegis"
    settings.CLOUDNATIVEGIS_BULK_MAX_CONCURRENCY = 3
    settings.CLOUDNATIVEGIS_POLL_INTERVAL = 1
    bucket = FakeS3()
    with (
        patch("apps.s3.bulk.get_s3_client", return_value=bucket),
        patch("apps.s3.cng_lite.get_s3_client", return_value=bucket),
        patch("apps.s3.bulk.time.sleep"),
    ):
        yield bucket


def seed(s3, names, prefix="incoming/", size=10):
    for name in names:
        s3.objects[f"{prefix}{name}"] = b"x" * size


class Sync:
    """A threading.Thread that runs its target as soon as it's started."""

    def __init__(self, target, args=(), kwargs=None, **_):
        self.target, self.args, self.kwargs = target, args, kwargs or {}

    def start(self):
        self.target(*self.args, **self.kwargs)


@pytest.fixture
def manual(s3):
    """No real threads: the test is the coordinator (step_batch) and the conversions.

    Yields the mock that stands for threading.Thread: one call for each job
    started on a slot.
    """
    thread = Mock()
    with patch("apps.s3.bulk.threading", SimpleNamespace(Thread=thread)):
        yield thread


def conversions(thread):
    """The job ids a `manual` run started a conversion thread for, in order."""
    return [
        call.kwargs["args"][0]
        for call in thread.call_args_list
        if call.kwargs["target"] is bulk.run_conversion
    ]


def start(owner, connection, files, prefix="incoming/", **options):
    options.setdefault("concurrency", 2)
    return bulk.start_batch(
        owner,
        str(connection.id),
        prefix=prefix,
        files=[f"{prefix}{name}" for name in files],
        **options,
    )


def jobs_by_name(batch):
    return {job.source_name: job for job in batch.jobs.all()}


def set_status(batch, name, status, **values):
    CngLiteJob.objects.filter(batch=batch, source_name=name).update(status=status, **values)


def statuses(batch):
    return {job.source_name: job.status for job in batch.jobs.all()}


# -- classify -------------------------------------------------------------------


@pytest.mark.parametrize(
    "key, kind",
    [
        ("f/districts.zip", "pmtiles"),
        ("f/cadastre.gpkg", "pmtiles"),
        ("f/rivers.geojson", "pmtiles"),
        ("f/parcels.fgb", "pmtiles"),
        ("f/trails.kml", "pmtiles"),
        ("f/trails.KMZ", "pmtiles"),
        ("f/dem.tif", "cog"),
        ("f/dem.TIFF", "cog"),
        ("f/survey.las", "copc"),
        ("f/survey.laz", "copc"),
    ],
)
def test_every_layer_type_is_classified(key, kind):
    assert bulk.classify(key) == (kind, None)


@pytest.mark.parametrize(
    "key, reason",
    [
        ("f/districts.pmtiles", bulk.OUTPUT_REASON),
        ("f/districts.parquet", bulk.OUTPUT_REASON),
        ("f/districts.geoparquet", bulk.OUTPUT_REASON),
        ("f/dem_3857.tif", bulk.OUTPUT_REASON),
        ("f/survey.copc.laz", bulk.OUTPUT_REASON),
        ("f/buildings.shp", bulk.LOOSE_PART_REASON),
        ("f/buildings.DBF", bulk.LOOSE_PART_REASON),
        ("f/buildings.prj", bulk.LOOSE_PART_REASON),
        ("f/notes.txt", bulk.UNSUPPORTED_REASON),
        ("f/thumbnail.png", bulk.UNSUPPORTED_REASON),
        (
            "f/sources/11111111-2222-3333-4444-555555555555/roads.zip",
            bulk.STAGED_REASON,
        ),
    ],
)
def test_what_isnt_a_source_is_left_alone(key, reason):
    assert bulk.classify(key) == (None, reason)


# -- preview --------------------------------------------------------------------


@pytest.mark.django_db
def test_preview_says_what_each_file_becomes(owner, connection, s3):
    seed(s3, ["districts.zip", "dem.tif", "survey.laz", "buildings.shp", "notes.txt"], size=7)
    s3.objects["incoming/deeper/other.zip"] = b"x"  # not directly in the folder
    s3.objects["incoming/dem/old.txt"] = b"x"  # an existing layer folder for dem.tif
    result = bulk.preview(owner, str(connection.id), "incoming")

    assert result["prefix"] == "incoming/"
    assert result["truncated"] is False
    assert result["limits"] == {"maxConcurrency": 3, "onDemand": False}
    files = {f["name"]: f for f in result["files"]}
    assert set(files) == {"districts.zip", "dem.tif", "survey.laz", "buildings.shp", "notes.txt"}
    assert (files["districts.zip"]["kind"], files["districts.zip"]["size"]) == ("pmtiles", 7)
    assert (files["dem.tif"]["kind"], files["survey.laz"]["kind"]) == ("cog", "copc")
    assert files["buildings.shp"]["kind"] is None
    assert files["buildings.shp"]["skipReason"] == bulk.LOOSE_PART_REASON
    # Where each layer would go, and whether something is there already.
    assert files["districts.zip"]["target"] == "incoming/districts"
    assert files["districts.zip"]["exists"] is False
    assert files["dem.tif"]["exists"] is True


@pytest.mark.django_db
def test_preview_can_read_subfolders_and_a_destination(owner, connection, s3):
    seed(s3, ["a.zip"])
    s3.objects["incoming/deeper/b.tif"] = b"x"

    flat = bulk.preview(owner, str(connection.id), "incoming/")
    deep = bulk.preview(owner, str(connection.id), "incoming/", recursive=True)
    moved = bulk.preview(
        owner, str(connection.id), "incoming/", destination_prefix="published/2026"
    )

    assert [f["name"] for f in flat["files"]] == ["a.zip"]
    assert [f["name"] for f in deep["files"]] == ["a.zip", "b.tif"]
    assert moved["files"][0]["target"] == "published/2026/a"


@pytest.mark.django_db
def test_preview_leaves_the_second_of_two_files_with_one_layer_name(owner, connection, s3):
    seed(s3, ["roads.zip", "roads.geojson"])

    files = {f["name"]: f for f in bulk.preview(owner, str(connection.id), "incoming/")["files"]}

    assert files["roads.geojson"]["kind"] == "pmtiles"
    assert files["roads.zip"]["kind"] is None
    assert files["roads.zip"]["skipReason"] == "Same layer name as roads.geojson"


@pytest.mark.django_db
def test_preview_refuses_a_catalog_and_the_whole_bucket(owner, connection, s3):
    s3.objects["incoming/roads/collection.json"] = b"{}"
    s3.objects["incoming/roads/roads.parquet"] = b"x"

    with pytest.raises(ValueError, match="Portolan catalog"):
        bulk.preview(owner, str(connection.id), "incoming/roads/")
    with pytest.raises(ValueError, match="Pick a folder"):
        bulk.preview(owner, str(connection.id), "")


@pytest.mark.django_db
def test_preview_stops_at_its_limit(owner, connection, s3):
    seed(s3, [f"layer-{i:03}.zip" for i in range(bulk.PREVIEW_LIMIT + 5)], size=1)

    result = bulk.preview(owner, str(connection.id), "incoming/")

    assert len(result["files"]) == bulk.PREVIEW_LIMIT
    assert result["truncated"] is True


def catalogued_bucket(s3):
    """A bucket with source folders, and what CloudBench wrote: layers, a group, sources."""
    seed(s3, ["a.zip"], prefix="incoming/")
    seed(s3, ["b.tif"], prefix="imports/2026/")
    seed(s3, ["c.laz"], prefix="roads/")  # a published layer's folder
    seed(s3, ["d.gpkg"], prefix="maps/castelo/")  # a layer group's
    seed(s3, ["e.zip"], prefix="incoming/sources/11111111-2222-3333-4444-555555555555/")
    seed(s3, ["f.zip"], prefix="sources/11111111-2222-3333-4444-555555555555/")
    s3.objects["catalog.json"] = json.dumps(
        {
            "links": [
                {"rel": "root", "href": "./catalog.json"},
                {"rel": "child", "href": "./roads/collection.json"},
                {"rel": "child", "href": "./maps/castelo/catalog.json"},
            ]
        }
    ).encode()


@pytest.mark.django_db
def test_the_folder_picker_leaves_out_what_cloudbench_wrote(owner, connection, s3):
    catalogued_bucket(s3)

    top = bulk.list_folders(owner, str(connection.id), "")
    inside = bulk.list_folders(owner, str(connection.id), "incoming/")

    # Source folders only: not the published layer, the layer group, or sources/.
    assert [f["name"] for f in top] == ["imports", "incoming", "maps"]
    assert [f["prefix"] for f in top] == ["imports/", "incoming/", "maps/"]
    assert inside == []  # incoming/sources/ is left out too
    assert [f["name"] for f in bulk.list_folders(owner, str(connection.id), "imports")] == ["2026"]


@pytest.mark.django_db
def test_the_folder_picker_without_a_catalog_only_hides_sources(owner, connection, s3):
    seed(s3, ["a.zip"], prefix="incoming/")
    seed(s3, ["x.zip"], prefix="sources/11111111-2222-3333-4444-555555555555/")

    assert [f["name"] for f in bulk.list_folders(owner, str(connection.id), "")] == ["incoming"]


@pytest.mark.django_db
def test_layers_can_go_to_the_top_level_like_other_uploads(owner, connection, s3, manual):
    seed(s3, ["semarang.zip", "dem.tif"], prefix="bulk-test/")
    s3.objects["semarang/collection.json"] = b"{}"  # a layer at the top level already

    files = {
        f["name"]: f
        for f in bulk.preview(owner, str(connection.id), "bulk-test/", destination="root")["files"]
    }
    batch = start(
        owner,
        connection,
        ["semarang.zip", "dem.tif"],
        prefix="bulk-test/",
        destination="root",
        on_exists="replace",
    )

    # The layer is a folder at the top of the bucket, and it is that one that exists.
    assert (files["semarang.zip"]["target"], files["semarang.zip"]["exists"]) == ("semarang", True)
    assert (files["dem.tif"]["target"], files["dem.tif"]["exists"]) == ("dem", False)
    jobs = jobs_by_name(batch)
    assert (jobs["semarang.zip"].output_key, jobs["dem.tif"].output_key) == (
        "semarang.pmtiles",
        "dem.tif",
    )
    assert (jobs["semarang.zip"].replace_existing, jobs["dem.tif"].replace_existing) == (
        True,
        False,
    )
    assert batch.destination_prefix == ""
    # Its staged copy is in the top level's sources/, as a single upload's is.
    bulk.step_batch(batch.pk)
    job = batch.jobs.get(source_name="dem.tif")
    assert job.source_key == f"sources/{job.id}/dem.tif"
    assert s3.objects["bulk-test/dem.tif"]  # the original stays


@pytest.mark.django_db
def test_where_the_layers_go_defaults_to_what_is_given(owner, connection, s3, manual):
    seed(s3, ["a.zip"], prefix="bulk-test/")

    def preview(**options):
        return bulk.preview(owner, str(connection.id), "bulk-test/", **options)["files"][0]

    assert preview()["target"] == "bulk-test/a"
    assert preview(destination="beside")["target"] == "bulk-test/a"
    assert preview(destination_prefix="out")["target"] == "out/a"
    assert preview(destination="folder", destination_prefix="out/2026")["target"] == "out/2026/a"
    # A prefix means nothing at the top level, or beside the files.
    assert preview(destination="root", destination_prefix="out")["target"] == "a"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "options, error",
    [
        ({"destination": "somewhere"}, "top level or into a folder"),
        ({"destination": "folder"}, "Name the folder"),
        ({"destination": "folder", "destination_prefix": "/"}, "Name the folder"),
    ],
)
def test_a_bad_destination_is_refused(owner, connection, s3, manual, options, error):
    seed(s3, ["a.zip"], prefix="bulk-test/")

    with pytest.raises(ValueError, match=error):
        bulk.preview(owner, str(connection.id), "bulk-test/", **options)
    with pytest.raises(ValueError, match=error):
        start(owner, connection, ["a.zip"], prefix="bulk-test/", **options)
    assert not CngLiteBatch.objects.exists()


@pytest.mark.django_db
def test_a_big_folder_is_read_with_a_listing_not_a_request_per_layer(owner, connection, s3):
    names = [f"layer-{i:03}.zip" for i in range(100)]
    seed(s3, names, size=1)
    s3.objects["incoming/layer-007/collection.json"] = b"{}"  # one exists already
    real = s3.list_objects
    with patch.object(s3, "list_objects", side_effect=real) as listing:
        files = bulk.preview(owner, str(connection.id), "incoming/")["files"]

    assert len(files) == 100
    assert [f["name"] for f in files if f["exists"]] == ["layer-007.zip"]
    # The folder, and the folder the layers go into (the same): not 100 more.
    assert listing.call_count == 2


@pytest.mark.django_db
def test_subfolders_are_listed_once_each(owner, connection, s3):
    seed(s3, ["a.zip", "b.zip"], prefix="incoming/one/")
    seed(s3, ["c.zip", "d.zip", "e.zip"], prefix="incoming/two/")
    s3.objects["incoming/two/d/collection.json"] = b"{}"
    real = s3.list_objects
    with patch.object(s3, "list_objects", side_effect=real) as listing:
        files = bulk.preview(owner, str(connection.id), "incoming/", recursive=True)["files"]

    assert {f["name"]: f["exists"] for f in files if f["kind"]} == {
        "a.zip": False,
        "b.zip": False,
        "c.zip": False,
        "d.zip": True,
        "e.zip": False,
    }
    assert listing.call_count == 3  # incoming/, incoming/one/, incoming/two/


@pytest.mark.django_db
def test_recursive_leaves_published_layers_alone(owner, connection, s3):
    # What an earlier bulk upload left beside the files: layers, and a group's source.
    seed(s3, ["a.zip"], prefix="incoming/")
    s3.objects["incoming/a/collection.json"] = b"{}"
    s3.objects["incoming/a/a.parquet"] = b"x"
    s3.objects["incoming/group/catalog.json"] = b"{}"
    s3.objects["incoming/group/source/original.gpkg"] = b"x"

    files = {
        f["name"]: f
        for f in bulk.preview(owner, str(connection.id), "incoming/", recursive=True)["files"]
    }

    assert files["a.zip"]["kind"] == "pmtiles"
    assert files["original.gpkg"]["kind"] is None
    assert files["original.gpkg"]["skipReason"] == bulk.PUBLISHED_REASON
    # Only a folder that is itself a layer is refused.
    with pytest.raises(ValueError, match="Portolan catalog"):
        bulk.preview(owner, str(connection.id), "incoming/a/", recursive=True)


@pytest.mark.django_db
def test_a_hundred_layers_are_scheduled_n_at_a_time(owner, connection, s3, manual):
    names = [f"layer-{i:03}.zip" for i in range(100)]
    seed(s3, names, size=1)
    batch = start(owner, connection, names, concurrency=3)
    peak = 0

    for _ in range(400):
        more = bulk.step_batch(batch.pk)
        running = batch.jobs.filter(status=Status.PENDING)
        peak = max(peak, running.count())
        CngLiteJob.objects.filter(pk__in=[job.pk for job in running]).update(
            status=Status.COMPLETED
        )
        if not more:
            break

    batch.refresh_from_db()
    assert (batch.status, peak) == ("completed", 3)
    assert len(batch.to_dict()["jobs"]) == 100


# -- start_batch ----------------------------------------------------------------


@pytest.mark.django_db
def test_start_makes_a_queued_job_per_layer(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.tif", "c.laz"], size=5)

    batch = start(
        owner,
        connection,
        ["a.zip", "b.tif", "c.laz"],
        license_id="CC-BY-4.0",
        concurrency=2,
    )

    assert (batch.status, batch.concurrency, batch.source_prefix) == ("running", 2, "incoming/")
    assert batch.license == "CC-BY-4.0"
    jobs = jobs_by_name(batch)
    assert {name: (job.kind, job.status) for name, job in jobs.items()} == {
        "a.zip": ("pmtiles", "queued"),
        "b.tif": ("cog", "queued"),
        "c.laz": ("copc", "queued"),
    }
    job = jobs["a.zip"]
    assert (job.origin_key, job.output_key, job.input_size) == (
        "incoming/a.zip",
        "incoming/a.pmtiles",
        5,
    )
    assert (job.owner, job.connection, job.bucket, job.license) == (
        owner,
        connection,
        "bucket",
        "CC-BY-4.0",
    )
    # Nothing is staged, or copied, until a job has its slot.
    assert not any("sources/" in key for key in s3.objects)


@pytest.mark.django_db
def test_start_writes_layers_into_the_destination_folder(owner, connection, s3, manual):
    seed(s3, ["a.zip"])

    batch = start(owner, connection, ["a.zip"], destination_prefix="/published/2026/")

    job = batch.jobs.get()
    assert job.output_key == "published/2026/a.pmtiles"
    assert batch.destination_prefix == "published/2026/"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "options, files, error",
    [
        ({"concurrency": 0}, ["a.zip"], "between 1 and 3"),
        ({"concurrency": 4}, ["a.zip"], "between 1 and 3"),
        ({"on_exists": "overwrite"}, ["a.zip"], "skip, replace or stop"),
        ({}, [], "at least one layer"),
        ({}, ["nope.zip"], "isn't in incoming/"),
        ({}, ["notes.txt"], "can't be converted"),
        ({"prefix": ""}, ["a.zip"], "Pick a folder"),
    ],
)
def test_start_refuses_what_cant_run(owner, connection, s3, manual, options, files, error):
    seed(s3, ["a.zip", "notes.txt"])

    with pytest.raises(ValueError, match=error):
        start(owner, connection, files, **options)
    assert not CngLiteBatch.objects.exists()


@pytest.mark.django_db
def test_start_refuses_an_unconfigured_cloudnativegis(owner, connection, s3, manual, settings):
    seed(s3, ["a.zip"])
    settings.CLOUDNATIVEGIS_URL = ""

    with pytest.raises(ValueError, match="not configured"):
        start(owner, connection, ["a.zip"])


@pytest.mark.django_db
def test_on_demand_needs_geohosting_configured(owner, connection, s3, manual, settings):
    seed(s3, ["a.zip"])
    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    settings.GEOHOSTING_URL = ""

    with pytest.raises(ValueError, match="not configured"):
        start(owner, connection, ["a.zip"], server_type_id=7)


@pytest.mark.django_db
def test_one_bulk_upload_runs_at_a_time_per_user(owner, connection, s3, manual, django_user_model):
    seed(s3, ["a.zip", "b.zip"])
    first = start(owner, connection, ["a.zip"])

    with pytest.raises(ValueError, match="already running"):
        start(owner, connection, ["b.zip"])

    # Another user's is theirs. Once the first ends, so is this one's.
    other = django_user_model.objects.create(username="8")
    S3Connection.objects.create(owner=other, name="Other", endpoint="minio:9000", bucket="bucket")
    CngLiteBatch.objects.filter(pk=first.pk).update(status="completed")
    assert start(owner, connection, ["b.zip"]).pk != first.pk


# -- the scheduler ----------------------------------------------------------------


@pytest.mark.django_db
def test_never_more_jobs_running_than_slots(owner, connection, s3, manual):
    names = [f"layer-{i}.zip" for i in range(5)]
    seed(s3, names, size=3)
    batch = start(owner, connection, names, concurrency=2)
    peak = 0

    for _ in range(20):
        more = bulk.step_batch(batch.pk)
        running = batch.jobs.filter(status=Status.PENDING)
        peak = max(peak, running.count())
        # Whichever are running finish, one at a time.
        job = running.order_by("created_at").first()
        if job:
            CngLiteJob.objects.filter(pk=job.pk).update(status=Status.COMPLETED)
        if not more:
            break

    batch.refresh_from_db()
    assert peak == 2
    assert batch.status == "completed"
    assert set(statuses(batch).values()) == {"completed"}
    assert len(conversions(manual)) == 5  # every job was started, once


@pytest.mark.django_db
def test_a_job_gets_a_copy_of_its_original_and_the_original_stays(owner, connection, s3, manual):
    seed(s3, ["a.zip"], size=4)
    s3.objects["incoming/a.zip"] = b"the original"
    batch = start(owner, connection, ["a.zip"], concurrency=1)

    bulk.step_batch(batch.pk)

    job = batch.jobs.get()
    assert job.status == Status.PENDING
    assert job.source_key == f"incoming/sources/{job.id}/a.zip"
    assert s3.objects[job.source_key] == b"the original"
    assert s3.objects["incoming/a.zip"] == b"the original"
    assert conversions(manual) == [job.id]


@pytest.mark.django_db
def test_a_failure_doesnt_stop_the_batch(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.zip", "c.zip"])
    batch = start(owner, connection, ["a.zip", "b.zip", "c.zip"], concurrency=1)

    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.FAILED, error="tippecanoe failed")
    assert bulk.step_batch(batch.pk) is True
    assert statuses(batch) == {"a.zip": "failed", "b.zip": "pending", "c.zip": "queued"}
    set_status(batch, "b.zip", Status.COMPLETED)
    bulk.step_batch(batch.pk)
    set_status(batch, "c.zip", Status.COMPLETED)

    assert bulk.step_batch(batch.pk) is False
    batch.refresh_from_db()
    assert batch.status == "partial"
    assert batch.completed_at is not None


@pytest.mark.django_db
def test_a_batch_where_everything_fails_fails(owner, connection, s3, manual):
    seed(s3, ["a.zip"])
    batch = start(owner, connection, ["a.zip"])
    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.FAILED, error="boom")

    bulk.step_batch(batch.pk)

    batch.refresh_from_db()
    assert batch.status == "failed"


@pytest.mark.django_db
def test_a_layer_that_cant_be_staged_fails_alone(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.zip"])
    batch = start(owner, connection, ["a.zip", "b.zip"], concurrency=2)
    del s3.objects["incoming/a.zip"]  # gone since the preview

    bulk.step_batch(batch.pk)

    jobs = jobs_by_name(batch)
    assert jobs["a.zip"].status == Status.FAILED
    assert jobs["a.zip"].completed_at is not None
    assert jobs["b.zip"].status == Status.PENDING


@pytest.mark.django_db
def test_skip_leaves_existing_layers_out(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.zip"])
    s3.objects["incoming/a/collection.json"] = b"{}"

    batch = start(owner, connection, ["a.zip", "b.zip"], on_exists="skip")

    assert list(jobs_by_name(batch)) == ["b.zip"]
    assert [item["name"] for item in batch.skipped] == ["a.zip"]
    # It shows in the batch as skipped, finished, beside the layers that run.
    layers = {layer["name"]: layer for layer in batch.to_dict()["jobs"]}
    assert (layers["a.zip"]["status"], layers["b.zip"]["status"]) == ("skipped", "queued")


@pytest.mark.django_db
def test_a_batch_of_only_skipped_layers_is_done_at_once(owner, connection, s3, manual):
    seed(s3, ["a.zip"])
    s3.objects["incoming/a/collection.json"] = b"{}"
    batch = start(owner, connection, ["a.zip"], on_exists="skip")

    assert bulk.step_batch(batch.pk) is False

    batch.refresh_from_db()
    assert batch.status == "completed"


@pytest.mark.django_db
def test_replace_converts_over_existing_layers(owner, connection, s3, manual):
    seed(s3, ["a.zip"])
    s3.objects["incoming/a/collection.json"] = b"{}"
    batch = start(owner, connection, ["a.zip"], on_exists="replace")

    bulk.step_batch(batch.pk)

    job = batch.jobs.get()
    assert job.replace_existing is True
    assert job.status == Status.PENDING


@pytest.mark.django_db
def test_stop_fails_on_an_existing_layer_and_cancels_the_rest(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.tif", "c.laz"])
    s3.objects["incoming/b/collection.json"] = b"{}"
    batch = start(owner, connection, ["a.zip", "b.tif", "c.laz"], concurrency=1, on_exists="stop")

    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.COMPLETED)
    bulk.step_batch(batch.pk)  # b.tif's turn: its layer exists
    assert statuses(batch)["b.tif"] == "failed"
    assert "already exists" in jobs_by_name(batch)["b.tif"].error
    assert bulk.step_batch(batch.pk) is False

    assert statuses(batch) == {"a.zip": "completed", "b.tif": "failed", "c.laz": "cancelled"}
    batch.refresh_from_db()
    assert batch.status == "partial"


@pytest.mark.django_db
def test_stop_cancels_the_rest_after_a_conversion_fails(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.zip", "c.zip"])
    batch = start(owner, connection, ["a.zip", "b.zip", "c.zip"], concurrency=1, on_exists="stop")

    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.FAILED, error="boom")
    bulk.step_batch(batch.pk)

    assert statuses(batch) == {"a.zip": "failed", "b.zip": "cancelled", "c.zip": "cancelled"}
    batch.refresh_from_db()
    assert batch.status == "failed"


@pytest.mark.django_db
def test_cancel_stops_waiting_and_running_layers(owner, connection, s3, manual):
    names = ["a.zip", "b.zip", "c.zip", "d.zip"]
    seed(s3, names)
    batch = start(owner, connection, names, concurrency=2)
    bulk.step_batch(batch.pk)

    batch = bulk.cancel_batch(batch)

    # Waiting layers are cancelled now; running ones are asked to stop.
    assert batch.status == "cancelling"
    assert statuses(batch) == {
        "a.zip": "cancelling",
        "b.zip": "cancelling",
        "c.zip": "cancelled",
        "d.zip": "cancelled",
    }
    assert bulk.step_batch(batch.pk) is True
    # Whatever runs them stops, and the batch is over.
    for name in ("a.zip", "b.zip"):
        set_status(batch, name, Status.CANCELLED)
    assert bulk.step_batch(batch.pk) is False
    batch.refresh_from_db()
    assert batch.status == "cancelled"
    assert len(conversions(manual)) == 2  # nothing started after the cancel


@pytest.mark.django_db
def test_cancel_with_nothing_running_ends_at_once(owner, connection, s3, manual):
    seed(s3, ["a.zip"])
    batch = start(owner, connection, ["a.zip"])

    batch = bulk.cancel_batch(batch)

    assert batch.status == "cancelled"
    assert statuses(batch) == {"a.zip": "cancelled"}
    with pytest.raises(ValueError, match="isn't running"):
        bulk.cancel_batch(batch)


@pytest.mark.django_db
def test_a_layer_publishing_isnt_cancelled(owner, connection, s3, manual):
    seed(s3, ["a.zip"])
    batch = start(owner, connection, ["a.zip"])
    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.PUBLISHING)

    batch = bulk.cancel_batch(batch)

    assert statuses(batch) == {"a.zip": "publishing"}
    set_status(batch, "a.zip", Status.COMPLETED)
    bulk.step_batch(batch.pk)
    batch.refresh_from_db()
    assert batch.status == "cancelled"


@pytest.mark.django_db
def test_retry_queues_the_failed_layers_again(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.zip", "c.zip"])
    s3.objects["incoming/c/collection.json"] = b"{}"
    batch = start(owner, connection, ["a.zip", "b.zip", "c.zip"], concurrency=3, on_exists="stop")
    bulk.step_batch(batch.pk)
    # b failed in the pipeline (its source staged); c's layer existed (never staged).
    set_status(batch, "a.zip", Status.COMPLETED)
    set_status(batch, "b.zip", Status.FAILED, error="boom", progress=40, cng_job_id="cng-1")
    bulk.step_batch(batch.pk)
    batch.refresh_from_db()
    assert batch.status == "partial"

    batch = bulk.retry_failed(batch)

    assert batch.status == "running"
    assert batch.completed_at is None
    jobs = jobs_by_name(batch)
    assert (jobs["a.zip"].status, jobs["b.zip"].status, jobs["c.zip"].status) == (
        "completed",
        "queued",
        "queued",
    )
    assert (jobs["b.zip"].error, jobs["b.zip"].progress, jobs["b.zip"].cng_job_id) == ("", 0, "")
    # What the failed attempt may have left is replaced; an existing layer isn't.
    assert jobs["b.zip"].replace_existing is True
    assert jobs["c.zip"].replace_existing is False


@pytest.mark.django_db
def test_retry_needs_a_finished_batch_with_failures(owner, connection, s3, manual):
    seed(s3, ["a.zip"])
    batch = start(owner, connection, ["a.zip"])
    with pytest.raises(ValueError, match="still running"):
        bulk.retry_failed(batch)

    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.COMPLETED)
    bulk.step_batch(batch.pk)
    batch.refresh_from_db()
    with pytest.raises(ValueError, match="Nothing failed"):
        bulk.retry_failed(batch)


@pytest.mark.django_db
def test_run_batch_carries_a_batch_to_its_end(owner, connection, s3):
    names = [f"layer-{i}.zip" for i in range(4)]
    seed(s3, names)
    with patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Mock())):
        batch = start(owner, connection, names, concurrency=2)

    def convert(job_id):
        CngLiteJob.objects.filter(pk=job_id).update(status=Status.COMPLETED)

    with (
        patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Sync)),
        patch("apps.s3.bulk.run_conversion", side_effect=convert) as run,
    ):
        bulk.run_batch(batch.pk)

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert run.call_count == 4


@pytest.mark.django_db
def test_a_restart_resumes_the_batch(owner, connection, s3):
    names = ["a.zip", "b.zip", "c.zip"]
    seed(s3, names)
    with patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Mock())):
        batch = start(owner, connection, names, concurrency=1)
        bulk.step_batch(batch.pk)  # a.zip running when the process stopped

    def convert(job_id):
        CngLiteJob.objects.filter(pk=job_id).update(status=Status.COMPLETED)

    # resume_interrupted_conversions finishes the running job; the batch carries on.
    convert(batch.jobs.get(source_name="a.zip").pk)
    with (
        patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Sync)),
        patch("apps.s3.bulk.run_conversion", side_effect=convert) as run,
    ):
        assert bulk.resume_batches() == 1

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert run.call_count == 2  # b.zip and c.zip; a.zip was already done
    assert bulk.resume_batches() == 0


@pytest.mark.django_db
def test_a_bulk_geopackage_isnt_waiting_for_its_layers_to_be_picked(owner, connection, s3, manual):
    from apps.s3.cng_lite import resume_interrupted_conversions  # noqa: PLC0415

    seed(s3, ["cadastre.gpkg"])
    batch = start(owner, connection, ["cadastre.gpkg"])
    bulk.step_batch(batch.pk)
    job = batch.jobs.get()

    # Pending, layers unknown - as a GeoPackage awaiting selection is - yet
    # a restart resumes it: it converts all its layers.
    assert (job.status, job.layers) == (Status.PENDING, None)
    with patch("apps.s3.cng_lite.CNGProcessingClient.run") as run:
        assert resume_interrupted_conversions() == 1
    run.assert_called_once()


@pytest.mark.django_db
def test_the_batch_as_the_api_serves_it(owner, connection, s3, manual):
    seed(s3, ["a.zip", "b.tif"])
    batch = start(owner, connection, ["a.zip", "b.tif"], concurrency=1)
    bulk.step_batch(batch.pk)
    CngLiteJob.objects.filter(batch=batch, source_name="a.zip").update(
        status=Status.POLLING, progress=40, message="Converting"
    )

    data = batch.to_dict()

    assert (data["status"], data["prefix"], data["concurrency"]) == ("running", "incoming/", 1)
    assert data["connectionId"] == str(connection.id)
    layers = {layer["name"]: layer for layer in data["jobs"]}
    assert layers["a.zip"] | {"jobId": None} == {
        "key": "incoming/a.zip",
        "name": "a.zip",
        "kind": "pmtiles",
        "status": "running",  # polling, publishing... are all "running"
        "progress": 40,
        "message": "Converting",
        "error": None,
        "jobId": None,
    }
    assert layers["b.tif"]["status"] == "queued"


# -- through the pipeline -----------------------------------------------------------


def vector_results():
    return {
        None: {
            "data": (PARQUET, {"columns": [{"name": "name", "type": "string"}]}),
            "visual": (PMTILES, {"bbox": [1, 2, 3, 4], "layers": ["default"]}),
            "thumbnail": (PNG, {}),
        }
    }


def raster_results():
    return {
        None: {
            "data": (COG, {"bbox": [1, 2, 3, 4]}),
            "visual": (COG + b"-3857", {"bbox": [1, 2, 3, 4]}),
            "thumbnail": (PNG, {}),
        }
    }


def cloud_results():
    return {None: {"data": (COPC, COPC_INFO), "thumbnail": (PNG, {})}}


@pytest.mark.django_db
@pytest.mark.parametrize(
    "name, endpoint, results, published",
    [
        ("districts.zip", "pmtiles", vector_results(), "incoming/districts/districts.pmtiles"),
        ("dem.tif", "cog", raster_results(), "incoming/dem/dem.tif"),
        ("survey.laz", "copc", cloud_results(), "incoming/survey/survey.copc.laz"),
    ],
)
def test_each_kind_runs_through_the_pipeline(
    owner, connection, s3, name, endpoint, results, published
):
    seed(s3, [name])
    s3.objects[f"incoming/{name}"] = b"the original"
    client, submitted = converting_cng(s3, endpoint, results)

    with (
        patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Sync)),
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        batch = start(owner, connection, [name], concurrency=1)

    batch.refresh_from_db()
    job = batch.jobs.get()
    assert job.status == "completed", job.error
    assert batch.status == "completed"
    assert published in s3.objects
    assert s3.objects[f"incoming/{name}"] == b"the original"  # the original is never touched
    [payload] = submitted
    assert payload["source"]
    assert batch.to_dict()["jobs"][0]["status"] == "completed"


# -- from another bucket -------------------------------------------------------------


@pytest.fixture
def sandbox(owner, s3):
    """A second connection and bucket: the layers' own is `s3` (the `connection`).

    Yields (connection, bucket); get_s3_client gives each connection its bucket.
    """
    other = S3Connection.objects.create(
        owner=owner, name="Sandbox", endpoint="sandbox:9000", bucket="sandbox"
    )
    bucket = FakeS3()
    bucket.bucket = "sandbox"
    buckets = {str(other.id): bucket}

    def pick(connection_id, _user):
        return buckets.get(str(connection_id), s3)

    with (
        patch("apps.s3.bulk.get_s3_client", side_effect=pick),
        patch("apps.s3.cng_lite.get_s3_client", side_effect=pick),
    ):
        yield other, bucket


def start_from(owner, connection, other, files, prefix="incoming/", **options):
    options.setdefault("concurrency", 2)
    return bulk.start_batch(
        owner,
        str(connection.id),
        prefix=prefix,
        files=[f"{prefix}{name}" for name in files],
        source_connection_id=str(other.id),
        **options,
    )


@pytest.mark.django_db
def test_preview_reads_the_source_bucket_and_checks_the_destination(owner, connection, s3, sandbox):
    other, bucket = sandbox
    seed(bucket, ["a.zip", "b.zip"])
    seed(s3, ["c.zip"])  # the layers' own bucket's folder isn't read
    s3.objects["a/a.pmtiles"] = b"published already"

    result = bulk.preview(
        owner,
        str(connection.id),
        "incoming/",
        destination="root",
        source_connection_id=str(other.id),
    )

    files = {f["name"]: f for f in result["files"]}
    assert sorted(files) == ["a.zip", "b.zip"]
    assert (files["a.zip"]["target"], files["a.zip"]["exists"]) == ("a", True)
    assert (files["b.zip"]["target"], files["b.zip"]["exists"]) == ("b", False)


@pytest.mark.django_db
def test_the_source_bucket_is_recorded_on_the_batch(owner, connection, s3, sandbox, manual):
    other, bucket = sandbox
    seed(bucket, ["a.zip"])

    batch = start_from(owner, connection, other, ["a.zip"])

    assert batch.is_cross_bucket
    batch.refresh_from_db()
    assert (batch.connection_id, batch.source_connection_id) == (connection.id, other.id)
    data = batch.to_dict()
    assert (data["sourceConnectionId"], data["sourceName"]) == (str(other.id), "Sandbox")
    assert batch.jobs.get().bucket == "bucket"  # published into the layers' bucket
    batch.source_connection.delete()
    batch.refresh_from_db()
    assert batch.to_dict()["sourceName"] == "sandbox"  # the bucket's name, once it's gone


@pytest.mark.django_db
def test_a_source_that_is_the_destination_is_the_same_bucket(owner, connection, s3, manual):
    seed(s3, ["a.zip"])

    batch = start_from(owner, connection, connection, ["a.zip"])

    assert not batch.is_cross_bucket
    assert batch.source_connection_id is None
    assert batch.to_dict()["sourceName"] is None


@pytest.mark.django_db
def test_a_cross_bucket_job_converts_its_file_where_it_is(owner, connection, s3, sandbox, manual):
    other, bucket = sandbox
    seed(bucket, ["a.zip"])
    bucket.objects["incoming/a.zip"] = b"the original"
    batch = start_from(owner, connection, other, ["a.zip"], concurrency=1)

    job = batch.jobs.get()
    assert (job.source_in_place, job.source_connection_id) == (True, other.id)

    bulk.step_batch(batch.pk)

    job.refresh_from_db()
    assert job.status == Status.PENDING
    assert job.source_key == "incoming/a.zip"  # the original's key, in the source bucket
    assert not any(key.startswith("incoming/sources/") for key in s3.objects)  # nothing copied
    assert conversions(manual) == [job.id]


@pytest.mark.django_db
def test_a_same_bucket_job_isnt_in_place(owner, connection, s3, manual):
    seed(s3, ["a.zip"])

    job = start_from(owner, connection, connection, ["a.zip"]).jobs.get()

    assert (job.source_in_place, job.source_connection_id) == (False, None)


@pytest.mark.django_db
def test_a_deleted_source_connection_fails_the_jobs(owner, connection, s3, sandbox, manual):
    other, bucket = sandbox
    seed(bucket, ["a.zip"])
    batch = start_from(owner, connection, other, ["a.zip"])
    other.delete()

    bulk.step_batch(batch.pk)

    job = batch.jobs.get()
    assert job.status == Status.FAILED
    assert "deleted" in job.error
    assert conversions(manual) == []


@pytest.mark.django_db
def test_retry_keeps_a_cross_bucket_job_in_place(owner, connection, s3, sandbox, manual):
    other, bucket = sandbox
    seed(bucket, ["a.zip"])
    batch = start_from(owner, connection, other, ["a.zip"], concurrency=1)
    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.FAILED, error="boom")
    bulk.step_batch(batch.pk)
    batch.refresh_from_db()

    bulk.retry_failed(batch)
    bulk.step_batch(batch.pk)

    job = batch.jobs.get()
    assert (job.status, job.source_key, job.source_in_place) == (
        Status.PENDING,
        "incoming/a.zip",
        True,
    )
    assert job.replace_existing  # it may have left files behind


def run_cross_bucket(owner, connection, other, name, endpoint, results):
    """Run `name` (in the other bucket) through the pipeline; returns (batch, submitted)."""
    s3 = bulk.get_s3_client(str(connection.id), owner)
    client, submitted = converting_cng(s3, endpoint, results)
    with (
        patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Sync)),
        patch("apps.s3.models.cng_lite_job.httpx.get", return_value=httpx.Response(200)),
        patch("apps.s3.cng_lite.httpx.Client", return_value=client),
        patch("apps.s3.cng_lite.time.sleep"),
        patch("apps.s3.cng_lite.close_old_connections"),
    ):
        batch = start_from(owner, connection, other, [name], concurrency=1)
    batch.refresh_from_db()
    return batch, submitted


@pytest.mark.django_db
def test_a_cross_bucket_layer_runs_through_the_pipeline(owner, connection, s3, sandbox):
    other, bucket = sandbox
    bucket.objects["incoming/districts.zip"] = b"the original"

    batch, submitted = run_cross_bucket(
        owner, connection, other, "districts.zip", "pmtiles", vector_results()
    )

    job = batch.jobs.get()
    assert job.status == "completed", job.error
    assert batch.status == "completed"
    assert "incoming/districts/districts.pmtiles" in s3.objects  # in the layers' bucket
    assert not any(key.startswith("incoming/sources/") for key in s3.objects)
    assert bucket.objects == {"incoming/districts.zip": b"the original"}  # only read
    [payload] = submitted
    # CloudNativeGIS reads it straight from the source bucket; the results go to the other.
    assert payload["source"].startswith("http://minio:9000/sandbox/incoming/districts.zip?")
    assert all(
        file["url"].startswith("http://minio:9000/bucket/")
        for upload in payload["uploads"]
        for file in upload["files"].values()
    )


@pytest.mark.django_db
def test_a_failed_cross_bucket_layer_leaves_its_original(owner, connection, s3, sandbox):
    other, bucket = sandbox
    bucket.objects["incoming/districts.zip"] = b"the original"

    with patch("apps.s3.cng_lite.CNGProcessingClient.push", side_effect=RuntimeError("boom")):
        batch, _ = run_cross_bucket(
            owner, connection, other, "districts.zip", "pmtiles", vector_results()
        )

    assert batch.jobs.get().status == "failed"
    assert batch.status == "failed"
    assert bucket.objects == {"incoming/districts.zip": b"the original"}


# -- the VRT of a batch's GeoTIFFs -------------------------------------------------------


@pytest.mark.django_db
def test_start_asks_for_a_vrt_of_the_rasters(owner, connection, s3, manual):
    seed(s3, ["a.tif", "b.tif", "c.zip"])

    batch = start(
        owner, connection, ["a.tif", "b.tif", "c.zip"], create_vrt=True, vrt_name=" My VRT "
    )

    assert (batch.create_vrt, batch.vrt_name, batch.vrt) == (True, "My VRT", {"state": "pending"})
    assert batch.to_dict()["vrt"] == {"state": "pending"}


@pytest.mark.django_db
def test_a_batch_doesnt_make_a_vrt_unless_asked(owner, connection, s3, manual):
    seed(s3, ["a.tif", "b.tif"])

    batch = start(owner, connection, ["a.tif", "b.tif"])

    assert (batch.create_vrt, batch.vrt) == (False, {})
    assert batch.to_dict()["vrt"] is None


@pytest.mark.django_db
@pytest.mark.parametrize(
    "files, name, error",
    [
        (["a.tif", "c.zip"], "vrt", "at least two GeoTIFFs"),
        (["a.tif"], "vrt", "at least two GeoTIFFs"),
        (["a.tif", "b.tif"], "  ", "Name the VRT"),
    ],
)
def test_a_vrt_needs_two_rasters_and_a_name(owner, connection, s3, manual, files, name, error):
    seed(s3, ["a.tif", "b.tif", "c.zip"])

    with pytest.raises(ValueError, match=error):
        start(owner, connection, files, create_vrt=True, vrt_name=name)

    assert CngLiteBatch.objects.count() == 0


# -- on-demand servers -------------------------------------------------------------------


class FakeGeoHosting:
    """GeoHosting's servers API, in memory: what the batch asks, and how it answers."""

    def __init__(self):
        self.servers = {}
        self.created = []
        self.deleted = []
        self.create_error = None
        self.delete_error = None

    def __call__(self):  # patched in as the GeoHostingClient class
        return self

    def create_server(self, job_id, username, hetzner_server_id, server_id=None, log=None):
        from apps.core.geohosting import GeoHostingError  # noqa: PLC0415

        self.created.append((str(job_id), username, hetzner_server_id, str(server_id)))
        if self.create_error:
            raise GeoHostingError(self.create_error, status_code=409)
        answer = {
            "server_id": str(server_id),
            "job_ids": [str(job_id)],
            "status": "provisioning",
            "url": "",
            "token": "",
        }
        self.servers[str(server_id)] = answer
        return dict(answer)

    def get_server(self, server_id, log=None):
        answer = self.servers.get(str(server_id))
        return dict(answer) if answer else None

    def delete_server(self, server_id, log=None):
        from apps.core.geohosting import GeoHostingError  # noqa: PLC0415

        if self.delete_error:
            raise GeoHostingError(self.delete_error, status_code=500)
        self.deleted.append(str(server_id))
        answer = self.servers.get(str(server_id))
        if answer is None:
            return None
        answer["status"] = "deleting"
        return dict(answer)

    # What GeoHosting's own background work does.
    def ready(self, server_id=None):
        """Finish starting `server_id` (default: every server being started)."""
        for key, answer in self.servers.items():
            if (server_id is None or key == str(server_id)) and answer["status"] == "provisioning":
                answer.update(status="ready", url="http://10.0.0.5:8000", token="token")

    def fail(self, server_id):
        self.servers[str(server_id)].update(status="failed", error="out of stock")

    def finish_deleting(self):
        for key in [k for k, a in self.servers.items() if a["status"] == "deleting"]:
            del self.servers[key]


@pytest.fixture
def geohosting(settings):
    from cryptography.fernet import Fernet  # noqa: PLC0415

    settings.CLOUDNATIVEGIS_ON_DEMAND = True
    settings.CLOUDNATIVEGIS_BULK_MAX_SERVERS = 3
    settings.GEOHOSTING_URL = "http://geohosting"
    settings.GEOHOSTING_CLIENT_ID = "cloudbench"
    settings.GEOHOSTING_CLIENT_SECRET = "secret"
    settings.CLOUDBENCH_ENCRYPTION_KEY = Fernet.generate_key().decode()
    fake = FakeGeoHosting()
    with (
        patch("apps.s3.bulk_servers.GeoHostingClient", fake),
        patch("apps.s3.models.cng_lite_server.GeoHostingClient", fake),
    ):
        yield fake


def start_on_servers(owner, connection, names, **options):
    options.setdefault("server_type_id", 7)
    return start(owner, connection, names, **options)


def server_of(batch, name):
    return CngLiteJob.objects.get(batch=batch, source_name=name).instance_server


def servers_of(batch):
    return list(batch.servers.order_by("created_at"))


@pytest.mark.django_db
def test_an_on_demand_batch_needs_a_server_type_and_at_most_the_server_cap(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip", "b.zip"])

    with pytest.raises(ValueError, match="Pick a server"):
        start(owner, connection, ["a.zip", "b.zip"])
    with pytest.raises(ValueError, match="between 1 and 3"):
        start_on_servers(owner, connection, ["a.zip", "b.zip"], concurrency=4)

    batch = start_on_servers(owner, connection, ["a.zip", "b.zip"], auto_destroy=False)

    assert (batch.on_demand, batch.hetzner_server_id, batch.auto_destroy) == (True, 7, False)
    assert batch.to_dict()["servers"] == {"starting": 0, "ready": 0, "stopping": 0, "failed": 0}


@pytest.mark.django_db
def test_without_on_demand_there_are_no_servers(owner, connection, s3, manual):
    seed(s3, ["a.zip"])

    batch = start(owner, connection, ["a.zip"], server_type_id=7)

    assert (batch.on_demand, batch.to_dict()["servers"]) == (False, None)


@pytest.mark.django_db
def test_the_batch_starts_as_many_servers_as_it_has_slots_and_layers(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip", "b.zip", "c.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip", "c.zip"], concurrency=2)

    bulk.step_batch(batch.pk)

    created = geohosting.created
    assert len(created) == 2  # N = 2, though there are three layers
    assert {entry[1:3] for entry in created} == {(owner.get_username(), 7)}
    assert all(entry[0] == str(batch.id) for entry in created)
    assert len({entry[3] for entry in created}) == 2  # two servers, each with an id of its own
    assert [(s.status, s.auto_destroy, s.batch_id) for s in servers_of(batch)] == [
        ("provisioning", True, batch.id)
    ] * 2
    assert conversions(manual) == []  # nothing runs until a server is ready
    assert set(statuses(batch).values()) == {Status.QUEUED}
    assert batch.to_dict()["servers"]["starting"] == 2


@pytest.mark.django_db
def test_no_more_servers_than_layers(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip"])
    batch = start_on_servers(owner, connection, ["a.zip"], concurrency=3)

    bulk.step_batch(batch.pk)
    bulk.step_batch(batch.pk)

    assert len(geohosting.created) == 1  # asked once, not again while it starts


@pytest.mark.django_db
def test_a_layer_runs_on_a_server_once_it_is_ready(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip", "b.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip"], concurrency=2)
    bulk.step_batch(batch.pk)
    first = geohosting.created[0][3]
    geohosting.ready(first)

    bulk.step_batch(batch.pk)

    started = [job for job in batch.jobs.all() if job.status == Status.PENDING]
    assert len(started) == 1  # the other server isn't ready yet
    job = started[0]
    assert str(job.instance_server.instance_id) == first
    assert job.instance_server.status == "ready"
    assert (job.hetzner_server_id, job.auto_destroy) == (7, False)  # the batch deletes servers
    assert conversions(manual) == [job.id]


@pytest.mark.django_db
def test_a_server_runs_the_next_layer_when_its_layer_is_done(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip", "b.zip", "c.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip", "c.zip"], concurrency=1)
    bulk.step_batch(batch.pk)
    geohosting.ready()
    bulk.step_batch(batch.pk)
    [first] = [j for j in batch.jobs.all() if j.status == Status.PENDING]

    bulk.step_batch(batch.pk)  # its server is busy: nothing else starts
    assert len(conversions(manual)) == 1
    CngLiteJob.objects.filter(pk=first.pk).update(status=Status.COMPLETED)
    bulk.step_batch(batch.pk)

    second = [j for j in batch.jobs.all() if j.status == Status.PENDING]
    assert len(second) == 1
    assert second[0].instance_server_id == first.instance_server_id  # the same server
    assert len(geohosting.created) == 1  # no second server was started


@pytest.mark.django_db
def test_servers_nothing_needs_any_more_are_deleted(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip", "b.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip"], concurrency=2)
    bulk.step_batch(batch.pk)
    geohosting.ready()
    bulk.step_batch(batch.pk)  # both layers have a server
    CngLiteJob.objects.filter(batch=batch, source_name="a.zip").update(status=Status.COMPLETED)

    bulk.step_batch(batch.pk)

    # Nothing is waiting: a.zip's server, not running anything, is deleted - b.zip's isn't.
    freed = server_of(batch, "a.zip")
    assert geohosting.deleted == [str(freed.instance_id)]
    busy = server_of(batch, "b.zip")
    assert str(busy.instance_id) not in geohosting.deleted


@pytest.mark.django_db
def test_servers_the_user_keeps_are_not_deleted(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip", "b.zip"])
    batch = start_on_servers(
        owner, connection, ["a.zip", "b.zip"], concurrency=2, auto_destroy=False
    )
    bulk.step_batch(batch.pk)
    geohosting.ready()
    bulk.step_batch(batch.pk)
    CngLiteJob.objects.filter(batch=batch).update(status=Status.COMPLETED)

    assert bulk.step_batch(batch.pk) is False  # nothing to wait for

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert geohosting.deleted == []
    assert [s.status for s in servers_of(batch)] == ["ready", "ready"]
    assert all(s.auto_destroy is False for s in servers_of(batch))


@pytest.mark.django_db
def test_the_batch_waits_for_its_servers_to_be_gone(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip"])
    batch = start_on_servers(owner, connection, ["a.zip"], concurrency=1)
    bulk.step_batch(batch.pk)
    geohosting.ready()
    bulk.step_batch(batch.pk)
    CngLiteJob.objects.filter(batch=batch).update(status=Status.COMPLETED)

    assert bulk.step_batch(batch.pk) is True  # asked GeoHosting to delete it, and waits
    batch.refresh_from_db()
    assert batch.status == "running"
    assert batch.to_dict()["servers"]["stopping"] == 1
    assert bulk.step_batch(batch.pk) is True  # still deleting
    geohosting.finish_deleting()
    assert bulk.step_batch(batch.pk) is False

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert [s.status for s in servers_of(batch)] == ["deleted"]
    assert len(geohosting.deleted) == 1  # asked once


@pytest.mark.django_db
def test_a_server_that_cant_be_deleted_doesnt_hold_the_batch_up(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip"])
    batch = start_on_servers(owner, connection, ["a.zip"], concurrency=1)
    bulk.step_batch(batch.pk)
    geohosting.ready()
    bulk.step_batch(batch.pk)
    CngLiteJob.objects.filter(batch=batch).update(status=Status.COMPLETED)
    geohosting.delete_error = "GeoHosting is down"

    assert bulk.step_batch(batch.pk) is False

    batch.refresh_from_db()
    assert batch.status == "completed"
    assert "GeoHosting is down" in servers_of(batch)[0].error  # left for the reaper / the user


@pytest.mark.django_db
def test_a_server_that_fails_to_start_is_replaced(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip"])
    batch = start_on_servers(owner, connection, ["a.zip"], concurrency=1)
    bulk.step_batch(batch.pk)
    geohosting.fail(geohosting.created[0][3])

    bulk.step_batch(batch.pk)  # sees it failed, asks for another

    assert len(geohosting.created) == 2
    assert [s.status for s in servers_of(batch)] == ["failed", "provisioning"]
    assert batch.to_dict()["servers"]["failed"] == 1
    geohosting.ready()
    bulk.step_batch(batch.pk)
    assert len(conversions(manual)) == 1  # the replacement runs the layer


@pytest.mark.django_db
def test_the_waiting_layers_fail_when_no_server_can_be_had(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip", "b.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip"], concurrency=1)
    geohosting.create_error = "That server type is out of stock"

    for _ in range(4):
        bulk.step_batch(batch.pk)

    batch.refresh_from_db()
    assert batch.status == "failed"
    jobs = list(batch.jobs.all())
    assert {job.status for job in jobs} == {Status.FAILED}
    assert "No server could be started: That server type is out of stock" in jobs[0].error
    assert len(geohosting.created) == bulk_servers.MAX_FAILURES + 1  # then it stops asking


@pytest.mark.django_db
def test_with_a_server_running_the_batch_goes_on_with_fewer_when_others_fail(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip", "b.zip", "c.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip", "c.zip"], concurrency=2)
    bulk.step_batch(batch.pk)
    working, broken = (entry[3] for entry in geohosting.created)
    geohosting.ready(working)
    geohosting.fail(broken)
    geohosting.create_error = "out of stock"  # replacements fail too

    for _ in range(5):
        bulk.step_batch(batch.pk)

    # The one server runs the first layer; the others wait for it, not fail.
    pending = [job for job in batch.jobs.all() if job.status == Status.PENDING]
    queued = [job for job in batch.jobs.all() if job.status == Status.QUEUED]
    assert (len(pending), len(queued)) == (1, 2)
    CngLiteJob.objects.filter(pk=pending[0].pk).update(status=Status.COMPLETED)
    bulk.step_batch(batch.pk)
    assert len([j for j in batch.jobs.all() if j.status == Status.PENDING]) == 1


@pytest.mark.django_db
def test_cancelling_leaves_the_servers_to_the_coordinator(
    owner, connection, s3, manual, geohosting
):
    seed(s3, ["a.zip", "b.zip"])
    batch = start_on_servers(owner, connection, ["a.zip", "b.zip"], concurrency=2)
    bulk.step_batch(batch.pk)  # two servers starting, nothing running

    batch = bulk.cancel_batch(batch)

    # No GeoHosting call in the request: the batch is cancelling, its layers still queued.
    assert batch.status == "cancelling"
    assert geohosting.deleted == []
    assert (
        bulk.step_batch(batch.pk) is True
    )  # the coordinator cancels the layers, deletes the servers
    assert set(statuses(batch).values()) == {Status.CANCELLED}
    assert len(geohosting.deleted) == 2
    geohosting.finish_deleting()
    assert bulk.step_batch(batch.pk) is False
    batch.refresh_from_db()
    assert batch.status == "cancelled"


@pytest.mark.django_db
def test_a_restart_carries_on_with_the_servers_it_had(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip"])
    batch = start_on_servers(owner, connection, ["a.zip"], concurrency=1)
    bulk.step_batch(batch.pk)  # the server is starting when the process stops
    geohosting.ready()

    def convert(job_id):
        CngLiteJob.objects.filter(pk=job_id).update(status=Status.COMPLETED)

    with (
        patch("apps.s3.bulk.threading", SimpleNamespace(Thread=Sync)),
        patch("apps.s3.bulk.run_conversion", side_effect=convert),
        # Between its passes GeoHosting finishes deleting the servers.
        patch("apps.s3.bulk.time.sleep", side_effect=lambda *_: geohosting.finish_deleting()),
    ):
        bulk.run_batch(batch.pk)  # the resume_conversions command's pass

    assert len(geohosting.created) == 1  # it asked about the server, and didn't start another
    batch.refresh_from_db()
    assert batch.status == "completed"
    assert batch.jobs.get().instance_server is not None


@pytest.mark.django_db
def test_a_retry_runs_the_failed_layers_on_servers_again(owner, connection, s3, manual, geohosting):
    seed(s3, ["a.zip"])
    batch = start_on_servers(owner, connection, ["a.zip"], concurrency=1)
    bulk.step_batch(batch.pk)
    geohosting.ready()
    bulk.step_batch(batch.pk)
    set_status(batch, "a.zip", Status.FAILED, error="boom")
    bulk.step_batch(batch.pk)
    geohosting.finish_deleting()
    bulk.step_batch(batch.pk)
    batch.refresh_from_db()
    assert batch.status == "failed"

    bulk.retry_failed(batch)

    job = batch.jobs.get()
    assert (job.status, job.instance_server_id) == (Status.QUEUED, None)
