"""Checks a published layer's files against their recorded checksums.

Also records checksums for a layer published before they existed
(record_checksums), from its files as they are in the bucket now, and
brings an older layer's metadata up to what publishing writes now
(repair_metadata).

A layer's collection.json records file:checksum/file:size for each data
file when it's published (from the SHA-256 CloudNativeGIS reports for what it
uploaded, checked in the bucket - see apps.s3.direct_upload). If a file
is later overwritten or deleted directly in the bucket, the record goes
stale — which Portolan counts as a conformance failure. This re-reads each
file from S3 and compares, for the portolan_verify command and the S3
connection panel's "Verify checksums".
"""

import hashlib
import json
import posixpath
from typing import Any

from django.conf import settings

from . import portolan

CHUNK_SIZE = 1024 * 1024

# Per-file results.
OK = "ok"
MISMATCH = "mismatch"  # checksum or size differs from what was recorded
MISSING = "missing"  # the file is gone from the bucket
# Per-layer results (OK/MISMATCH as above, plus):
UNVERIFIABLE = "unverifiable"  # no file records a checksum (published before checksums)
UNREADABLE = "unreadable"  # collection.json is missing or not valid JSON


class AlreadyRecorded(Exception):
    """The layer already records checksums: verify it, don't re-record over it.

    Re-recording would silently accept any file changed since publishing —
    exactly what verification exists to catch; re-publishing is the fix.
    """


def catalog_layers(client) -> list[dict[str, str]]:
    """[{'folder', 'title'}, ...] for each layer in the bucket's catalog.

    Includes layers inside sub-catalogs (a GeoPackage's layer group).
    Empty if the bucket has no (readable) catalog.json.
    """
    return portolan.catalog_collections(client) or []


def _checksummed_files(collection: dict[str, Any]) -> list[dict[str, Any]]:
    """Every asset/link in a collection that records a file:checksum."""
    files = [
        {"name": f"asset {name}", **asset}
        for name, asset in collection.get("assets", {}).items()
        if "file:checksum" in asset
    ]
    files += [
        {"name": f"link {link.get('rel')}", **link}
        for link in collection.get("links", [])
        if "file:checksum" in link
    ]
    return files


def _hash_object(client, key: str) -> tuple[int, str]:
    """(size, SHA-256 multihash) of an object, streamed from S3."""
    digest = hashlib.sha256()
    size = 0
    stream = client.get_object_stream(key)
    try:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
            size += len(chunk)
    finally:
        stream.close()
    return size, portolan.sha256_multihash(digest.digest())


def verify_file(client, folder: str, record: dict[str, Any]) -> dict[str, Any]:
    key = posixpath.normpath(posixpath.join(folder, record.get("href", "")))
    result = {
        "name": record["name"],
        "key": key,
        "expectedChecksum": record.get("file:checksum"),
        "expectedSize": record.get("file:size"),
    }
    try:
        size, checksum = _hash_object(client, key)
    except Exception:
        return {**result, "status": MISSING}
    matches = checksum == record.get("file:checksum") and (
        record.get("file:size") is None or size == record["file:size"]
    )
    return {
        **result,
        "status": OK if matches else MISMATCH,
        "actualChecksum": checksum,
        "actualSize": size,
    }


def verify_layer(client, folder: str, title: str = "") -> dict[str, Any]:
    """Re-hash every checksummed file of one layer folder and compare."""
    result: dict[str, Any] = {"folder": folder, "title": title or folder, "files": []}
    try:
        collection = json.loads(client.get_object(f"{folder}/collection.json"))
    except Exception:
        return {**result, "status": UNREADABLE}
    result["title"] = collection.get("title") or result["title"]
    files = [verify_file(client, folder, record) for record in _checksummed_files(collection)]
    if not files:
        status = UNVERIFIABLE
    elif all(file["status"] == OK for file in files):
        status = OK
    else:
        status = MISMATCH
    return {**result, "status": status, "files": files}


def record_checksums(client, folder: str) -> dict[str, Any]:
    """Record file:checksum/file:size for a layer that has none yet.

    Hashes the layer's files as they are in the bucket *now* and writes the
    results into its collection.json — so it catches changes from here on,
    not ones made before. Writes nothing if a file is missing (the result
    lists it). Raises AlreadyRecorded if the layer already has checksums.
    Returns the layer's verification result afterwards.
    """
    key = f"{folder}/collection.json"
    try:
        collection = json.loads(client.get_object(key))
    except Exception:
        return {"folder": folder, "title": folder, "status": UNREADABLE, "files": []}
    if _checksummed_files(collection):
        raise AlreadyRecorded(folder)

    targets = [record for record in collection.get("assets", {}).values() if record.get("href")] + [
        link for link in collection.get("links", []) if link.get("rel") == "pmtiles"
    ]
    missing = []
    for record in targets:
        file_key = posixpath.normpath(posixpath.join(folder, record["href"]))
        try:
            size, checksum = _hash_object(client, file_key)
        except Exception:
            missing.append({"name": record["href"], "key": file_key, "status": MISSING})
            continue
        record["file:checksum"] = checksum
        record["file:size"] = size
    if missing:
        title = collection.get("title") or folder
        return {"folder": folder, "title": title, "status": MISMATCH, "files": missing}

    extensions = collection.setdefault("stac_extensions", [])
    if portolan.FILE_SCHEMA not in extensions:
        extensions.append(portolan.FILE_SCHEMA)
    client.put_object(
        key=key,
        body=json.dumps(collection, indent=2).encode("utf-8"),
        content_type="application/json",
    )
    portolan.touch_root_catalog(client)
    return verify_layer(client, folder)


def _current_providers(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`providers` as publishing writes them now (see portolan.providers).

    The hosting organisation (settings.PORTOLAN_HOST_NAME) is the producer
    too, and whoever else was listed - the uploader - its processor.
    """
    host = next((p for p in providers if "host" in p.get("roles", [])), None)
    if host is None:
        return providers
    host = {**host, "name": settings.PORTOLAN_HOST_NAME}
    uploader = next((p.get("name") for p in providers if p is not host and p.get("name")), None)
    if uploader is None or uploader == host["name"]:
        return [{**host, "roles": ["producer", "host"]}]
    return portolan.providers(host, uploader)


def repair_metadata(client, folder: str, dry_run: bool = False) -> list[str] | None:
    """Bring a published layer's collection.json up to what publishing writes now."""
    key = f"{folder}/collection.json"
    try:
        collection = json.loads(client.get_object(key))
    except Exception:
        return None
    changes = []

    providers = collection.get("providers") or []
    current = _current_providers(providers)
    if current != providers:
        collection["providers"] = current
        changes.append("providers")

    style = collection.get("assets", {}).get("style-default")
    if style and style.get("href"):
        recorded: tuple[int, str] | None
        try:
            recorded = _hash_object(
                client, posixpath.normpath(posixpath.join(folder, style["href"]))
            )
        except Exception:
            recorded = None  # no style file: nothing to record
        if recorded and (style.get("file:size"), style.get("file:checksum")) != recorded:
            size, checksum = recorded
            style["file:checksum"] = checksum
            style["file:size"] = size
            extensions = collection.setdefault("stac_extensions", [])
            if portolan.FILE_SCHEMA not in extensions:
                extensions.append(portolan.FILE_SCHEMA)
            changes.append("style checksum")

    if changes and not dry_run:
        client.put_object(
            key=key,
            body=json.dumps(collection, indent=2).encode("utf-8"),
            content_type="application/json",
        )
    return changes
