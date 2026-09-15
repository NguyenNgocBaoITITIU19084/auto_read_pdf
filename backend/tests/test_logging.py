import logging
import time
from pathlib import Path

import pytest

from backend.app.core import config
from backend.app.core.logging_setup import (
    configure_logging,
    get_log_dir,
    SensitiveDataFilter,
    APP_LOG_MAX_BYTES,
    APP_LOG_BACKUP_COUNT,
    ERROR_LOG_MAX_BYTES,
    ERROR_LOG_BACKUP_COUNT,
)


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


def test_get_log_dir_honors_env_override(monkeypatch, tmp_path):
    override = tmp_path / "custom_logs"
    monkeypatch.setenv("LOG_DIR", str(override))
    assert get_log_dir() == str(override)


def test_get_log_dir_falls_back_to_db_path_parent(monkeypatch):
    monkeypatch.delenv("LOG_DIR", raising=False)
    expected = str(Path(config.DB_PATH).resolve().parent / "logs")
    assert get_log_dir() == expected


def test_configure_logging_creates_rotating_handlers_with_spec_limits(monkeypatch, tmp_path):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()

    root = logging.getLogger()
    file_handlers = {Path(h.baseFilename).name: h for h in root.handlers if hasattr(h, "baseFilename")}

    assert set(file_handlers) == {"app.log", "errors.log"}
    assert file_handlers["app.log"].maxBytes == APP_LOG_MAX_BYTES
    assert file_handlers["app.log"].backupCount == APP_LOG_BACKUP_COUNT
    assert file_handlers["app.log"].level == logging.INFO
    assert file_handlers["errors.log"].maxBytes == ERROR_LOG_MAX_BYTES
    assert file_handlers["errors.log"].backupCount == ERROR_LOG_BACKUP_COUNT
    assert file_handlers["errors.log"].level == logging.WARNING


def test_info_goes_to_app_log_only_warning_goes_to_both(monkeypatch, tmp_path):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()
    logger = logging.getLogger("backend.tests.logging")

    logger.info("just an info line")
    logger.warning("something is off")

    app_log = (tmp_path / "app.log").read_text()
    error_log = (tmp_path / "errors.log").read_text()

    assert "just an info line" in app_log
    assert "something is off" in app_log
    assert "just an info line" not in error_log
    assert "something is off" in error_log


def test_gemini_key_masked_in_log_file(monkeypatch, tmp_path):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()
    logger = logging.getLogger("backend.tests.logging")

    secret = "AIzaSyREALSECRETVALUE1234567890"
    logger.info(f"calling gemini url ?key={secret}&model=x")
    logger.info('payload={"gemini_api_key": "%s", "other": 1}' % secret)

    app_log = (tmp_path / "app.log").read_text()
    assert secret not in app_log
    assert "***MASKED***" in app_log


def test_sensitive_filter_masks_api_key_param_directly():
    record = logging.LogRecord(
        name="x", level=logging.INFO, pathname=__file__, lineno=1,
        msg="GET /settings/ai/models?api_key=super-secret-value -> 200", args=(), exc_info=None,
    )
    SensitiveDataFilter().filter(record)
    assert "super-secret-value" not in record.getMessage()
    assert "***MASKED***" in record.getMessage()


def test_sensitive_filter_does_not_mask_unrelated_key_words():
    record = logging.LogRecord(
        name="x", level=logging.INFO, pathname=__file__, lineno=1,
        msg="filter by column_key=Carrier preset_id=purple", args=(), exc_info=None,
    )
    SensitiveDataFilter().filter(record)
    assert record.getMessage() == "filter by column_key=Carrier preset_id=purple"


def test_sensitive_filter_masks_key_in_gemini_url_inside_exception_text():
    secret = "AIzaSyREALSECRETVALUE1234567890"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={secret}"
    record = logging.LogRecord(
        name="x", level=logging.ERROR, pathname=__file__, lineno=1,
        msg=f"ConnectionError: HTTPSConnectionPool for {url}: timeout", args=(), exc_info=None,
    )
    SensitiveDataFilter().filter(record)
    message = record.getMessage()
    assert secret not in message
    assert "***MASKED***" in message


def test_log_timestamp_uses_vn_timezone_regardless_of_machine_tz(monkeypatch, tmp_path):
    if not hasattr(time, "tzset"):
        pytest.skip("time.tzset is POSIX-only")
    monkeypatch.setenv("TZ", "America/New_York")
    time.tzset()
    try:
        monkeypatch.setenv("LOG_DIR", str(tmp_path))
        configure_logging()
        logger = logging.getLogger("backend.tests.logging")
        logger.info("vn time check")

        app_log = (tmp_path / "app.log").read_text()
        line = next(l for l in app_log.splitlines() if "vn time check" in l)
        from backend.app.core.timezone import VN_TZ
        from datetime import datetime
        expected_prefix = datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M")
        assert line.startswith(expected_prefix)
    finally:
        monkeypatch.delenv("TZ", raising=False)
        time.tzset()


def test_request_middleware_logs_method_path_status_no_body(monkeypatch, tmp_path):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()

    from fastapi.testclient import TestClient
    from backend.app.main import app

    client = TestClient(app)
    # /health is a noisy polling endpoint logged at DEBUG (see test_request_logging.py),
    # so exercise a normal route to check the per-request INFO line still has no body.
    res = client.get("/api/v1/collections")
    assert res.status_code == 200

    app_log = (tmp_path / "app.log").read_text()
    assert "GET /api/v1/collections -> 200" in app_log
