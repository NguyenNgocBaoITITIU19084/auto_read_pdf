"""Tests for the loopback-only desktop-control API (backend/app/api/mobile.py)
mounted on the main app, plus the security invariants from the Task 4 brief.

The mocked-LanServer tests (TestStartSession/TestGetSession/TestPhotos/
TestDeleteSession/TestSecurity) never open a real socket: `lan_server.start`
and `lan_server.stop` are monkeypatched. The one real-port test
(TestRealPortIntegration) is separate, clearly marked, and always tears
down its session even if an assertion fails partway.
"""

import io

import httpx
import pytest
from fastapi.testclient import TestClient

import backend.app.api.mobile as mobile_api
from backend.app.main import app
from backend.app.mobile.app import mobile_app
from backend.app.services.mobile_bridge import bridge


@pytest.fixture(autouse=True)
def reset_bridge():
    try:
        bridge.stop()
    except Exception:
        pass
    yield
    try:
        bridge.stop()
    except Exception:
        pass


@pytest.fixture
def client():
    # Bare TestClient (no `with`): skips the main app's lifespan (init_db /
    # create_collection), so these tests never touch the real booking_data.db.
    return TestClient(app)


@pytest.fixture(autouse=True)
def fake_lan_server(monkeypatch):
    """Mock lan_server.start/stop so no real port is opened, and pin
    list_lan_ipv4() to a fixed, deterministic set of addresses."""

    class FakeLanServer:
        def __init__(self):
            self.port = None
            self.selected_ip = None
            self._running = False
            self.stop_calls = 0

        def start(self, app, host="0.0.0.0", preferred_port=8765):
            # Regression pin for the plan's one hard security requirement: the
            # LAN server must only ever be handed the phone-facing app, never
            # the main (loopback-only) app.
            assert app is mobile_app, "LanServer.start() must only ever be given mobile_app"
            self.port = 8765
            self._running = True
            return self.port

        def stop(self, timeout=3):
            self.stop_calls += 1
            self._running = False
            self.port = None
            self.selected_ip = None

        @property
        def running(self):
            return self._running

    fake = FakeLanServer()
    monkeypatch.setattr(mobile_api, "lan_server", fake)
    monkeypatch.setattr(
        mobile_api, "list_lan_ipv4", lambda: ["192.168.1.10", "192.168.1.11"]
    )
    return fake


def make_jpeg_bytes() -> bytes:
    return b"\xff\xd8\xff" + b"\x00" * 100


# ---------------------------------------------------------------------------
# POST /api/v1/mobile/session
# ---------------------------------------------------------------------------


class TestStartSession:
    def test_starts_session_and_returns_expected_shape(self, client, fake_lan_server):
        resp = client.post("/api/v1/mobile/session", json={})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["active"] is True
        assert body["session_id"]
        assert body["pair_url"].startswith("http://192.168.1.10:8765/#p=")
        assert body["ips"] == ["192.168.1.10", "192.168.1.11"]
        assert body["selected_ip"] == "192.168.1.10"
        assert body["port"] == 8765
        assert body["pairing_expires_at"]

    def test_explicit_ip_is_honored(self, client, fake_lan_server):
        resp = client.post("/api/v1/mobile/session", json={"ip": "192.168.1.11"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["selected_ip"] == "192.168.1.11"
        assert "192.168.1.11:8765" in body["pair_url"]

    def test_ip_not_in_list_returns_400(self, client, fake_lan_server):
        resp = client.post("/api/v1/mobile/session", json={"ip": "10.0.0.99"})
        assert resp.status_code == 400

    def test_calling_twice_is_idempotent_and_reuses_session(self, client, fake_lan_server):
        resp1 = client.post("/api/v1/mobile/session", json={})
        resp2 = client.post("/api/v1/mobile/session", json={})
        assert resp1.json()["session_id"] == resp2.json()["session_id"]


# ---------------------------------------------------------------------------
# GET /api/v1/mobile/session
# ---------------------------------------------------------------------------


class TestGetSession:
    def test_inactive_when_no_session(self, client, fake_lan_server):
        resp = client.get("/api/v1/mobile/session")
        assert resp.status_code == 200
        body = resp.json()
        assert body["active"] is False
        assert body["devices"] == []
        assert body["pending"] == []

    def test_active_session_reports_devices_and_pending(self, client, fake_lan_server):
        client.post("/api/v1/mobile/session", json={})
        session = bridge._session
        device = bridge.pair(session.pairing_token, "iPhone UA")
        bridge.add_photo(device.token, make_jpeg_bytes())

        resp = client.get("/api/v1/mobile/session")
        assert resp.status_code == 200
        body = resp.json()
        assert body["active"] is True
        assert len(body["devices"]) == 1
        assert set(body["devices"][0].keys()) == {"id", "label", "last_seen"}
        assert len(body["pending"]) == 1
        assert set(body["pending"][0].keys()) == {"id", "filename", "size", "received_at"}

    def test_active_session_keeps_ip_and_port_fields_across_a_poll(self, client, fake_lan_server):
        # Regression: GET must return the same connection-detail fields POST does, so the
        # desktop UI's IP picker (documented in README as the fix for multi-homed machines)
        # doesn't disappear on the very next 2s poll.
        start_body = client.post("/api/v1/mobile/session", json={}).json()

        resp = client.get("/api/v1/mobile/session")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ips"] == start_body["ips"]
        assert body["selected_ip"] == start_body["selected_ip"]
        assert body["port"] == start_body["port"]
        assert body["session_id"] == start_body["session_id"]
        assert body["pairing_expires_at"] == start_body["pairing_expires_at"]

    def test_response_never_contains_a_device_token(self, client, fake_lan_server):
        client.post("/api/v1/mobile/session", json={})
        session = bridge._session
        device = bridge.pair(session.pairing_token, "iPhone UA")

        resp = client.get("/api/v1/mobile/session")
        assert device.token not in resp.text

    def test_pair_url_is_always_the_latest_token(self, client, fake_lan_server):
        client.post("/api/v1/mobile/session", json={})
        pair_url_1 = client.get("/api/v1/mobile/session").json()["pair_url"]

        session = bridge._session
        bridge.pair(session.pairing_token, "iPhone UA")  # rotates the token

        pair_url_2 = client.get("/api/v1/mobile/session").json()["pair_url"]
        assert pair_url_1 != pair_url_2
        assert pair_url_2.split("#p=")[1] == bridge.snapshot()["pairing_token"]

    def test_expired_pairing_token_auto_rotates(self, client, fake_lan_server):
        client.post("/api/v1/mobile/session", json={})
        old_token = bridge.snapshot()["pairing_token"]
        bridge._session.pairing_expires_at = bridge._clock() - 1

        resp = client.get("/api/v1/mobile/session")
        assert resp.status_code == 200
        new_token = bridge.snapshot()["pairing_token"]
        assert new_token != old_token
        assert old_token not in resp.json()["pair_url"]


# ---------------------------------------------------------------------------
# GET/DELETE /api/v1/mobile/photos/{id}
# ---------------------------------------------------------------------------


class TestPhotos:
    def _pair_and_upload(self, client):
        client.post("/api/v1/mobile/session", json={})
        session = bridge._session
        device = bridge.pair(session.pairing_token, "iPhone UA")
        photo = bridge.add_photo(device.token, make_jpeg_bytes())
        return photo

    def test_get_photo_returns_jpeg_bytes(self, client, fake_lan_server):
        photo = self._pair_and_upload(client)
        resp = client.get(f"/api/v1/mobile/photos/{photo.id}")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.content == make_jpeg_bytes()

    def test_get_unknown_photo_returns_404(self, client, fake_lan_server):
        resp = client.get("/api/v1/mobile/photos/does-not-exist")
        assert resp.status_code == 404

    def test_delete_photo_returns_204_and_acks(self, client, fake_lan_server):
        photo = self._pair_and_upload(client)
        resp = client.delete(f"/api/v1/mobile/photos/{photo.id}")
        assert resp.status_code == 204
        assert client.get(f"/api/v1/mobile/photos/{photo.id}").status_code == 404

    def test_delete_unknown_photo_returns_404(self, client, fake_lan_server):
        resp = client.delete("/api/v1/mobile/photos/does-not-exist")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/v1/mobile/session
# ---------------------------------------------------------------------------


class TestDeleteSession:
    def test_deletes_session_and_stops_lan_server(self, client, fake_lan_server):
        client.post("/api/v1/mobile/session", json={})
        resp = client.delete("/api/v1/mobile/session")
        assert resp.status_code == 204
        assert fake_lan_server.stop_calls >= 1
        assert bridge.snapshot()["active"] is False

    def test_delete_without_active_session_still_succeeds(self, client, fake_lan_server):
        resp = client.delete("/api/v1/mobile/session")
        assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------


class TestSecurity:
    def test_main_app_has_no_pair_or_photos_routes(self):
        paths = {getattr(route, "path", None) for route in app.routes}
        assert "/api/pair" not in paths
        assert "/api/photos" not in paths

    def test_backend_host_defaults_to_loopback(self, monkeypatch):
        monkeypatch.delenv("HOST", raising=False)
        import importlib

        import backend.app.core.config as config_module

        reloaded = importlib.reload(config_module)
        try:
            assert reloaded.BACKEND_HOST == "127.0.0.1"
        finally:
            importlib.reload(config_module)  # restore normal module state

    def test_no_route_path_template_embeds_a_token_placeholder(self):
        # None of this task's new routes ever put a token value in a URL
        # path or query string (pairing_token lives only in request/response
        # bodies and in the pair_url fragment, which servers never receive).
        for route in app.routes:
            path = getattr(route, "path", None)
            if path is None:
                continue
            assert "token" not in path.lower()

    def test_get_session_response_never_contains_pairing_token_key(
        self, client, fake_lan_server
    ):
        client.post("/api/v1/mobile/session", json={})
        resp = client.get("/api/v1/mobile/session")
        assert "pairing_token" not in resp.text
        assert "device_token" not in resp.text


# ---------------------------------------------------------------------------
# Real-port integration test (Step 4 of the brief)
# ---------------------------------------------------------------------------


class TestRealPortIntegration:
    """The one test in this file that opens a real socket end-to-end:
    start a real session (real LanServer, real mobile_app), pair over the
    real LAN port with httpx, upload a JPEG, see it via GET /session, then
    delete the session and confirm the port is closed.

    Uses try/finally (not just a fixture) so a failing assertion mid-test
    still tears the session down and never leaks a background thread.
    """

    def test_full_real_port_flow(self):
        # Bypass the fake_lan_server autouse fixture entirely by driving the
        # real singletons directly, exactly as main.py wires them.
        from backend.app.services.lan_server import lan_server as real_lan_server
        from backend.app.mobile.app import mobile_app

        started = False
        port = None
        try:
            bridge.start()
            port = real_lan_server.start(mobile_app, host="127.0.0.1", preferred_port=18765)
            started = True

            base = f"http://127.0.0.1:{port}"
            pairing_token = bridge.snapshot()["pairing_token"]

            pair_resp = httpx.post(
                f"{base}/api/pair",
                json={"pairing_token": pairing_token},
                headers={"User-Agent": "iPhone UA"},
                timeout=5,
            )
            assert pair_resp.status_code == 200, pair_resp.text
            device_token = pair_resp.json()["device_token"]

            upload_resp = httpx.post(
                f"{base}/api/photos",
                files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
                headers={"X-Device-Token": device_token},
                timeout=5,
            )
            assert upload_resp.status_code == 201, upload_resp.text

            snap = bridge.snapshot()
            assert snap["pending_count"] == 1
        finally:
            bridge.stop()
            real_lan_server.stop()
            started = False

        # Port must now be closed: a new connection attempt should fail.
        with pytest.raises(httpx.ConnectError):
            httpx.get(f"http://127.0.0.1:{port}/", timeout=2)
