"""The requests a CloudNativeGIS conversion job made, and what came back."""

import logging
import re
from urllib.parse import urlsplit, urlunsplit

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from .cng_lite_job import CngLiteJob

logger = logging.getLogger(__name__)

REDACTED = "***"
# A key containing any of these has its value redacted before it's logged,
# e.g. an on-demand server's API token in GeoHosting's answer.
SENSITIVE_KEY_PARTS = ("token", "secret", "password", "authorization", "signature")
# A URL carrying credentials in its query - a presigned S3 URL, say - keeps
# only its scheme, host and path.
SIGNED_URL = re.compile(r"(signature|credential|token)=", re.IGNORECASE)


def redact(value):
    """`value` (any JSON-like structure) with its sensitive values masked."""
    if isinstance(value, dict):
        return {
            key: (
                REDACTED
                if any(part in str(key).lower() for part in SENSITIVE_KEY_PARTS)
                else redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    if isinstance(value, str) and "://" in value and SIGNED_URL.search(value):
        return f"{_without_query(value)}?{REDACTED}"
    return value


def _without_query(url):
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


class CngLiteJobLog(models.Model):
    """One request a CngLiteJob made - to GeoHosting or to CloudNativeGIS.

    The calls that matter for following (or debugging) a job: asking for,
    and deleting, its on-demand server; submitting it to CloudNativeGIS;
    and any request that failed. Routine polling isn't logged, except
    when it changes something. Sensitive values are redacted (see redact).
    """

    class Target(models.TextChoices):
        """Who the request went to."""

        GEOHOSTING = "geohosting", "GeoHosting"
        CLOUDNATIVEGIS = "cloudnativegis", "CloudNativeGIS"

    job = models.ForeignKey(CngLiteJob, on_delete=models.CASCADE, related_name="logs")
    # The job's status (its step) when the request was made.
    step = models.CharField(max_length=20)
    target = models.CharField(max_length=20, choices=Target.choices)
    method = models.CharField(max_length=10)
    # Without its query string, which can carry credentials.
    url = models.CharField(max_length=2000)
    request_payload = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    # Null when there was no answer (e.g. couldn't connect).
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    response_payload = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    error = models.TextField(blank=True, default="")
    duration_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self):
        return f"{self.method} {self.url} -> {self.status_code or self.error[:40]}"

    @classmethod
    def record(
        cls,
        job,
        *,
        target,
        method,
        url,
        request_payload=None,
        status_code=None,
        response_payload=None,
        error="",
        duration_ms=0,
    ):
        """Log one request of `job`; never raises.

        A failure to log is only reported, so it can't fail the job.
        """
        try:
            return cls.objects.create(
                job_id=job.pk,
                step=job.status,
                target=target,
                method=method.upper(),
                url=_without_query(url)[:2000],
                request_payload=redact(request_payload),
                status_code=status_code,
                response_payload=redact(response_payload),
                error=str(error or ""),
                duration_ms=max(0, round(duration_ms)),
            )
        except Exception:  # noqa: BLE001 - logging must not fail the job
            logger.exception("Could not log a request of conversion job %s", job.pk)
            return None
