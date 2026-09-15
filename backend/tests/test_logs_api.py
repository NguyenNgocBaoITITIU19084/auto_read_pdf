import io
import json
import logging
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import logging_setup as ls
from backend.app.main import app
from backend.app.services import log_reader

API = "/api/v1"
FAKE_KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuv"


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
def env(tmp_path, fresh_db, monkeypatch):
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("LOG_DIR", str(log_dir))
    ls.configure_logging()
    import backend.app.api.logs as logs_api
    logs_api._rate_window.clear()
    return TestClient(app), log_dir


def _flush():
    for h in logging.getLogger().handlers:
        h.flush()


def test_read_entries_groups_tracebacks_and_filters(env):
    _, log_dir = env
    lg = logging.getLogger("backend.sample")
    lg.info("first info")
    try:
        raise ValueError("broken thing")
    except ValueError:
        lg.exception("upload failed")
    lg.warning("watch out")
    _flush()
    entries = log_reader.read_entries(log_dir, level="WARNING")
    assert [e["level"] for e in entries[:2]] == ["WARNING", "ERROR"]
    assert "Traceback" in entries[1]["message"] and "broken thing" in entries[1]["message"]
    assert log_reader.read_entries(log_dir, q="first")[0]["message"] == "first info"


def test_client_log_endpoint_writes_frontend_logger_and_rate_limits(env):
    client, log_dir = env
    res = client.post(f"{API}/logs/client", json={"level": "error", "message": "TypeError: x is undefined",
                                                  "stack": "at BookingTab", "url": "app://index.html"})
    assert res.json() == {"status": "ok"}
    _flush()
    assert "[frontend]" in (log_dir / ls.ERROR_LOG).read_text(encoding="utf-8")
    statuses = [client.post(f"{API}/logs/client", json={"level": "info", "message": "m"}).json()["status"] for _ in range(70)]
    assert "dropped" in statuses


def test_get_logs_endpoint(env):
    client, _ = env
    logging.getLogger("backend.sample").error("visible error")
    _flush()
    body = client.get(f"{API}/logs", params={"source": "errors", "q": "visible"}).json()
    assert body["entries"][0]["message"] == "visible error"


def test_export_zip_contains_logs_and_system_info_without_key(env, monkeypatch, tmp_path):
    client, _ = env
    db.set_system_setting("gemini_api_key", FAKE_KEY)
    electron_log = tmp_path / "backend.log"
    electron_log.write_text(f"[STDOUT] url?key={FAKE_KEY}\n", encoding="utf-8")
    monkeypatch.setenv("ELECTRON_BACKEND_LOG", str(electron_log))
    logging.getLogger("backend.sample").info(f"call with key={FAKE_KEY}")
    _flush()
    res = client.get(f"{API}/logs/export")
    assert res.status_code == 200 and res.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(res.content))
    names = zf.namelist()
    assert "logs/app.log" in names and "system_info.json" in names and "electron/backend.log" in names
    info = json.loads(zf.read("system_info.json"))
    assert info["gemini_key_configured"] is True
    for name in names:
        assert FAKE_KEY.encode() not in zf.read(name)
    db.set_system_setting("gemini_api_key", "")
