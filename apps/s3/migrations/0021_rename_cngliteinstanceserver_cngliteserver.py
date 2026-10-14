from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cloudbench_s3", "0020_cngliteinstanceserver_auto_destroy_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RenameModel(
            old_name="CngLiteInstanceServer",
            new_name="CngLiteServer",
        ),
        migrations.AlterField(
            model_name="cngliteserver",
            name="owner",
            field=models.ForeignKey(
                on_delete=models.deletion.CASCADE,
                related_name="cng_lite_servers",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
