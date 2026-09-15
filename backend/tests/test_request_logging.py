import logging

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.core import logging_setup as ls
from backend.app.main import app


@pytest.fixture(autouse=True)
def _restore_root_handlers():
    """configure_logging() mutates the process-wide root logger; restore it after each test
    so this file never leaks handlers pointed at a throwaway tmp_path into other tests."""
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    yield
    for h in list(root.handlers):
        root.removeHandler(h)
    for h in original_handlers:
        root.addHandler(h)
    root.setLevel(original_level)


@pytest.fixture
def client(tmp_path, monkeypatch, fresh_db):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    ls.configure_logging()

    def boom():
        raise RuntimeError("kaboom api_key=AIzaSyA1234567890abcdefghijklmnopqrstuv")

    def not_found():
        raise HTTPException(status_code=404, detail="nope")

    app.add_api_route("/__test/boom", boom)
    app.add_api_route("/__test/missing", not_found)
    yield TestClient(app, raise_server_exceptions=False), tmp_path
    app.router.routes[:] = [r for r in app.router.routes if not getattr(r, "path", "").startswith("/__test")]


def _read(path):
    for h in logging.getLogger().handlers:
        h.flush()
    return path.read_text(encoding="utf-8")


def test_success_has_request_id_header_and_info_line(client):
    c, log_dir = client
    res = c.get("/api/v1/collections?api_key=secret999")
    rid = res.headers["X-Request-ID"]
    assert res.status_code == 200 and len(rid) >= 6
    content = _read(log_dir / ls.APP_LOG)
    assert f"[req={rid}] GET /api/v1/collections?api_key={ls.MASK} -> 200" in content
    assert "secret999" not in content


def test_unhandled_error_returns_lookup_code_and_traceback(client):
    c, log_dir = client
    res = c.get("/__test/boom", headers={"X-Request-ID": "support-case-42"})
    assert res.status_code == 500
    assert res.json()["request_id"] == "support-case-42"
    assert "support-case-42" in res.json()["detail"]
    errors = _read(log_dir / ls.ERROR_LOG)
    assert "[req=support-case-42]" in errors and "Traceback" in errors and "AIzaSy" not in errors


def test_client_error_logged_as_warning(client):
    c, log_dir = client
    c.get("/__test/missing")
    assert "GET /__test/missing -> 404" in _read(log_dir / ls.ERROR_LOG)


def test_noisy_polling_not_logged_at_info(client):
    c, log_dir = client
    c.get("/health")
    c.get("/api/v1/scheduler/status")
    content = _read(log_dir / ls.APP_LOG)
    # Only check our own per-request log line (not httpx's client-side "HTTP Request: ..."
    # line, which the test client itself emits and which also mentions these URLs).
    assert "GET /health ->" not in content and "GET /api/v1/scheduler/status ->" not in content


def test_invalid_incoming_request_id_is_replaced(client):
    c, _ = client
    res = c.get("/health", headers={"X-Request-ID": "bad id with spaces"})
    assert res.headers["X-Request-ID"] != "bad id with spaces"
