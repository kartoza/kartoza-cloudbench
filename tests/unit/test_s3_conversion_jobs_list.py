"""Listing a user's conversion jobs (the header's Jobs panel)."""

from datetime import timedelta
from unittest.mock import Mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.s3.models import CngLiteJob


def job(owner="7", status="running", source_name="roads.zip", **fields):
    return CngLiteJob.objects.create(
        kind=fields.pop("kind", "pmtiles"),
        owner_id=owner,
        connection_id="conn",
        bucket="bucket",
        source_name=source_name,
        output_key="roads.pmtiles",
        input_size=1,
        status=status,
        **fields,
    )


def listed(username="7"):
    api = APIClient()
    api.force_authenticate(user=Mock(id=7, username=username, is_authenticated=True))
    response = api.get("/api/s3/conversion/jobs")
    assert response.status_code == 200
    return response.json()


@pytest.mark.django_db
def test_lists_running_and_recently_finished_jobs_newest_first():
    now = timezone.now()
    finished = job(status="completed", completed_at=now - timedelta(hours=2), source_name="a.zip")
    job(status="completed", completed_at=now - timedelta(days=2), source_name="old.zip")
    job(status="running", source_name="b.zip")
    job(owner="someone-else", status="running", source_name="theirs.zip")
    CngLiteJob.objects.filter(pk=finished.pk).update(created_at=now - timedelta(hours=3))

    names = [item["sourcePath"] for item in listed()]

    # Newest first; not the 2-day-old one, nor another user's.
    assert names == ["b.zip", "a.zip"]


@pytest.mark.django_db
def test_hides_geopackages_awaiting_layer_selection_but_not_queued_raster_halves():
    job(status="pending", source_name="picking.gpkg", layers=None)  # the upload dialog's step
    job(
        status="pending",
        source_name="both.gpkg",
        kind="cog",
        layers=["dem"],
        message="Waiting for the vector layers to finish",
    )

    assert [item["sourcePath"] for item in listed()] == ["both.gpkg"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "active_status", ["provisioning", "pushing", "polling", "downloading", "publishing"]
)
def test_lists_job_in_any_active_step_as_in_progress(active_status):
    job(status=active_status, source_name="busy.zip")

    [item] = listed()

    assert item["status"] == active_status


@pytest.mark.django_db
@pytest.mark.parametrize(
    "active_status",
    ["provisioning", "pushing", "polling", "downloading", "publishing", "running"],
)
def test_stalled_active_job_is_listed_as_failed(settings, active_status):
    settings.CLOUDNATIVEGIS_CONVERSION_TIMEOUT = 1
    stalled = job(status=active_status, source_name="stuck.zip")
    CngLiteJob.objects.filter(pk=stalled.pk).update(updated_at=timezone.now() - timedelta(hours=1))

    [item] = listed()

    assert item["status"] == "failed"
    assert "interrupted" in item["error"]
