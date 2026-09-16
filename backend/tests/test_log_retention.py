import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from backend.app.core.timezone import VN_TZ
from backend.app.core.logging_setup import (
    configure_logging,
    get_log_dir,
    purge_old_logs,
    APP_LOG,
    ERROR_LOG,
)


@pytest.fixture(autouse=True)
def _restore_root_handlers():
    """purge_old_logs()/configure_logging() mutate the process-wide root logger; restore it
    after each test so this file never leaks handlers pointed at a throwaway tmp_path."""
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    yield
    for h in list(root.handlers):
        root.removeHandler(h)
        if h not in original_handlers:
            try:
                h.close()
            except Exception:
                pass
    for h in original_handlers:
        if h not in root.handlers:
            root.addHandler(h)
    root.setLevel(original_level)


def _ts(days_ago: float) -> str:
    dt = datetime.now(VN_TZ) - timedelta(days=days_ago)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def test_purge_old_logs_trims_stale_blocks_from_active_log_file(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    log_path = tmp_path / APP_LOG

    old_line = f"{_ts(5)} [INFO] [x]: old message"
    old_traceback = "Traceback (most recent call last):\n  File \"x.py\", line 1\nValueError: boom"
    new_line = f"{_ts(1)} [INFO] [x]: new message"
    new_traceback = "Traceback (most recent call last):\n  File \"y.py\", line 2\nRuntimeError: oops"

    content = "\n".join([old_line, old_traceback, new_line, new_traceback]) + "\n"
    log_path.write_text(content, encoding="utf-8")

    result = purge_old_logs(max_age_days=3)

    remaining = log_path.read_text(encoding="utf-8")
    assert "old message" not in remaining
    assert "Traceback (most recent call last):\n  File \"x.py\", line 1\nValueError: boom" not in remaining
    assert "new message" in remaining
    assert "RuntimeError: oops" in remaining
    assert result["trimmed_files"][APP_LOG] > 0


def test_purge_old_logs_keeps_all_lines_when_nothing_is_stale(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    log_path = tmp_path / APP_LOG

    line1 = f"{_ts(0.5)} [INFO] [x]: fresh one"
    line2 = f"{_ts(0.1)} [INFO] [x]: fresh two"
    content = "\n".join([line1, line2]) + "\n"
    log_path.write_text(content, encoding="utf-8")

    result = purge_old_logs(max_age_days=3)

    remaining = log_path.read_text(encoding="utf-8")
    assert "fresh one" in remaining
    assert "fresh two" in remaining
    assert result["trimmed_files"][APP_LOG] == 0


def test_purge_old_logs_safely_trims_file_with_open_handler(tmp_path, monkeypatch):
    """Trimming must not break subsequent writes through the live RotatingFileHandler."""
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()
    logger = logging.getLogger("backend.tests.log_retention")

    old_line = f"{_ts(10)} [INFO] [x]: stale entry"
    log_path = Path(get_log_dir()) / APP_LOG
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(old_line + "\n")

    purge_old_logs(max_age_days=3)

    # File should no longer contain the stale line
    assert "stale entry" not in log_path.read_text(encoding="utf-8")

    # Handler must still be able to write after the trim
    logger.info("post-purge write works")
    content = log_path.read_text(encoding="utf-8")
    assert "post-purge write works" in content


def test_purge_old_logs_deletes_stale_rotated_backup_files(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    (tmp_path / APP_LOG).write_text(f"{_ts(0.1)} [INFO] [x]: current\n", encoding="utf-8")

    old_backup = tmp_path / f"{APP_LOG}.1"
    old_backup.write_text("old rotated content\n", encoding="utf-8")
    old_time = time.time() - (4 * 86400)
    os.utime(old_backup, (old_time, old_time))

    fresh_backup = tmp_path / f"{APP_LOG}.2"
    fresh_backup.write_text("fresh rotated content\n", encoding="utf-8")
    fresh_time = time.time() - (1 * 86400)
    os.utime(fresh_backup, (fresh_time, fresh_time))

    result = purge_old_logs(max_age_days=3)

    assert not old_backup.exists()
    assert fresh_backup.exists()
    assert str(old_backup) in result["deleted_backups"]
    assert str(fresh_backup) not in result["deleted_backups"]


def test_purge_old_logs_handles_missing_files_gracefully(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    result = purge_old_logs(max_age_days=3)
    assert result["deleted_backups"] == []
    assert result["trimmed_files"] == {APP_LOG: 0, ERROR_LOG: 0}


def test_purge_old_logs_trims_errors_log_too(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    error_path = tmp_path / ERROR_LOG
    old_line = f"{_ts(5)} [ERROR] [x]: old error"
    new_line = f"{_ts(0.1)} [ERROR] [x]: new error"
    error_path.write_text("\n".join([old_line, new_line]) + "\n", encoding="utf-8")

    result = purge_old_logs(max_age_days=3)

    remaining = error_path.read_text(encoding="utf-8")
    assert "old error" not in remaining
    assert "new error" in remaining
    assert result["trimmed_files"][ERROR_LOG] == 1
