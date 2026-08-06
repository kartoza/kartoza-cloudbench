"""PostgreSQL service client.

Provides an object-oriented client for PostgreSQL operations,
wrapping psycopg2 connections via pg_service.conf entries.
"""

from typing import Any

import psycopg2

from apps.core.config import get_config
from apps.core.models import PGService


class PGServiceClient:
    """Client for a PostgreSQL service entry."""

    def __init__(self, service: PGService):
        self.service = service

    def _connect(self, dbname: str | None = None) -> Any:
        return psycopg2.connect(
            host=self.service.host,
            port=self.service.port,
            dbname=dbname or self.service.dbname,
            user=self.service.user,
            password=self.service.password,
        )

    def list_databases(self) -> list[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT datname FROM pg_database "
                    "WHERE datistemplate = false ORDER BY datname"
                )
                return [row[0] for row in cur.fetchall()]

    def list_schema_names(self, database: str | None = None) -> list[str]:
        with self._connect(dbname=database) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT schema_name
                    FROM information_schema.schemata
                    WHERE schema_name NOT IN (
                                              'pg_catalog',
                                              'information_schema',
                                              'pg_toast'
                        )
                    ORDER BY schema_name
                    """
                )
                return [row[0] for row in cur.fetchall()]

    def test_connection(self) -> tuple[bool, str]:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT version()")
                    version = cur.fetchone()[0]
                    return True, f"Connected: {version}"
        except Exception as e:
            return False, str(e)

    def get_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version()")
                version = cur.fetchone()[0]

                cur.execute(
                    "SELECT pg_postmaster_start_time(), now() - pg_postmaster_start_time()")
                start_time, uptime = cur.fetchone()

                cur.execute("SHOW max_connections")
                max_connections = int(cur.fetchone()[0])

                cur.execute("""
                            SELECT count(*) FILTER (WHERE state IS NOT NULL), count(*) FILTER (WHERE state = 'active'), count(*) FILTER (WHERE state = 'idle'), count(*) FILTER (WHERE state = 'idle in transaction'), count(*) FILTER (WHERE wait_event_type = 'Lock')
                            FROM pg_stat_activity
                            WHERE datname = current_database()
                            """)
                cur_conn, active, idle, idle_txn, waiting = cur.fetchone()

                cur.execute("""
                            SELECT s.datname,
                                   d.oid,
                                   pg_size_pretty(pg_database_size(s.datname)),
                                   s.xact_commit,
                                   s.xact_rollback,
                                   s.blks_read,
                                   s.blks_hit,
                                   s.tup_returned,
                                   s.tup_fetched,
                                   s.tup_inserted,
                                   s.tup_updated,
                                   s.tup_deleted,
                                   s.numbackends,
                                   CASE
                                       WHEN s.blks_hit + s.blks_read > 0
                                           THEN round(100.0 * s.blks_hit /
                                                      (s.blks_hit + s.blks_read),
                                                      2)::text || '%'
                                       ELSE 'N/A' END
                            FROM pg_stat_database s
                                     JOIN pg_database d ON d.datname = s.datname
                            WHERE s.datname = current_database()
                            """)
                row = cur.fetchone()
                (db_name, db_oid, db_size, xact_commit, xact_rollback,
                 blks_read, blks_hit, tup_returned, tup_fetched,
                 tup_inserted, tup_updated, tup_deleted, num_backends,
                 cache_hit) = row

                cur.execute("""
                            SELECT COALESCE(sum(n_live_tup), 0),
                                   COALESCE(sum(n_dead_tup), 0)
                            FROM pg_stat_user_tables
                            """)
                live_tup, dead_tup = cur.fetchone()

                cur.execute(
                    "SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')")
                table_count = cur.fetchone()[0]

                cur.execute(
                    "SELECT count(*) FROM information_schema.tables WHERE table_type = 'VIEW' AND table_schema NOT IN ('pg_catalog','information_schema')")
                view_count = cur.fetchone()[0]

                cur.execute(
                    "SELECT count(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')")
                index_count = cur.fetchone()[0]

                cur.execute(
                    "SELECT count(*) FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog','information_schema')")
                function_count = cur.fetchone()[0]

                cur.execute(
                    "SELECT count(*) FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')")
                schema_count = cur.fetchone()[0]

                cur.execute("SELECT pg_is_in_recovery()")
                is_in_recovery = cur.fetchone()[0]

                cur.execute(
                    "SELECT name FROM pg_available_extensions WHERE installed_version IS NOT NULL ORDER BY name")
                extensions = [r[0] for r in cur.fetchall()]

                has_postgis = 'postgis' in extensions
                postgis_version = None
                geometry_columns = None
                raster_columns = None
                if has_postgis:
                    try:
                        cur.execute("SELECT PostGIS_Full_Version()")
                        postgis_version = cur.fetchone()[0]
                        cur.execute("SELECT count(*) FROM geometry_columns")
                        geometry_columns = cur.fetchone()[0]
                        cur.execute("SELECT count(*) FROM raster_columns")
                        raster_columns = cur.fetchone()[0]
                    except Exception:
                        pass

                connection_percent = round(100.0 * cur_conn / max_connections,
                                           1) if max_connections else 0

                uptime_str = str(uptime).split('.')[0] if uptime else 'N/A'

                return {
                    "version": version,
                    "server_start_time": start_time.isoformat() if start_time else None,
                    "uptime": uptime_str,
                    "host": self.service.host,
                    "port": str(self.service.port),
                    "database_name": db_name,
                    "database_size": db_size,
                    "database_oid": db_oid,
                    "max_connections": max_connections,
                    "current_connections": cur_conn,
                    "active_connections": active,
                    "idle_connections": idle,
                    "idle_in_transaction_connections": idle_txn,
                    "waiting_connections": waiting,
                    "connection_percent": connection_percent,
                    "num_backends": num_backends,
                    "xact_commit": xact_commit,
                    "xact_rollback": xact_rollback,
                    "blks_read": blks_read,
                    "blks_hit": blks_hit,
                    "tup_returned": tup_returned,
                    "tup_fetched": tup_fetched,
                    "tup_inserted": tup_inserted,
                    "tup_updated": tup_updated,
                    "tup_deleted": tup_deleted,
                    "cache_hit_ratio": cache_hit,
                    "live_tuples": live_tup,
                    "dead_tuples": dead_tup,
                    "table_count": table_count,
                    "view_count": view_count,
                    "index_count": index_count,
                    "function_count": function_count,
                    "schema_count": schema_count,
                    "is_in_recovery": is_in_recovery,
                    "installed_extensions": extensions,
                    "has_postgis": has_postgis,
                    "postgis_version": postgis_version,
                    "geometry_columns": geometry_columns,
                    "raster_columns": raster_columns,
                }

    def get_schema_stats(self, schema: str) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                # Owner
                cur.execute("""
                            SELECT pg_catalog.pg_get_userbyid(n.nspowner)
                            FROM pg_namespace n
                            WHERE n.nspname = %s
                            """, (schema,))
                row = cur.fetchone()
                owner = row[0] if row else ''

                # Table stats
                cur.execute("""
                            SELECT t.table_name,
                                   COALESCE(s.n_live_tup, 0),
                                   pg_size_pretty(pg_total_relation_size(
                                           quote_ident(%s) || '.' ||
                                           quote_ident(t.table_name))),
                                   pg_total_relation_size(quote_ident(%s) ||
                                                          '.' ||
                                                          quote_ident(t.table_name)),
                                   COALESCE(s.n_dead_tup, 0),
                                   s.last_vacuum::text, s.last_autovacuum::text, (SELECT count(*)
                                                                                  FROM pg_indexes i
                                                                                  WHERE i.schemaname = %s
                                                                                    AND i.tablename = t.table_name),
                                   EXISTS(SELECT 1
                                          FROM information_schema.table_constraints tc
                                          WHERE tc.table_schema = %s
                                            AND tc.table_name = t.table_name
                                            AND tc.constraint_type = 'PRIMARY KEY')
                            FROM information_schema.tables t
                                     LEFT JOIN pg_stat_user_tables s
                                               ON s.schemaname =
                                                  t.table_schema AND
                                                  s.relname = t.table_name
                            WHERE t.table_schema = %s
                              AND t.table_type = 'BASE TABLE'
                            ORDER BY t.table_name
                            """, (schema, schema, schema, schema, schema))
                table_rows = cur.fetchall()

                # Geometry info per table
                geom_map: dict[str, dict] = {}
                try:
                    cur.execute("""
                                SELECT f_table_name, type, srid
                                FROM geometry_columns
                                WHERE f_table_schema = %s
                                """, (schema,))
                    for tname, gtype, srid in cur.fetchall():
                        geom_map[tname] = {"geometry_type": gtype,
                                           "srid": srid}
                except Exception:
                    pass

                tables = []
                for (tname, rows, size, size_bytes, dead, last_vac,
                     last_autovac, idx_count, has_pk) in table_rows:
                    geom = geom_map.get(tname, {})
                    tables.append({
                        "name": tname,
                        "row_count": rows,
                        "size": size,
                        "size_bytes": size_bytes,
                        "dead_tuples": dead,
                        "last_vacuum": last_vac,
                        "last_autovacuum": last_autovac,
                        "index_count": idx_count,
                        "has_primary_key": has_pk,
                        "has_geometry": bool(geom),
                        "geometry_type": geom.get("geometry_type"),
                        "srid": geom.get("srid"),
                    })

                # Views
                cur.execute("""
                            SELECT table_name,
                                   EXISTS(SELECT 1
                                          FROM pg_matviews m
                                          WHERE m.schemaname = %s
                                            AND m.matviewname = table_name)
                            FROM information_schema.views
                            WHERE table_schema = %s
                            ORDER BY table_name
                            """, (schema, schema))
                views = [{"name": r[0], "is_materialized": r[1]} for r in
                         cur.fetchall()]

                # Counts
                cur.execute(
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = %s",
                    (schema,))
                index_count = cur.fetchone()[0]

                cur.execute("""
                            SELECT count(*)
                            FROM information_schema.routines
                            WHERE routine_schema = %s
                            """, (schema,))
                function_count = cur.fetchone()[0]

                cur.execute("""
                            SELECT count(*)
                            FROM information_schema.sequences
                            WHERE sequence_schema = %s
                            """, (schema,))
                sequence_count = cur.fetchone()[0]

                cur.execute("""
                            SELECT count(*)
                            FROM information_schema.triggers
                            WHERE trigger_schema = %s
                            """, (schema,))
                trigger_count = cur.fetchone()[0]

                total_size_bytes = sum(t["size_bytes"] for t in tables)
                total_rows = sum(t["row_count"] for t in tables)
                dead_tuples = sum(t["dead_tuples"] for t in tables)

                geometry_columns = len(geom_map)
                raster_columns = 0
                try:
                    cur.execute(
                        "SELECT count(*) FROM raster_columns WHERE r_table_schema = %s",
                        (schema,))
                    raster_columns = cur.fetchone()[0]
                except Exception:
                    pass

                return {
                    "name": schema,
                    "owner": owner,
                    "database_name": self.service.dbname,
                    "table_count": len(tables),
                    "view_count": len(views),
                    "index_count": index_count,
                    "function_count": function_count,
                    "sequence_count": sequence_count,
                    "trigger_count": trigger_count,
                    "total_size": self._format_bytes(total_size_bytes),
                    "total_size_bytes": total_size_bytes,
                    "total_rows": total_rows,
                    "dead_tuples": dead_tuples,
                    "tables": tables,
                    "views": views,
                    "has_postgis": bool(geom_map) or raster_columns > 0,
                    "geometry_columns": geometry_columns,
                    "raster_columns": raster_columns,
                }

    @staticmethod
    def _format_bytes(size_bytes: int) -> str:
        for unit in ('B', 'kB', 'MB', 'GB', 'TB'):
            if size_bytes < 1024:
                return f"{size_bytes:.1f} {unit}"
            size_bytes //= 1024
        return f"{size_bytes} PB"

    def list_schemas(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                            SELECT schema_name
                            FROM information_schema.schemata
                            WHERE schema_name NOT IN (
                                                      'pg_catalog',
                                                      'information_schema',
                                                      'pg_toast'
                                )
                            ORDER BY schema_name
                            """)
                schema_names = [row[0] for row in cur.fetchall()]

                cur.execute("""
                            SELECT t.table_schema,
                                   t.table_name,
                                   t.table_type,
                                   c.column_name,
                                   c.data_type,
                                   c.is_nullable
                            FROM information_schema.tables t
                                     JOIN information_schema.columns c
                                          ON c.table_schema = t.table_schema
                                              AND c.table_name = t.table_name
                            WHERE t.table_schema = ANY (%s)
                              AND t.table_type IN ('BASE TABLE', 'VIEW')
                            ORDER BY t.table_schema, t.table_name,
                                     c.ordinal_position
                            """, (schema_names,))

                schemas: dict[str, dict] = {name: {"name": name, "tables": {}}
                                            for name in schema_names}
                for schema, table, table_type, col_name, col_type, nullable in cur.fetchall():
                    tables = schemas[schema]["tables"]
                    if table not in tables:
                        tables[table] = {
                            "name": table,
                            "schema": schema,
                            "columns": [],
                        }
                    tables[table]["columns"].append({
                        "name": col_name,
                        "type": col_type,
                        "nullable": nullable == "YES",
                    })

                return [
                    {
                        "name": s["name"],
                        "tables": list(s["tables"].values()),
                    }
                    for s in schemas.values()
                ]

    def list_tables(self, schema: str = "public") -> list[dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                            SELECT t.table_name,
                                   t.table_type,
                                   gc.f_geometry_column,
                                   gc.type,
                                   gc.srid
                            FROM information_schema.tables t
                                     LEFT JOIN geometry_columns gc
                                               ON gc.f_table_schema =
                                                  t.table_schema
                                                   AND gc.f_table_name =
                                                       t.table_name
                            WHERE t.table_schema = %s
                              AND t.table_type IN ('BASE TABLE', 'VIEW')
                            ORDER BY t.table_name
                            """, (schema,))
                return [
                    {
                        "name": row[0],
                        "type": row[1],
                        "geometryColumn": row[2],
                        "geometryType": row[3],
                        "srid": row[4],
                        "schema": schema,
                    }
                    for row in cur.fetchall()
                ]

    def get_table_columns(self, schema: str, table: str) -> list[
        dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                            SELECT c.column_name,
                                   c.data_type,
                                   c.is_nullable,
                                   c.column_default,
                                   CASE
                                       WHEN pk.column_name IS NOT NULL
                                           THEN true
                                       ELSE false END
                            FROM information_schema.columns c
                                     LEFT JOIN (SELECT kcu.column_name
                                                FROM information_schema.table_constraints tc
                                                         JOIN information_schema.key_column_usage kcu
                                                              ON tc.constraint_name = kcu.constraint_name
                                                WHERE tc.table_schema = %s
                                                  AND tc.table_name = %s
                                                  AND tc.constraint_type = 'PRIMARY KEY') pk
                                               ON pk.column_name = c.column_name
                            WHERE c.table_schema = %s
                              AND c.table_name = %s
                            ORDER BY c.ordinal_position
                            """, (schema, table, schema, table))

                columns = [
                    {
                        "name": row[0],
                        "dataType": row[1],
                        "isNullable": row[2] == "YES",
                        "default": row[3],
                        "isPrimaryKey": row[4],
                    }
                    for row in cur.fetchall()
                ]

                cur.execute("""
                            SELECT f_geometry_column, type, srid
                            FROM geometry_columns
                            WHERE f_table_schema = %s
                              AND f_table_name = %s
                            """, (schema, table))
                geom = cur.fetchone()
                if geom:
                    for col in columns:
                        if col["name"] == geom[0]:
                            col["isGeometry"] = True
                            col["geometryType"] = geom[1]
                            col["srid"] = geom[2]

                return columns

    def get_table_row_count(self, schema: str, table: str) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                            SELECT reltuples::bigint
                            FROM pg_class c
                                     JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = %s
                              AND c.relname = %s
                            """, (schema, table))
                result = cur.fetchone()
                return result[0] if result else 0

    def get_table_data(
            self,
            schema: str,
            table: str,
            limit: int = 100,
            offset: int = 0,
            order_by: str | None = None,
    ) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
                total = cur.fetchone()[0]

                query = f'SELECT * FROM "{schema}"."{table}"'
                if order_by:
                    query += f' ORDER BY "{order_by}"'
                query += f" LIMIT {limit} OFFSET {offset}"
                cur.execute(query)

                columns = [desc[0] for desc in
                           cur.description] if cur.description else []
                rows = []
                for row in cur.fetchall():
                    row_values = []
                    for value in row:
                        if hasattr(value, "isoformat"):
                            value = value.isoformat()
                        elif isinstance(value, bytes):
                            value = f"<binary {len(value)} bytes>"
                        elif value is not None:
                            value = str(value)
                        row_values.append(value)
                    rows.append(row_values)

                return {
                    "columns": columns,
                    "rows": rows,
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                }

    def execute_query(
            self,
            query: str,
            params: tuple | None = None,
            limit: int = 1000,
    ) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                query_lower = query.lower().strip()
                if "limit" not in query_lower and query_lower.startswith(
                        "select"):
                    query = f"{query.rstrip(';')} LIMIT {limit}"

                cur.execute(query, params)
                columns = [desc[0] for desc in
                           cur.description] if cur.description else []
                rows = []
                for row in cur.fetchall():
                    row_dict = {}
                    for i, col in enumerate(columns):
                        value = row[i]
                        if hasattr(value, "isoformat"):
                            value = value.isoformat()
                        elif isinstance(value, bytes):
                            value = value.hex()
                        row_dict[col] = value
                    rows.append(row_dict)

                return {
                    "columns": columns,
                    "rows": rows,
                    "rowCount": len(rows),
                }


def get_pg_client(service_name: str,
                  user_id: str = "default") -> PGServiceClient:
    """Get a PGServiceClient for a named service."""
    service = get_config(user_id).get_pg_service(service_name)
    if not service:
        raise ValueError(f"PostgreSQL service not found: {service_name}")
    return PGServiceClient(service)


def list_pg_services(user_id: str = "default"):
    return get_config(user_id).list_pg_services()


def add_pg_service(service: PGService, user_id: str = "default") -> None:
    get_config(user_id).add_pg_service(service)


def update_pg_service(service: PGService, user_id: str = "default") -> None:
    get_config(user_id).update_pg_service(service)


def delete_pg_service(service_name: str, user_id: str = "default") -> bool:
    return get_config(user_id).delete_pg_service(service_name)
