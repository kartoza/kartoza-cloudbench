"""Uploads relayed straight to GeoServer/GeoNode, never stored (apps/upload/relay.py)."""

import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.core.config import Connection
from apps.core.exceptions import GeoServerError
from apps.geonode.client import GeoNodeClient
from apps.geoserver.client import GeoServerClient
from apps.upload import relay
from apps.upload.models import UploadSession

CHUNK = 4


@pytest.fixture(autouse=True)
def relay_settings(settings):
    # Unix socket paths are short (~108 bytes): not under pytest's tmp_path.
    with tempfile.TemporaryDirectory(prefix="cbr-", dir="/tmp") as sockets:
        settings.UPLOAD_RELAY_SOCKET_DIR = sockets
        settings.UPLOAD_RELAY_IDLE_TIMEOUT = 2
        yield settings


class Target:
    """A fake GeoServer/GeoNode: reads the body as it's streamed."""

    def __init__(self, fail_after: int | None = None, result: dict | None = None):
        self.received = b""
        self.fail_after = fail_after
        self.result = result or {"ok": True}
        self.started = threading.Event()

    def send(self, content):
        self.started.set()
        for i, piece in enumerate(content):
            if self.fail_after is not None and i == self.fail_after:
                raise RuntimeError("GeoServer said no")
            self.received += piece
        return self.result


def start(target: Target, data: bytes, session_id: str = "s1", on_done=None) -> relay.Relay:
    upload = relay.Relay(session_id, len(data), CHUNK, target.send, on_done=on_done)
    upload.start()
    return upload


def wait_for(session_id: str, *states: str, timeout: float = 5) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = relay.get_status(session_id)
        if status["state"] in states:
            return status
        time.sleep(0.05)
    raise AssertionError(f"still {status['state']}")


def chunks(data: bytes) -> list[bytes]:
    return [data[i : i + CHUNK] for i in range(0, len(data), CHUNK)]


# === The relay ===


def test_chunks_reach_the_target_in_one_request():
    data = b"0123456789"
    target = Target(result={"storeName": "roads"})
    ended = []
    start(target, data, on_done=lambda state, error: ended.append((state, error)))
    for i, piece in enumerate(chunks(data)):
        assert relay.send_chunk("s1", i, piece) == {"ok": True, "next": i + 1}
    status = wait_for("s1", relay.COMPLETED)
    assert target.received == data
    assert status["result"] == {"storeName": "roads"}
    assert ended == [(relay.COMPLETED, "")]


def test_a_chunk_sent_again_is_acknowledged_not_sent_twice():
    data = b"01234567"
    target = Target()
    start(target, data)
    relay.send_chunk("s1", 0, b"0123")
    # The browser didn't get the answer and sends it again.
    assert relay.send_chunk("s1", 0, b"0123") == {"ok": True, "next": 1}
    relay.send_chunk("s1", 1, b"4567")
    wait_for("s1", relay.COMPLETED)
    assert target.received == data


def test_a_chunk_ahead_of_the_next_is_refused():
    start(Target(), b"01234567")
    reply = relay.send_chunk("s1", 1, b"4567")
    assert reply["ok"] is False
    assert reply["status"] == 409 and reply["next"] == 0


@pytest.mark.parametrize(
    "index, piece, error",
    [(0, b"012", "should be 4 bytes"), (1, b"456", "should be 2 bytes"), (5, b"", "range")],
)
def test_a_chunk_of_the_wrong_size_or_place_is_refused(index, piece, error):
    start(Target(), b"012345")
    if index == 1:
        relay.send_chunk("s1", 0, b"0123")
    reply = relay.send_chunk("s1", index, piece)
    assert reply["ok"] is False and reply["status"] == 400
    assert error in reply["error"]


def test_no_chunk_for_too_long_fails_the_upload():
    start(Target(), b"01234567")
    relay.send_chunk("s1", 0, b"0123")
    status = wait_for("s1", relay.FAILED)
    assert "No data came for 2 seconds" in status["error"]
    # A chunk arriving after that is told so; the browser starts over.
    reply = relay.send_chunk("s1", 1, b"4567")
    assert reply["status"] == 409 and reply["state"] == relay.FAILED


def test_the_target_failing_fails_the_upload():
    ended = []
    start(Target(fail_after=1), b"0123456789", on_done=lambda state, _error: ended.append(state))
    relay.send_chunk("s1", 0, b"0123")
    relay.send_chunk("s1", 1, b"4567")
    status = wait_for("s1", relay.FAILED)
    assert status["error"] == "GeoServer said no"
    assert ended == [relay.FAILED]
    assert relay.send_chunk("s1", 2, b"89")["error"] == "GeoServer said no"


def test_cancelling_stops_the_request_to_the_target():
    target = Target()
    ended = []
    start(target, b"01234567", on_done=lambda state, _error: ended.append(state))
    relay.send_chunk("s1", 0, b"0123")
    assert relay.cancel("s1")["state"] == relay.CANCELLED
    wait_for("s1", relay.CANCELLED)
    time.sleep(0.6)  # one tick for the body to notice
    assert ended == [relay.CANCELLED]
    assert relay.send_chunk("s1", 1, b"4567")["status"] == 409


def test_once_all_is_sent_it_cant_be_cancelled():
    answer = threading.Event()

    def slow_target(content):
        b"".join(content)
        answer.wait(5)
        return {}

    upload = relay.Relay("s1", 4, CHUNK, slow_target)
    upload.start()
    relay.send_chunk("s1", 0, b"0123")
    reply = relay.cancel("s1")
    assert reply["status"] == 409 and "already sent" in reply["error"]
    answer.set()
    wait_for("s1", relay.COMPLETED)


def test_a_slow_target_holds_the_browser_back():
    """At most QUEUE_CHUNKS wait in memory: the next chunk waits for room."""
    go = threading.Event()

    def slow_target(content):
        go.wait(5)
        return {"size": len(b"".join(content))}

    data = bytes(CHUNK * (relay.QUEUE_CHUNKS + 1))
    relay.Relay("s1", len(data), CHUNK, slow_target).start()
    for i in range(relay.QUEUE_CHUNKS):
        relay.send_chunk("s1", i, data[:CHUNK])
    last = []
    sender = threading.Thread(
        target=lambda: last.append(relay.send_chunk("s1", relay.QUEUE_CHUNKS, data[:CHUNK]))
    )
    sender.start()
    sender.join(0.5)
    assert sender.is_alive() and not last  # waiting for room
    go.set()
    sender.join(5)
    assert last[0]["ok"]
    assert wait_for("s1", relay.COMPLETED)["result"] == {"size": len(data)}


def test_no_relay_for_an_unknown_session():
    with pytest.raises(relay.RelayGone):
        relay.get_status("nope")


# === On the wire ===


class _Recorder(BaseHTTPRequestHandler):
    requests: list = []

    def do_PUT(self):  # noqa: N802 - http.server's naming
        length = int(self.headers["Content-Length"])
        type(self).requests.append((self.path, dict(self.headers), self.rfile.read(length)))
        self.send_response(201)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


def test_geoserver_gets_one_plain_put_with_a_content_length():
    """A real HTTP server sees an ordinary upload: Content-Length, not chunked."""
    _Recorder.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        client = GeoServerClient(
            Connection(
                id="c",
                name="gs",
                url=f"http://127.0.0.1:{server.server_port}/geoserver",
                username="admin",
                password="pw",
            )
        )
        result = client.upload_store_file("ws", "roads", "roads.zip", iter([b"PK", b"zip"]), 5, 30)
    finally:
        server.shutdown()
    assert result == {"storeName": "roads", "storeType": "shapefile"}
    [(path, headers, body)] = _Recorder.requests
    assert path == "/geoserver/rest/workspaces/ws/datastores/roads/file.shp?charset=UTF-8"
    assert headers["Content-Length"] == "5" and "Transfer-Encoding" not in headers
    assert headers["Content-Type"] == "application/zip"
    assert body == b"PKzip"


@pytest.mark.parametrize(
    "filename, url",
    [
        ("dem.TIF", "/rest/workspaces/ws/coveragestores/dem/file.geotiff"),
        ("db.gpkg", "/rest/workspaces/ws/datastores/db/file.gpkg"),
    ],
)
def test_geoserver_store_types(http_mock, filename, url):
    http_mock.add("PUT", url, status=201)
    client = GeoServerClient(
        Connection(id="c", name="gs", url="http://gs", username="", password="")
    )
    store = filename.split(".")[0]
    client.upload_store_file("ws", store, filename, [b"x"], 1, 30)
    assert http_mock.calls[0].content == b"x"


def test_geoserver_refusing_says_why(http_mock):
    http_mock.add("PUT", "/rest/workspaces/ws/datastores/r/file.shp", status=500, text="bad zip")
    client = GeoServerClient(
        Connection(id="c", name="gs", url="http://gs", username="", password="")
    )
    with pytest.raises(GeoServerError, match="bad zip"):
        client.upload_store_file("ws", "r", "r.zip", [b"x"], 1, 30)


# === The endpoints ===


@pytest.fixture
def geoserver():
    client = MagicMock(spec=GeoServerClient)
    target = Target()
    client.upload_store_file.side_effect = lambda _ws, store, _name, content, _size, _timeout: (
        target.send(content) and {"storeName": store, "storeType": "shapefile"}
    )
    client.target = target
    with patch("apps.upload.views.get_geoserver_client", return_value=client):
        yield client


@pytest.fixture
def geonode():
    client = MagicMock(spec=GeoNodeClient)
    client.url = "http://geonode"
    client.get_upload_size_limit.return_value = None
    target = Target(result={"execution_id": "e1"})
    client.upload_dataset.side_effect = lambda content, *_args, **_kwargs: target.send(content)
    client.target = target
    with patch("apps.upload.views.get_geonode_client", return_value=client):
        yield client


def put_chunk(api: APIClient, session_id: str, index: int, data: bytes):
    return api.put(
        f"/api/upload/relay/{session_id}/chunks/{index}",
        data=data,
        content_type="application/octet-stream",
    )


def poll(api: APIClient, session_id: str, *states: str) -> dict:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        body = api.get(f"/api/upload/relay/{session_id}").json()
        if body["state"] in states:
            return body
        time.sleep(0.05)
    raise AssertionError(body)


GEOSERVER_UPLOAD = {
    "target": "geoserver",
    "connectionId": "c1",
    "workspace": "ws",
    "filename": "roads.zip",
    "fileSize": 6,
    "chunkSize": 1024 * 1024,
}


@pytest.mark.django_db(transaction=True)
def test_upload_to_geoserver(authenticated_api_client, geoserver):
    api = authenticated_api_client
    started = api.post("/api/upload/relay", GEOSERVER_UPLOAD, format="json")
    assert started.status_code == 201, started.json()
    body = started.json()
    assert body["totalChunks"] == 1 and body["storeName"] == "roads"
    geoserver.get_workspace.assert_called_once_with("ws")

    sent = put_chunk(api, body["sessionId"], 0, b"PKroad")
    assert sent.status_code == 200 and sent.json() == {"next": 1}
    done = poll(api, body["sessionId"], "completed")
    assert done["result"] == {"storeName": "roads", "storeType": "shapefile"}
    assert geoserver.target.received == b"PKroad"
    # Nothing was written to disk.
    session = UploadSession.objects.get(session_id=body["sessionId"])
    assert session.upload_dir == "" and session.completed


@pytest.mark.django_db
@pytest.mark.parametrize(
    "change, error",
    [
        ({"target": "ftp"}, "target must be"),
        ({"filename": "roads.shp"}, "Unsupported file type"),
        ({"fileSize": 0}, "filename and fileSize are required"),
        ({"workspace": ""}, "workspace is required"),
        ({"storeName": "a b"}, "Store name must"),
        ({"chunkSize": 10}, "chunkSize must be"),
    ],
)
def test_upload_refused_before_it_starts(authenticated_api_client, geoserver, change, error):
    response = authenticated_api_client.post(
        "/api/upload/relay", {**GEOSERVER_UPLOAD, **change}, format="json"
    )
    assert response.status_code == 400
    assert error in response.json()["error"]


@pytest.mark.django_db
def test_upload_to_a_missing_workspace(authenticated_api_client, geoserver):
    geoserver.get_workspace.side_effect = GeoServerError("Resource not found", status_code=404)
    response = authenticated_api_client.post("/api/upload/relay", GEOSERVER_UPLOAD, format="json")
    assert response.status_code == 400 and response.json()["error"] == "Workspace not found"


@pytest.mark.django_db(transaction=True)
def test_upload_to_geonode(authenticated_api_client, geonode):
    api = authenticated_api_client
    started = api.post(
        "/api/upload/relay",
        {
            "target": "geonode",
            "connectionId": "g1",
            "filename": "dem.tif",
            "fileSize": 3,
            "title": "DEM",
        },
        format="json",
    )
    assert started.status_code == 201, started.json()
    session_id = started.json()["sessionId"]
    put_chunk(api, session_id, 0, b"tif")
    assert poll(api, session_id, "completed")["result"] == {"execution_id": "e1"}
    assert geonode.target.received == b"tif"
    assert geonode.upload_dataset.call_args.kwargs["title"] == "DEM"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("field", ["zip_file", "base_file"])
def test_a_zip_goes_where_the_geonode_takes_it(authenticated_api_client, geonode, field):
    geonode.zip_upload_field.return_value = field
    api = authenticated_api_client
    session_id = api.post(
        "/api/upload/relay",
        {"target": "geonode", "connectionId": "g1", "filename": "roads.zip", "fileSize": 3},
        format="json",
    ).json()["sessionId"]
    put_chunk(api, session_id, 0, b"zip")
    poll(api, session_id, "completed")
    assert geonode.upload_dataset.call_args.kwargs["zip_field"] == field


@pytest.mark.django_db
def test_only_a_zipped_dataset_asks(authenticated_api_client, geonode):
    authenticated_api_client.post(
        "/api/upload/relay",
        {"target": "geonode", "connectionId": "g1", "filename": "dem.tif", "fileSize": 3},
        format="json",
    )
    geonode.zip_upload_field.assert_not_called()


@pytest.mark.django_db
def test_too_big_for_geonode_is_refused_up_front(authenticated_api_client, geonode):
    geonode.get_upload_size_limit.side_effect = lambda slug: {
        "dataset_upload_size": 10 * 1024 * 1024
    }.get(slug)
    response = authenticated_api_client.post(
        "/api/upload/relay",
        {"target": "geonode", "connectionId": "g1", "filename": "big.tif", "fileSize": 20 << 20},
        format="json",
    )
    assert response.status_code == 413
    assert "up to 10 MB (20 MB given)" in response.json()["error"]
    geonode.upload_dataset.assert_not_called()


@pytest.mark.django_db(transaction=True)
def test_someone_elses_upload_is_not_found(authenticated_api_client, geoserver, django_user_model):
    session_id = authenticated_api_client.post(
        "/api/upload/relay", GEOSERVER_UPLOAD, format="json"
    ).json()["sessionId"]
    other = APIClient()
    other.force_authenticate(user=django_user_model.objects.create_user(username="other"))
    assert put_chunk(other, session_id, 0, b"PKroad").status_code == 404
    assert other.get(f"/api/upload/relay/{session_id}").status_code == 404
    assert other.delete(f"/api/upload/relay/{session_id}").status_code == 404
    authenticated_api_client.delete(f"/api/upload/relay/{session_id}")


@pytest.mark.django_db(transaction=True)
def test_cancel_an_upload(authenticated_api_client, geoserver):
    api = authenticated_api_client
    session_id = api.post(
        "/api/upload/relay", {**GEOSERVER_UPLOAD, "fileSize": 3 << 20}, format="json"
    ).json()["sessionId"]
    put_chunk(api, session_id, 0, bytes(1 << 20))
    assert api.delete(f"/api/upload/relay/{session_id}").json()["state"] == "cancelled"
    assert put_chunk(api, session_id, 1, bytes(1 << 20)).status_code == 409


@pytest.mark.django_db
def test_a_relay_that_is_gone(authenticated_api_client, django_user_model):
    """Its worker restarted: the session row says what's known."""
    user = django_user_model.objects.get(username="test-user")
    session = UploadSession.objects.create(
        user=user, filename="a.zip", file_size=1, chunk_size=1, total_chunks=1
    )
    api = authenticated_api_client
    assert put_chunk(api, session.session_id, 0, b"x").status_code == 410
    status = api.get(f"/api/upload/relay/{session.session_id}").json()
    assert status["state"] == "failed" and "interrupted" in status["error"]
    session.completed = True
    session.save()
    assert api.get(f"/api/upload/relay/{session.session_id}").json()["state"] == "completed"
