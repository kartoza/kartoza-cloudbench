"""portolan_backfill: which published vector layers get regenerated."""

from datetime import timedelta
from io import StringIO
from unittest.mock import Mock, patch

import pytest
from botocore.exceptions import ClientError
from django.core.management import call_command
from django.utils import timezone

from apps.s3.models import CngLiteJob

CONN = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def owner(django_user_model):
    return django_user_model.objects.create(username="7")


def make_job(outputs, source_key="sources/a/roads.zip", age_days=0, **fields):
    job = CngLiteJob.objects.create(
        kind="pmtiles",
        owner_id="7",
        connection_id=CONN,
        bucket="bucket",
        source_name=fields.pop("source_name", "roads.zip"),
        source_key=source_key,
        output_key=fields.pop("output_key", "roads.pmtiles"),
        input_size=10,
        output_keys=[{"name": key.rsplit("/", 1)[-1], "key": key} for key in outputs],
        status="completed",
        **fields,
    )
    CngLiteJob.objects.filter(pk=job.pk).update(
        created_at=timezone.now() - timedelta(days=age_days)
    )
    return job


def fake_s3(existing):
    client = Mock()

    def info(key):
        if key not in existing:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}

    client.get_object_info.side_effect = info
    return client


def complete_with_parquet(job_id, create_collection=True):
    assert create_collection is False
    job = CngLiteJob.objects.get(pk=job_id)
    job.status = "completed"
    job.output_keys = [{"name": "x.parquet", "key": "roads/roads.parquet"}]
    job.save()


def run(existing, *args):
    out = StringIO()
    with (
        patch(
            "apps.s3.management.commands.portolan_backfill.get_s3_client",
            return_value=fake_s3(existing),
        ),
        patch(
            "apps.s3.management.commands.portolan_backfill.pmtiles.run_conversion",
            side_effect=complete_with_parquet,
        ) as run_conversion,
    ):
        call_command("portolan_backfill", *args, stdout=out, stderr=out)
    return out.getvalue(), run_conversion


@pytest.mark.django_db
def test_reruns_latest_job_for_each_live_layer_folder(owner):
    make_job(["roads/roads.pmtiles"], source_key="sources/old/roads.zip", age_days=2)
    latest = make_job(
        ["roads/roads.pmtiles"], source_key="sources/new/roads.zip", license="CC0-1.0"
    )

    output, run_conversion = run({"roads/collection.json", "sources/new/roads.zip"})

    assert run_conversion.call_count == 1
    backfill = CngLiteJob.objects.get(pk=run_conversion.call_args.args[0])
    assert backfill.source_key == latest.source_key
    assert backfill.license == "CC0-1.0"
    assert "Backfilled roads" in output


@pytest.mark.django_db
def test_skips_deleted_layers_missing_sources_and_existing_geoparquet(owner):
    make_job(["gone/gone.pmtiles"], source_key="sources/g/gone.zip")
    make_job(["nosource/nosource.pmtiles"], source_key="sources/n/nosource.zip")
    make_job(["done/done.parquet", "done/done.pmtiles"], source_key="sources/d/done.zip")
    # Pre-Portolan output: a bare .pmtiles, no layer folder / collection.json.
    make_job(["sources/x/highway.pmtiles"], source_key="sources/x/data.gpkg")

    output, run_conversion = run(
        {"nosource/collection.json", "done/collection.json", "sources/d/done.zip"}
    )

    run_conversion.assert_not_called()
    assert "source sources/n/nosource.zip is gone" in output
    assert "Nothing to backfill." in output


@pytest.mark.django_db
def test_geopackage_rerun_excludes_layers_deleted_since_upload(owner):
    make_job(
        ["data/roads/roads.pmtiles", "data/rivers/rivers.pmtiles"],
        source_key="sources/g/data.gpkg",
        source_name="data.gpkg",
        output_key="data/data.pmtiles",
        layers=["Roads", "rivers"],
    )

    _, run_conversion = run({"data/roads/collection.json", "sources/g/data.gpkg"})

    backfill = CngLiteJob.objects.get(pk=run_conversion.call_args.args[0])
    assert backfill.layers == ["Roads"]


@pytest.mark.django_db
def test_dry_run_changes_nothing(owner):
    make_job(["roads/roads.pmtiles"])

    output, run_conversion = run({"roads/collection.json", "sources/a/roads.zip"}, "--dry-run")

    run_conversion.assert_not_called()
    assert CngLiteJob.objects.count() == 1
    assert "roads" in output
