"""A GeoPackage's original is kept once in its layer group and listed as a `source` asset."""

import hashlib
from unittest.mock import Mock

import pytest

from apps.s3 import portolan
from apps.s3.cng_lite import _publish_source, job_directory
from apps.s3.models import CngLiteJob

GPKG = b"SQLite format 3\x00" + b"g" * 4000
SOURCE_ASSET = {
    "filename": "../source/CasteloBranco.gpkg",
    "role": "source",
    "media_type": portolan.GEOPACKAGE_MEDIA_TYPE,
    "file": {"checksum": "1220" + "cd" * 32, "size": 4016},
}
LAYER_ASSETS = [
    {"filename": "highway.parquet", "role": "data", "media_type": portolan.PARQUET_MEDIA_TYPE},
    {"filename": "highway.pmtiles", "role": "visual", "media_type": portolan.PMTILES_MEDIA_TYPE},
    SOURCE_ASSET,
]


def test_collection_lists_the_geopackage_as_a_source_asset():
    collection = portolan.build_collection_json(
        layer_id="highway",
        title="Highway",
        description="Highway, uploaded via CloudBench.",
        license_id="CC-BY-4.0",
        provider_name="admin",
        kind="pmtiles",
        data_assets=LAYER_ASSETS,
        bbox=[1, 2, 3, 4],
        root_relative_path="../../catalog.json",
        parent_relative_path="../catalog.json",
    )

    assert collection["assets"]["source"] == {
        "href": "../source/CasteloBranco.gpkg",
        "type": "application/geopackage+sqlite3",
        "title": "Original GeoPackage (CasteloBranco.gpkg)",
        "roles": ["source"],
        "file:checksum": "1220" + "cd" * 32,
        "file:size": 4016,
    }
    # The data file stays the thing to query.
    assert collection["assets"]["data"]["href"] == "./highway.parquet"


def test_agents_and_readme_point_at_the_source():
    agents = portolan.build_agents_md(
        title="Highway", layer_id="highway", kind="pmtiles", data_assets=LAYER_ASSETS
    )
    assert "- Source: `../source/CasteloBranco.gpkg` (the original upload" in agents
    assert "Data file: `./../source" not in agents

    readme = portolan.build_readme(
        title="Highway",
        license_id="CC-BY-4.0",
        source_name="CasteloBranco.gpkg",
        kind="pmtiles",
        source_href="../source/CasteloBranco.gpkg",
    )
    assert "**Source file:** [CasteloBranco.gpkg](../source/CasteloBranco.gpkg)" in readme


@pytest.fixture
def gpkg_job(settings, tmp_path, django_user_model):
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    return CngLiteJob.objects.create(
        kind="pmtiles",
        owner=django_user_model.objects.create(username="7"),
        bucket="bucket",
        source_name="CasteloBranco.gpkg",
        source_key="maps/sources/job-1/CasteloBranco.gpkg",
        output_key="maps/CasteloBranco.pmtiles",
        input_size=len(GPKG),
    )


@pytest.mark.django_db
def test_source_is_moved_into_the_group_folder_from_the_local_copy(gpkg_job):
    staged = job_directory("pmtiles", gpkg_job.id)
    staged.mkdir(parents=True)
    (staged / "source.gpkg").write_bytes(GPKG)
    client = Mock()
    uploaded = {}
    client.client.upload_fileobj.side_effect = lambda body, _bucket, key, **kwargs: uploaded.update(
        {key: (body.read(), kwargs["ExtraArgs"]["ContentType"])}
    )

    asset = _publish_source(gpkg_job, client, "maps/castelobranco")

    dest = "maps/castelobranco/source/CasteloBranco.gpkg"
    assert uploaded == {dest: (GPKG, "application/geopackage+sqlite3")}
    assert asset == {
        "filename": "../source/CasteloBranco.gpkg",
        "role": "source",
        "media_type": "application/geopackage+sqlite3",
        "file": {"checksum": "1220" + hashlib.sha256(GPKG).hexdigest(), "size": len(GPKG)},
    }
    # The staged copy goes, and the job now records where the original lives.
    client.delete_object.assert_called_once_with("maps/sources/job-1/CasteloBranco.gpkg")
    gpkg_job.refresh_from_db()
    assert gpkg_job.source_key == dest


@pytest.mark.django_db
def test_source_is_copied_within_s3_when_no_local_copy_is_left(gpkg_job):
    client = Mock()

    asset = _publish_source(gpkg_job, client, "maps/castelobranco")

    client.client.copy.assert_called_once_with(
        {"Bucket": "bucket", "Key": "maps/sources/job-1/CasteloBranco.gpkg"},
        "bucket",
        "maps/castelobranco/source/CasteloBranco.gpkg",
    )
    # No local bytes to hash: listed without a checksum rather than a guessed one.
    assert asset["file"] is None
    assert asset["filename"] == "../source/CasteloBranco.gpkg"


@pytest.mark.django_db
def test_a_failed_move_leaves_the_layers_publishable_without_a_source(gpkg_job):
    client = Mock()
    client.client.copy.side_effect = RuntimeError("S3 unavailable")

    assert _publish_source(gpkg_job, client, "maps/castelobranco") is None
    client.delete_object.assert_not_called()  # the staged original is kept
    gpkg_job.refresh_from_db()
    assert gpkg_job.source_key == "maps/sources/job-1/CasteloBranco.gpkg"
