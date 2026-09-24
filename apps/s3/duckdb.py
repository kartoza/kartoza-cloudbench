"""DuckDB integration for querying S3 data.

Provides functionality to query Parquet, GeoParquet, CSV, and JSON
files stored in S3-compatible storage using DuckDB.
"""

import json
import threading
from typing import TYPE_CHECKING, Any, cast

import duckdb
from django.core.exceptions import ValidationError

from .models import S3Connection

if TYPE_CHECKING:
    from django.contrib.auth.models import User


class DuckDBQueryEngine:
    """Query engine for S3 data using DuckDB."""

    _instance: "DuckDBQueryEngine | None" = None
    _lock = threading.RLock()
    _initialized: bool

    def __new__(cls) -> "DuckDBQueryEngine":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        """Initialize DuckDB connection."""
        if self._initialized:
            return

        with self._lock:
            if self._initialized:
                return

            # Create in-memory DuckDB connection
            self.conn = duckdb.connect(":memory:")

            # Install and load extensions
            self.conn.execute("INSTALL httpfs")
            self.conn.execute("LOAD httpfs")
            self.conn.execute("INSTALL spatial")
            self.conn.execute("LOAD spatial")

            self._initialized = True

    def configure_s3(self, connection_id: str, user: "User") -> None:
        """Configure DuckDB for S3 access.

        Args:
            connection_id: S3 connection ID
            user: User the connection belongs to
        """
        try:
            conn = S3Connection.objects.filter(owner=user, id=connection_id).first()
        except (ValueError, ValidationError):
            conn = None
        if not conn:
            raise ValueError(f"S3 connection not found: {connection_id}")

        # Parse endpoint for DuckDB config
        endpoint = conn.endpoint
        if endpoint.startswith("http://"):
            endpoint = endpoint[7:]
            use_ssl = "false"
        elif endpoint.startswith("https://"):
            endpoint = endpoint[8:]
            use_ssl = "true"
        else:
            use_ssl = "true" if conn.use_ssl else "false"

        # Configure S3 settings
        self.conn.execute(f"SET s3_region='{conn.region or 'us-east-1'}'")
        self.conn.execute(f"SET s3_access_key_id='{conn.access_key}'")
        self.conn.execute(f"SET s3_secret_access_key='{conn.secret_key}'")
        self.conn.execute(f"SET s3_endpoint='{endpoint}'")
        self.conn.execute(f"SET s3_use_ssl={use_ssl}")
        self.conn.execute("SET s3_url_style='path'")

    def execute_query(
        self,
        query: str,
        connection_id: str | None = None,
        limit: int = 1000,
        user: "User | None" = None,
    ) -> dict[str, Any]:
        """Execute a DuckDB query.

        Args:
            query: SQL query
            connection_id: Optional S3 connection ID to configure
            user: User the connection belongs to
            limit: Maximum rows to return

        Returns:
            Dictionary with columns, rows, and metadata
        """
        with self._lock:
            if connection_id:
                self.configure_s3(connection_id, user)

            # Add limit if not present in SELECT queries
            query_lower = query.lower().strip()
            if query_lower.startswith("select") and "limit" not in query_lower:
                query = f"{query.rstrip(';')} LIMIT {limit}"

            result = self.conn.execute(query)

            # Get column names
            columns = [desc[0] for desc in result.description]

            # Fetch rows and convert to JSON-serializable format
            rows = []
            for row in result.fetchall():
                row_dict = {}
                for i, col in enumerate(columns):
                    value = row[i]
                    # Handle special types
                    if hasattr(value, "isoformat"):
                        value = value.isoformat()
                    elif isinstance(value, bytes):
                        value = value.hex()
                    elif isinstance(value, (list, dict)):
                        pass  # Keep as-is for JSON
                    row_dict[col] = value
                rows.append(row_dict)

            return {
                "columns": columns,
                "rows": rows,
                "rowCount": len(rows),
            }

    def query_parquet(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
        columns: list[str] | None = None,
        where: str | None = None,
        limit: int = 1000,
    ) -> dict[str, Any]:
        """Query a Parquet file on S3.

        Args:
            s3_path: Full S3 path (s3://bucket/key)
            connection_id: S3 connection ID
            user: User the connection belongs to
            columns: Optional columns to select
            where: Optional WHERE clause
            limit: Maximum rows to return

        Returns:
            Query results
        """
        col_list = ", ".join(columns) if columns else "*"
        query = f"SELECT {col_list} FROM read_parquet('{s3_path}')"
        if where:
            query += f" WHERE {where}"
        query += f" LIMIT {limit}"

        return self.execute_query(query, connection_id, limit, user=user)

    def query_csv(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
        columns: list[str] | None = None,
        where: str | None = None,
        limit: int = 1000,
        header: bool = True,
        delimiter: str = ",",
    ) -> dict[str, Any]:
        """Query a CSV file on S3.

        Args:
            s3_path: Full S3 path (s3://bucket/key)
            connection_id: S3 connection ID
            user: User the connection belongs to
            columns: Optional columns to select
            where: Optional WHERE clause
            limit: Maximum rows to return
            header: Whether CSV has header row
            delimiter: Field delimiter

        Returns:
            Query results
        """
        col_list = ", ".join(columns) if columns else "*"
        query = (
            f"SELECT {col_list} FROM read_csv_auto('{s3_path}', "
            f"header={str(header).lower()}, delim='{delimiter}')"
        )
        if where:
            query += f" WHERE {where}"
        query += f" LIMIT {limit}"

        return self.execute_query(query, connection_id, limit, user=user)

    def query_json(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
        columns: list[str] | None = None,
        where: str | None = None,
        limit: int = 1000,
    ) -> dict[str, Any]:
        """Query a JSON/JSONL file on S3.

        Args:
            s3_path: Full S3 path (s3://bucket/key)
            connection_id: S3 connection ID
            user: User the connection belongs to
            columns: Optional columns to select
            where: Optional WHERE clause
            limit: Maximum rows to return

        Returns:
            Query results
        """
        col_list = ", ".join(columns) if columns else "*"
        query = f"SELECT {col_list} FROM read_json_auto('{s3_path}')"
        if where:
            query += f" WHERE {where}"
        query += f" LIMIT {limit}"

        return self.execute_query(query, connection_id, limit, user=user)

    def get_parquet_schema(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
    ) -> dict[str, Any]:
        """Get schema of a Parquet file.

        Args:
            s3_path: Full S3 path (s3://bucket/key)
            connection_id: S3 connection ID
            user: User the connection belongs to

        Returns:
            Schema information
        """
        query = f"DESCRIBE SELECT * FROM read_parquet('{s3_path}')"
        result = self.execute_query(query, connection_id, user=user)

        columns = []
        for row in result["rows"]:
            columns.append(
                {
                    "name": row.get("column_name"),
                    "type": row.get("column_type"),
                    "nullable": row.get("null") == "YES",
                }
            )

        return {"columns": columns}

    def get_parquet_metadata(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
    ) -> dict[str, Any]:
        """Get metadata of a Parquet file.

        Args:
            s3_path: Full S3 path (s3://bucket/key)
            connection_id: S3 connection ID
            user: User the connection belongs to

        Returns:
            Parquet metadata
        """
        query = f"SELECT * FROM parquet_metadata('{s3_path}')"
        result = self.execute_query(query, connection_id, user=user)

        if result["rows"]:
            return cast(dict, result["rows"][0])
        return {}

    def query_geoparquet(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
        geometry_column: str = "geometry",
        bbox: tuple[float, float, float, float] | None = None,
        limit: int = 1000,
    ) -> dict[str, Any]:
        """Query a GeoParquet file and return GeoJSON.

        Args:
            s3_path: Full S3 path (s3://bucket/key)
            connection_id: S3 connection ID
            user: User the connection belongs to
            geometry_column: Name of geometry column
            bbox: Optional bounding box filter (minx, miny, maxx, maxy)
            limit: Maximum features to return

        Returns:
            GeoJSON FeatureCollection
        """
        # Build query with spatial filter
        query = f"""
            SELECT * FROM read_parquet('{s3_path}')
        """

        if bbox:
            minx, miny, maxx, maxy = bbox
            query += f"""
                WHERE ST_Intersects(
                    {geometry_column},
                    ST_MakeEnvelope({minx}, {miny}, {maxx}, {maxy})
                )
            """

        query += f" LIMIT {limit}"

        result = self.execute_query(query, connection_id, limit, user=user)

        # Convert to GeoJSON
        features = []
        for row in result["rows"]:
            geom = row.pop(geometry_column, None)
            feature = {
                "type": "Feature",
                "geometry": json.loads(geom) if isinstance(geom, str) else geom,
                "properties": row,
            }
            features.append(feature)

        return {
            "type": "FeatureCollection",
            "features": features,
        }


def get_duckdb_engine() -> DuckDBQueryEngine:
    """Get the DuckDB query engine singleton.

    Returns:
        DuckDBQueryEngine instance
    """
    return DuckDBQueryEngine()
