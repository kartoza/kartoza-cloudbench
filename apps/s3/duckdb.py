"""DuckDB integration for querying S3 data.

Provides functionality to query Parquet, GeoParquet, CSV, and JSON
files stored in S3-compatible storage using DuckDB.

Users send their own SQL, so every query runs on a fresh in-memory connection
holding only that user's S3 credentials (a temporary secret), closed once the
query is done: nothing it set, created or loaded reaches the next query. The
connection can read s3:// and nothing else - no local files (CloudBench's
database, its settings), no http(s) URLs (inside a cluster, those reach its
internal services) - with a memory limit, and the query can't change any of
it (lock_configuration).
"""

import json
import threading
from typing import TYPE_CHECKING, Any, cast

import duckdb
from django.conf import settings
from django.core.exceptions import ValidationError

from .models import S3Connection

if TYPE_CHECKING:
    from django.contrib.auth.models import User

EXTENSIONS = ("httpfs", "spatial")


def _quote(value: str) -> str:
    """A SQL string literal (CREATE SECRET takes no parameters)."""
    return "'" + str(value).replace("'", "''") + "'"


class DuckDBQueryEngine:
    """Query engine for S3 data using DuckDB."""

    _instance: "DuckDBQueryEngine | None" = None
    _lock = threading.RLock()
    _installed = False

    def __new__(cls) -> "DuckDBQueryEngine":
        """Ensure singleton instance (it holds no state but whether extensions are installed)."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def _install_extensions(self) -> None:
        """Download the extensions once per process (connections only load them)."""
        if DuckDBQueryEngine._installed:
            return
        with self._lock:
            if DuckDBQueryEngine._installed:
                return
            conn = duckdb.connect(":memory:")
            try:
                for extension in EXTENSIONS:
                    conn.execute(f"INSTALL {extension}")
            finally:
                conn.close()
            DuckDBQueryEngine._installed = True

    def connect(
        self, connection_id: str | None = None, user: "User | None" = None
    ) -> duckdb.DuckDBPyConnection:
        """A connection for one query: S3 only, the user's credentials, locked."""
        self._install_extensions()
        conn = duckdb.connect(":memory:", config={"allow_persistent_secrets": False})
        try:
            for extension in EXTENSIONS:
                conn.execute(f"LOAD {extension}")
            if connection_id:
                self.configure_s3(conn, connection_id, user)
            conn.execute("SET allowed_directories=['s3://']")
            conn.execute("SET enable_external_access=false")
            conn.execute(f"SET memory_limit={_quote(settings.DUCKDB_MEMORY_LIMIT)}")
            conn.execute("SET lock_configuration=true")
        except Exception:
            conn.close()
            raise
        return conn

    def configure_s3(
        self, conn: duckdb.DuckDBPyConnection, connection_id: str, user: "User | None"
    ) -> None:
        """Give `conn` the S3 connection's credentials, as a temporary secret.

        Args:
            conn: The query's DuckDB connection
            connection_id: S3 connection ID
            user: User the connection belongs to
        """
        try:
            s3 = S3Connection.objects.filter(owner=user, id=connection_id).first()
        except (ValueError, ValidationError, TypeError):
            s3 = None
        if not s3:
            raise ValueError(f"S3 connection not found: {connection_id}")

        # Parse endpoint for DuckDB config
        endpoint = s3.endpoint
        if endpoint.startswith("http://"):
            endpoint = endpoint[7:]
            use_ssl = "false"
        elif endpoint.startswith("https://"):
            endpoint = endpoint[8:]
            use_ssl = "true"
        else:
            use_ssl = "true" if s3.use_ssl else "false"

        conn.execute(
            "CREATE TEMPORARY SECRET s3 ("
            "TYPE s3, "
            f"KEY_ID {_quote(s3.access_key)}, "
            f"SECRET {_quote(s3.secret_key)}, "
            f"REGION {_quote(s3.region or 'us-east-1')}, "
            f"ENDPOINT {_quote(endpoint)}, "
            f"USE_SSL {use_ssl}, "
            "URL_STYLE 'path')"
        )

    def execute_query(
        self,
        query: str,
        connection_id: str | None = None,
        limit: int = 1000,
        user: "User | None" = None,
    ) -> dict[str, Any]:
        """Execute a DuckDB query on a connection of its own.

        Args:
            query: SQL query
            connection_id: Optional S3 connection ID to read with
            user: User the connection belongs to
            limit: Maximum rows to return

        Returns:
            Dictionary with columns, rows, and metadata
        """
        limit = int(limit)
        conn = self.connect(connection_id, user)
        try:
            # Add limit if not present in SELECT queries
            query_lower = query.lower().strip()
            if query_lower.startswith("select") and "limit" not in query_lower:
                query = f"{query.rstrip(';')} LIMIT {limit}"

            result = conn.execute(query)
            if result.description is None:  # a statement with no result set
                return {"columns": [], "rows": [], "rowCount": 0}

            # Get column names
            columns = [desc[0] for desc in result.description]

            # Fetch rows and convert to JSON-serializable format; never more
            # than `limit`, whatever the query.
            rows = []
            for row in result.fetchmany(limit):
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
        finally:
            conn.close()

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

    def get_geoparquet_info(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
    ) -> dict[str, Any] | None:
        """Read a Parquet file's GeoParquet footer, or None if it isn't GeoParquet.

        Returns {'geo': <the parsed "geo" key-value metadata>, 'rowCount'}.
        Only the footer is fetched (range requests), not the row data.
        """
        geo_rows = self.execute_query(
            f"SELECT decode(value) AS geo FROM parquet_kv_metadata('{s3_path}') "
            "WHERE decode(key) = 'geo'",
            connection_id,
            user=user,
        )["rows"]
        if not geo_rows:
            return None
        count_rows = self.execute_query(
            f"SELECT num_rows FROM parquet_file_metadata('{s3_path}')",
            connection_id,
            user=user,
        )["rows"]
        return {
            "geo": json.loads(geo_rows[0]["geo"]),
            "rowCount": count_rows[0]["num_rows"] if count_rows else None,
        }

    def query_parquet_page(
        self,
        s3_path: str,
        connection_id: str,
        user: "User",
        limit: int,
        offset: int,
        exclude: list[str] | None = None,
    ) -> dict[str, Any]:
        """One page of a Parquet file's rows, for a table: {'fields', 'rows'}.

        DuckDB reads only the row groups the page falls in, so this stays
        cheap on a file of millions of rows. `exclude` drops columns a
        table can't show (a GeoParquet's geometry and bbox columns).
        """
        columns = ", ".join('"' + name.replace('"', '""') + '"' for name in exclude or [])
        select = f"SELECT * EXCLUDE ({columns})" if columns else "SELECT *"
        query = (
            f"{select} FROM read_parquet('{s3_path}') " f"LIMIT {int(limit)} OFFSET {int(offset)}"
        )
        result = self.execute_query(query, connection_id, limit, user=user)
        return {"fields": result["columns"], "rows": result["rows"]}

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
