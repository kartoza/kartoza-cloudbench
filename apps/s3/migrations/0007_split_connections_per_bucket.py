"""Split each existing S3Connection into one connection per bucket it can see.

A connection used to represent a whole S3 endpoint (browse/create/delete
any bucket under it); it now represents exactly one bucket. For each
connection with no bucket set yet, this connects to S3 with its saved
credentials and lists its buckets:
  - one bucket found -> set it directly on the existing row
  - several buckets found -> create one new connection per bucket
    (named "<original name> (<bucket>)"), then delete the original row
  - none found (e.g. unreachable, or already bucket-scoped credentials
    that can't call ListBuckets) -> left with an empty bucket; the
    connection won't work until a bucket is set manually.
"""

import logging

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from django.db import migrations

logger = logging.getLogger(__name__)


def _list_bucket_names(connection):
    endpoint_url = connection.endpoint
    if not endpoint_url.startswith("http"):
        protocol = "https" if connection.use_ssl else "http"
        endpoint_url = f"{protocol}://{connection.endpoint}"

    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=connection.access_key,
        aws_secret_access_key=connection.secret_key,
        region_name=connection.region or "us-east-1",
        config=BotoConfig(
            signature_version="s3v4",
            s3={"addressing_style": "path" if connection.path_style else "virtual"},
        ),
    )
    try:
        return [b["Name"] for b in client.list_buckets().get("Buckets", [])]
    except (BotoCoreError, ClientError) as exc:
        logger.warning(
            "Could not list buckets for S3 connection %s (%r): %s",
            connection.id,
            connection.name,
            exc,
        )
        return []


def split_connections_per_bucket(apps, schema_editor):
    S3Connection = apps.get_model("cloudbench_s3", "S3Connection")

    for connection in list(S3Connection.objects.filter(bucket="")):
        bucket_names = _list_bucket_names(connection)

        if not bucket_names:
            logger.warning(
                "S3 connection %s (%r) has no reachable buckets; "
                "leaving its bucket blank for manual fixup.",
                connection.id,
                connection.name,
            )
            continue

        if len(bucket_names) == 1:
            connection.bucket = bucket_names[0]
            connection.save(update_fields=["bucket"])
            continue

        for bucket_name in bucket_names:
            S3Connection.objects.create(
                owner_id=connection.owner_id,
                name=f"{connection.name} ({bucket_name})",
                endpoint=connection.endpoint,
                bucket=bucket_name,
                access_key=connection.access_key,
                secret_key=connection.secret_key,
                region=connection.region,
                use_ssl=connection.use_ssl,
                path_style=connection.path_style,
            )
        connection.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("cloudbench_s3", "0006_s3connection_bucket"),
    ]

    operations = [
        migrations.RunPython(split_connections_per_bucket, migrations.RunPython.noop),
    ]
