"""CngLiteJob.owner_id/connection_id (text) -> `owner`/`connection` foreign keys.

owner_id held the owner's username, connection_id an S3Connection id as
text. The new keys' columns have those same names, so the old values move to
owner_username/connection_key first, then the keys are filled in from them:

- `owner`: jobs whose user no longer exists are deleted - listed by
  username, nobody could see them anyway. Then it's made required.
- `connection`: left null where the value isn't a valid id or its connection
  has since been deleted - as deleting a connection does from now on.

Non-atomic, so the data update commits before the schema changes after it
(PostgreSQL refuses both in one transaction: "pending trigger events").
"""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def fill_keys(apps, _schema_editor):
    CngLiteJob = apps.get_model("cloudbench_s3", "CngLiteJob")
    S3Connection = apps.get_model("cloudbench_s3", "S3Connection")
    User = apps.get_model(settings.AUTH_USER_MODEL)

    for username in list(CngLiteJob.objects.values_list("owner_username", flat=True).distinct()):
        user_id = User.objects.filter(username=username).values_list("pk", flat=True).first()
        jobs = CngLiteJob.objects.filter(owner_username=username)
        if user_id is None:
            jobs.delete()
        else:
            jobs.update(owner_id=user_id)

    existing = set(S3Connection.objects.values_list("pk", flat=True))
    for key in list(CngLiteJob.objects.values_list("connection_key", flat=True).distinct()):
        try:
            connection_id = uuid.UUID(str(key))
        except ValueError:
            continue
        if connection_id in existing:
            CngLiteJob.objects.filter(connection_key=key).update(connection_id=connection_id)


def fill_old_values(apps, _schema_editor):
    CngLiteJob = apps.get_model("cloudbench_s3", "CngLiteJob")
    User = apps.get_model(settings.AUTH_USER_MODEL)

    for user_id in list(CngLiteJob.objects.values_list("owner_id", flat=True).distinct()):
        username = User.objects.filter(pk=user_id).values_list("username", flat=True).first()
        CngLiteJob.objects.filter(owner_id=user_id).update(owner_username=username or "")

    for connection_id in list(
        CngLiteJob.objects.values_list("connection_id", flat=True).distinct()
    ):
        CngLiteJob.objects.filter(connection_id=connection_id).update(
            connection_key=str(connection_id) if connection_id else ""
        )


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("cloudbench_s3", "0013_cnglitejob_cloudnativegis_api_token_and_more"),
    ]

    operations = [
        migrations.RenameField(
            model_name="cnglitejob",
            old_name="owner_id",
            new_name="owner_username",
        ),
        migrations.RenameField(
            model_name="cnglitejob",
            old_name="connection_id",
            new_name="connection_key",
        ),
        migrations.AddField(
            model_name="cnglitejob",
            name="owner",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="cng_lite_jobs",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="cnglitejob",
            name="connection",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="cng_lite_jobs",
                to="cloudbench_s3.s3connection",
            ),
        ),
        migrations.RunPython(fill_keys, fill_old_values),
        migrations.AlterField(
            model_name="cnglitejob",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="cng_lite_jobs",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RemoveField(
            model_name="cnglitejob",
            name="owner_username",
        ),
        migrations.RemoveField(
            model_name="cnglitejob",
            name="connection_key",
        ),
    ]
