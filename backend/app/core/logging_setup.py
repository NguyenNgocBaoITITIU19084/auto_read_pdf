import logging
import logging.handlers
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from backend.app.core.config import DB_PATH
from backend.app.core.timezone import VN_TZ

APP_LOG_MAX_BYTES = 5 * 1024 * 1024
APP_LOG_BACKUP_COUNT = 5
ERROR_LOG_MAX_BYTES = 2 * 1024 * 1024
ERROR_LOG_BACKUP_COUNT = 3

MASK = "***MASKED***"
# Named kwarg style, unambiguous even bare: api_key=..., gemini_api_key=...
_SENSITIVE_NAMED_KV_RE = re.compile(r"(?i)\b((?:gemini_)?api_key)\s*=\s*[^&\s\"'}]+")
# Bare `key=` is only treated as sensitive in URL query-param position (?key=... / &key=...),
# since "key" alone is too common a word/dict-field to mask everywhere it appears.
_SENSITIVE_URL_KEY_RE = re.compile(r"(?i)([?&])key=[^&\s\"'}]+")
# Dict/JSON-ish style with either quote char: "api_key": "...", 'key': '...'
_SENSITIVE_QUOTED_RE = re.compile(r"""(?i)(['"](?:gemini_)?(?:api_)?key['"]\s*:\s*['"])[^'"]*(['"])""")


def _mask_sensitive(text: str) -> str:
    if not text:
        return text
    text = _SENSITIVE_NAMED_KV_RE.sub(lambda m: f"{m.group(1)}={MASK}", text)
    text = _SENSITIVE_URL_KEY_RE.sub(lambda m: f"{m.group(1)}key={MASK}", text)
    text = _SENSITIVE_QUOTED_RE.sub(lambda m: f"{m.group(1)}{MASK}{m.group(2)}", text)
    return text


class SensitiveDataFilter(logging.Filter):
    """Masks Gemini API keys and api_key/key params before any handler writes them out."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = _mask_sensitive(record.getMessage())
            record.args = ()
        except Exception:
            pass
        return True


class VnTimeFormatter(logging.Formatter):
    """Formats log timestamps in Asia/Ho_Chi_Minh, independent of the machine's timezone."""

    def formatTime(self, record: logging.LogRecord, datefmt: str = None) -> str:
        dt = datetime.fromtimestamp(record.created, tz=VN_TZ)
        return dt.strftime(datefmt or "%Y-%m-%d %H:%M:%S")


def get_log_dir() -> str:
    """`LOG_DIR` env var if set, else `<directory containing DB_PATH>/logs`."""
    env_dir = os.environ.get("LOG_DIR")
    if env_dir:
        return env_dir
    return str(Path(DB_PATH).resolve().parent / "logs")


def configure_logging() -> str:
    """Configure the root logger with a console handler plus rotating app/error log files.

    Returns the log directory actually used. Safe to call more than once (e.g. across
    tests) — it replaces any handlers from a prior call instead of stacking them.
    """
    log_dir = get_log_dir()
    Path(log_dir).mkdir(parents=True, exist_ok=True)

    formatter = VnTimeFormatter(
        fmt="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    sensitive_filter = SensitiveDataFilter()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)

    app_handler = logging.handlers.RotatingFileHandler(
        str(Path(log_dir) / "app.log"),
        maxBytes=APP_LOG_MAX_BYTES,
        backupCount=APP_LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    app_handler.setLevel(logging.INFO)

    error_handler = logging.handlers.RotatingFileHandler(
        str(Path(log_dir) / "errors.log"),
        maxBytes=ERROR_LOG_MAX_BYTES,
        backupCount=ERROR_LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    error_handler.setLevel(logging.WARNING)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for old_handler in list(root.handlers):
        root.removeHandler(old_handler)
        old_handler.close()

    for handler in (console_handler, app_handler, error_handler):
        handler.setFormatter(formatter)
        handler.addFilter(sensitive_filter)
        root.addHandler(handler)

    return log_dir
