"""Portolan collection generation for converted layers."""

import json
from unittest.mock import Mock

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


def collection_for(
    data_assets, kind="pmtiles", table_info=None, host=None, license_id="CC-BY-4.0", license_url=""
):
    return portolan.build_collection_json(
        layer_id="roads",
        title="Roads",
        description="Roads, uploaded via CloudBench.",
        license_id=license_id,
        provider_name="admin",
        kind=kind,
        data_assets=data_assets,
        bbox=[1, 2, 3, 4],
        root_relative_path="../catalog.json",
        pmtiles_layers=["default"] if kind == "pmtiles" else None,
        table_info=table_info,
        host=host,
        license_url=license_url,
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


def license_links(collection):
    return [link for link in collection["links"] if link["rel"] == "license"]


def test_other_license_links_to_its_url():
    collection = collection_for(
        VECTOR_ASSETS, license_id="other", license_url="https://example.org/terms"
    )
    assert collection["license"] == "other"
    assert license_links(collection) == [
        {
            "rel": "license",
            "href": "https://example.org/terms",
            "type": "text/html",
            "title": "License",
        }
    ]


def test_other_license_without_url_links_to_generated_license_file():
    collection = collection_for(VECTOR_ASSETS, license_id="other")
    assert license_links(collection) == [
        {
            "rel": "license",
            "href": "./LICENSE.md",
            "type": "text/markdown",
            "title": "License (not specified)",
        }
    ]


def test_spdx_license_needs_no_license_link():
    assert license_links(collection_for(VECTOR_ASSETS, license_id="CC-BY-4.0")) == []


@pytest.mark.parametrize(
    "license_id, expected",
    [("proprietary", "other"), ("", "other"), (None, "other"), (" CC0-1.0 ", "CC0-1.0")],
)
def test_normalize_license(license_id, expected):
    assert portolan.normalize_license(license_id) == expected


def test_proprietary_is_not_offered():
    assert "proprietary" not in {choice["id"] for choice in portolan.LICENSE_CHOICES}


def finalize(s3_client, license_id, license_url=""):
    portolan.finalize_layer(
        s3_client,
        folder="roads",
        layer_id="roads",
        title="Roads",
        kind="pmtiles",
        data_assets=VECTOR_ASSETS,
        license_id=license_id,
        provider_name="admin",
        source_name="roads.zip",
        info={"bbox": [1, 2, 3, 4], "layers": ["default"]},
        license_url=license_url,
    )
    return {call.kwargs["key"]: call.kwargs["body"] for call in s3_client.put_object.call_args_list}


def publish_target():
    s3_client = Mock(bucket_url="http://minio:9000/bucket")
    s3_client.get_object.side_effect = Exception("no catalog.json yet")
    return s3_client


def test_finalize_writes_license_file_when_terms_are_unknown():
    s3_client = publish_target()
    written = finalize(s3_client, "proprietary")  # legacy value: published as "other"

    assert b"was not specified" in written["roads/LICENSE.md"]
    assert b"not specified" in written["roads/README.md"]
    collection = json.loads(written["roads/collection.json"])
    assert collection["license"] == "other"
    assert license_links(collection)[0]["href"] == "./LICENSE.md"
    s3_client.delete_object.assert_not_called()


@pytest.mark.parametrize(
    "license_id, license_url",
    [("other", "https://example.org/terms"), ("CC-BY-4.0", "https://ignored.example.org")],
)
def test_finalize_removes_stale_license_file_once_terms_are_known(license_id, license_url):
    s3_client = publish_target()
    written = finalize(s3_client, license_id, license_url)

    assert "roads/LICENSE.md" not in written
    s3_client.delete_object.assert_called_once_with("roads/LICENSE.md")
    collection = json.loads(written["roads/collection.json"])
    expected = [license_url] if license_id == "other" else []
    assert [link["href"] for link in license_links(collection)] == expected


class FakeBucket:
    """Just enough of S3Client for the root catalog functions: an in-memory bucket."""

    def __init__(self):
        self.objects = {}

    def get_object(self, key):
        return self.objects[key]

    def put_object(self, key, body, content_type):
        self.objects[key] = body


def test_publishing_writes_root_readme_and_agents_listing_every_layer():
    bucket = FakeBucket()
    portolan.ensure_root_catalog(bucket, folder="roads", title="Roads")
    portolan.ensure_root_catalog(bucket, folder="imports/rivers", title="Rivers")

    catalog = json.loads(bucket.objects["catalog.json"])
    doc_links = {link["rel"]: link["href"] for link in catalog["links"]}
    assert doc_links["describedby"] == "./README.md"
    assert doc_links["agents"] == "./AGENTS.md"

    readme = bucket.objects["README.md"].decode()
    assert (
        "| [Roads](./roads/README.md) | `roads/` | [collection.json](./roads/collection.json) |"
        in readme
    )
    assert "[Rivers](./imports/rivers/README.md)" in readme
    agents = bucket.objects["AGENTS.md"].decode()
    assert "- `Roads`: `./roads/collection.json` (notes: `./roads/AGENTS.md`)" in agents
    assert "`./imports/rivers/collection.json`" in agents


def test_republishing_a_layer_does_not_duplicate_links():
    bucket = FakeBucket()
    for _ in range(2):
        portolan.ensure_root_catalog(bucket, folder="roads", title="Roads")

    catalog = json.loads(bucket.objects["catalog.json"])
    rels = [link["rel"] for link in catalog["links"]]
    assert rels.count("child") == 1
    assert rels.count("describedby") == 1
    assert rels.count("agents") == 1
    assert bucket.objects["README.md"].decode().count("./roads/README.md") == 1


def test_deleting_layers_regenerates_root_docs():
    bucket = FakeBucket()
    portolan.ensure_root_catalog(bucket, folder="roads", title="Roads")
    portolan.ensure_root_catalog(bucket, folder="rivers", title="Rivers")

    portolan.prune_root_catalog(bucket, "roads/")
    assert "Roads" not in bucket.objects["README.md"].decode()
    assert "Rivers" in bucket.objects["AGENTS.md"].decode()

    portolan.prune_root_catalog(bucket, "rivers/")
    assert "No layers are published yet." in bucket.objects["README.md"].decode()
    assert "(none published yet)" in bucket.objects["AGENTS.md"].decode()


def test_catalogs_from_before_root_docs_gain_them_on_next_change():
    bucket = FakeBucket()
    bucket.objects["catalog.json"] = json.dumps(
        {
            "type": "Catalog",
            "id": "catalog",
            "title": "CloudBench Catalog",
            "links": [
                {"rel": "root", "href": "./catalog.json"},
                {"rel": "child", "href": "./old/collection.json", "title": "Old"},
            ],
        }
    ).encode()

    portolan.ensure_root_catalog(bucket, folder="new", title="New")

    readme = bucket.objects["README.md"].decode()
    assert "[Old](./old/README.md)" in readme and "[New](./new/README.md)" in readme
    assert {"describedby", "agents"} <= {
        link["rel"] for link in json.loads(bucket.objects["catalog.json"])["links"]
    }


def test_thumbnail_is_listed_apart_from_data_files():
    assets = [*VECTOR_ASSETS, portolan.thumbnail_asset({"name": "roads_thumbnail.png"})]
    agents = portolan.build_agents_md(
        title="Roads", layer_id="roads", kind="pmtiles", data_assets=assets
    )
    assert "- Thumbnail: `./thumbnail.png` (PNG preview of the default style)" in agents
    assert "Data file: `./thumbnail.png`" not in agents

    collection = collection_for(assets)
    assert collection["assets"]["thumbnail"]["roles"] == ["thumbnail"]
    assert set(collection["assets"]) == {"data", "thumbnail", "style-default"}


def test_default_vector_style_draws_points():
    style = portolan.default_style_for_pmtiles("default", "roads.pmtiles")
    circle = next(layer for layer in style["layers"] if layer["type"] == "circle")
    assert circle["filter"] == ["==", ["geometry-type"], "Point"]
    assert circle["paint"]["circle-color"] == "#2d7d9b"


@pytest.mark.parametrize(
    "name, expected",
    [("roads_thumbnail.png", True), ("output_cog_thumbnail.png", True), ("roads.png", False)],
)
def test_is_thumbnail_result(name, expected):
    assert portolan.is_thumbnail_result(name) is expected
