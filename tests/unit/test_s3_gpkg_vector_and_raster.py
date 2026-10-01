"""Converting a GeoPackage's vector layers and raster tables together."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient

from apps.s3 import geopackage_convert
from apps.s3.cng_lite import job_directory
from apps.s3.models import CngLiteJob


@pytest.fixture
def inspected(settings, tmp_path):
    """A GeoPackage job as inspect_geopackage leaves it: pending, staged locally."""
    settings.UPLOAD_TEMP_DIR = str(tmp_path)
    job = CngLiteJob.objects.create(
        kind="pmtiles",
        owner_id="7",
        connection_id="conn",
        bucket="bucket",
        source_name="CasteloBranco.gpkg",
        source_key="maps/sources/job/CasteloBranco.gpkg",
        output_key="maps/CasteloBranco.pmtiles",
        input_size=10,
        license="CC-BY-4.0",
        license_url="",
        replace_existing=True,
        message="Waiting for layer selection",
    )
    staged = job_directory("pmtiles", job.id)
    staged.mkdir(parents=True)
    (staged / "source.gpkg").write_bytes(b"SQLite format 3\x00gpkg")
    return job


USER = Mock(username="7")
RASTER_ID = "11111111-2222-3333-4444-555555555555"


@pytest.mark.django_db
def test_one_kind_uses_the_single_kind_conversion(inspected):
    with (
        patch("apps.s3.geopackage_convert.pmtiles.start_geopackage_conversion") as vector,
        patch("apps.s3.geopackage_convert.cog.start_geopackage_conversion") as raster,
    ):
        geopackage_convert.start_geopackage_conversion(inspected.id, USER, ["roads"], [])
        vector.assert_called_once_with(inspected.id, USER, ["roads"])
        geopackage_convert.start_geopackage_conversion(inspected.id, USER, [], ["dem"])
        raster.assert_called_once_with(inspected.id, USER, ["dem"])

    with pytest.raises(ValueError, match="at least one"):
        geopackage_convert.start_geopackage_conversion(inspected.id, USER, [], [])


@pytest.mark.django_db
def test_both_kinds_start_a_vector_job_then_a_raster_job(inspected):
    with patch("apps.s3.geopackage_convert.threading.Thread") as thread:
        vector, raster = geopackage_convert.start_geopackage_conversion(
            inspected.id, USER, ["roads", "rivers"], ["dem"]
        )

    vector.refresh_from_db()
    assert (vector.pk, vector.kind, vector.layers) == (inspected.pk, "pmtiles", ["roads", "rivers"])
    assert raster.kind == "cog"
    assert raster.layers == ["dem"]
    # ...so a restart resumes it after the vector job (see resume_interrupted_conversions).
    assert raster.depends_on_id == vector.pk
    # Same upload, same place, same license...
    for field in ("source_name", "source_key", "output_key", "connection_id", "license"):
        assert getattr(raster, field) == getattr(vector, field)
    # ...but only the vector job (first) clears a confirmed-replace folder.
    assert vector.replace_existing is True
    assert raster.replace_existing is False
    # The raster job has its own link to the staged file (each job's dir is removed after it).
    linked = job_directory("cog", raster.id) / "source.gpkg"
    assert linked.read_bytes() == b"SQLite format 3\x00gpkg"
    # Both run in one thread, in turn.
    thread.assert_called_once()
    assert thread.call_args.kwargs["target"] == geopackage_convert._run_in_turn
    assert thread.call_args.kwargs["args"] == (vector.id, raster.id)

    with pytest.raises(ValueError, match="already started"):
        geopackage_convert.start_geopackage_conversion(inspected.id, USER, ["roads"], ["dem"])


@pytest.mark.django_db
def test_raster_job_runs_after_vector_from_the_moved_source_into_its_group(inspected):
    raster = CngLiteJob.objects.create(
        kind="cog",
        owner_id="7",
        connection_id="conn",
        bucket="bucket",
        source_name="CasteloBranco.gpkg",
        source_key=inspected.source_key,
        output_key=inspected.output_key,
        input_size=10,
    )
    calls = []

    def vector_run(job_id):
        calls.append(("vector", job_id))
        # Publishing moves the GeoPackage into its group folder (Phase 3).
        CngLiteJob.objects.filter(pk=job_id).update(
            source_key="maps/castelobranco/source/CasteloBranco.gpkg"
        )

    def raster_run(job_id):
        calls.append(("raster", job_id))
        # By now the raster job reads the source from where the vector job moved it.
        assert CngLiteJob.objects.get(pk=job_id).source_key == (
            "maps/castelobranco/source/CasteloBranco.gpkg"
        )

    with (
        patch("apps.s3.geopackage_convert.pmtiles.run_conversion", side_effect=vector_run),
        patch("apps.s3.geopackage_convert.cog.run_conversion", side_effect=raster_run),
    ):
        geopackage_convert._run_in_turn(inspected.id, raster.id)

    assert calls == [("vector", inspected.id), ("raster", raster.id)]


@pytest.mark.django_db
def test_raster_job_still_runs_if_the_vector_job_blows_up(inspected):
    with (
        patch(
            "apps.s3.geopackage_convert.pmtiles.run_conversion", side_effect=RuntimeError("boom")
        ),
        patch("apps.s3.geopackage_convert.cog.run_conversion") as raster_run,
    ):
        geopackage_convert._run_in_turn(inspected.id, RASTER_ID)
    raster_run.assert_called_once_with(RASTER_ID)


@pytest.mark.django_db
def test_convert_endpoint_accepts_layers_and_tables(inspected):
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username="7", is_authenticated=True))

    with patch("apps.s3.geopackage_convert.threading.Thread"):
        both = api.post(
            f"/api/s3/gpkg/convert/{inspected.id}",
            {"layers": ["roads"], "tables": ["dem"]},
            format="json",
        )
    assert both.status_code == 202
    body = both.json()
    assert len(body["conversionJobIds"]) == 2
    assert body["conversionJobId"] == body["conversionJobIds"][0] == str(inspected.id)

    # The older one-kind form still works.
    with patch("apps.s3.views.start_geopackage_conversion") as vector_only:
        vector_only.return_value = inspected
        legacy = api.post(
            f"/api/s3/gpkg/convert/{inspected.id}", {"layers": ["roads"]}, format="json"
        )
    assert legacy.status_code == 202
    assert legacy.json()["conversionJobIds"] == [str(inspected.id)]
