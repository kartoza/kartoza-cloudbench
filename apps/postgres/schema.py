"""PostgreSQL schema harvesting.

Provides functionality to introspect PostgreSQL database schemas,
tables, columns, and geometry information.
"""

from dataclasses import dataclass
from typing import Any

import psycopg2

from apps.core.models import PGService
from .service import get_service


@dataclass
class Column:
    """Database column information."""

    name: str
    data_type: str
    is_nullable: bool
    is_primary_key: bool = False
    is_geometry: bool = False
    geometry_type: str = ""
    srid: int = 0


@dataclass
class Table:
    """Database table information."""

    schema: str
    name: str
    columns: list[Column]
    geometry_column: str = ""
    geometry_type: str = ""
    srid: int = 0
    row_count: int = 0

    @property
    def full_name(self) -> str:
        """Get fully qualified table name."""
        return f"{self.schema}.{self.name}"

    @property
    def has_geometry(self) -> bool:
        """Check if table has geometry column."""
        return bool(self.geometry_column)


@dataclass
class Schema:
    """Database schema information."""

    name: str
    tables: list[Table]


def get_connection(service_name: str) -> Any:
    """Get a database connection for a service.

    Args:
        service_name: PostgreSQL service name

    Returns:
        psycopg connection

    Raises:
        ValueError: If service not found
        psycopg2.Error: If connection fails
    """
    service = get_service(service_name)
    if not service:
        raise ValueError(f"Service not found: {service_name}")

    return psycopg2.connect(
        host=service.host,
        port=service.port,
        dbname=service.dbname,
        user=service.user,
        password=service.password,
    )


def list_schemas(service_name: str) -> list[str]:
    """List all schemas in the database.

    Args:
        service_name: PostgreSQL service name

    Returns:
        List of schema names
    """
    with get_connection(service_name) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                ORDER BY schema_name
            """)
            return [row[0] for row in cur.fetchall()]


def list_tables(service_name: str, schema: str = "public") -> list[dict[str, Any]]:
    """List all tables in a schema.

    Args:
        service_name: PostgreSQL service name
        schema: Schema name (default: public)

    Returns:
        List of table information dictionaries
    """
    with get_connection(service_name) as conn:
        with conn.cursor() as cur:
            # Get tables with geometry info from geometry_columns
            cur.execute("""
                SELECT
                    t.table_name,
                    t.table_type,
                    gc.f_geometry_column,
                    gc.type,
                    gc.srid
                FROM information_schema.tables t
                LEFT JOIN geometry_columns gc
                    ON gc.f_table_schema = t.table_schema
                    AND gc.f_table_name = t.table_name
                WHERE t.table_schema = %s
                    AND t.table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY t.table_name
            """, (schema,))

            tables = []
            for row in cur.fetchall():
                tables.append({
                    "name": row[0],
                    "type": row[1],
                    "geometryColumn": row[2],
                    "geometryType": row[3],
                    "srid": row[4],
                    "schema": schema,
                })

            return tables


def get_table_columns(
    service_name: str,
    schema: str,
    table: str,
) -> list[dict[str, Any]]:
    """Get columns for a table.

    Args:
        service_name: PostgreSQL service name
        schema: Schema name
        table: Table name

    Returns:
        List of column information dictionaries
    """
    with get_connection(service_name) as conn:
        with conn.cursor() as cur:
            # Get column info
            cur.execute("""
                SELECT
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    c.column_default,
                    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                    WHERE tc.table_schema = %s
                        AND tc.table_name = %s
                        AND tc.constraint_type = 'PRIMARY KEY'
                ) pk ON pk.column_name = c.column_name
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position
            """, (schema, table, schema, table))

            columns = []
            for row in cur.fetchall():
                columns.append({
                    "name": row[0],
                    "dataType": row[1],
                    "isNullable": row[2] == "YES",
                    "default": row[3],
                    "isPrimaryKey": row[4],
                })

            # Check for geometry columns
            cur.execute("""
                SELECT f_geometry_column, type, srid
                FROM geometry_columns
                WHERE f_table_schema = %s AND f_table_name = %s
            """, (schema, table))

            geom_info = cur.fetchone()
            if geom_info:
                for col in columns:
                    if col["name"] == geom_info[0]:
                        col["isGeometry"] = True
                        col["geometryType"] = geom_info[1]
                        col["srid"] = geom_info[2]

            return columns


def get_table_row_count(service_name: str, schema: str, table: str) -> int:
    """Get approximate row count for a table.

    Args:
        service_name: PostgreSQL service name
        schema: Schema name
        table: Table name

    Returns:
        Approximate row count
    """
    with get_connection(service_name) as conn:
        with conn.cursor() as cur:
            # Use pg_class for fast approximate count
            cur.execute("""
                SELECT reltuples::bigint
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = %s AND c.relname = %s
            """, (schema, table))

            result = cur.fetchone()
            return result[0] if result else 0


def execute_query(
    service_name: str,
    query: str,
    params: tuple | None = None,
    limit: int = 1000,
) -> dict[str, Any]:
    """Execute a query and return results.

    Args:
        service_name: PostgreSQL service name
        query: SQL query
        params: Query parameters
        limit: Maximum rows to return

    Returns:
        Dictionary with columns and rows
    """
    with get_connection(service_name) as conn:
        with conn.cursor() as cur:
            # Add limit if not present
            query_lower = query.lower().strip()
            if "limit" not in query_lower and query_lower.startswith("select"):
                query = f"{query.rstrip(';')} LIMIT {limit}"

            cur.execute(query, params)

            # Get column names
            columns = [desc[0] for desc in cur.description] if cur.description else []

            # Fetch rows
            rows = cur.fetchall()

            # Convert to list of dicts
            result_rows = []
            for row in rows:
                row_dict = {}
                for i, col in enumerate(columns):
                    value = row[i]
                    # Handle special types
                    if hasattr(value, "isoformat"):
                        value = value.isoformat()
                    elif isinstance(value, bytes):
                        value = value.hex()
                    row_dict[col] = value
                result_rows.append(row_dict)

            return {
                "columns": columns,
                "rows": result_rows,
                "rowCount": len(result_rows),
            }


def get_table_data(
    service_name: str,
    schema: str,
    table: str,
    limit: int = 100,
    offset: int = 0,
    order_by: str | None = None,
) -> dict[str, Any]:
    """Get data from a table with pagination.

    Args:
        service_name: PostgreSQL service name
        schema: Schema name
        table: Table name
        limit: Number of rows to return
        offset: Number of rows to skip
        order_by: Optional column to order by

    Returns:
        Dictionary with columns, rows, and total count
    """
    with get_connection(service_name) as conn:
        with conn.cursor() as cur:
            # Get total count
            cur.execute(
                f'SELECT COUNT(*) FROM "{schema}"."{table}"'
            )
            total = cur.fetchone()[0]

            # Build query
            query = f'SELECT * FROM "{schema}"."{table}"'
            if order_by:
                query += f' ORDER BY "{order_by}"'
            query += f" LIMIT {limit} OFFSET {offset}"

            cur.execute(query)

            # Get column names
            columns = [desc[0] for desc in cur.description] if cur.description else []

            # Fetch rows
            rows = cur.fetchall()

            # Convert to list of lists (for table display)
            result_rows = []
            for row in rows:
                row_values = []
                for value in row:
                    if hasattr(value, "isoformat"):
                        value = value.isoformat()
                    elif isinstance(value, bytes):
                        value = f"<binary {len(value)} bytes>"
                    elif value is None:
                        value = None
                    else:
                        value = str(value)
                    row_values.append(value)
                result_rows.append(row_values)

            return {
                "columns": columns,
                "rows": result_rows,
                "total": total,
                "limit": limit,
                "offset": offset,
            }


def test_connection(service_name: str) -> tuple[bool, str]:
    """Test a database connection.

    Args:
        service_name: PostgreSQL service name

    Returns:
        Tuple of (success, message)
    """
    try:
        with get_connection(service_name) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version()")
                version = cur.fetchone()[0]
                return True, f"Connected: {version}"
    except Exception as e:
        return False, str(e)
