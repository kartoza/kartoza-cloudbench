# Generated manually to widen PMTilesJob into a generic CloudNativeGIS Lite job.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("s3", "0001_initial"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="PMTilesJob",
            new_name="CngLiteJob",
        ),
        migrations.AddField(
            model_name="cnglitejob",
            name="kind",
            field=models.CharField(default="pmtiles", max_length=20),
        ),
    ]
