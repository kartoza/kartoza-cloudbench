"""Background upload jobs: the tool runner, the heartbeat, and the status API."""

import sys
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.upload import jobs
from apps.upload.models import UploadJob

# A stand-in for ogr2ogr -progress: progress on stdout, an error on stderr.
FAKE_TOOL = (
    "import sys, time\n"
    "for p in ('0...10...', '20...30...', '40...50...60...70...80...90...', '100 - done.'):\n"
    "    sys.stdout.write(p); sys.stdout.flush(); time.sleep(0.05)\n"
    "sys.stderr.write('Warning 1: something\\n')\n"
    "sys.exit(int(sys.argv[1]))\n"
)


def test_run_command_reports_progress_and_stderr():
    seen = []
    code, stderr = jobs.run_command([sys.executable, "-c", FAKE_TOOL, "0"], on_progress=seen.append)
    assert code == 0
    assert "Warning 1: something" in stderr
    assert seen[-1] == 100 and seen == sorted(seen)


def test_run_command_returns_a_failure():
    code, stderr = jobs.run_command([sys.executable, "-c", FAKE_TOOL, "3"])
    assert code == 3
    assert "something" in stderr


@pytest.fixture
def user(django_user_model):
    return django_user_model.objects.create(username="job-owner")


@pytest.mark.django_db
def test_a_job_runs_to_completion(user):
    job = UploadJob.objects.create(user=user, kind=UploadJob.Kind.POSTGIS_VECTOR)

    def work(job_id):
        jobs.update_job(job_id, progress=50)
        jobs.finish_job(job_id, message="Imported public.t")

    jobs._run(job.id, work)
    job.refresh_from_db()
    assert (job.status, job.progress, job.message) == ("completed", 100, "Imported public.t")
    assert job.completed_at is not None


@pytest.mark.django_db
def test_an_exception_fails_the_job(user):
    job = UploadJob.objects.create(user=user, kind=UploadJob.Kind.POSTGIS_VECTOR)

    def work(job_id):
        raise RuntimeError("the database went away")

    jobs._run(job.id, work)
    job.refresh_from_db()
    assert job.status == "failed" and job.error == "the database went away"


@pytest.mark.django_db
def test_the_heartbeat_keeps_a_long_job_alive(user):
    job = UploadJob.objects.create(user=user, kind=UploadJob.Kind.POSTGIS_RASTER)
    beats = []

    def work(job_id):
        # The tool says nothing for a while (e.g. raster2pgsql): the runner's
        # own heartbeat still marks the job as alive.
        import time

        time.sleep(0.3)
        beats.append(UploadJob.objects.get(pk=job_id).heartbeat_at)
        jobs.finish_job(job_id)

    with patch.object(jobs, "HEARTBEAT_SECONDS", 0.05):
        jobs._run(job.id, work)
    assert beats[0] is not None and job.created_at < beats[0]


@pytest.mark.django_db
def test_a_job_whose_server_stopped_shows_as_failed(user):
    job = UploadJob.objects.create(
        user=user, kind=UploadJob.Kind.POSTGIS_VECTOR, status=UploadJob.Status.RUNNING
    )
    UploadJob.objects.filter(pk=job.id).update(
        heartbeat_at=timezone.now() - timedelta(seconds=UploadJob.STALE_AFTER_SECONDS + 1)
    )
    job.refresh_from_db()
    data = job.to_dict()
    assert data["status"] == "failed" and "restarted" in data["error"]


@pytest.mark.django_db
def test_the_status_api_shows_only_your_jobs(user, django_user_model):
    job = UploadJob.objects.create(user=user, kind=UploadJob.Kind.POSTGIS_VECTOR, output="public.t")
    client = APIClient()

    client.force_authenticate(user=user)
    response = client.get(f"/api/upload/jobs/{job.id}")
    assert response.status_code == 200
    assert response.json()["output"] == "public.t"

    client.force_authenticate(user=django_user_model.objects.create(username="someone-else"))
    assert client.get(f"/api/upload/jobs/{job.id}").status_code == 404
