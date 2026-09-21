"""Unit tests for the PostgreSQL service client, schema helpers and pg_service.conf parsing."""

from datetime import UTC, datetime, timedelta

import pytest

from apps.core.models import PGService
from apps.postgres import client as pgclient
from apps.postgres import schema as pgschema
from apps.postgres import service as pgservice


@pytest.fixture
def svc() -> PGService:
    return PGService(name="s", host="db.test", port=5433, dbname="gis", user="u", password="p")


@pytest.fixture
def pg(svc) -> pgclient.PGServiceClient:
    return pgclient.PGServiceClient(svc)


@pytest.mark.unit
class TestPGServiceClient:
    def test_connect_uses_service_settings(self, pg, fake_pg):
        pg.list_databases()
        assert fake_pg.connect_kwargs[0] == {
            "host": "db.test",
            "port": 5433,
            "dbname": "gis",
            "user": "u",
            "password": "p",
        }

    def test_list_databases_and_schema_names(self, pg, fake_pg):
        fake_pg.add("pg_database", [("a",), ("b",)])
        fake_pg.add("information_schema.schemata", [("public",)])
        assert pg.list_databases() == ["a", "b"]
        assert pg.list_schema_names(database="other") == ["public"]
        assert fake_pg.connect_kwargs[-1]["dbname"] == "other"

    def test_test_connection(self, pg, fake_pg):
        fake_pg.add("select version()", [("PostgreSQL 16",)])
        assert pg.test_connection() == (True, "Connected: PostgreSQL 16")

    def test_test_connection_failure(self, pg, fake_pg):
        fake_pg.add("select version()", RuntimeError("refused"))
        assert pg.test_connection() == (False, "refused")

    def test_list_tables_and_schemas(self, pg, fake_pg):
        fake_pg.add(
            "geometry_columns gc",
            [("t", "BASE TABLE", "geom", "POINT", 4326), ("v", "VIEW", None, None, None)],
        )
        tables = pg.list_tables("public")
        assert tables[0] == {
            "name": "t",
            "type": "BASE TABLE",
            "geometryColumn": "geom",
            "geometryType": "POINT",
            "srid": 4326,
            "schema": "public",
        }
        fake_pg.add("select schema_name", [("public",), ("empty",)])
        fake_pg.add(
            "join information_schema.columns c",
            [
                ("public", "t", "BASE TABLE", "id", "integer", "NO"),
                ("public", "t", "BASE TABLE", "name", "text", "YES"),
            ],
        )
        schemas = pg.list_schemas()
        assert schemas[0]["tables"][0]["columns"][1] == {
            "name": "name",
            "type": "text",
            "nullable": True,
        }
        assert schemas[1]["tables"] == []

    def test_get_table_columns_marks_geometry(self, pg, fake_pg):
        fake_pg.add(
            "information_schema.columns c",
            [("id", "integer", "NO", None, True), ("geom", "USER-DEFINED", "YES", None, False)],
        )
        fake_pg.add("from geometry_columns", [("geom", "POLYGON", 3857)])
        cols = pg.get_table_columns("public", "t")
        assert cols[0]["isPrimaryKey"] is True and "isGeometry" not in cols[0]
        assert cols[1]["isGeometry"] and cols[1]["geometryType"] == "POLYGON"

    def test_get_table_columns_without_geometry(self, pg, fake_pg):
        fake_pg.add("information_schema.columns c", [("id", "integer", "NO", None, True)])
        assert "isGeometry" not in pg.get_table_columns("public", "t")[0]

    def test_row_count(self, pg, fake_pg):
        fake_pg.add("reltuples", [(42,)])
        assert pg.get_table_row_count("public", "t") == 42
        fake_pg.rules.clear()
        assert pg.get_table_row_count("public", "t") == 0

    def test_get_table_data_formats_values(self, pg, fake_pg):
        when = datetime(2024, 1, 1, tzinfo=UTC)
        fake_pg.add("count(*)", [(3,)])
        fake_pg.add("limit 5 offset 10", [(1, when, b"abc", None)], columns=["a", "b", "c", "d"])
        data = pg.get_table_data("public", "t", limit=5, offset=10, order_by="a")
        assert data["total"] == 3
        assert data["columns"] == ["a", "b", "c", "d"]
        assert data["rows"] == [["1", when.isoformat(), "<binary 3 bytes>", None]]
        assert 'order by "a"' in fake_pg.queries[-1][0].lower()

    def test_execute_query_adds_limit_and_serialises(self, pg, fake_pg):
        when = datetime(2024, 1, 1, tzinfo=UTC)
        fake_pg.add("select", [(1, when, b"\x01")], columns=["a", "b", "c"])
        result = pg.execute_query("SELECT * FROM t;", limit=7)
        assert fake_pg.queries[-1][0].endswith("LIMIT 7")
        assert result["rows"] == [{"a": 1, "b": when.isoformat(), "c": "01"}]
        assert result["rowCount"] == 1

    def test_execute_query_keeps_existing_limit_and_non_select(self, pg, fake_pg):
        pg.execute_query("SELECT 1 LIMIT 1")
        assert fake_pg.queries[-1][0] == "SELECT 1 LIMIT 1"
        result = pg.execute_query("UPDATE t SET a=1")
        assert fake_pg.queries[-1][0] == "UPDATE t SET a=1"
        assert result == {"columns": [], "rows": [], "rowCount": 0}

    @pytest.mark.parametrize(
        ("size", "expected"),
        [(10, "10.0 B"), (2048, "2.0 kB"), (5 * 1024**2, "5.0 MB"), (1024**6, "1024 PB")],
    )
    def test_format_bytes(self, size, expected):
        assert pgclient.PGServiceClient._format_bytes(size) == expected

    def test_get_stats(self, pg, fake_pg):
        start = datetime(2024, 1, 1, tzinfo=UTC)
        fake_pg.add("select version()", [("PG 16",)])
        fake_pg.add(
            "pg_postmaster_start_time", [(start, timedelta(days=1, seconds=5, microseconds=9))]
        )
        fake_pg.add("show max_connections", [("100",)])
        fake_pg.add("from pg_stat_activity", [(10, 4, 5, 1, 0)])
        fake_pg.add(
            "from pg_stat_database",
            [("gis", 1234, "10 MB", 1, 2, 3, 4, 5, 6, 7, 8, 9, 3, "99%")],
        )
        fake_pg.add("pg_stat_user_tables", [(100, 5)])
        fake_pg.add("table_type = 'base table'", [(4,)])
        fake_pg.add("table_type = 'view'", [(2,)])
        fake_pg.add("from pg_indexes", [(7,)])
        fake_pg.add("information_schema.routines", [(3,)])
        fake_pg.add("information_schema.schemata", [(2,)])
        fake_pg.add("pg_is_in_recovery", [(False,)])
        fake_pg.add("pg_available_extensions", [("plpgsql",), ("postgis",)])
        fake_pg.add("postgis_full_version", [("POSTGIS 3",)])
        fake_pg.add("from geometry_columns", [(6,)])
        fake_pg.add("from raster_columns", [(1,)])
        stats = pg.get_stats()
        assert stats["version"] == "PG 16"
        assert stats["uptime"] == "1 day, 0:00:05"
        assert stats["connection_percent"] == 10.0
        assert stats["has_postgis"] is True and stats["geometry_columns"] == 6
        assert stats["installed_extensions"] == ["plpgsql", "postgis"]

    def test_get_stats_without_postgis(self, pg, fake_pg):
        start = datetime(2024, 1, 1, tzinfo=UTC)
        fake_pg.add("select version()", [("PG",)])
        fake_pg.add("pg_postmaster_start_time", [(start, None)])
        fake_pg.add("show max_connections", [("0",)])
        fake_pg.add("from pg_stat_activity", [(0, 0, 0, 0, 0)])
        fake_pg.add(
            "from pg_stat_database", [("gis", 1, "1 MB", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "N/A")]
        )
        fake_pg.add("pg_stat_user_tables", [(0, 0)])
        fake_pg.add("pg_is_in_recovery", [(True,)])
        for fragment in ("table_type", "pg_indexes", "routines", "schemata"):
            fake_pg.add(fragment, [(0,)])
        stats = pg.get_stats()
        assert stats["has_postgis"] is False and stats["uptime"] == "N/A"
        assert stats["connection_percent"] == 0

    def test_get_stats_postgis_query_failure_is_tolerated(self, pg, fake_pg):
        start = datetime(2024, 1, 1, tzinfo=UTC)
        fake_pg.add("select version()", [("PG",)])
        fake_pg.add("pg_postmaster_start_time", [(start, timedelta(seconds=1))])
        fake_pg.add("show max_connections", [("10",)])
        fake_pg.add("from pg_stat_activity", [(1, 1, 0, 0, 0)])
        fake_pg.add(
            "from pg_stat_database", [("gis", 1, "1 MB", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "N/A")]
        )
        fake_pg.add("pg_stat_user_tables", [(0, 0)])
        fake_pg.add("pg_available_extensions", [("postgis",)])
        fake_pg.add("postgis_full_version", RuntimeError("no postgis"))
        fake_pg.add("pg_is_in_recovery", [(False,)])
        for fragment in ("table_type", "pg_indexes", "routines", "schemata"):
            fake_pg.add(fragment, [(0,)])
        stats = pg.get_stats()
        assert stats["postgis_version"] is None

    def test_get_schema_stats(self, pg, fake_pg):
        fake_pg.add("pg_get_userbyid", [("owner",)])
        fake_pg.add(
            "from information_schema.tables t",
            [
                ("a", 10, "8 kB", 8192, 1, "v", "av", 2, True),
                ("b", 0, "0 B", 0, 0, None, None, 0, False),
            ],
        )
        fake_pg.add("f_table_name, type, srid", [("a", "POINT", 4326)])
        fake_pg.add("from information_schema.views", [("v1", False), ("v2", True)])
        fake_pg.add("from pg_indexes", [(3,)])
        fake_pg.add("information_schema.routines", [(1,)])
        fake_pg.add("information_schema.sequences", [(2,)])
        fake_pg.add("information_schema.triggers", [(0,)])
        fake_pg.add("from raster_columns", [(1,)])
        stats = pg.get_schema_stats("public")
        assert stats["owner"] == "owner"
        assert stats["table_count"] == 2 and stats["view_count"] == 2
        assert stats["tables"][0]["geometry_type"] == "POINT"
        assert stats["tables"][1]["has_geometry"] is False
        assert stats["total_rows"] == 10 and stats["has_postgis"] is True
        assert stats["total_size"] == "8.0 kB"

    def test_get_schema_stats_without_postgis_tables(self, pg, fake_pg):
        fake_pg.add("from information_schema.tables t", [])
        fake_pg.add("f_table_name, type, srid", RuntimeError("no geometry_columns"))
        fake_pg.add("from raster_columns", RuntimeError("no raster_columns"))
        for fragment in ("from pg_indexes", "routines", "sequences", "triggers"):
            fake_pg.add(fragment, [(0,)])
        stats = pg.get_schema_stats("empty")
        assert stats["owner"] == "" and stats["has_postgis"] is False


@pytest.mark.unit
class TestClientHelpers:
    def test_get_pg_client(self, config_manager, svc):
        config_manager.add_pg_service(svc)
        assert isinstance(pgclient.get_pg_client("s", "test-user"), pgclient.PGServiceClient)
        with pytest.raises(ValueError, match="not found"):
            pgclient.get_pg_client("missing", "test-user")

    def test_service_crud_helpers(self, config_manager, svc):
        pgclient.add_pg_service(svc, "test-user")
        assert [s.name for s in pgclient.list_pg_services("test-user")] == ["s"]
        updated = svc.model_copy(update={"host": "other"})
        pgclient.update_pg_service(updated, "test-user")
        assert pgclient.list_pg_services("test-user")[0].host == "other"
        assert pgclient.delete_pg_service("s", "test-user") is True
        assert pgclient.delete_pg_service("s", "test-user") is False


@pytest.fixture
def conf(tmp_path, monkeypatch):
    path = tmp_path / "pg_service.conf"
    path.write_text(
        "# comment\n[one]\nhost=h1\nport=5433\ndatabase=d1\nuser=u\npassword=p\nsslmode=require\n"
        "application_name=cb\n\n; other comment\n[two]\nhost = h2\ndbname = d2\n\n[empty]\n"
    )
    monkeypatch.setenv("PGSERVICEFILE", str(path))
    return path


@pytest.mark.unit
class TestPgServiceFile:
    def test_paths_include_env_file(self, conf):
        assert pgservice.get_pg_service_file_paths()[0] == conf

    def test_find_service_file(self, conf, monkeypatch, tmp_path):
        assert pgservice.find_pg_service_file() == conf
        empty = tmp_path / "empty"
        empty.mkdir()
        monkeypatch.setenv("PGSERVICEFILE", str(empty / "missing"))
        monkeypatch.setenv("HOME", str(empty))
        monkeypatch.setenv("PGSYSCONFDIR", str(empty))
        assert pgservice.find_pg_service_file() in (None, pgservice.Path("/etc/pg_service.conf"))

    def test_parse(self, conf):
        services = pgservice.parse_pg_service_file(conf)
        assert set(services) == {"one", "two"}  # empty section skipped
        one = services["one"]
        assert (one.host, one.port, one.dbname, one.sslmode) == ("h1", 5433, "d1", "require")
        assert one.options == {"application_name": "cb"}
        assert services["two"].port == 5432

    def test_parse_missing_file(self, tmp_path):
        assert pgservice.parse_pg_service_file(tmp_path / "nope") == {}

    def test_list_and_get_service(self, conf):
        assert pgservice.list_services() == ["one", "two"]
        assert pgservice.get_service("two").host == "h2"
        assert pgservice.get_service("zzz") is None

    def test_write_and_delete_service(self, tmp_path):
        path = tmp_path / "out.conf"
        pgservice.write_service(
            PGService(
                name="a",
                host="h",
                dbname="d",
                user="u",
                password="p",
                sslmode="prefer",
                options={"x": "1"},
            ),
            path,
        )
        pgservice.write_service(PGService(name="b"), path)
        parsed = pgservice.parse_pg_service_file(path)
        assert parsed["a"].options == {"x": "1"} and parsed["a"].sslmode == "prefer"
        assert parsed["b"].host == "localhost" and parsed["b"].dbname == ""
        assert pgservice.delete_service("a", path) is True
        assert pgservice.delete_service("a", path) is False
        assert pgservice.delete_service("a", tmp_path / "missing") is False


@pytest.mark.unit
class TestSchemaModule:
    @pytest.fixture(autouse=True)
    def _service(self, monkeypatch, svc):
        monkeypatch.setattr(pgschema, "get_service", lambda name: svc if name == "s" else None)

    def test_dataclass_properties(self):
        table = pgschema.Table("public", "t", [], geometry_column="geom")
        assert table.full_name == "public.t" and table.has_geometry
        assert not pgschema.Table("public", "t", []).has_geometry

    def test_unknown_service(self):
        with pytest.raises(ValueError, match="not found"):
            pgschema.list_schemas("missing")

    def test_list_schemas_and_tables(self, fake_pg):
        fake_pg.add("select schema_name", [("public",)])
        fake_pg.add("geometry_columns gc", [("t", "BASE TABLE", None, None, None)])
        assert pgschema.list_schemas("s") == ["public"]
        assert pgschema.list_tables("s")[0]["schema"] == "public"

    def test_columns_and_row_count(self, fake_pg):
        fake_pg.add("information_schema.columns c", [("geom", "USER-DEFINED", "YES", None, False)])
        fake_pg.add("from geometry_columns", [("geom", "POINT", 4326)])
        fake_pg.add("reltuples", [(9,)])
        cols = pgschema.get_table_columns("s", "public", "t")
        assert cols[0]["srid"] == 4326
        assert pgschema.get_table_row_count("s", "public", "t") == 9

    def test_execute_query_and_table_data(self, fake_pg):
        when = datetime(2024, 1, 1, tzinfo=UTC)
        fake_pg.add("select 1", [(1, when, b"\x01")], columns=["a", "b", "c"])
        result = pgschema.execute_query("s", "select 1;", limit=5)
        assert result["rows"][0] == {"a": 1, "b": when.isoformat(), "c": "01"}
        fake_pg.add("count(*)", [(2,)])
        fake_pg.add("limit 1 offset 0", [(None, b"ab", 3, when)], columns=["a", "b", "c", "d"])
        data = pgschema.get_table_data("s", "public", "t", limit=1, order_by="a")
        assert data["rows"][0] == [None, "<binary 2 bytes>", "3", when.isoformat()]

    def test_test_connection(self, fake_pg):
        fake_pg.add("select version()", [("PG",)])
        assert pgschema.test_connection("s") == (True, "Connected: PG")
        assert pgschema.test_connection("missing")[0] is False
