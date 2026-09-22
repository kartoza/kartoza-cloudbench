"""Convert shapefiles via CloudNativeGIS Lite and transfer the resulting PMTiles to S3."""

import shutil
import threading
import zipfile
from pathlib import PurePosixPath

import httpx
from django.conf import settings

from .client import get_s3_client
from .cng_lite import (
    job_directory,
    request_json,
    run_conversion as run_cng_lite_conversion,
    source_object_key,
    sources_directory_key,
)
from .geopackage import is_geopackage, prepare_geopackage
from .models import CngLiteJob

KIND = "pmtiles"
ENDPOINT = "api/v1/pmtiles"
CONTENT_TYPE = "application/vnd.pmtiles"


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
        s3_client.client.upload_fileobj(component, s3_client.bucket, key, ExtraArgs={"ContentType": content_type})


def start_conversion(uploaded_file, key, connection_id, owner_id, companion_files=()):
    if not settings.CLOUDNATIVEGIS_URL:
        raise ValueError("CloudNativeGIS URL is not configured.")
    geopackage = is_geopackage(uploaded_file.name)
    if geopackage and companion_files:
        raise ValueError("GeoPackage conversion accepts a single file.")
    input_size = uploaded_file.size + sum(component.size for component in companion_files)
    if input_size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The file exceeds the upload size limit.")
    s3_client = get_s3_client(connection_id, owner_id)
    job = CngLiteJob(
        kind=KIND,
        owner_id=owner_id,
        connection_id=connection_id,
        bucket=s3_client.bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=input_size,
    )
    directory = job_directory(KIND, job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        if geopackage:
            source_path = directory / "source.gpkg"
            prepare_geopackage(uploaded_file, source_path, settings.UPLOAD_MAX_FILE_SIZE)
            source_filename = PurePosixPath(uploaded_file.name).name
            content_type = "application/geopackage+sqlite3"
        else:
            source_path = directory / "source.zip"
            prepare_shapefile(uploaded_file, source_path, job.id, companion_files)
            source_filename = f"{PurePosixPath(uploaded_file.name).stem}.zip"
            content_type = "application/zip"
        job.source_key = source_object_key(job.output_key, job.id, source_filename)
        if companion_files:
            upload_raw_components(s3_client, job.output_key, job.id, uploaded_file, companion_files)
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


def inspect_geopackage(uploaded_file, key, connection_id, owner_id):
    """Stage a GeoPackage in S3 and ask CloudNativeGIS Lite for its layers.

    Creates the CngLiteJob now (so the eventual conversion reuses the same
    already-uploaded source), but leaves it "pending" — the caller is
    expected to let the user pick layers, then call start_geopackage_conversion.
    """
    if not settings.CLOUDNATIVEGIS_URL:
        raise ValueError("CloudNativeGIS URL is not configured.")
    if not is_geopackage(uploaded_file.name):
        raise ValueError("Select a GeoPackage (.gpkg) file.")
    if uploaded_file.size > settings.UPLOAD_MAX_FILE_SIZE:
        raise ValueError("The GeoPackage exceeds the upload size limit.")

    s3_client = get_s3_client(connection_id, owner_id)
    job = CngLiteJob(
        kind=KIND,
        owner_id=owner_id,
        connection_id=connection_id,
        bucket=s3_client.bucket,
        source_name=uploaded_file.name,
        output_key=output_key(key),
        input_size=uploaded_file.size,
        message="Waiting for layer selection",
    )
    directory = job_directory(KIND, job.id)
    directory.mkdir(parents=True, mode=0o700)
    try:
        source_path = directory / "source.gpkg"
        prepare_geopackage(uploaded_file, source_path, settings.UPLOAD_MAX_FILE_SIZE)
        job.source_key = source_object_key(job.output_key, job.id, PurePosixPath(uploaded_file.name).name)
        with source_path.open("rb") as source_file:
            s3_client.client.upload_fileobj(
                source_file,
                s3_client.bucket,
                job.source_key,
                ExtraArgs={"ContentType": "application/geopackage+sqlite3"},
            )
        job.save()
        presigned_url = s3_client.generate_presigned_url(job.source_key, expiration=300)
        with httpx.Client(base_url=f"{settings.CLOUDNATIVEGIS_URL}/", timeout=httpx.Timeout(30, connect=10)) as client:
            layers = request_json(client, "POST", "api/v1/gpkg/layers", json={"source": presigned_url})["layers"]
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        if job.pk:
            CngLiteJob.objects.filter(pk=job.pk).delete()
        raise
    # Keep `directory` around: run_conversion (started once layers are
    # confirmed) reuses it to write the downloaded result, and cleans it
    # up itself in its `finally` once the job finishes either way.
    return job, layers


def start_geopackage_conversion(job_id, owner_id, layers):
    """Confirm which layers to include and start a previously-inspected GeoPackage's conversion."""
    if not layers:
        raise ValueError("Select at least one layer.")
    job = CngLiteJob.objects.filter(pk=job_id, owner_id=owner_id, kind=KIND, status="pending").first()
    if not job:
        raise ValueError("Job not found, or conversion was already started.")
    job.layers = layers
    job.save(update_fields=["layers", "updated_at"])
    threading.Thread(target=run_conversion, args=(job.id,), daemon=True).start()
    return job


def validate_pmtiles(output):
    return output.read(7) == b"PMTiles"


def run_conversion(job_id):
    run_cng_lite_conversion(
        job_id,
        kind=KIND,
        endpoint=ENDPOINT,
        validate_result=validate_pmtiles,
        invalid_result_message="CloudNativeGIS did not return a valid PMTiles file.",
        output_content_type=CONTENT_TYPE,
        build_extra_payload=lambda job: {"layers": job.layers} if job.layers else None,
        use_folder=lambda job: job.layers is not None,
    )
