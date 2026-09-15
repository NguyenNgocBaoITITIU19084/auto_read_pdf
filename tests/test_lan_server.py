"""Unit tests for LanServer's port selection and start/stop lifecycle.

These tests do start a real uvicorn thread on a real (ephemeral/free) port --
that is the whole point of the class -- but use a tiny throwaway FastAPI app
rather than the real `mobile_app`, and always stop the server in a
try/finally so a failing assertion never leaks a background thread/socket
into later tests.
"""

import socket
import threading
import time

import httpx
import pytest
from fastapi import FastAPI

from backend.app.services.lan_server import LanServer, _pick_free_port, _port_is_free


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def tiny_app():
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    return app


@pytest.fixture
def server():
    s = LanServer()
    yield s
    try:
        s.stop()
    except Exception:
        pass


class TestPortSelection:
    def test_port_is_free_detects_taken_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            port = sock.getsockname()[1]
            assert _port_is_free(port, "127.0.0.1") is False

    def test_pick_free_port_returns_something_bindable(self):
        port = _pick_free_port("127.0.0.1")
        assert _port_is_free(port, "127.0.0.1") is True


class TestLanServerLifecycle:
    def test_start_returns_a_port_and_serves_the_app(self, server, tiny_app):
        port = server.start(tiny_app, host="127.0.0.1", preferred_port=_free_port())
        try:
            assert server.running is True
            resp = httpx.get(f"http://127.0.0.1:{port}/ping", timeout=2)
            assert resp.status_code == 200
            assert resp.json() == {"ok": True}
        finally:
            server.stop()

    def test_stop_closes_the_port(self, server, tiny_app):
        port = server.start(tiny_app, host="127.0.0.1", preferred_port=_free_port())
        server.stop()
        assert server.running is False
        # A fresh socket should now be able to bind that port.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1)
            sock.bind(("127.0.0.1", port))

    def test_stop_is_idempotent(self, server, tiny_app):
        server.start(tiny_app, host="127.0.0.1", preferred_port=_free_port())
        server.stop()
        server.stop()  # must not raise

    def test_stop_without_start_is_noop(self, server):
        server.stop()  # must not raise

    def test_start_twice_reuses_running_server(self, server, tiny_app):
        port1 = server.start(tiny_app, host="127.0.0.1", preferred_port=_free_port())
        port2 = server.start(tiny_app, host="127.0.0.1", preferred_port=_free_port())
        assert port1 == port2
        server.stop()

    def test_falls_back_to_os_assigned_port_when_preferred_range_taken(
        self, server, tiny_app, monkeypatch
    ):
        import backend.app.services.lan_server as lan_server_module

        monkeypatch.setattr(lan_server_module, "_port_is_free", lambda port, host: False)
        # _pick_free_port's internal fallback still binds a real OS-assigned
        # port directly (it doesn't call the monkeypatched _port_is_free),
        # so start() should still succeed with *some* port.
        port = server.start(tiny_app, host="127.0.0.1", preferred_port=_free_port())
        assert isinstance(port, int) and port > 0
        server.stop()
