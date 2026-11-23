"""Relay a chunked upload into one streaming request to GeoServer/GeoNode.

GeoServer and GeoNode only take a file as one request, and CloudBench has no
room to keep big files, so nothing is stored: the worker that starts an upload
(Relay.start) opens that request to the target at once and feeds it the chunks
as the browser sends them, holding at most QUEUE_CHUNKS of them. Chunks can
land in any gunicorn worker, so each one reaches the relay over a Unix socket
named after the session (send_chunk) - from the relay's own worker too, so
there's one way in.

A chunk the browser sends again after a dropped connection is acknowledged
without being sent twice. Nothing can be resumed on the target's side: when no
chunk comes for UPLOAD_RELAY_IDLE_TIMEOUT seconds, or the target drops the
request, the upload fails and has to start over.
See docs/dev-guide/upload-passthrough.md.
"""

import contextlib
import json
import logging
import queue
import socket
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from django.conf import settings

logger = logging.getLogger(__name__)

UPLOADING = "uploading"
PROCESSING = "processing"  # all sent, waiting for the target's answer
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"
DONE = (COMPLETED, FAILED, CANCELLED)

# Chunks held between the browser and the target (~15 MB with 5 MB chunks).
QUEUE_CHUNKS = 3
# How long a finished relay still answers status requests (seconds).
RESULT_TTL = 600
# How often a blocked wait looks for a cancel, a failure or idleness (seconds).
_TICK = 0.5
# Longest message header on the socket (bytes).
_MAX_HEADER = 4096


class RelayError(Exception):
    """A request the relay refused; `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400, **extra: Any) -> None:
        super().__init__(message)
        self.status = status
        self.extra = extra


class RelayGone(Exception):
    """No relay is listening for this session (finished long ago, or its worker died)."""


class _Stopped(Exception):
    """Raised inside the request body to abort the request to the target."""


def socket_path(session_id: str) -> Path:
    return Path(settings.UPLOAD_RELAY_SOCKET_DIR) / f"{session_id}.sock"


class Relay:
    """One upload: a socket taking chunks, and a thread sending them on.

    `send` makes the request to the target with the body it's given (an
    iterator of bytes, file_size long) and returns what the target answered;
    it raises when the target refuses. `on_done(state, error)` is called once
    the upload ends, from the relay's thread.
    """

    def __init__(
        self,
        session_id: str,
        file_size: int,
        chunk_size: int,
        send: Callable[[Iterator[bytes]], dict],
        on_done: Callable[[str, str], None] | None = None,
    ) -> None:
        self.session_id = str(session_id)
        self.file_size = file_size
        self.chunk_size = chunk_size
        self.total_chunks = -(-file_size // chunk_size)
        self._send = send
        self._on_done = on_done
        self._queue: queue.Queue[bytes] = queue.Queue(QUEUE_CHUNKS)
        self._accepting = threading.Lock()  # one chunk taken at a time
        self._lock = threading.Lock()  # state
        self._idle_timeout = settings.UPLOAD_RELAY_IDLE_TIMEOUT
        self._last_chunk = time.monotonic()
        self._done_at: float | None = None
        self._server: socket.socket | None = None
        self.next = 0
        self.state = UPLOADING
        self.error = ""
        self.result: dict | None = None

    def start(self) -> None:
        path = socket_path(self.session_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(path))
        server.listen()
        server.settimeout(_TICK)
        self._server = server
        name = f"upload-relay-{self.session_id[:8]}"
        threading.Thread(target=self._serve, name=f"{name}-socket", daemon=True).start()
        threading.Thread(target=self._run, name=name, daemon=True).start()

    # === Chunks in ===

    def accept(self, index: int, data: bytes) -> int:
        """Queue chunk `index` for the target; returns the next chunk expected."""
        if not 0 <= index < self.total_chunks:
            raise RelayError(f"Chunk {index} is out of range 0-{self.total_chunks - 1}")
        with self._accepting:
            self._last_chunk = time.monotonic()
            self._raise_if_ended()
            if index < self.next:
                # Sent again after a dropped connection; it's already on its way.
                return self.next
            if index > self.next:
                raise RelayError(
                    f"Expected chunk {self.next}, got {index}", status=409, next=self.next
                )
            expected = min(self.chunk_size, self.file_size - index * self.chunk_size)
            if len(data) != expected:
                raise RelayError(f"Chunk {index} should be {expected} bytes, got {len(data)}")
            while True:
                try:
                    self._queue.put(data, timeout=_TICK)
                    break
                except queue.Full:
                    # The target is slower than the browser: wait for room.
                    self._raise_if_ended()
            # It may have ended while this chunk waited.
            self._raise_if_ended()
            self._last_chunk = time.monotonic()
            with self._lock:
                self.next += 1
                if self.next == self.total_chunks and self.state == UPLOADING:
                    self.state = PROCESSING
            return self.next

    def cancel(self) -> None:
        with self._lock:
            if self.state == PROCESSING:
                raise RelayError("The file is already sent; it can't be cancelled now", 409)
            if self.state == UPLOADING:
                self.state = CANCELLED

    def status(self) -> dict:
        with self._lock:
            return {
                "state": self.state,
                "next": self.next,
                "totalChunks": self.total_chunks,
                "error": self.error,
                "result": self.result,
            }

    def _raise_if_ended(self) -> None:
        with self._lock:
            if self.state == FAILED:
                raise RelayError(self.error, status=409, state=FAILED)
            if self.state == CANCELLED:
                raise RelayError("The upload was cancelled", status=409, state=CANCELLED)

    # === Chunks out ===

    def _body(self) -> Iterator[bytes]:
        for _ in range(self.total_chunks):
            yield self._take()

    def _take(self) -> bytes:
        while True:
            with self._lock:
                if self.state == CANCELLED:
                    raise _Stopped("cancelled")
            try:
                return self._queue.get(timeout=_TICK)
            except queue.Empty:
                idle = time.monotonic() - self._last_chunk
                if idle > self._idle_timeout and not self._accepting.locked():
                    with self._lock:
                        self.error = (
                            f"No data came for {self._idle_timeout:g} seconds; "
                            "the upload has to start over"
                        )
                    raise _Stopped("idle") from None

    def _run(self) -> None:
        result = None
        try:
            result = self._send(self._body())
            state, error = COMPLETED, ""
        except Exception as e:
            with self._lock:
                cancelled = self.state == CANCELLED
                state = CANCELLED if cancelled else FAILED
                error = "" if cancelled else self.error or str(e) or e.__class__.__name__
                # Chunks still coming are refused from now on.
                self.state, self.error = state, error
            if not isinstance(e, _Stopped):
                logger.warning("Upload %s to the target failed: %s", self.session_id, e)
        # Unblock a chunk still waiting for room in the queue.
        with contextlib.suppress(queue.Empty):
            while True:
                self._queue.get_nowait()
        # Recorded before the status says it's over, so the two always agree.
        if self._on_done:
            try:
                self._on_done(state, error)
            except Exception:
                logger.exception("Recording the end of upload %s failed", self.session_id)
        with self._lock:
            self.state, self.error, self.result = state, error, result
        self._done_at = time.monotonic()

    # === Socket ===

    def _serve(self) -> None:
        server = self._server
        assert server is not None
        try:
            while self._done_at is None or time.monotonic() - self._done_at < RESULT_TTL:
                try:
                    conn, _ = server.accept()
                except TimeoutError:
                    continue
                threading.Thread(target=self._handle, args=(conn,), daemon=True).start()
        finally:
            server.close()
            with contextlib.suppress(FileNotFoundError):
                socket_path(self.session_id).unlink()

    def _handle(self, conn: socket.socket) -> None:
        with conn:
            conn.settimeout(settings.UPLOAD_RELAY_IDLE_TIMEOUT)
            try:
                header, data = _read_message(conn, max_data=self.chunk_size)
                op = header.get("op")
                if op == "chunk":
                    reply = {"ok": True, "next": self.accept(int(header["index"]), data)}
                elif op == "status":
                    reply = {"ok": True, **self.status()}
                elif op == "cancel":
                    self.cancel()
                    reply = {"ok": True, **self.status()}
                else:
                    raise RelayError(f"Unknown operation: {op}")
            except RelayError as e:
                reply = {"ok": False, "error": str(e), "status": e.status, **e.extra}
            except Exception as e:
                logger.exception("Upload relay %s: bad request", self.session_id)
                reply = {"ok": False, "error": f"Relay error: {e}", "status": 500}
            with contextlib.suppress(OSError):
                conn.sendall(json.dumps(reply).encode() + b"\n")


def _read_message(conn: socket.socket, max_data: int) -> tuple[dict, bytes]:
    """A header line (JSON, with the data's `size`) then that many bytes."""
    buffer = b""
    while b"\n" not in buffer:
        part = conn.recv(65536)
        if not part:
            raise RelayError("Connection closed before the header")
        buffer += part
        if len(buffer) > _MAX_HEADER + max_data:
            raise RelayError("Message too long")
    line, data = buffer.split(b"\n", 1)
    header = json.loads(line)
    size = int(header.get("size", 0))
    if size > max_data:
        raise RelayError(f"Chunk too big: {size} bytes")
    chunks = [data]
    received = len(data)
    while received < size:
        part = conn.recv(min(1 << 20, size - received))
        if not part:
            raise RelayError("Connection closed before the whole chunk arrived")
        chunks.append(part)
        received += len(part)
    return header, b"".join(chunks)[:size]


# === Talking to a relay (from any worker) ===


def _call(session_id: str, header: dict, data: bytes = b"") -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        # A chunk may wait for room while the target catches up.
        conn.settimeout(settings.UPLOAD_RELAY_IDLE_TIMEOUT * 2)
        try:
            conn.connect(str(socket_path(session_id)))
        except (FileNotFoundError, ConnectionRefusedError) as e:
            raise RelayGone(session_id) from e
        conn.sendall(json.dumps({**header, "size": len(data)}).encode() + b"\n" + data)
        reply = b""
        while not reply.endswith(b"\n"):
            part = conn.recv(65536)
            if not part:
                raise RelayGone(session_id)
            reply += part
    return json.loads(reply)


def send_chunk(session_id: str, index: int, data: bytes) -> dict:
    return _call(session_id, {"op": "chunk", "index": index}, data)


def get_status(session_id: str) -> dict:
    return _call(session_id, {"op": "status"})


def cancel(session_id: str) -> dict:
    return _call(session_id, {"op": "cancel"})
