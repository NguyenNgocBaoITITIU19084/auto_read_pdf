"""Tests for the LAN-only mobile FastAPI app (pairing + photo upload).

Uses TestClient(mobile_app) in-process — no real network binding happens in
this task (that's Task 4). The module-level `bridge` singleton from
mobile_bridge is reset around every test since the app imports and uses it
directly.
"""

import io

import pytest
from fastapi.testclient import TestClient

from backend.app.mobile.app import mobile_app, MAX_CONTENT_LENGTH_BYTES
from backend.app.services.mobile_bridge import bridge, MAX_PHOTO_BYTES


@pytest.fixture(autouse=True)
def reset_bridge():
    """Ensure a clean bridge session before and after every test."""
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
    return TestClient(mobile_app)


def make_jpeg_bytes(size: int = 128) -> bytes:
    return b"\xff\xd8\xff" + b"\x00" * max(size - 3, 0)


def make_png_bytes() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 50


def make_heic_bytes() -> bytes:
    return b"\x00\x00\x00\x18ftypheic" + b"\x00" * 40


def pair_device(client) -> str:
    """Start a session, pair a device, return its device_token."""
    session = bridge.start()
    resp = client.post(
        "/api/pair",
        json={"pairing_token": session.pairing_token},
        headers={"User-Agent": "iPhone UA"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["device_token"]


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------


class TestIndexPage:
    def test_returns_html_with_security_headers(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        assert resp.headers["cache-control"] == "no-store"
        assert resp.headers["referrer-policy"] == "no-referrer"
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_security_headers_present_on_404(self, client):
        resp = client.get("/does-not-exist")
        assert resp.status_code == 404
        assert resp.headers["cache-control"] == "no-store"
        assert resp.headers["referrer-policy"] == "no-referrer"
        assert resp.headers["x-content-type-options"] == "nosniff"


class TestIndexPageStructure:
    """Pin the HTML structure of the real capture page (Task 5) so a future
    edit can't silently drop the camera input or break the JS wiring. These
    tests can't execute the page's JS (no browser in pytest) -- they only
    check the served markup/script text.
    """

    def test_camera_input_uses_capture_environment(self, client):
        html = client.get("/").text
        assert 'capture="environment"' in html
        assert 'accept="image/*"' in html

    def test_secondary_picker_input_allows_multiple_no_capture(self, client):
        html = client.get("/").text
        assert 'id="pickInput"' in html
        pick_input_start = html.index('id="pickInput"')
        # Scan back to the start of this <input ...> tag to check its
        # attributes without also matching the capture input above it.
        tag_start = html.rindex("<input", 0, pick_input_start)
        tag_end = html.index(">", tag_start)
        tag = html[tag_start:tag_end]
        assert "multiple" in tag
        assert "capture=" not in tag

    def test_capture_and_pick_buttons_present(self, client):
        html = client.get("/").text
        assert 'id="captureBtn"' in html
        assert 'id="pickBtn"' in html
        assert 'id="captureInput"' in html

    def test_script_references_api_routes(self, client):
        html = client.get("/").text
        assert "<script>" in html
        assert "/api/pair" in html
        assert "/api/photos" in html
        assert "/api/status" in html

    def test_script_reads_and_strips_location_hash(self, client):
        html = client.get("/").text
        assert "location.hash" in html
        assert "history.replaceState" in html

    def test_script_uses_session_storage_for_device_token(self, client):
        html = client.get("/").text
        assert "sessionStorage" in html
        assert "device_token" in html

    def test_bilingual_strings_present(self, client):
        html = client.get("/").text
        # Spot-check one Vietnamese and one English string from the i18n
        # table, plus the navigator.language selection logic.
        assert "navigator.language" in html
        assert "vi:" in html
        assert "en:" in html


# ---------------------------------------------------------------------------
# POST /api/pair
# ---------------------------------------------------------------------------


class TestPairEndpoint:
    def test_correct_token_returns_device_and_session(self, client):
        session = bridge.start()
        resp = client.post(
            "/api/pair",
            json={"pairing_token": session.pairing_token},
            headers={"User-Agent": "iPhone UA"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["device_token"]
        assert body["session_id"] == session.id

    def test_wrong_token_returns_401_pair_invalid(self, client):
        bridge.start()
        resp = client.post(
            "/api/pair",
            json={"pairing_token": "not-the-real-token"},
            headers={"User-Agent": "iPhone UA"},
        )
        assert resp.status_code == 401
        assert resp.json() == {"code": "pair_invalid"}

    def test_expired_token_returns_401_pair_invalid(self, client, monkeypatch):
        session = bridge.start()
        # Force expiry by rewriting the session's expiry into the past.
        bridge._session.pairing_expires_at = bridge._clock() - 1
        resp = client.post(
            "/api/pair",
            json={"pairing_token": session.pairing_token},
            headers={"User-Agent": "iPhone UA"},
        )
        assert resp.status_code == 401
        assert resp.json() == {"code": "pair_invalid"}

    def test_no_active_session_returns_409_no_session(self, client):
        resp = client.post(
            "/api/pair",
            json={"pairing_token": "whatever"},
            headers={"User-Agent": "iPhone UA"},
        )
        assert resp.status_code == 409
        assert resp.json() == {"code": "no_session"}


# ---------------------------------------------------------------------------
# POST /api/photos
# ---------------------------------------------------------------------------


class TestPhotosEndpoint:
    def test_missing_device_token_returns_401(self, client):
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 401

    def test_wrong_device_token_returns_401(self, client):
        bridge.start()
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": "not-a-real-token"},
        )
        assert resp.status_code == 401

    def test_valid_upload_returns_201_with_photo_id(self, client):
        token = pair_device(client)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["photo_id"]

    def test_png_upload_accepted(self, client):
        token = pair_device(client)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.png", make_png_bytes(), "image/png")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 201, resp.text

    def test_too_large_returns_413(self, client):
        token = pair_device(client)
        oversized = make_jpeg_bytes(MAX_PHOTO_BYTES + 1024)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", oversized, "image/jpeg")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 413
        assert resp.json() == {"code": "too_large"}

    def test_content_length_over_16mb_rejected_before_body_read(self, client):
        token = pair_device(client)
        huge = make_jpeg_bytes(17 * 1024 * 1024)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", huge, "image/jpeg")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 413
        assert resp.json() == {"code": "too_large"}

    def test_junk_content_length_header_does_not_500(self, client):
        token = pair_device(client)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": token, "Content-Length": "not-a-number"},
        )
        assert resp.status_code != 500

    def test_unsupported_type_returns_415_bad_type(self, client):
        token = pair_device(client)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.txt", b"not an image at all", "text/plain")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 415
        assert resp.json() == {"code": "bad_type"}

    def test_heic_returns_415_heic(self, client):
        token = pair_device(client)
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.heic", make_heic_bytes(), "image/heic")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 415
        assert resp.json() == {"code": "heic"}

    def test_queue_full_returns_429(self, client):
        token = pair_device(client)
        for _ in range(30):
            resp = client.post(
                "/api/photos",
                files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
                headers={"X-Device-Token": token},
            )
            assert resp.status_code == 201
        resp = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": token},
        )
        assert resp.status_code == 429
        assert resp.json() == {"code": "queue_full"}


# ---------------------------------------------------------------------------
# GET /api/status
# ---------------------------------------------------------------------------


class TestStatusEndpoint:
    def test_status_reports_connected_and_queued_photos(self, client):
        token = pair_device(client)
        upload = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": token},
        )
        photo_id = upload.json()["photo_id"]

        resp = client.get("/api/status", headers={"X-Device-Token": token})
        assert resp.status_code == 200
        body = resp.json()
        assert body["connected"] is True
        assert {"photo_id": photo_id, "state": "queued"} in body["photos"]

    def test_status_unknown_token_reports_not_connected(self, client):
        bridge.start()
        resp = client.get("/api/status", headers={"X-Device-Token": "bogus"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["connected"] is False
        assert body["photos"] == []

    def test_status_does_not_leak_another_devices_photos(self, client):
        """Two phones paired into the same session must only see their own
        photos via /api/status -- this is the exact scoping bug being fixed."""
        session = bridge.start()
        pair_a = client.post(
            "/api/pair",
            json={"pairing_token": session.pairing_token},
            headers={"User-Agent": "iPhone UA"},
        )
        token_a = pair_a.json()["device_token"]

        pairing_token_2 = bridge.snapshot()["pairing_token"]
        pair_b = client.post(
            "/api/pair",
            json={"pairing_token": pairing_token_2},
            headers={"User-Agent": "Android UA"},
        )
        token_b = pair_b.json()["device_token"]

        upload_a = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": token_a},
        )
        photo_id_a = upload_a.json()["photo_id"]

        resp_a = client.get("/api/status", headers={"X-Device-Token": token_a})
        assert {"photo_id": photo_id_a, "state": "queued"} in resp_a.json()["photos"]

        resp_b = client.get("/api/status", headers={"X-Device-Token": token_b})
        body_b = resp_b.json()
        assert body_b["connected"] is True
        assert body_b["photos"] == []

    def test_status_reports_received_state_after_ack(self, client):
        token = pair_device(client)
        upload = client.post(
            "/api/photos",
            files={"file": ("photo.jpg", make_jpeg_bytes(), "image/jpeg")},
            headers={"X-Device-Token": token},
        )
        photo_id = upload.json()["photo_id"]

        bridge.ack(photo_id)

        resp = client.get("/api/status", headers={"X-Device-Token": token})
        assert resp.status_code == 200
        body = resp.json()
        assert {"photo_id": photo_id, "state": "received"} in body["photos"]


# ---------------------------------------------------------------------------
# Isolation from the main app / no CORS
# ---------------------------------------------------------------------------


class TestIsolationFromMainApp:
    def test_main_app_route_404s(self, client):
        resp = client.get("/api/v1/bookings")
        assert resp.status_code == 404

    def test_no_cors_headers_on_get(self, client):
        resp = client.get("/", headers={"Origin": "http://evil.lan"})
        assert "access-control-allow-origin" not in resp.headers

    def test_no_cors_headers_on_preflight(self, client):
        resp = client.options(
            "/api/status",
            headers={
                "Origin": "http://evil.lan",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert "access-control-allow-origin" not in resp.headers
