"""Unit tests for the AI query engine (Ollama) and the DuckDB S3 query engine."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import duckdb
import httpx
import pytest

from apps.ai import engine as ai
from apps.s3 import duckdb as ddb
from apps.s3.models import S3Connection

OLLAMA = "http://ollama.test:11434"
# Opaque stand-in: these tests only check the user is passed through.
USER = SimpleNamespace(username="alice")


@pytest.mark.unit
class TestOllamaClient:
    @pytest.fixture
    def ollama(self):
        return ai.OllamaClient(OLLAMA + "/", "m")

    def test_is_available(self, ollama, http_mock):
        http_mock.add("GET", "/api/tags", json={"models": []})
        assert ollama.is_available() is True
        http_mock.add("GET", "/api/tags", status=500)
        assert ollama.is_available() is False
        http_mock.add("GET", "/api/tags", exc=httpx.ConnectError("x"))
        assert ollama.is_available() is False

    def test_list_models(self, ollama, http_mock):
        http_mock.add("GET", "/api/tags", json={"models": [{"name": "a"}]})
        assert ollama.list_models() == [{"name": "a"}]
        http_mock.add("GET", "/api/tags", status=500)
        assert ollama.list_models() == []

    def test_generate_and_chat(self, ollama, http_mock):
        http_mock.add("POST", "/api/generate", json={"response": "SELECT 1"})
        http_mock.add("POST", "/api/chat", json={"message": {"content": "hi"}})
        assert ollama.generate("q", system="sys", max_tokens=5) == "SELECT 1"
        body = json.loads(http_mock.calls[0].content)
        assert body["system"] == "sys" and body["options"]["num_predict"] == 5
        assert ollama.chat([{"role": "user", "content": "x"}]) == "hi"

    def test_generate_error(self, ollama, http_mock):
        http_mock.add("POST", "/api/generate", status=500)
        with pytest.raises(httpx.HTTPStatusError):
            ollama.generate("q")


@pytest.mark.unit
class TestAIQueryEngine:
    @pytest.fixture
    def engine(self):
        return ai.AIQueryEngine(OLLAMA, "m")

    def test_generate_sql_cleans_and_explains(self, engine, http_mock):
        http_mock.add("POST", "/api/generate", json={"response": "```sql\nSELECT * FROM t\n```"})
        result = engine.generate_sql(
            "all rows", "Table: t", examples=[{"question": "q", "sql": "select 1"}]
        )
        assert result.sql == "SELECT * FROM t;"
        assert "LIMIT" in result.warnings[0]
        prompt = json.loads(http_mock.calls[0].content)["prompt"]
        assert "Examples:" in prompt and "Question: all rows" in prompt

    def test_explanation_failure_is_reported(self, engine, monkeypatch):
        monkeypatch.setattr(
            engine.client, "generate", MagicMock(side_effect=[" SELECT 1 ", RuntimeError()])
        )
        result = engine.generate_sql("q", "ctx")
        assert result.explanation == "Unable to generate explanation."

    def test_explain_query(self, engine, http_mock):
        http_mock.add("POST", "/api/generate", json={"response": " Explained "})
        assert engine.explain_query("SELECT 1") == "Explained"

    @pytest.mark.parametrize(
        ("sql", "expected"),
        [
            ("DROP TABLE t;", "DROP"),
            ("DELETE FROM t;", "DELETE"),
            ("UPDATE t SET a=1;", "UPDATE"),
            ("TRUNCATE t;", "TRUNCATE"),
            ("SELECT * FROM t;", "LIMIT"),
            ("SELECT ST_Distance(a,b) FROM t LIMIT 1;", "ST_Transform"),
        ],
    )
    def test_analyze_query_warnings(self, engine, sql, expected):
        assert any(expected in w for w in engine._analyze_query(sql))

    def test_analyze_query_clean(self, engine):
        assert engine._analyze_query("SELECT 1 LIMIT 1;") == []

    def test_clean_sql_variants(self, engine):
        assert engine._clean_sql("SELECT 1;") == "SELECT 1;"
        assert engine._clean_sql("```\nSELECT 1") == "SELECT 1;"


@pytest.mark.unit
class TestAIHelpers:
    def test_available_providers(self, http_mock):
        http_mock.add("GET", "/api/tags", json={})
        providers = ai.get_available_providers()
        assert providers[0].name == "Ollama" and providers[0].available is True

    def test_schema_context(self, monkeypatch):
        monkeypatch.setattr("apps.postgres.schema.list_tables", lambda _s, _sc: [{"name": "t"}])
        monkeypatch.setattr(
            "apps.postgres.schema.get_table_columns",
            lambda _s, _sc, _t: [
                {"name": "id", "dataType": "int", "isPrimaryKey": True},
                {"name": "g", "dataType": "geometry", "isGeometry": True, "geometryType": "POINT"},
            ],
        )
        text = ai.get_schema_context("svc")
        assert "Table: public.t" in text and "(PK)" in text and "(POINT)" in text

    def test_schema_context_error(self, monkeypatch):
        def boom(*_a):
            raise RuntimeError("down")

        monkeypatch.setattr("apps.postgres.schema.list_tables", boom)
        assert ai.get_schema_context("svc") == "Error getting schema: down"


@pytest.fixture
def engine(monkeypatch):
    """A DuckDB engine whose queries run on plain connections (no extension downloads)."""
    ddb.DuckDBQueryEngine._instance = None
    instance = ddb.DuckDBQueryEngine()
    opened = []

    def plain(connection_id=None, user=None):
        opened.append((connection_id, user))
        return duckdb.connect(":memory:")

    monkeypatch.setattr(instance, "connect", plain)
    instance.opened = opened
    yield instance
    ddb.DuckDBQueryEngine._instance = None


def sandboxed_engine():
    """The real engine, if the DuckDB extensions are here (they download once)."""
    ddb.DuckDBQueryEngine._instance = None
    try:
        engine = ddb.DuckDBQueryEngine()
        engine.connect().close()
    except duckdb.Error as e:
        pytest.skip(f"DuckDB extensions unavailable: {e}")
    return engine


@pytest.mark.unit
class TestDuckDBEngine:
    def test_singleton_accessor(self, engine):
        assert ddb.get_duckdb_engine() is engine
        assert ddb.DuckDBQueryEngine() is engine

    def test_execute_query_serialises_and_limits(self, engine):
        result = engine.execute_query(
            "SELECT 1 AS a, DATE '2024-01-02' AS d, 'x'::BLOB AS b, [1, 2] AS l", limit=5
        )
        assert result["columns"] == ["a", "d", "b", "l"]
        row = result["rows"][0]
        assert row["d"] == "2024-01-02" and row["b"] == "78" and row["l"] == [1, 2]

    def test_execute_query_applies_default_limit(self, engine):
        result = engine.execute_query("SELECT * FROM range(50)", limit=3)
        assert result["rowCount"] == 3

    def test_never_more_rows_than_the_limit(self, engine):
        """A query that isn't a SELECT gets no LIMIT added, but is cut all the same."""
        assert engine.execute_query("FROM range(50)", limit="4")["rowCount"] == 4

    def test_a_statement_without_rows(self, engine):
        assert engine.execute_query("SET threads=1")["rows"] == []

    def test_each_query_has_its_own_connection(self, engine):
        engine.execute_query("CREATE TABLE kept AS SELECT 1 AS i")
        with pytest.raises(duckdb.CatalogException):
            engine.execute_query("SELECT * FROM kept")
        assert len(engine.opened) == 2

    def test_execute_query_reads_with_the_connection_given(self, engine):
        engine.execute_query("SELECT 1", connection_id="c1", user=USER)
        assert engine.opened == [("c1", USER)]

    def test_query_builders(self, engine, monkeypatch):
        captured = []
        monkeypatch.setattr(
            engine,
            "execute_query",
            lambda q, _cid, _limit, **_kwargs: captured.append(q) or {"rows": []},
        )
        engine.query_parquet(
            "s3://b/a.parquet", "c", USER, columns=["a", "b"], where="a > 1", limit=5
        )
        engine.query_csv("s3://b/a.csv", "c", USER, header=False, delimiter=";")
        engine.query_json("s3://b/a.json", "c", USER, where="x = 1")
        assert (
            captured[0] == "SELECT a, b FROM read_parquet('s3://b/a.parquet') WHERE a > 1 LIMIT 5"
        )
        assert "header=false" in captured[1] and "delim=';'" in captured[1]
        assert "read_json_auto" in captured[2] and "WHERE x = 1" in captured[2]

    def test_parquet_schema_and_metadata(self, engine, monkeypatch):
        rows = [{"column_name": "a", "column_type": "INTEGER", "null": "YES"}]
        monkeypatch.setattr(
            engine, "execute_query", lambda _q, _cid, _limit=1000, **_kwargs: {"rows": rows}
        )
        assert engine.get_parquet_schema("p", "c", USER) == {
            "columns": [{"name": "a", "type": "INTEGER", "nullable": True}]
        }
        assert engine.get_parquet_metadata("p", "c", USER) == rows[0]
        monkeypatch.setattr(
            engine, "execute_query", lambda _q, _cid, _limit=1000, **_kwargs: {"rows": []}
        )
        assert engine.get_parquet_metadata("p", "c", USER) == {}

    def test_geoparquet_features(self, engine, monkeypatch):
        captured = []

        def fake(query, cid, limit, user):
            captured.append(query)
            return {
                "rows": [
                    {"geometry": '{"type": "Point"}', "name": "a"},
                    {"geometry": {"type": "Point"}, "name": "b"},
                ]
            }

        monkeypatch.setattr(engine, "execute_query", fake)
        result = engine.query_geoparquet("p", "c", USER, bbox=(0, 1, 2, 3), limit=9)
        assert "ST_MakeEnvelope(0, 1, 2, 3)" in captured[0] and "LIMIT 9" in captured[0]
        assert [f["properties"] for f in result["features"]] == [{"name": "a"}, {"name": "b"}]
        assert result["features"][0]["geometry"] == {"type": "Point"}

    @pytest.mark.django_db
    def test_configure_s3(self, django_user_model):
        engine = ddb.DuckDBQueryEngine()
        conn = MagicMock()
        owner = django_user_model.objects.create(username="alice")

        def make(endpoint, region, use_ssl, secret="s"):
            s3 = S3Connection.objects.create(
                owner=owner,
                name=endpoint,
                endpoint=endpoint,
                bucket="b",
                access_key="k",
                secret_key=secret,
                region=region,
                use_ssl=use_ssl,
            )
            return str(s3.id)

        def secret_sql():
            return conn.execute.call_args.args[0]

        engine.configure_s3(conn, make("http://minio:9000", "", True), owner)
        sql = secret_sql()
        assert sql.startswith("CREATE TEMPORARY SECRET s3 (TYPE s3, ")
        assert "ENDPOINT 'minio:9000'" in sql and "USE_SSL false" in sql
        assert "REGION 'us-east-1'" in sql and "KEY_ID 'k'" in sql
        engine.configure_s3(conn, make("https://s3.test", "eu", False), owner)
        assert "USE_SSL true" in secret_sql() and "REGION 'eu'" in secret_sql()
        # A quote in a credential can't end the string early.
        engine.configure_s3(conn, make("s3.test", "", False, secret="a'b"), owner)
        assert "SECRET 'a''b'" in secret_sql()
        with pytest.raises(ValueError, match="not found"):
            engine.configure_s3(conn, "missing", owner)
        # Another user's connection is not visible.
        bob = django_user_model.objects.create(username="bob")
        with pytest.raises(ValueError, match="not found"):
            engine.configure_s3(conn, make("s3.test", "", False), bob)

    def test_connect_installs_once_then_loads_and_locks(self, monkeypatch, settings):
        settings.DUCKDB_MEMORY_LIMIT = "512MB"
        ddb.DuckDBQueryEngine._instance = None
        monkeypatch.setattr(ddb.DuckDBQueryEngine, "_installed", False)
        conns = []

        def fake_connect(_path, config=None):
            conns.append((MagicMock(), config))
            return conns[-1][0]

        monkeypatch.setattr(ddb.duckdb, "connect", fake_connect)
        engine = ddb.DuckDBQueryEngine()
        engine.connect()
        engine.connect()
        installer, (query, config), _ = conns[0][0], conns[1], conns[2]
        assert [c.args[0] for c in installer.execute.call_args_list] == [
            "INSTALL httpfs",
            "INSTALL spatial",
        ]
        assert len(conns) == 3  # installed once, then one connection per query
        assert config == {"allow_persistent_secrets": False}
        assert [c.args[0] for c in query.execute.call_args_list] == [
            "LOAD httpfs",
            "LOAD spatial",
            "SET allowed_directories=['s3://']",
            "SET enable_external_access=false",
            "SET memory_limit='512MB'",
            "SET lock_configuration=true",
        ]
        ddb.DuckDBQueryEngine._instance = None


@pytest.mark.unit
class TestDuckDBSandbox:
    """What a user's own SQL can't do (real extensions; skipped without them)."""

    @pytest.fixture
    def sandbox(self):
        engine = sandboxed_engine()
        yield engine
        ddb.DuckDBQueryEngine._instance = None

    @pytest.mark.parametrize(
        "query",
        [
            "SELECT size FROM read_blob('/etc/hostname')",
            "COPY (SELECT 1) TO '/tmp/cloudbench-duckdb-test.csv'",
            "ATTACH '/tmp/cloudbench-duckdb-test.db'",
            "SELECT * FROM read_csv('http://127.0.0.1:9/a.csv')",
            "INSTALL postgres",
        ],
    )
    def test_no_local_files_or_urls(self, sandbox, query):
        with pytest.raises(duckdb.PermissionException):
            sandbox.execute_query(query)

    @pytest.mark.parametrize(
        "query",
        [
            "SET enable_external_access=true",
            "SET allowed_directories=['/']",
            "SET memory_limit='100GB'",
            "SET lock_configuration=false",
        ],
    )
    def test_the_sandbox_cant_be_lifted(self, sandbox, query):
        with pytest.raises(duckdb.InvalidInputException, match="locked"):
            sandbox.execute_query(query)

    @pytest.mark.django_db
    def test_credentials_dont_reach_another_query(self, sandbox, django_user_model):
        owner = django_user_model.objects.create(username="alice")
        s3 = S3Connection.objects.create(
            owner=owner,
            name="minio",
            endpoint="http://127.0.0.1:9",
            bucket="b",
            access_key="AKIA_ALICE",
            secret_key="alices-secret",
        )
        # s3:// gets past the sandbox, with alice's credentials, to the network
        # (nothing listens there).
        with pytest.raises(duckdb.IOException, match="127.0.0.1:9"):
            sandbox.execute_query(
                "SELECT * FROM read_parquet('s3://b/a.parquet')", str(s3.id), user=owner
            )
        # Someone else's query, without a connection, sees none of it.
        assert sandbox.execute_query("SELECT * FROM duckdb_secrets()")["rows"] == []
        setting = sandbox.execute_query("SELECT current_setting('s3_secret_access_key') AS s")
        assert setting["rows"] == [{"s": None}]
        # Even alice's own query only sees her secret redacted.
        [secret] = sandbox.execute_query(
            "SELECT secret_string FROM duckdb_secrets()", str(s3.id), user=owner
        )["rows"]
        assert "alices-secret" not in secret["secret_string"]
        assert "secret=redacted" in secret["secret_string"]
