"""Unit tests for the search and sync services (upstream clients mocked)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from apps.core.models import Connection, S3Connection, SyncConfiguration, SyncOptions
from apps.search import services as search
from apps.sync import services as sync


@pytest.fixture
def user(config_manager):
    config_manager.add_connection(
        Connection(
            id="gs1", name="Prod GeoServer", url="http://gs.test", username="a", password="b"
        )
    )
    config_manager.add_s3_connection(
        S3Connection(id="s31", name="Archive", endpoint="s3.test", access_key="k", secret_key="s")
    )
    return "test-user"


@pytest.mark.unit
class TestSearchService:
    def make(self, user):
        return search.get_search_service(user)

    def test_result_to_dict(self):
        result = search.SearchResult("layer", "n", "t", "d", "geoserver", "1", "/p")
        assert result.to_dict()["sourceId"] == "1" and result.to_dict()["metadata"] == {}

    def test_search_connections_by_name_and_url(self, user):
        service = self.make(user)
        assert [r.source for r in service.search("prod", types=["connection"])] == ["geoserver"]
        assert [r.source for r in service.search("s3.test", types=["connection"])] == ["s3"]
        assert service.search("zzz", types=["connection"]) == []

    def test_search_layers(self, user, monkeypatch):
        client = MagicMock()
        client.list_workspaces.return_value = [{"name": "ws"}, {}, {"name": "broken"}]
        client.list_layers.side_effect = lambda ws: (
            [{"name": "roads", "title": "Roads"}, {"name": "rivers"}]
            if ws == "ws"
            else (_ for _ in ()).throw(RuntimeError("boom"))
        )
        monkeypatch.setattr(search, "get_geoserver_client", lambda *_a, **_k: client)
        results = self.make(user).search("roads", types=["layer"])
        assert [r.name for r in results] == ["roads"]
        assert results[0].path == "/layers/gs1/ws/roads"
        assert results[0].metadata["workspace"] == "ws"

    def test_search_layers_client_failure_is_swallowed(self, user, monkeypatch):
        monkeypatch.setattr(
            search, "get_geoserver_client", lambda *_a, **_k: (_ for _ in ()).throw(ValueError())
        )
        assert self.make(user).search("x", types=["layer"]) == []

    def test_search_tables(self, user, monkeypatch):
        monkeypatch.setattr("apps.postgres.service.list_services", lambda: ["gis_db", "other"])

        def list_tables(name):
            if name == "other":
                raise RuntimeError("down")
            return [{"name": "gis_roads", "geometryColumn": "geom"}, {"name": "misc"}]

        monkeypatch.setattr("apps.postgres.schema.list_tables", list_tables)
        results = self.make(user).search("gis", types=["table"])
        assert {(r.type, r.name) for r in results} == {
            ("service", "gis_db"),
            ("table", "gis_roads"),
        }
        table = next(r for r in results if r.type == "table")
        assert table.metadata["hasGeometry"] is True

    def test_search_tables_service_listing_failure(self, user, monkeypatch):
        def boom():
            raise RuntimeError("no pg")

        monkeypatch.setattr("apps.postgres.service.list_services", boom)
        assert self.make(user).search("x", types=["table"]) == []

    def test_search_buckets(self, user, monkeypatch):
        client = MagicMock()
        client.list_buckets.return_value = [
            SimpleNamespace(name="photos", creation_date="2024"),
            SimpleNamespace(name="docs", creation_date=None),
        ]
        monkeypatch.setattr("apps.s3.client.get_s3_client", lambda _id: client)
        results = self.make(user).search("photo", types=["bucket"])
        assert [r.name for r in results] == ["photos"]
        assert results[0].metadata["creationDate"] == "2024"

    def test_search_buckets_failure_is_swallowed(self, user, monkeypatch):
        def boom(_id):
            raise ValueError("nope")

        monkeypatch.setattr("apps.s3.client.get_s3_client", boom)
        assert self.make(user).search("x", types=["bucket"]) == []

    def test_search_sorts_name_matches_first_and_limits(self, user, monkeypatch):
        monkeypatch.setattr("apps.postgres.service.list_services", lambda: [])
        service = self.make(user)
        monkeypatch.setattr(service, "_search_layers", lambda _q: [])
        monkeypatch.setattr(service, "_search_buckets", lambda _q: [])
        results = service.search("a")
        assert [r.name for r in results][0] == "Archive"
        assert len(service.search("a", limit=1)) == 1

    def test_suggestions(self, user, monkeypatch):
        service = self.make(user)
        monkeypatch.setattr(
            service,
            "search",
            lambda _q, **_kw: [
                search.SearchResult("t", n, n, "", "s", "1", "/") for n in ("a1", "a1", "a2", "a3")
            ],
        )
        assert service.get_suggestions("a", limit=5) == []
        assert service.get_suggestions("ab", limit=2) == ["a1", "a2"]


@pytest.mark.unit
class TestSyncJobManager:
    @pytest.fixture(autouse=True)
    def _reset(self):
        sync.SyncJobManager._instance = None
        yield
        sync.SyncJobManager._instance = None

    def test_job_lifecycle(self):
        manager = sync.SyncJobManager()
        assert manager is sync.SyncJobManager()
        job = manager.create_job("cfg")
        assert job.status == "pending" and manager.get_job(job.id) is job
        manager.update_job(job.id, status="running", progress=0.5, current_step="x")
        manager.update_job(job.id, status="failed", error="bad", results={"a": 1})
        assert (job.status, job.progress, job.current_step, job.error) == (
            "failed",
            0.5,
            "x",
            "bad",
        )
        assert job.completed_at and job.results == {"a": 1}
        assert manager.list_jobs() == [job]
        manager.update_job("missing", status="completed")  # no-op


@pytest.mark.unit
class TestSyncService:
    @pytest.fixture(autouse=True)
    def _reset(self):
        sync.SyncJobManager._instance = None
        yield
        sync.SyncJobManager._instance = None

    @pytest.fixture
    def clients(self, monkeypatch):
        source, dest = MagicMock(), MagicMock()
        monkeypatch.setattr(
            sync, "get_geoserver_client", lambda cid, _u: source if cid == "src" else dest
        )
        return source, dest

    def test_sync_workspaces(self, clients):
        source, dest = clients
        source.list_workspaces.return_value = [{"name": "a"}, {"name": "b"}, {"name": "c"}, {}]
        dest.list_workspaces.return_value = [{"name": "a"}]
        dest.create_workspace.side_effect = lambda name: (
            (_ for _ in ()).throw(RuntimeError("nope")) if name == "c" else None
        )
        result = sync.get_sync_service().sync_workspaces("src", "dst", SyncOptions())
        assert result["workspaces"]["created"] == 1
        assert result["workspaces"]["skipped"] == 1
        assert result["workspaces"]["errors"] == [{"workspace": "c", "error": "nope"}]

    def test_sync_workspaces_filter(self, clients):
        source, dest = clients
        source.list_workspaces.return_value = [{"name": "a"}, {"name": "b"}]
        dest.list_workspaces.return_value = []
        result = sync.SyncService().sync_workspaces(
            "src", "dst", SyncOptions(workspace_filter=["b"])
        )
        assert result["workspaces"]["created"] == 1
        dest.create_workspace.assert_called_once_with("b")

    def test_sync_styles(self, clients):
        source, dest = clients
        source.list_styles.return_value = [{"name": "new"}, {"name": "old"}, {"name": "bad"}, {}]
        dest.list_styles.return_value = [{"name": "old"}]
        source.get_style.side_effect = lambda name, _ws: (
            (_ for _ in ()).throw(RuntimeError("x")) if name == "bad" else {"name": name}
        )
        result = sync.SyncService().sync_styles("src", "dst", workspace="ws")
        assert result["styles"]["created"] == 1
        assert result["styles"]["updated"] == 1
        assert result["styles"]["errors"] == [{"style": "bad", "error": "x"}]

    def test_run_sync(self, clients):
        source, dest = clients
        source.list_workspaces.return_value = []
        dest.list_workspaces.return_value = []
        source.list_styles.return_value = []
        dest.list_styles.return_value = []
        service = sync.SyncService()
        job = service.job_manager.create_job("cfg")
        config = SyncConfiguration(
            name="n",
            source_id="src",
            destination_ids=["d1", "d2"],
            options=SyncOptions(workspaces=True, styles=True),
        )
        result = service.run_sync(config, job.id)
        assert set(result["results"]) == {"d1", "d2"}
        assert set(result["results"]["d1"]) == {"workspaces", "styles"}
        assert job.current_step == "Syncing styles"

    def test_run_sync_respects_disabled_options(self, clients):
        service = sync.SyncService()
        job = service.job_manager.create_job("cfg")
        config = SyncConfiguration(
            name="n",
            source_id="src",
            destination_ids=["d1"],
            options=SyncOptions(workspaces=False, styles=False),
        )
        assert service.run_sync(config, job.id)["results"] == {"d1": {}}
