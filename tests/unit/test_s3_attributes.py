"""The table view's paged attributes, read with DuckDB rather than in the browser."""

from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient

GEO = {
    "primary_column": "geom",
    "columns": {
        "geom": {
            "encoding": "WKB",
            "covering": {"bbox": {c: ["geom_bbox", c] for c in ("xmin", "ymin", "xmax", "ymax")}},
        }
    },
}


@pytest.fixture
def api(django_user_model):
    client = APIClient()
    client.force_authenticate(user=django_user_model.objects.create(username="table-owner"))
    return client


@pytest.fixture
def engine():
    engine = Mock()
    engine.query_parquet_page.return_value = {"fields": ["osm_id"], "rows": [{"osm_id": "1"}]}
    with (
        patch("apps.s3.views.get_s3_client", return_value=Mock(bucket="data")),
        patch("apps.s3.views.get_duckdb_engine", return_value=engine),
    ):
        yield engine


@pytest.mark.django_db
def test_a_page_of_a_geoparquet_leaves_out_its_geometry(api, engine):
    engine.get_geoparquet_info.return_value = {"geo": GEO, "rowCount": 2_830_778}

    response = api.get(
        "/api/s3/attributes/conn",
        {"key": "roads/roads.parquet", "limit": 50, "offset": 100},
    )

    assert response.status_code == 200
    assert response.json() == {
        "fields": ["osm_id"],
        "rows": [{"osm_id": "1"}],
        "total": 2_830_778,
        "limit": 50,
        "offset": 100,
        "hasMore": True,
    }
    path, _conn, _user, limit, offset, exclude = engine.query_parquet_page.call_args.args
    assert path == "s3://data/roads/roads.parquet"
    assert (limit, offset) == (50, 100)
    assert exclude == ["geom", "geom_bbox"]  # geometry, and its bbox covering column


@pytest.mark.django_db
def test_plain_parquet_and_the_last_page(api, engine):
    engine.get_geoparquet_info.return_value = None
    engine.execute_query.return_value = {"rows": [{"num_rows": 101}]}

    body = api.get("/api/s3/attributes/conn", {"key": "t.parquet", "offset": 100}).json()

    assert body["total"] == 101
    assert body["hasMore"] is False
    assert engine.query_parquet_page.call_args.args[5] == []


@pytest.mark.django_db
def test_limits_are_bounded_and_only_parquet_has_a_table(api, engine):
    engine.get_geoparquet_info.return_value = None
    engine.execute_query.return_value = {"rows": [{"num_rows": 10}]}

    api.get("/api/s3/attributes/conn", {"key": "t.parquet", "limit": 100000})
    assert engine.query_parquet_page.call_args.args[3] == 500

    assert api.get("/api/s3/attributes/conn", {"key": "t.tif"}).status_code == 400
    assert api.get("/api/s3/attributes/conn", {"key": "t.parquet", "limit": "x"}).status_code == 400
