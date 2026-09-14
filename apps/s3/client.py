"""S3/MinIO client for storage operations.

Provides a unified interface for S3-compatible object storage
including AWS S3, MinIO, and other compatible services.
"""

import threading
from dataclasses import dataclass
from typing import Any, BinaryIO

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from apps.core.config import get_config


@dataclass
class S3Object:
    """S3 object information."""

    key: str
    size: int
    last_modified: str
    etag: str
    storage_class: str = "STANDARD"
    is_directory: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "key": self.key,
            "size": self.size,
            "lastModified": self.last_modified,
            "etag": self.etag,
            "storageClass": self.storage_class,
            "isDirectory": self.is_directory,
        }


@dataclass
class S3Bucket:
    """S3 bucket information."""

    name: str
    creation_date: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "creationDate": self.creation_date,
        }


class S3Client:
    """Client for S3-compatible object storage."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        use_ssl: bool = True,
        path_style: bool = True,
    ):
        """Initialize S3 client.

        Args:
            endpoint: S3 endpoint URL
            access_key: Access key ID
            secret_key: Secret access key
            region: AWS region (default: us-east-1)
            use_ssl: Whether to use SSL
            path_style: Use path-style addressing (required for MinIO)
        """
        self.endpoint = endpoint
        self.region = region

        # Configure boto3 for S3-compatible storage
        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if path_style else "virtual"},
        )

        # Handle endpoint URL
        endpoint_url = endpoint
        if not endpoint_url.startswith("http"):
            protocol = "https" if use_ssl else "http"
            endpoint_url = f"{protocol}://{endpoint}"

        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=config,
        )

        self.resource = boto3.resource(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=config,
        )

    def test_connection(self) -> tuple[bool, str]:
        """Test the S3 connection.

        Returns:
            Tuple of (success, message)
        """
        try:
            self.client.list_buckets()
            return True, "Connection successful"
        except ClientError as e:
            return False, str(e)
        except Exception as e:
            return False, str(e)

    def list_buckets(self) -> list[S3Bucket]:
        """List all accessible buckets.

        Returns:
            List of S3Bucket objects
        """
        response = self.client.list_buckets()
        buckets = []
        for bucket in response.get("Buckets", []):
            creation_date = bucket.get("CreationDate")
            buckets.append(
                S3Bucket(
                    name=bucket["Name"],
                    creation_date=creation_date.isoformat() if creation_date else None,
                )
            )
        return buckets

    def list_objects(
        self,
        bucket: str,
        prefix: str = "",
        delimiter: str = "/",
        max_keys: int = 1000,
        continuation_token: str | None = None,
    ) -> dict[str, Any]:
        """List objects in a bucket with optional prefix.

        Args:
            bucket: Bucket name
            prefix: Key prefix to filter
            delimiter: Delimiter for virtual directories
            max_keys: Maximum keys to return
            continuation_token: Token for pagination

        Returns:
            Dictionary with objects, prefixes, and pagination info
        """
        params = {
            "Bucket": bucket,
            "MaxKeys": max_keys,
        }
        if prefix:
            params["Prefix"] = prefix
        if delimiter:
            params["Delimiter"] = delimiter
        if continuation_token:
            params["ContinuationToken"] = continuation_token

        response = self.client.list_objects_v2(**params)

        objects = []
        for obj in response.get("Contents", []):
            last_modified = obj.get("LastModified")
            objects.append(
                S3Object(
                    key=obj["Key"],
                    size=obj.get("Size", 0),
                    last_modified=last_modified.isoformat() if last_modified else "",
                    etag=obj.get("ETag", "").strip('"'),
                    storage_class=obj.get("StorageClass", "STANDARD"),
                )
            )

        # Common prefixes represent "directories"
        prefixes = []
        for prefix_info in response.get("CommonPrefixes", []):
            prefixes.append(prefix_info["Prefix"])

        return {
            "objects": [obj.to_dict() for obj in objects],
            "prefixes": prefixes,
            "isTruncated": response.get("IsTruncated", False),
            "nextContinuationToken": response.get("NextContinuationToken"),
            "keyCount": response.get("KeyCount", 0),
        }

    def get_object(self, bucket: str, key: str) -> bytes:
        """Get object content.

        Args:
            bucket: Bucket name
            key: Object key

        Returns:
            Object content as bytes
        """
        response = self.client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def get_object_stream(self, bucket: str, key: str) -> BinaryIO:
        """Get object content as a stream.

        Args:
            bucket: Bucket name
            key: Object key

        Returns:
            StreamingBody for the object
        """
        response = self.client.get_object(Bucket=bucket, Key=key)
        return response["Body"]

    def get_object_info(self, bucket: str, key: str) -> dict[str, Any]:
        """Get object metadata.

        Args:
            bucket: Bucket name
            key: Object key

        Returns:
            Object metadata dictionary
        """
        response = self.client.head_object(Bucket=bucket, Key=key)
        last_modified = response.get("LastModified")
        return {
            "contentLength": response.get("ContentLength", 0),
            "contentType": response.get("ContentType", "application/octet-stream"),
            "lastModified": last_modified.isoformat() if last_modified else None,
            "etag": response.get("ETag", "").strip('"'),
            "metadata": response.get("Metadata", {}),
        }

    def put_object(
        self,
        bucket: str,
        key: str,
        body: bytes | BinaryIO,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Upload an object.

        Args:
            bucket: Bucket name
            key: Object key
            body: Object content
            content_type: Content type header
            metadata: Custom metadata

        Returns:
            Upload response
        """
        params: dict[str, Any] = {
            "Bucket": bucket,
            "Key": key,
            "Body": body,
        }
        if content_type:
            params["ContentType"] = content_type
        if metadata:
            params["Metadata"] = metadata

        response = self.client.put_object(**params)
        return {
            "etag": response.get("ETag", "").strip('"'),
            "versionId": response.get("VersionId"),
        }

    def delete_object(self, bucket: str, key: str) -> bool:
        """Delete an object.

        Args:
            bucket: Bucket name
            key: Object key

        Returns:
            True if deleted successfully
        """
        self.client.delete_object(Bucket=bucket, Key=key)
        return True

    def generate_presigned_url(
        self,
        bucket: str,
        key: str,
        expiration: int = 3600,
        method: str = "get_object",
    ) -> str:
        """Generate a presigned URL.

        Args:
            bucket: Bucket name
            key: Object key
            expiration: URL expiration in seconds
            method: S3 method (get_object, put_object)

        Returns:
            Presigned URL
        """
        return self.client.generate_presigned_url(
            method,
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expiration,
        )

    def copy_object(
        self,
        source_bucket: str,
        source_key: str,
        dest_bucket: str,
        dest_key: str,
    ) -> dict[str, Any]:
        """Copy an object.

        Args:
            source_bucket: Source bucket name
            source_key: Source object key
            dest_bucket: Destination bucket name
            dest_key: Destination object key

        Returns:
            Copy response
        """
        copy_source = {"Bucket": source_bucket, "Key": source_key}
        response = self.client.copy_object(
            CopySource=copy_source,
            Bucket=dest_bucket,
            Key=dest_key,
        )
        return {
            "etag": response.get("CopyObjectResult", {}).get("ETag", "").strip('"'),
        }


class S3ClientManager:
    """Thread-safe manager for S3 clients."""

    _instance: "S3ClientManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "S3ClientManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._clients: dict[str, S3Client] = {}
        return cls._instance

    def get_client(self, connection_id: str) -> S3Client:
        """Get or create an S3 client for a connection.

        Args:
            connection_id: S3 connection ID

        Returns:
            S3Client instance

        Raises:
            ValueError: If connection not found
        """
        with self._lock:
            if connection_id in self._clients:
                return self._clients[connection_id]

            # Get connection config
            config = get_config()
            conn = config.get_s3_connection(connection_id)
            if not conn:
                raise ValueError(f"S3 connection not found: {connection_id}")

            # Create client
            client = S3Client(
                endpoint=conn.endpoint,
                access_key=conn.access_key,
                secret_key=conn.secret_key,
                region=conn.region or "us-east-1",
                use_ssl=conn.use_ssl,
                path_style=conn.path_style,
            )

            self._clients[connection_id] = client
            return client

    def remove_client(self, connection_id: str) -> None:
        """Remove a cached client.

        Args:
            connection_id: Connection ID to remove
        """
        with self._lock:
            self._clients.pop(connection_id, None)

    def clear_all(self) -> None:
        """Clear all cached clients."""
        with self._lock:
            self._clients.clear()


def get_s3_client(connection_id: str) -> S3Client:
    """Get an S3 client for a connection.

    Args:
        connection_id: S3 connection ID

    Returns:
        S3Client instance
    """
    manager = S3ClientManager()
    return manager.get_client(connection_id)
