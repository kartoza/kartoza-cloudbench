"""Running an UploadJob in the background, and the external tools it uses.

A job runs in a thread (the request that starts it answers at once with its
id); the browser polls GET /api/upload/jobs/<id>. While it runs, a heartbeat
is saved every few seconds, so a job whose server restarted under it shows
as failed rather than running forever (UploadJob.is_stale).
"""

import logging
import re
import subprocess
import threading
from collections.abc import Callable

from django.db import close_old_connections
from django.utils import timezone

from apps.core.retry import retry_if_locked

from .models import UploadJob

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 5
# How much of a failed tool's stderr to keep.
MAX_ERROR_CHARS = 4000

# ogr2ogr -progress prints "0...10...20...", then "100 - done."
_PROGRESS = re.compile(r"(\d{1,3})(?=\.\.\.| - done)")


def update_job(job_id, **fields) -> None:
    """Save `fields` on the job, with a fresh heartbeat."""
    retry_if_locked(
        UploadJob.objects.filter(pk=job_id).update, heartbeat_at=timezone.now(), **fields
    )


def finish_job(job_id, *, error: str = "", message: str = "") -> None:
    if error:
        update_job(
            job_id,
            status=UploadJob.Status.FAILED,
            error=error[-MAX_ERROR_CHARS:],
            message=message or "Failed",
            completed_at=timezone.now(),
        )
    else:
        update_job(
            job_id,
            status=UploadJob.Status.COMPLETED,
            progress=100,
            message=message or "Done",
            completed_at=timezone.now(),
        )


def _heartbeat(job_id, stop: threading.Event) -> None:
    """Keep the job's heartbeat fresh until `stop`, whatever the work is doing."""
    try:
        while not stop.wait(HEARTBEAT_SECONDS):
            try:
                retry_if_locked(
                    UploadJob.objects.filter(
                        pk=job_id,
                        status__in=(UploadJob.Status.PENDING, UploadJob.Status.RUNNING),
                    ).update,
                    heartbeat_at=timezone.now(),
                )
            except Exception:  # noqa: BLE001 - a missed beat; the next one tries again
                logger.warning("Upload job %s: couldn't save its heartbeat", job_id, exc_info=True)
    finally:
        close_old_connections()


def _run(job_id, work: Callable[[object], None]) -> None:
    stop = threading.Event()
    threading.Thread(target=_heartbeat, args=(job_id, stop), daemon=True).start()
    try:
        update_job(job_id, status=UploadJob.Status.RUNNING)
        work(job_id)
    except Exception as exc:  # noqa: BLE001 - whatever failed, the job says so
        logger.exception("Upload job %s failed", job_id)
        finish_job(job_id, error=str(exc) or exc.__class__.__name__)
    finally:
        stop.set()
        close_old_connections()


def start_job(job: UploadJob, work: Callable[[object], None]) -> None:
    """Run `work(job_id)` in a background thread; it ends the job (finish_job).

    An exception in it fails the job with its message.
    """
    threading.Thread(target=_run, args=(job.id, work), daemon=True).start()


def run_command(
    cmd: list[str],
    *,
    env: dict | None = None,
    on_progress: Callable[[int], None] | None = None,
) -> tuple[int, str]:
    """Run `cmd` to the end (no time limit), and return its exit code and stderr.

    `on_progress` gets each percentage it prints in ogr2ogr's -progress format.
    """
    proc = subprocess.Popen(  # noqa: S603 - a fixed tool and arguments, no shell
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env
    )
    stderr: list[str] = []

    def read_stdout():
        buffer = ""
        for chunk in iter(lambda: proc.stdout.read(16), ""):
            buffer = (buffer + chunk)[-64:]
            found = _PROGRESS.findall(buffer)
            if found and on_progress:
                on_progress(min(100, int(found[-1])))
                buffer = buffer[buffer.rfind(found[-1]) + len(found[-1]) :]

    def read_stderr():
        for line in proc.stderr:
            stderr.append(line)

    readers = [threading.Thread(target=read_stdout), threading.Thread(target=read_stderr)]
    for reader in readers:
        reader.start()
    proc.wait()
    for reader in readers:
        reader.join()
    return proc.returncode, "".join(stderr)
