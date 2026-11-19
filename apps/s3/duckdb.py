"""DuckDB integration for querying S3 data.

Provides functionality to query Parquet, GeoParquet, CSV, and JSON
files stored in S3-compatible storage using DuckDB.

Users send their own SQL, so each query gets its own in-memory connection with
only that user's S3 credentials, closed afterwards. It reads s3:// only (no local
files, no http(s) URLs into the cluster), memory-limited and locked.
"""

import json
import os
import threading
from typing import TYPE_CHECKING, Any, cast

import duckdb
from django.conf import settings
from django.core.exceptions import ValidationError

from .models import S3Connection

if TYPE_CHECKING:
    from django.contrib.auth.models import User

EXTENSIONS = ("httpfs", "spatial")

# With external access off, httpfs can't read the CA bundle and https:// S3 fails TLS;
# the bundle found here is allowed.
CA_BUNDLES = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
)


def _ca_bundle() -> str | None:
    return next((path for path in CA_BUNDLES if os.path.isfile(path)), None)


def _quote(value: str) -> str:
    """A SQL string literal (CREATE SECRET takes no parameters)."""
    return "'" + str(value).replace("'", "''") + "'"


def _ident(name: str) -> str:
    """A quoted SQL identifier."""
    return '"' + str(name).replace('"', '""') + '"'


def _json_value(value: Any) -> Any:
    """A DuckDB value as JSON can carry it."""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    return value


def _rows(columns: list[str], rows: list[tuple]) -> list[dict[str, Any]]:
    return [{col: _json_value(row[i]) for i, col in enumerate(columns)} for row in rows]


def _user_sql(sql: str) -> str:
    """The user's query, ready to wrap in a subquery."""
    sql = sql.strip()
    while sql.endswith(";"):
        sql = sql[:-1].rstrip()
    if not sql:
        raise ValueError("SQL query is required")
    return sql


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
            ca_bundle = _ca_bundle()
            if ca_bundle:
                conn.execute(f"SET allowed_paths=[{_quote(ca_bundle)}]")
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

            # JSON-serializable rows; never more than `limit`, whatever the query.
            rows = _rows(columns, result.fetchmany(limit))

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


# The query panel (DuckDBQueryPanel): the user's SQL on one Parquet file, called `data`.


def _open_data(
    engine: DuckDBQueryEngine, source: str, connection_id: str | None, user: "User | None"
) -> duckdb.DuckDBPyConnection:
    """A sandboxed connection on which `data` is the Parquet file at `source`."""
    conn = engine.connect(connection_id, user)
    try:
        conn.execute(f"CREATE TEMP VIEW data AS SELECT * FROM read_parquet({_quote(source)})")
    except Exception:
        conn.close()
        raise
    return conn


def _describe(conn: duckdb.DuckDBPyConnection, sql: str) -> list[tuple[str, str]]:
    """(name, type) of each column the query returns, without running it."""
    return [(row[0], str(row[1])) for row in conn.execute(f"DESCRIBE {sql}").fetchall()]


def _geometry_columns(columns: list[tuple[str, str]]) -> list[str]:
    return [name for name, type_ in columns if type_.upper().startswith("GEOMETRY")]


def data_table_info(
    source: str, connection_id: str | None = None, user: "User | None" = None
) -> dict[str, Any]:
    """Columns, row count, geometry column, bbox and sample queries of `data`."""
    conn = _open_data(get_duckdb_engine(), source, connection_id, user)
    try:
        columns = _describe(conn, "SELECT * FROM data")
        row_count = conn.execute(
            f"SELECT sum(num_rows) FROM parquet_file_metadata({_quote(source)})"
        ).fetchone()[0]
        geo_rows = conn.execute(
            f"SELECT decode(value) FROM parquet_kv_metadata({_quote(source)}) "
            "WHERE decode(key) = 'geo'"
        ).fetchall()
    finally:
        conn.close()

    geometry = _geometry_columns(columns)
    geometry_column = geometry[0] if geometry else None
    bbox = None
    if geo_rows:
        geo = json.loads(geo_rows[0][0])
        geometry_column = geo.get("primary_column") or geometry_column
        column_bbox = (geo.get("columns") or {}).get(geometry_column, {}).get("bbox")
        if isinstance(column_bbox, list) and len(column_bbox) == 4:
            bbox = column_bbox

    samples = ["SELECT * FROM data LIMIT 100", "SELECT COUNT(*) AS count FROM data"]
    if geometry_column:
        g = _ident(geometry_column)
        samples.append(
            f"SELECT * EXCLUDE ({g}), ST_GeometryType({g}) AS geometry_type FROM data LIMIT 100"
        )

    info: dict[str, Any] = {
        "columns": [{"name": name, "type": type_} for name, type_ in columns],
        "rowCount": int(row_count or 0),
        "sampleQueries": samples,
    }
    if geometry_column:
        info["geometryColumn"] = geometry_column
    if bbox:
        info["bbox"] = bbox
    return info


def query_data(
    source: str,
    sql: str,
    connection_id: str | None = None,
    user: "User | None" = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """One page of the user's query on `data`, geometries as WKT.

    {columns, columnTypes, rows, rowCount, hasMore, geometryColumn?}
    """
    sql = _user_sql(sql)
    limit, offset = max(1, int(limit)), max(0, int(offset))
    conn = _open_data(get_duckdb_engine(), source, connection_id, user)
    try:
        columns = _describe(conn, sql)
        geometry = _geometry_columns(columns)
        select = "SELECT *"
        if geometry:
            replace = ", ".join(f"ST_AsText({_ident(g)}) AS {_ident(g)}" for g in geometry)
            select = f"SELECT * REPLACE ({replace})"
        result = conn.execute(f"{select} FROM ({sql}) LIMIT {limit + 1} OFFSET {offset}")
        names = [desc[0] for desc in result.description]
        rows = result.fetchmany(limit + 1)
    finally:
        conn.close()

    response: dict[str, Any] = {
        "columns": names,
        "columnTypes": [type_ for _name, type_ in columns],
        "rows": _rows(names, rows[:limit]),
        "rowCount": min(len(rows), limit),
        "hasMore": len(rows) > limit,
    }
    if geometry:
        response["geometryColumn"] = geometry[0]
    return response


def query_data_geojson(
    source: str,
    sql: str,
    connection_id: str | None = None,
    user: "User | None" = None,
    limit: int = 1000,
) -> dict[str, Any]:
    """The user's query on `data` as a GeoJSON FeatureCollection, for the map."""
    sql = _user_sql(sql)
    limit = max(1, int(limit))
    conn = _open_data(get_duckdb_engine(), source, connection_id, user)
    try:
        geometry = _geometry_columns(_describe(conn, sql))
        if not geometry:
            return {"type": "FeatureCollection", "features": []}
        exclude = ", ".join(_ident(g) for g in geometry)
        result = conn.execute(
            f"SELECT * EXCLUDE ({exclude}), ST_AsGeoJSON({_ident(geometry[0])}) "
            f"AS __cloudbench_geometry FROM ({sql}) LIMIT {limit}"
        )
        names = [desc[0] for desc in result.description]
        rows = _rows(names, result.fetchmany(limit))
    finally:
        conn.close()

    features = []
    for row in rows:
        geom = row.pop("__cloudbench_geometry", None)
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(geom) if isinstance(geom, str) else geom,
                "properties": row,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def get_duckdb_engine() -> DuckDBQueryEngine:
    """Get the DuckDB query engine singleton.

    Returns:
        DuckDBQueryEngine instance
    """
    return DuckDBQueryEngine()
