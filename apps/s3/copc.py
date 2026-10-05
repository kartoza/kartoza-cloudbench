"""Convert LAS/LAZ point clouds to COPC via CloudNativeGIS."""

import shutil
import threading
from pathlib import PurePosixPath

from django.conf import settings

from . import portolan
from .client import get_s3_client
from .cng_lite import Converter, check_target, job_directory, source_object_key
from .cng_lite import run_conversion as run_cng_lite_conversion
from .models import CngLiteJob

KIND = "copc"
ENDPOINT = "api/v1/copc"
CONTENT_TYPE = portolan.COPC_MEDIA_TYPE
SUFFIXES = (".las", ".laz")
# Every LAS/LAZ file (COPC too) starts with this file signature.
LAS_MAGIC = b"LASF"


def assets_for(layer_id):
    """A point cloud's files: its COPC (data) and thumbnail.

    The COPC is its own visual: the preview reads its octree directly.
    """
    return [
        {"role": "data", "filename": f"{layer_id}.copc.laz", "media_type": CONTENT_TYPE},
        {
            "role": "thumbnail",
            "filename": portolan.THUMBNAIL_FILENAME,
            "media_type": portolan.THUMBNAIL_MEDIA_TYPE,
        },
    ]


def output_key(key):
    """Where the COPC goes: "<name>.copc.laz" beside the key."""
    path = PurePosixPath(key.rstrip("/"))
    stem = (
        path.name.removesuffix(".copc.laz")
        if path.name.lower().endswith(".copc.laz")
        else path.stem
    )
    return str(path.with_name(f"{stem}.copc.laz"))


def prepare_point_cloud(uploaded_file, destination):
    """Validate the upload is a single LAS/LAZ file and copy it to `destination`."""
    if not uploaded_file.name.lower().endswith(SUFFIXES):
        raise ValueError("Select a LAS or LAZ point cloud (.las or .laz).")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The point cloud exceeds the upload size limit.")
    header = uploaded_file.read(len(LAS_MAGIC))
    uploaded_file.seek(0)
    if header != LAS_MAGIC:
        raise ValueError("The file is not a valid LAS/LAZ point cloud.")
    with destination.open("wb") as output:
        for chunk in uploaded_file.chunks():
            output.write(chunk)


def start_conversion(
    uploaded_file,
    key,
    connection_id,
    user,
    license_id=portolan.DEFAULT_LICENSE,
    license_url="",
    replace=False,
    hetzner_server_id=None,
):
    """Start converting an upload; raises TargetExists unless `replace` (see check_target)."""
    if not CngLiteJob.is_valid():
        raise ValueError("CloudNativeGIS is not configured.")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The file exceeds the upload size limit.")
    s3_client = get_s3_client(connection_id, user)
    check_target(s3_client, output_key(key), uploaded_file.name, replace)
    job = CngLiteJob(
        kind=KIND,
        owner=user,
        connection_id=connection_id,
        bucket=s3_client.bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=uploaded_file.size,
        license=license_id,
        license_url=license_url,
        replace_existing=replace,
        hetzner_server_id=hetzner_server_id,
    )
    directory = job_directory(KIND, job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        name = PurePosixPath(uploaded_file.name).name
        source_path = directory / f"source{PurePosixPath(name).suffix.lower()}"
        prepare_point_cloud(uploaded_file, source_path)
        job.source_key = source_object_key(job.output_key, job.id, name)
        with source_path.open("rb") as source_file:
            s3_client.client.upload_fileobj(
                source_file,
                s3_client.bucket,
                job.source_key,
                ExtraArgs={"ContentType": "application/vnd.las"},
            )
        job.save()
        threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        if job.pk:
            CngLiteJob.objects.filter(pk=job.pk).delete()
        raise
    return job


CONVERTER = Converter(
    endpoint=ENDPOINT,
    assets_for=assets_for,
    # Only a GeoPackage has layers to pick; a point cloud is one layer.
    pick_layers=lambda _inspection: [],
    payload=lambda _job: {"thumbnail": True},
)


def run_conversion(job_id):
    run_cng_lite_conversion(job_id)
