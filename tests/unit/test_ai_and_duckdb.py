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
    """A DuckDB engine on a plain in-memory database (no extension downloads)."""
    ddb.DuckDBQueryEngine._instance = None
    instance = ddb.DuckDBQueryEngine.__new__(ddb.DuckDBQueryEngine)
    instance._initialized = True
    instance.conn = duckdb.connect(":memory:")
    ddb.DuckDBQueryEngine._instance = instance
    yield instance
    ddb.DuckDBQueryEngine._instance = None


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

    def test_execute_query_configures_s3_when_connection_given(self, engine, monkeypatch):
        seen = []
        monkeypatch.setattr(engine, "configure_s3", lambda cid, user: seen.append((cid, user)))
        engine.execute_query("SELECT 1", connection_id="c1", user=USER)
        assert seen == [("c1", USER)]

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
    def test_configure_s3(self, engine, django_user_model):
        engine.conn = MagicMock()
        owner = django_user_model.objects.create(username="alice")

        def make(endpoint, region, use_ssl):
            conn = S3Connection.objects.create(
                owner=owner,
                name=endpoint,
                endpoint=endpoint,
                bucket="b",
                access_key="k",
                secret_key="s",
                region=region,
                use_ssl=use_ssl,
            )
            return str(conn.id)

        plain = make("http://minio:9000", "", True)
        tls = make("https://s3.test", "eu", False)
        bare = make("s3.test", "", False)

        engine.configure_s3(plain, owner)
        statements = [c.args[0] for c in engine.conn.execute.call_args_list]
        assert "SET s3_endpoint='minio:9000'" in statements
        assert "SET s3_use_ssl=false" in statements
        assert "SET s3_region='us-east-1'" in statements
        engine.conn.reset_mock()
        engine.configure_s3(tls, owner)
        assert "SET s3_use_ssl=true" in [c.args[0] for c in engine.conn.execute.call_args_list]
        engine.configure_s3(bare, owner)
        with pytest.raises(ValueError, match="not found"):
            engine.configure_s3("missing", owner)
        # Another user's connection is not visible.
        bob = django_user_model.objects.create(username="bob")
        with pytest.raises(ValueError, match="not found"):
            engine.configure_s3(plain, bob)

    def test_init_loads_extensions(self, monkeypatch):
        ddb.DuckDBQueryEngine._instance = None
        fake_conn = MagicMock()
        monkeypatch.setattr(ddb.duckdb, "connect", lambda _p: fake_conn)
        instance = ddb.DuckDBQueryEngine()
        assert instance._initialized
        assert [c.args[0] for c in fake_conn.execute.call_args_list] == [
            "INSTALL httpfs",
            "LOAD httpfs",
            "INSTALL spatial",
            "LOAD spatial",
        ]
        ddb.DuckDBQueryEngine()  # second init is a no-op
        assert fake_conn.execute.call_count == 4
        ddb.DuckDBQueryEngine._instance = None
