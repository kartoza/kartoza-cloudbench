"""API tests for connection management endpoints.

Note: URL patterns in this project do NOT use trailing slashes.
"""

import shutil
from unittest.mock import patch

import httpx
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.s3 import views
from apps.s3.models import S3Connection

# The real reachability check (the S3 tests below stub it out by default).
_REAL_UNREACHABLE = views._unreachable_response


@pytest.fixture
def api_client(authenticated_api_client: APIClient) -> APIClient:
    """These endpoints require authentication, so use the logged-in client."""
    return authenticated_api_client


@pytest.mark.django_db
@pytest.mark.api
class TestGeoServerConnectionsAPI:
    """Tests for GeoServer connections endpoints."""

    def test_list_connections_empty(self, api_client: APIClient) -> None:
        """Test listing connections when empty."""
        response = api_client.get("/api/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_connection(self, api_client: APIClient) -> None:
        """Test creating a new GeoServer connection."""
        response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["name"] == "Test GeoServer"
        assert "id" in data

    def test_get_connection(self, api_client: APIClient) -> None:
        """Test getting a specific connection."""
        # Create first
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Get
        response = api_client.get(f"/api/connections/{conn_id}")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["id"] == conn_id

    def test_update_connection(self, api_client: APIClient) -> None:
        """Test updating a connection."""
        # Create first
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Update
        response = api_client.put(
            f"/api/connections/{conn_id}",
            {
                "name": "Updated GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "newpassword",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["name"] == "Updated GeoServer"

    def test_delete_connection(self, api_client: APIClient) -> None:
        """Test deleting a connection."""
        # Create first
        create_response = api_client.post(
            "/api/connections",
            {
                "name": "Test GeoServer",
                "url": "http://localhost:8080/geoserver",
                "username": "admin",
                "password": "geoserver",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Delete
        response = api_client.delete(f"/api/connections/{conn_id}")
        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify deleted
        response = api_client.get(f"/api/connections/{conn_id}")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_get_nonexistent_connection(self, api_client: APIClient) -> None:
        """Test getting a nonexistent connection."""
        response = api_client.get("/api/connections/nonexistent")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_create_connection_validation(self, api_client: APIClient) -> None:
        """Test connection creation validation."""
        # Missing required fields
        response = api_client.post(
            "/api/connections",
            {"name": "Test"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
@pytest.mark.api
class TestS3ConnectionsAPI:
    """Tests for S3 connections endpoints."""

    @pytest.fixture
    def api_client(self, api_client: APIClient) -> APIClient:
        """S3 connection endpoints require IsAuthenticated and scope
        connections to a real owner FK, so a saved user is needed.
        """
        user = get_user_model().objects.create_user(username="s3-api-tester", password="x")
        api_client.force_authenticate(user=user)
        return api_client

    @pytest.fixture(autouse=True)
    def reachable(self):
        """Saving tests the connection first; these endpoints don't exist, so pretend they do."""
        with patch("apps.s3.views._unreachable_response", return_value=None) as check:
            yield check

    def test_list_s3_connections_empty(self, api_client: APIClient) -> None:
        """Test listing S3 connections when empty."""
        response = api_client.get("/api/s3/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_s3_connection(self, api_client: APIClient) -> None:
        """Test creating a new S3 connection."""
        response = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "accessKey": "minioadmin",
                "secretKey": "minioadmin",
                "useSSL": False,
                "pathStyle": True,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["name"] == "Test MinIO"
        assert data["bucket"] == "test-bucket"
        assert "id" in data

    def test_create_s3_connection_requires_bucket(self, api_client: APIClient) -> None:
        """A connection can't be created without a bucket."""
        response = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "accessKey": "minioadmin",
                "secretKey": "minioadmin",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_contact_email_is_saved_updated_and_cleared(self, api_client: APIClient) -> None:
        """The optional contact email round-trips; blank on edit clears it."""
        conn_id = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "contactEmail": " data@example.org ",
            },
            format="json",
        ).json()["id"]

        def contact_email():
            detail = api_client.get(f"/api/s3/connections/{conn_id}").json()
            return detail["connection"]["contactEmail"]

        assert contact_email() == "data@example.org"
        assert api_client.get("/api/s3/connections").json()[0]["contactEmail"] == (
            "data@example.org"
        )

        # An edit that doesn't mention it leaves it alone...
        api_client.put(f"/api/s3/connections/{conn_id}", {"name": "Renamed"}, format="json")
        assert contact_email() == "data@example.org"
        # ...while an explicit blank clears it (falling back to the server default).
        api_client.put(f"/api/s3/connections/{conn_id}", {"contactEmail": ""}, format="json")
        assert contact_email() == ""

    def test_invalid_contact_email_is_rejected(self, api_client: APIClient) -> None:
        payload = {"name": "Test MinIO", "endpoint": "localhost:9000", "bucket": "b"}
        response = api_client.post(
            "/api/s3/connections", {**payload, "contactEmail": "not-an-email"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        conn_id = api_client.post("/api/s3/connections", payload, format="json").json()["id"]
        response = api_client.put(
            f"/api/s3/connections/{conn_id}", {"contactEmail": "nope@"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_s3_connection(self, api_client: APIClient) -> None:
        """Test deleting an S3 connection."""
        # Create first
        create_response = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "accessKey": "minioadmin",
                "secretKey": "minioadmin",
            },
            format="json",
        )
        conn_id = create_response.json()["id"]

        # Delete
        response = api_client.delete(f"/api/s3/connections/{conn_id}")
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_test_connection_falls_back_to_saved_keys(self, api_client: APIClient) -> None:
        """Testing an edited connection may omit the keys: the saved ones are used."""
        conn_id = api_client.post(
            "/api/s3/connections",
            {
                "name": "Test MinIO",
                "endpoint": "localhost:9000",
                "bucket": "test-bucket",
                "accessKey": "saved-key",
                "secretKey": "saved-secret",
            },
            format="json",
        ).json()["id"]

        with patch("apps.s3.views.S3Client") as client_cls:
            client_cls.return_value.test_connection.return_value = (True, "ok")
            response = api_client.post(
                "/api/s3/connections/test",
                {
                    "connectionId": conn_id,
                    "endpoint": "localhost:9001",
                    "bucket": "other-bucket",
                    "secretKey": "retyped-secret",
                },
                format="json",
            )

        assert response.status_code == status.HTTP_200_OK
        kwargs = client_cls.call_args.kwargs
        # Edited fields are tested as typed; only the omitted key comes from the DB.
        assert (kwargs["endpoint"], kwargs["bucket"]) == ("localhost:9001", "other-bucket")
        assert (kwargs["access_key"], kwargs["secret_key"]) == ("saved-key", "retyped-secret")

    def test_unreachable_connection_is_not_saved(self, api_client: APIClient) -> None:
        """A connection is only added once it can reach its bucket."""
        payload = {
            "name": "Typo",
            "endpoint": "localhost:9000",
            "bucket": "test-bucket",
            "accessKey": "k",
            "secretKey": "wrong",
        }
        # Undo the class-wide stub for this test: exercise the real check.
        with (
            patch.object(views, "_unreachable_response", _REAL_UNREACHABLE),
            patch("apps.s3.views.S3Client") as client_cls,
        ):
            client_cls.return_value.test_connection.return_value = (False, "403 Forbidden")
            refused = api_client.post("/api/s3/connections", payload, format="json")
            client_cls.return_value.test_connection.return_value = (True, "ok")
            added = api_client.post("/api/s3/connections", payload, format="json")

        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert "403 Forbidden" in refused.json()["error"]
        assert added.status_code == status.HTTP_201_CREATED
        assert S3Connection.objects.filter(name="Typo").count() == 1
        # Tested with exactly the settings being saved.
        assert client_cls.call_args.kwargs["secret_key"] == "wrong"

    def test_edit_is_retested_only_when_connectivity_changes(self, api_client: APIClient) -> None:
        conn_id = api_client.post(
            "/api/s3/connections",
            {
                "name": "MinIO",
                "endpoint": "localhost:9000",
                "bucket": "b",
                "accessKey": "k",
                "secretKey": "s",
            },
            format="json",
        ).json()["id"]
        with (
            patch.object(views, "_unreachable_response", _REAL_UNREACHABLE),
            patch("apps.s3.views.S3Client") as client_cls,
        ):
            client_cls.return_value.test_connection.return_value = (False, "no such bucket")
            # Renaming (blank keys mean "keep the saved ones") needs no test.
            renamed = api_client.put(
                f"/api/s3/connections/{conn_id}",
                {"name": "Renamed", "accessKey": "", "secretKey": ""},
                format="json",
            )
            assert renamed.status_code == status.HTTP_200_OK
            client_cls.assert_not_called()

            # A new bucket that can't be reached is refused, and nothing changes.
            moved = api_client.put(
                f"/api/s3/connections/{conn_id}", {"bucket": "missing"}, format="json"
            )
            assert moved.status_code == status.HTTP_400_BAD_REQUEST
            assert S3Connection.objects.get(id=conn_id).bucket == "b"

            client_cls.return_value.test_connection.return_value = (True, "ok")
            moved = api_client.put(
                f"/api/s3/connections/{conn_id}", {"bucket": "other"}, format="json"
            )
            assert moved.status_code == status.HTTP_200_OK
            assert S3Connection.objects.get(id=conn_id).bucket == "other"

    def test_invalid_endpoint_is_refused_not_crashed(self, api_client: APIClient) -> None:
        with patch.object(views, "_unreachable_response", _REAL_UNREACHABLE):
            response = api_client.post(
                "/api/s3/connections",
                {"name": "Bad", "endpoint": "http://[::bad", "bucket": "b"},
                format="json",
            )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not S3Connection.objects.filter(name="Bad").exists()

    def test_test_connection_rejects_another_users_connection(self, api_client: APIClient) -> None:
        """connectionId can't be used to borrow someone else's saved keys."""
        other = get_user_model().objects.create_user(username="someone-else", password="x")
        conn = S3Connection.objects.create(
            owner=other,
            name="theirs",
            endpoint="localhost:9000",
            bucket="b",
            access_key="k",
            secret_key="s",
        )
        response = api_client.post(
            "/api/s3/connections/test",
            {"connectionId": str(conn.id), "endpoint": "localhost:9000", "bucket": "b"},
            format="json",
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND


def _geoserver_by_token(http_mock, valid: str, body: bytes = b"PNG", content_type="image/png"):
    """A GeoServer that serves the layer to ``valid``'s token only; anyone else
    gets the "not found" it answers for a private layer."""

    def handle(request):
        http_mock.calls.append(request)
        if request.headers.get("authorization") == f"Bearer {valid}":
            return httpx.Response(200, content=body, headers={"content-type": content_type})
        return httpx.Response(
            200,
            content=b'<ServiceException code="LayerNotDefined">Could not find layer x'
            b"</ServiceException>",
            headers={"content-type": "application/vnd.ogc.se_xml"},
        )

    return handle


@pytest.mark.django_db
@pytest.mark.api
class TestGeoNodeConnectionsAPI:
    """Tests for GeoNode connections endpoints."""

    def test_list_geonode_connections(self, api_client: APIClient) -> None:
        """Test listing GeoNode connections."""
        response = api_client.get("/api/geonode/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_geonode_connection(self, api_client: APIClient) -> None:
        """Test creating a GeoNode connection."""
        response = api_client.post(
            "/api/geonode/connections",
            {
                "name": "Test GeoNode",
                "url": "http://localhost:8000",
                "username": "admin",
                "password": "admin",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED

    def _geonode_id(self, api_client: APIClient, **auth: str) -> str:
        response = api_client.post(
            "/api/geonode/connections",
            {
                "name": "GN",
                "url": "https://gn.example/",
                **(auth or {"username": "u", "password": "p"}),
            },
            format="json",
        )
        return response.json()["id"]

    def _wms(self, api_client: APIClient, conn_id: str, **params: str):
        return api_client.get(
            f"/api/geonode/connections/{conn_id}/wms",
            {"SERVICE": "WMS", "REQUEST": "GetMap", **params},
        )

    def test_wms_proxy_forwards_getmap_to_geoserver(self, api_client: APIClient, http_mock) -> None:
        """The map preview's tiles: forwarded to the GeoNode's GeoServer, image returned."""
        conn_id = self._geonode_id(api_client)
        http_mock.add(
            "GET", "/geoserver/ows", content=b"PNG", headers={"content-type": "image/png"}
        )
        with patch("apps.geonode.geoserver.get_access_token", return_value="") as token:
            response = self._wms(api_client, conn_id, LAYERS="geonode:roads")
        assert response.status_code == status.HTTP_200_OK
        assert response["Content-Type"] == "image/png"
        assert response.content == b"PNG"
        sent = http_mock.calls[0]
        assert str(sent.url).startswith("https://gn.example/geoserver/ows?")
        assert sent.url.params["LAYERS"] == "geonode:roads"
        # No token to be had (login failed): asked anonymously.
        assert "authorization" not in sent.headers
        token.assert_called_once_with("https://gn.example/", "u", "p")

    def test_wms_proxy_logs_in_for_a_password_connection(
        self, api_client: APIClient, http_mock
    ) -> None:
        """GeoServer won't take GeoNode basic auth: the login's token goes as Bearer."""
        conn_id = self._geonode_id(api_client)
        http_mock.add(
            "GET", "/geoserver/ows", content=b"PNG", headers={"content-type": "image/png"}
        )
        with patch("apps.geonode.geoserver.get_access_token", return_value="login-tok"):
            self._wms(api_client, conn_id)
        assert len(http_mock.calls) == 1
        assert http_mock.calls[0].headers["authorization"] == "Bearer login-tok"

    def test_wms_proxy_retries_a_hidden_layer_with_a_fresh_token(
        self, api_client: APIClient, http_mock
    ) -> None:
        """An expired token reads as anonymous ("Could not find layer"): log in again."""
        conn_id = self._geonode_id(api_client)
        http_mock.handle = _geoserver_by_token(http_mock, valid="new")
        with patch("apps.geonode.geoserver.get_access_token", side_effect=["old", "new"]) as token:
            response = self._wms(api_client, conn_id)
        assert response.content == b"PNG"
        assert token.call_args.kwargs == {"refresh": True}
        assert [c.headers["authorization"] for c in http_mock.calls] == [
            "Bearer old",
            "Bearer new",
        ]

    def test_wms_proxy_no_retry_when_the_token_is_the_same(
        self, api_client: APIClient, http_mock
    ) -> None:
        """A layer that's really hidden (or missing) isn't asked for twice."""
        conn_id = self._geonode_id(api_client)
        http_mock.add(
            "GET",
            "/geoserver/ows",
            content=b'<ServiceException code="LayerNotDefined"/>',
            headers={"content-type": "application/vnd.ogc.se_xml"},
        )
        with patch("apps.geonode.geoserver.get_access_token", return_value="tok"):
            response = self._wms(api_client, conn_id)
        assert b"LayerNotDefined" in response.content
        assert len(http_mock.calls) == 1

    def test_wms_proxy_sends_the_geonode_token(self, api_client: APIClient, http_mock) -> None:
        """A token connection's tiles carry its token, so private layers draw."""
        conn_id = self._geonode_id(api_client, token="tok")
        http_mock.add(
            "GET", "/geoserver/ows", content=b"PNG", headers={"content-type": "image/png"}
        )
        with patch("apps.geonode.geoserver.get_access_token") as login:
            self._wms(api_client, conn_id)
        assert http_mock.calls[0].headers["authorization"] == "Bearer tok"
        login.assert_not_called()

    def test_wms_proxy_only_forwards_wms_reads(self, api_client: APIClient, http_mock) -> None:
        conn_id = self._geonode_id(api_client)
        response = api_client.get(
            f"/api/geonode/connections/{conn_id}/wms",
            {"SERVICE": "WFS", "REQUEST": "Transaction"},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert http_mock.calls == []

    def test_wms_proxy_unknown_connection(self, api_client: APIClient) -> None:
        response = api_client.get(
            "/api/geonode/connections/nope/wms", {"SERVICE": "WMS", "REQUEST": "GetMap"}
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
@pytest.mark.api
class TestGeoNodeDatasetDownloadAPI:
    """GET /api/geonode/connections/<id>/download/<pk>/<alternate>?format=…"""

    @pytest.fixture
    def conn_id(self, api_client: APIClient) -> str:
        return api_client.post(
            "/api/geonode/connections",
            {"name": "GN", "url": "https://gn.example/", "token": "tok"},
            format="json",
        ).json()["id"]

    def _download(self, api_client: APIClient, conn_id: str, fmt: str, alternate="geonode:roads"):
        return api_client.get(
            f"/api/geonode/connections/{conn_id}/download/7/{alternate}", {"format": fmt}
        )

    def test_vector_through_wfs(self, api_client: APIClient, conn_id: str, http_mock) -> None:
        """A shapefile: WFS GetFeature, with the connection's token, streamed as a download."""
        http_mock.add(
            "GET", "/geoserver/ows", content=b"ZIP", headers={"content-type": "application/zip"}
        )
        response = self._download(api_client, conn_id, "shp")
        assert response.status_code == status.HTTP_200_OK
        assert b"".join(response.streaming_content) == b"ZIP"
        assert response["Content-Disposition"] == 'attachment; filename="roads.zip"'
        sent = http_mock.calls[0]
        assert sent.headers["authorization"] == "Bearer tok"
        assert sent.url.params["service"] == "WFS"
        assert sent.url.params["typeName"] == "geonode:roads"
        assert sent.url.params["outputFormat"] == "SHAPE-ZIP"

    def test_excel_isnt_taken_for_an_error(
        self, api_client: APIClient, conn_id: str, http_mock
    ) -> None:
        """Its content type has "xml" in it, like GeoServer's exception reports."""
        xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        http_mock.add("GET", "/geoserver/ows", content=b"XLSX", headers={"content-type": xlsx})
        response = self._download(api_client, conn_id, "xlsx")
        assert response.status_code == status.HTTP_200_OK
        assert response["Content-Disposition"] == 'attachment; filename="roads.xlsx"'

    def test_raster_through_wcs(self, api_client: APIClient, conn_id: str, http_mock) -> None:
        http_mock.add(
            "GET", "/geoserver/ows", content=b"TIFF", headers={"content-type": "image/tiff"}
        )
        response = self._download(api_client, conn_id, "tif", alternate="geonode:dem")
        assert response.status_code == status.HTTP_200_OK
        assert response["Content-Disposition"] == 'attachment; filename="dem.tif"'
        params = http_mock.calls[0].url.params
        assert params["service"] == "WCS" and params["request"] == "GetCoverage"
        assert params["coverageId"] == "geonode__dem"
        assert params["format"] == "image/tiff"

    @pytest.mark.skipif(not shutil.which("ogr2ogr"), reason="needs GDAL's ogr2ogr")
    def test_geopackage_converted_from_geojson(
        self, api_client: APIClient, conn_id: str, http_mock
    ) -> None:
        """GeoServer has no GeoPackage output (without an extension): convert its GeoJSON."""
        geojson = (
            b'{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"n":1},'
            b'"geometry":{"type":"Point","coordinates":[115.2,-8.7]}}]}'
        )
        http_mock.add(
            "GET", "/geoserver/ows", content=geojson, headers={"content-type": "application/json"}
        )
        response = self._download(api_client, conn_id, "gpkg")
        assert response.status_code == status.HTTP_200_OK
        assert http_mock.calls[0].url.params["outputFormat"] == "application/json"
        assert response["Content-Disposition"] == 'attachment; filename="roads.gpkg"'
        assert b"".join(response.streaming_content).startswith(b"SQLite format 3")

    def test_private_dataset_the_user_may_not_see(
        self, api_client: APIClient, conn_id: str, http_mock
    ) -> None:
        """GeoServer's "unknown" for a hidden layer becomes a clear 404."""
        http_mock.add(
            "GET",
            "/geoserver/ows",
            content=b"<ServiceException>Feature type geonode:roads unknown</ServiceException>",
            headers={"content-type": "application/vnd.ogc.se_xml"},
        )
        response = self._download(api_client, conn_id, "csv")
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "private" in response.json()["error"]

    def test_password_connection_logs_in_again_for_a_hidden_dataset(
        self, api_client: APIClient, http_mock
    ) -> None:
        conn_id = api_client.post(
            "/api/geonode/connections",
            {"name": "GN", "url": "https://gn.example/", "username": "u", "password": "p"},
            format="json",
        ).json()["id"]
        http_mock.handle = _geoserver_by_token(
            http_mock, valid="new", body=b"CSV", content_type="text/csv"
        )
        with patch("apps.geonode.geoserver.get_access_token", side_effect=["old", "new"]):
            response = self._download(api_client, conn_id, "csv")
        assert response.status_code == status.HTTP_200_OK
        assert b"".join(response.streaming_content) == b"CSV"

    def test_other_geoserver_errors_pass_its_message_on(
        self, api_client: APIClient, conn_id: str, http_mock
    ) -> None:
        http_mock.add(
            "GET",
            "/geoserver/ows",
            content=b"<ServiceException>Too many features</ServiceException>",
            headers={"content-type": "text/xml"},
        )
        response = self._download(api_client, conn_id, "json")
        assert response.status_code == status.HTTP_502_BAD_GATEWAY
        assert response.json()["error"].endswith("Too many features")

    def test_rejects_unknown_formats_and_names(
        self, api_client: APIClient, conn_id: str, http_mock
    ) -> None:
        assert self._download(api_client, conn_id, "kml").status_code == 400
        assert self._download(api_client, conn_id, "shp", alternate="roads").status_code == 400
        assert http_mock.calls == []

    def test_unknown_connection(self, api_client: APIClient) -> None:
        response = self._download(api_client, "nope", "gpkg")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
@pytest.mark.api
class TestIcebergConnectionsAPI:
    """Tests for Iceberg connections endpoints."""

    def test_list_iceberg_connections(self, api_client: APIClient) -> None:
        """Test listing Iceberg connections."""
        response = api_client.get("/api/iceberg/connections")
        assert response.status_code == status.HTTP_200_OK

    def test_create_iceberg_connection(self, api_client: APIClient) -> None:
        """Test creating an Iceberg connection."""
        response = api_client.post(
            "/api/iceberg/connections",
            {
                "name": "Test Iceberg",
                "url": "http://localhost:8181",
                "warehouse": "s3://warehouse",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
@pytest.mark.api
class TestQFieldCloudConnectionsAPI:
    """Tests for QFieldCloud connections endpoints."""

    def test_list_qfieldcloud_connections(self, api_client: APIClient) -> None:
        """Test listing QFieldCloud connections."""
        response = api_client.get("/api/qfieldcloud/connections")
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
@pytest.mark.api
class TestMerginConnectionsAPI:
    """Tests for Mergin Maps connections endpoints."""

    def test_list_mergin_connections(self, api_client: APIClient) -> None:
        """Test listing Mergin Maps connections."""
        response = api_client.get("/api/mergin/connections")
        assert response.status_code == status.HTTP_200_OK
