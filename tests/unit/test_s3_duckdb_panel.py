"""The DuckDB query panel's API: table info, a page of a query, and GeoJSON for its map."""

from unittest.mock import Mock, patch

import duckdb
import pytest
from rest_framework.test import APIClient

SOURCE = "s3://data/roads/roads.parquet"


@pytest.fixture
def api(django_user_model):
    client = APIClient()
    client.force_authenticate(user=django_user_model.objects.create(username="panel-owner"))
    return client


@pytest.fixture
def s3():
    with patch("apps.s3.views.get_s3_client", return_value=Mock(bucket="data")):
        yield


@pytest.mark.django_db
def test_table_info(api, s3):
    info = {"columns": [{"name": "id", "type": "BIGINT"}], "rowCount": 3, "sampleQueries": []}
    with patch("apps.s3.views.data_table_info", return_value=info) as table_info:
        response = api.get("/api/s3/duckdb/conn", {"key": "roads/roads.parquet"})
    assert response.status_code == 200
    assert response.json() == info
    assert table_info.call_args.args[:2] == (SOURCE, "conn")


@pytest.mark.django_db
def test_query_a_page(api, s3):
    page = {"columns": ["id"], "rows": [{"id": 1}], "rowCount": 1, "hasMore": False}
    with patch("apps.s3.views.query_data", return_value=page) as query:
        response = api.post(
            "/api/s3/duckdb/conn?key=roads/roads.parquet",
            {"sql": "SELECT id FROM data", "limit": 100000, "offset": 20},
            format="json",
        )
    assert response.status_code == 200
    assert response.json() == {**page, "sql": "SELECT id FROM data"}
    source, sql, conn_id, _user, limit, offset = query.call_args.args
    assert (source, sql, conn_id, limit, offset) == (
        SOURCE,
        "SELECT id FROM data",
        "conn",
        1000,
        20,
    )


@pytest.mark.django_db
def test_a_bad_query_answers_its_error(api, s3):
    with patch("apps.s3.views.query_data", side_effect=duckdb.BinderException("no column nope")):
        response = api.post(
            "/api/s3/duckdb/conn?key=a.parquet", {"sql": "SELECT nope FROM data"}, format="json"
        )
    assert response.status_code == 400
    assert "no column nope" in response.json()["error"]


@pytest.mark.django_db
def test_geojson(api, s3):
    fc = {"type": "FeatureCollection", "features": []}
    with patch("apps.s3.views.query_data_geojson", return_value=fc) as geojson:
        response = api.post(
            "/api/s3/duckdb/geojson/conn?key=a.geoparquet",
            {"sql": "SELECT * FROM data", "limit": 1000},
            format="json",
        )
    assert response.status_code == 200
    assert response.json() == fc
    assert geojson.call_args.args[0] == "s3://data/a.geoparquet"


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/api/s3/duckdb/conn", "/api/s3/duckdb/geojson/conn"])
def test_only_parquet_files(api, s3, path):
    response = api.post(f"{path}?key=a.csv", {"sql": "SELECT 1"}, format="json")
    assert response.status_code == 400
    assert "Parquet" in response.json()["error"]
