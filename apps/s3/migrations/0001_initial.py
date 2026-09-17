import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="PMTilesJob",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("owner_id", models.CharField(max_length=255)),
                ("connection_id", models.CharField(max_length=255)),
                ("bucket", models.CharField(max_length=255)),
                ("source_name", models.CharField(max_length=255)),
                ("output_key", models.TextField()),
                ("input_size", models.BigIntegerField()),
                ("output_size", models.BigIntegerField(default=0)),
                ("layer_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("status", models.CharField(default="pending", max_length=20)),
                ("progress", models.PositiveSmallIntegerField(default=0)),
                ("message", models.TextField(default="Waiting to upload to CloudNativeGIS")),
                ("error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
            ],
        ),
    ]
