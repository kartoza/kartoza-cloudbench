"""Convert vector uploads via CloudNativeGIS Lite and transfer the resulting PMTiles to S3.

A shapefile, a GeoPackage, or a single GeoJSON, FlatGeobuf or KML/KMZ file.
"""

import shutil
import threading
import zipfile
from pathlib import PurePosixPath

from django.conf import settings

from . import portolan
from .client import get_s3_client
from .cng_lite import (
    Converter,
    cancel_inspection,
    check_target,
    job_directory,
    source_object_key,
    sources_directory_key,
)
from .cng_lite import (
    inspect_conversion as inspect_cng_lite_job,
)
from .cng_lite import (
    run_conversion as run_cng_lite_conversion,
)
from .geopackage import is_geopackage, validate_geopackage
from .models import CngLiteJob, CngLiteJobStatus

KIND = "pmtiles"
ENDPOINT = "api/v1/pmtiles"
CONTENT_TYPE = "application/vnd.pmtiles"
PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# Single-file vector sources, staged as they are (cng-lite reads each with
# OGR, by its suffix): their media types.
VECTOR_FILE_TYPES = {
    ".geojson": "application/geo+json",
    ".fgb": "application/vnd.flatgeobuf",
    ".kml": "application/vnd.google-earth.kml+xml",
    ".kmz": "application/vnd.google-earth.kmz",
}


def assets_for(layer_id):
    """A vector layer's files: its GeoParquet (data), PMTiles (visual), thumbnail."""
    return [
        {"role": "data", "filename": f"{layer_id}.parquet", "media_type": PARQUET_CONTENT_TYPE},
        {"role": "visual", "filename": f"{layer_id}.pmtiles", "media_type": CONTENT_TYPE},
        {
            "role": "thumbnail",
            "filename": portolan.THUMBNAIL_FILENAME,
            "media_type": portolan.THUMBNAIL_MEDIA_TYPE,
        },
    ]


def pick_layers(inspection):
    """A GeoPackage's vector layers, from CloudNativeGIS's inspection of it."""
    return [layer["name"] for layer in inspection.get("layers", [])]


def is_vector_file(filename):
    return PurePosixPath(filename).suffix.lower() in VECTOR_FILE_TYPES


def output_key(key):
    key = key.rstrip("/")
    if key.lower().endswith(".shp.zip"):
        key = key[:-8]
    elif not key.lower().endswith(".pmtiles"):
        key = str(PurePosixPath(key).with_suffix(""))
    else:
        return key
    return f"{key}.pmtiles"


def prepare_shapefile(uploaded_file, destination, identifier, companion_files=()):
    """Validate and flatten one shapefile, using unique names upstream."""
    if uploaded_file.name.lower().endswith(".shp"):
        stem = PurePosixPath(uploaded_file.name).stem.lower()
        components = {}
        for component in [uploaded_file, *companion_files]:
            path = PurePosixPath(component.name)
            suffix = path.suffix.lower()
            if path.stem.lower() != stem or suffix not in {
                ".shp",
                ".shx",
                ".dbf",
                ".prj",
                ".cpg",
                ".qix",
                ".sbn",
                ".sbx",
            }:
                raise ValueError("Select only the matching components of one shapefile.")
            if suffix in components:
                raise ValueError("Duplicate shapefile components were selected.")
            components[suffix] = component
        if not {".shp", ".shx", ".dbf"}.issubset(components):
            raise ValueError(
                "Select the matching .shp, .shx and .dbf files together. "
                "Cloudbench will ZIP them automatically."
            )
        if sum(component.size for component in components.values()) > settings.UPLOAD_MAX_FILE_SIZE:
            raise ValueError("The shapefile components exceed the upload size limit.")
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            for suffix, component in components.items():
                with archive.open(f"{identifier}{suffix}", "w", force_zip64=True) as output:
                    for chunk in component.chunks():
                        output.write(chunk)
        return
    if companion_files:
        raise ValueError("Multiple files are supported only for matching shapefile components.")
    if not uploaded_file.name.lower().endswith(".zip"):
        raise ValueError("Select a shapefile and its companion files, or a shapefile ZIP.")
    try:
        with zipfile.ZipFile(uploaded_file) as source:
            files = [entry for entry in source.infolist() if not entry.is_dir()]
            shapes = [entry for entry in files if entry.filename.lower().endswith(".shp")]
            if len(shapes) != 1:
                raise ValueError("The ZIP must contain exactly one shapefile.")
            stem = str(PurePosixPath(shapes[0].filename).with_suffix("")).lower()
            sidecars = {}
            for entry in files:
                path = PurePosixPath(entry.filename)
                if str(path.with_suffix("")).lower() != stem:
                    continue
                suffix = path.suffix.lower()
                if suffix not in {".shp", ".shx", ".dbf", ".prj", ".cpg", ".qix", ".sbn", ".sbx"}:
                    continue
                if suffix in sidecars:
                    raise ValueError("The ZIP contains duplicate shapefile components.")
                sidecars[suffix] = entry
            if not {".shp", ".shx", ".dbf"}.issubset(sidecars):
                raise ValueError("The ZIP must include matching .shp, .shx and .dbf files.")
            if sum(entry.file_size for entry in sidecars.values()) > settings.UPLOAD_MAX_FILE_SIZE:
                raise ValueError("The uncompressed shapefile exceeds the upload size limit.")
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as target:
                for suffix, entry in sidecars.items():
                    with (
                        source.open(entry) as incoming,
                        target.open(f"{identifier}{suffix}", "w", force_zip64=True) as outgoing,
                    ):
                        shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise ValueError("The shapefile ZIP is invalid, encrypted, or unsupported.") from exc


def upload_raw_components(s3_client, output_key_value, job_id, uploaded_file, companion_files):
    """Persist each originally-uploaded file (not just the synthesized zip) to S3."""
    directory = sources_directory_key(output_key_value, job_id)
    for component in (uploaded_file, *companion_files):
        component.seek(0)
        key = f"{directory}/{PurePosixPath(component.name).name}"
        content_type = component.content_type or "application/octet-stream"
        s3_client.client.upload_fileobj(
            component, s3_client.bucket, key, ExtraArgs={"ContentType": content_type}
        )


def start_conversion(
    uploaded_file,
    key,
    connection_id,
    user,
    companion_files=(),
    license_id=portolan.DEFAULT_LICENSE,
    license_url="",
    replace=False,
    hetzner_server_id=None,
    auto_destroy=True,
    instance_server=None,
):
    """Start converting an upload; raises TargetExists unless `replace` (see check_target)."""
    if not CngLiteJob.is_valid():
        raise ValueError("CloudNativeGIS is not configured.")
    geopackage = is_geopackage(uploaded_file.name)
    vector_file = is_vector_file(uploaded_file.name)
    if geopackage and companion_files:
        raise ValueError("GeoPackage conversion accepts a single file.")
    if vector_file and companion_files:
        raise ValueError("GeoJSON, FlatGeobuf and KML conversion accepts a single file.")
    input_size = uploaded_file.size + sum(component.size for component in companion_files)
    if input_size > settings.UPLOAD_MAX_FILE_SIZE:
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
        input_size=input_size,
        license=license_id,
        license_url=license_url,
        replace_existing=replace,
        hetzner_server_id=hetzner_server_id,
        auto_destroy=auto_destroy,
        instance_server=instance_server,
    )
    directory = job_directory(KIND, job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        if geopackage:
            # Streamed straight to S3, never staged on local disk - a large
            # GeoPackage shouldn't need CloudBench's own disk space.
            validate_geopackage(uploaded_file, settings.UPLOAD_MAX_FILE_SIZE)
            source_filename = PurePosixPath(uploaded_file.name).name
            job.source_key = source_object_key(job.output_key, job.id, source_filename)
            if companion_files:
                upload_raw_components(
                    s3_client, job.output_key, job.id, uploaded_file, companion_files
                )
            uploaded_file.seek(0)
            s3_client.client.upload_fileobj(
                uploaded_file,
                s3_client.bucket,
                job.source_key,
                ExtraArgs={"ContentType": "application/geopackage+sqlite3"},
            )
        else:
            if vector_file:
                suffix = PurePosixPath(uploaded_file.name).suffix.lower()
                source_path = directory / f"source{suffix}"
                with source_path.open("wb") as output:
                    for chunk in uploaded_file.chunks():
                        output.write(chunk)
                source_filename = PurePosixPath(uploaded_file.name).name
                content_type = VECTOR_FILE_TYPES[suffix]
            else:
                source_path = directory / "source.zip"
                prepare_shapefile(uploaded_file, source_path, job.id, companion_files)
                source_filename = f"{PurePosixPath(uploaded_file.name).stem}.zip"
                content_type = "application/zip"
            job.source_key = source_object_key(job.output_key, job.id, source_filename)
            if companion_files:
                upload_raw_components(
                    s3_client, job.output_key, job.id, uploaded_file, companion_files
                )
            with source_path.open("rb") as source_file:
                s3_client.client.upload_fileobj(
                    source_file,
                    s3_client.bucket,
                    job.source_key,
                    ExtraArgs={"ContentType": content_type},
                )
        job.save()
        threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        if job.pk:
            CngLiteJob.objects.filter(pk=job.pk).delete()
        raise
    return job


def inspect_geopackage(
    uploaded_file,
    key,
    connection_id,
    user,
    license_id=portolan.DEFAULT_LICENSE,
    license_url="",
    replace=False,
    hetzner_server_id=None,
    auto_destroy=True,
    instance_server=None,
):
    """Stage a GeoPackage in S3 and start reading what it contains, on CloudNativeGIS.

    Creates the CngLiteJob now (so the eventual conversion reuses the same
    already-uploaded source), streams the upload straight to S3 (never to
    CloudBench's own disk), then starts a background thread asking
    CloudNativeGIS what it holds (see cng_lite.CNGProcessingClient.inspect) -
    provisioning its server first if needed, same as a real conversion. The
    job is left INSPECTING, then PENDING with `inspection` set once that's
    done - the caller is expected to poll it (GET the job) until then, let
    the user pick layers, and call start_geopackage_conversion (vector
    layers -> PMTiles) or cog.start_geopackage_conversion (raster tables ->
    COG, for a GeoPackage that turns out to have no vector layers).

    Raises TargetExists if the GeoPackage's folder already holds data and
    `replace` isn't set (see check_target).
    """
    if not CngLiteJob.is_valid():
        raise ValueError("CloudNativeGIS is not configured.")
    if not is_geopackage(uploaded_file.name):
        raise ValueError("Select a GeoPackage (.gpkg) file.")
    validate_geopackage(uploaded_file, settings.UPLOAD_MAX_FILE_SIZE)

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
        message="Waiting for layer selection",
        license=license_id,
        license_url=license_url,
        replace_existing=replace,
        hetzner_server_id=hetzner_server_id,
        auto_destroy=auto_destroy,
        instance_server=instance_server,
    )
    directory = job_directory(KIND, job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        job.source_key = source_object_key(
            job.output_key, job.id, PurePosixPath(uploaded_file.name).name
        )
        s3_client.client.upload_fileobj(
            uploaded_file,
            s3_client.bucket,
            job.source_key,
            ExtraArgs={"ContentType": "application/geopackage+sqlite3"},
        )
        job.save()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        if job.pk:
            CngLiteJob.objects.filter(pk=job.pk).delete()
        raise
    # Keep `directory` around: run_conversion (started once layers are
    # confirmed) reuses it to write the downloaded result, and cleans it
    # up itself in its `finally` once the job finishes either way.
    threading.Thread(target=inspect_cng_lite_job, args=(job.id,), daemon=True).start()
    return job


def start_geopackage_conversion(job_id, user, layers):
    """Confirm which layers to include and start a previously-inspected GeoPackage's conversion."""
    if not layers:
        raise ValueError("Select at least one layer.")
    job = CngLiteJob.objects.filter(
        pk=job_id, owner=user, kind=KIND, status=CngLiteJobStatus.PENDING
    ).first()
    if not job:
        raise ValueError("Job not found, or conversion was already started.")
    job.layers = layers
    job.save(update_fields=["layers", "updated_at"])
    threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    return job


def cancel_geopackage_inspection(job_id, user):
    """Cancel a GeoPackage job the user hasn't confirmed layers for yet.

    While it's being inspected, or once inspected and awaiting the user's
    pick (see cng_lite.cancel_inspection): deprovisioning its server, on
    demand, as any cancelled conversion would. Its staged upload in S3 is
    left as it is for now - an on-demand auto_destroy server tears down
    whatever it was given anyway.
    """
    job = CngLiteJob.objects.filter(pk=job_id, owner=user, kind=KIND, layers__isnull=True).first()
    if not job:
        raise ValueError("Job not found, or conversion was already started.")
    cancel_inspection(job)


CONVERTER = Converter(
    endpoint=ENDPOINT,
    assets_for=assets_for,
    pick_layers=pick_layers,
    payload=lambda job: {
        "thumbnail": True,
        **({"layers": job.layers} if job.layers else {}),
    },
)


def run_conversion(job_id, create_collection=True):  # noqa: ARG001
    """`create_collection` is no longer used (layer groups come from the catalog;
    see layer_groups) - still accepted for the portolan_backfill command."""
    run_cng_lite_conversion(job_id)
