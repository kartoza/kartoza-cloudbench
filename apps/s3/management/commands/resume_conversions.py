"""Run the CloudNativeGIS conversions a restart left unfinished.

A conversion runs in a thread of the web process that started it, so a
restart stops it partway; its CngLiteJob keeps the step it had got to. This
carries each such job on from that step, one after another.

Run it only while nothing else is running conversions - the deployment
entrypoint starts it in the background just before the web server, when
every job still active must have been interrupted.

Usage:
    python manage.py resume_conversions
"""

from django.core.management.base import BaseCommand

from apps.s3.cng_lite import resume_interrupted_conversions


class Command(BaseCommand):
    help = "Run the CloudNativeGIS conversions a restart left unfinished."

    def handle(self, *_args, **_options):
        count = resume_interrupted_conversions()
        self.stdout.write(f"Resumed {count} CloudNativeGIS conversion(s).")
