"""Portolan collection generation for converted layers."""

import pytest

from apps.s3 import portolan
from apps.s3.cng_lite import host_contact_email
from apps.s3.models import S3Connection

TABLE_INFO = {
    "columns": [{"name": "name", "type": "string"}, {"name": "geometry", "type": "binary"}],
    "rowCount": 177,
}
VECTOR_ASSETS = [
    {"filename": "roads.parquet", "role": "data", "media_type": portolan.PARQUET_MEDIA_TYPE},
    {"filename": "roads.pmtiles", "role": "visual", "media_type": portolan.PMTILES_MEDIA_TYPE},
]


def collection_for(data_assets, kind="pmtiles", table_info=None, host=None):
    return portolan.build_collection_json(
        layer_id="roads",
        title="Roads",
        description="Roads, uploaded via CloudBench.",
        license_id="CC-BY-4.0",
        provider_name="admin",
        kind=kind,
        data_assets=data_assets,
        bbox=[1, 2, 3, 4],
        root_relative_path="../catalog.json",
        pmtiles_layers=["default"] if kind == "pmtiles" else None,
        table_info=table_info,
        host=host,
    )


def test_vector_layer_publishes_geoparquet_as_data_and_pmtiles_as_link():
    collection = collection_for(VECTOR_ASSETS, table_info=TABLE_INFO)

    assert collection["assets"]["data"] == {
        "href": "./roads.parquet",
        "type": "application/vnd.apache.parquet",
        "title": "Roads (GeoParquet)",
        "roles": ["data"],
    }
    # Portolan registers PMTiles through the rel=pmtiles link, not as an asset.
    assert "visual" not in collection["assets"]
    pmtiles_link = next(link for link in collection["links"] if link["rel"] == "pmtiles")
    assert pmtiles_link["href"] == "./roads.pmtiles"
    assert pmtiles_link["pmtiles:layers"] == ["default"]

    assert portolan.TABLE_SCHEMA in collection["stac_extensions"]
    assert collection["table:columns"] == TABLE_INFO["columns"]
    assert collection["table:row_count"] == 177


def test_vector_layer_without_geoparquet_keeps_pmtiles_asset():
    """Conversions from a cng-lite build that predates GeoParquet output."""
    collection = collection_for([{"filename": "roads.pmtiles", "role": "visual"}])

    assert collection["assets"]["visual"]["href"] == "./roads.pmtiles"
    assert collection["assets"]["visual"]["type"] == "application/vnd.pmtiles"
    assert portolan.TABLE_SCHEMA not in collection["stac_extensions"]
    assert "table:columns" not in collection


def test_cog_layer_assets_are_unchanged():
    collection = collection_for(
        [
            {"filename": "dem.tif", "role": "data"},
            {"filename": "dem_3857.tif", "role": "visual"},
        ],
        kind="cog",
    )

    assert set(collection["assets"]) == {"data", "visual", "style-default"}
    assert collection["assets"]["data"]["type"].startswith("image/tiff")
    assert not any(link["rel"] == "pmtiles" for link in collection["links"])


def test_host_provider_defaults_to_endpoint_hostname():
    assert portolan.host_provider("https://minio.example.org/data") == {
        "name": "minio.example.org",
        "roles": ["host"],
        "url": "https://minio.example.org/data",
    }


def test_host_provider_takes_configured_name_and_contact_email():
    assert portolan.host_provider(
        "https://minio.example.org/data", name="Kartoza", email="info@kartoza.com"
    ) == {
        "name": "Kartoza",
        "roles": ["host"],
        "url": "https://minio.example.org/data",
        "email": "info@kartoza.com",
    }


def test_collection_lists_producer_and_exactly_one_host():
    host = portolan.host_provider("https://minio.example.org/data")
    collection = collection_for(VECTOR_ASSETS, host=host)

    assert collection["providers"] == [{"name": "admin", "roles": ["producer"]}, host]
    assert [p for p in collection["providers"] if "host" in p["roles"]] == [host]


def test_agents_md_points_queries_at_geoparquet():
    agents = portolan.build_agents_md(
        title="Roads", layer_id="roads", kind="pmtiles", data_assets=VECTOR_ASSETS
    )

    assert "`./roads.parquet` (application/vnd.apache.parquet, data)" in agents
    assert "read_parquet('roads.parquet')" in agents


def test_readme_describes_both_formats():
    readme = portolan.build_readme(
        title="Roads",
        license_id="CC-BY-4.0",
        source_name="roads.zip",
        kind="pmtiles",
        layer_names=["default"],
        table_info=TABLE_INFO,
    )

    assert "GeoParquet" in readme
    assert "Features: 177" in readme
    assert "PMTiles" in readme


@pytest.mark.django_db
@pytest.mark.parametrize(
    "connection_email, default_email, expected",
    [
        ("data@example.org", "info@kartoza.com", "data@example.org"),
        ("", "info@kartoza.com", "info@kartoza.com"),
        ("", "", ""),
    ],
)
def test_host_contact_email_prefers_connection_then_setting(
    settings, django_user_model, connection_email, default_email, expected
):
    settings.PORTOLAN_HOST_EMAIL = default_email
    connection = S3Connection.objects.create(
        owner=django_user_model.objects.create(username="owner"),
        name="MinIO",
        endpoint="minio:9000",
        bucket="data",
        contact_email=connection_email,
    )

    assert host_contact_email(str(connection.id)) == expected


@pytest.mark.django_db
@pytest.mark.parametrize("connection_id", ["not-a-uuid", "11111111-1111-1111-1111-111111111111"])
def test_host_contact_email_falls_back_for_unknown_connections(settings, connection_id):
    settings.PORTOLAN_HOST_EMAIL = "info@kartoza.com"
    assert host_contact_email(connection_id) == "info@kartoza.com"
