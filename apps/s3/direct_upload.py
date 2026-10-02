"""Results CloudNativeGIS uploads straight to the bucket, and checking them.

Every conversion's results go from CloudNativeGIS to the bucket through
presigned PUT URLs CloudBench hands out - one per file, for its final key,
signed with the only content type it may carry - so large files never pass
through CloudBench. CloudBench doesn't take CloudNativeGIS's word for what
arrived: each file is checked in the bucket (see verify_uploads) before
anything is published. The Portolan metadata is still CloudBench's to write.
"""

from . import portolan

# How long presigned URLs outlast how long CloudBench waits for the job
# (seconds): past that they'd only be a risk.
URL_MARGIN = 300

TIFF_MAGIC = (b"II*\x00", b"MM\x00*")
# How each kind of result file starts, by content type: (what it is, how).
_MAGIC = {
    portolan.COG_MEDIA_TYPE: ("a TIFF", TIFF_MAGIC),
    portolan.PMTILES_MEDIA_TYPE: ("a PMTiles file", (b"PMTiles",)),
    portolan.PARQUET_MEDIA_TYPE: ("a Parquet file", (b"PAR1",)),
    portolan.THUMBNAIL_MEDIA_TYPE: ("a PNG", (b"\x89PNG\r\n\x1a\n",)),
    # A COPC is a LAS file whose first VLR, right after the 375-byte
    # header, is "copc"'s (user id at byte 377).
    portolan.COPC_MEDIA_TYPE: ("a COPC point cloud", (b"LASF",)),
}
# Bytes further in that a kind must also carry: (offset, bytes).
_MAGIC_AT = {portolan.COPC_MEDIA_TYPE: (377, b"copc")}


def presign_put(s3_client, key: str, expiry: int, content_type: str) -> str:
    """A presigned PUT URL for `key`, accepting only `content_type`."""
    url: str = s3_client.generate_presigned_url(
        key, expiration=expiry, method="put_object", content_type=content_type
    )
    return url


def file_fields(output: dict) -> dict:
    """CloudNativeGIS's {'size', 'sha256'} for an uploaded file, as asset `file`."""
    return {
        "size": output["size"],
        "checksum": portolan.sha256_multihash(bytes.fromhex(output["sha256"])),
    }


def verify_uploads(s3_client, expected: list[tuple[str, int, str]]) -> None:
    """Check each (key, size, content type) is in the bucket as reported.

    Each file must exist with the size CloudNativeGIS reported (recorded as
    its asset's file:size) and the content type expected of it, and a file
    of a known kind must start as that kind does (a COG as a TIFF, ...).
    Only object metadata and a few bytes per file are read. Raises
    ValueError, failing the job, on any mismatch.
    """
    for key, size, content_type in expected:
        name = key.rsplit("/", 1)[-1]
        try:
            info = s3_client.get_object_info(key)
        except Exception as exc:
            raise ValueError(
                f"CloudNativeGIS reported {name} uploaded, but it isn't there."
            ) from exc
        if info["contentLength"] != size:
            raise ValueError(
                f"{name} is {info['contentLength']} bytes in the bucket, "
                f"but CloudNativeGIS reported {size}."
            )
        if info["contentType"] != content_type:
            raise ValueError(f"{name} was stored as {info['contentType']!r}, not {content_type!r}.")
        if content_type in _MAGIC:
            kind, magic = _MAGIC[content_type]
            offset, inner = _MAGIC_AT.get(content_type, (0, b""))
            length = max(*(len(m) for m in magic), offset + len(inner))
            head = s3_client.client.get_object(
                Bucket=s3_client.bucket, Key=key, Range=f"bytes=0-{length - 1}"
            )["Body"].read()
            if not any(head.startswith(m) for m in magic) or (
                inner and head[offset : offset + len(inner)] != inner
            ):
                raise ValueError(f"{name} in the bucket isn't {kind}.")


def delete_leftovers(s3_client, folder: str, keep: set[str]) -> None:
    """Drop the files under `folder` a replacement didn't rewrite.

    For a confirmed replace: the new results land on their final keys, so
    once they're up, whatever else the old layer had there goes.
    """
    stale, token = [], None
    while True:
        page = s3_client.list_objects(
            prefix=f"{folder}/", delimiter="", max_keys=1000, continuation_token=token
        )
        stale += [{"Key": o["key"]} for o in page["objects"] if o["key"] not in keep]
        if not page.get("isTruncated"):
            break
        token = page.get("nextContinuationToken")
    for i in range(0, len(stale), 1000):
        s3_client.client.delete_objects(
            Bucket=s3_client.bucket, Delete={"Objects": stale[i : i + 1000]}
        )
