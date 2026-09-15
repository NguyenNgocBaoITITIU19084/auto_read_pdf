import glob
import logging
import logging.handlers
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from backend.app.core.config import DB_PATH
from backend.app.core.timezone import VN_TZ

APP_LOG = "app.log"
ERROR_LOG = "errors.log"
APP_LOG_MAX_BYTES = 5 * 1024 * 1024
APP_LOG_BACKUP_COUNT = 5
ERROR_LOG_MAX_BYTES = 2 * 1024 * 1024
ERROR_LOG_BACKUP_COUNT = 3

# Matches the start of a log line's timestamp, e.g. "2026-09-15 12:34:56" — as produced by
# VnTimeFormatter's datefmt. Lines that don't match are continuation lines (e.g. traceback)
# belonging to the most recent timestamped line above them.
_LOG_LINE_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")

MASK = "***MASKED***"
# Named kwarg style, unambiguous even bare: api_key=..., gemini_api_key=...
_SENSITIVE_NAMED_KV_RE = re.compile(r"(?i)\b((?:gemini_)?api_key)\s*=\s*[^&\s\"'}]+")
# Bare `key=` is only treated as sensitive in URL query-param position (?key=... / &key=...),
# since "key" alone is too common a word/dict-field to mask everywhere it appears.
_SENSITIVE_URL_KEY_RE = re.compile(r"(?i)([?&])key=[^&\s\"'}]+")
# Dict/JSON-ish style with either quote char: "api_key": "...", 'key': '...'
_SENSITIVE_QUOTED_RE = re.compile(r"""(?i)(['"](?:gemini_)?(?:api_)?key['"]\s*:\s*['"])[^'"]*(['"])""")
# A bare Google API key token (Gemini keys look like `AIzaSy...`), wherever it appears —
# e.g. inside an exception message or a third-party library's repr() — regardless of whether
# it's introduced by a recognizable `key=`/`api_key=` prefix the patterns above catch.
_SENSITIVE_GOOGLE_KEY_RE = re.compile(r"AIza[0-9A-Za-z_-]{16,}")


def _mask_sensitive(text: str) -> str:
    if not text:
        return text
    text = _SENSITIVE_NAMED_KV_RE.sub(lambda m: f"{m.group(1)}={MASK}", text)
    text = _SENSITIVE_URL_KEY_RE.sub(lambda m: f"{m.group(1)}key={MASK}", text)
    text = _SENSITIVE_QUOTED_RE.sub(lambda m: f"{m.group(1)}{MASK}{m.group(2)}", text)
    text = _SENSITIVE_GOOGLE_KEY_RE.sub(MASK, text)
    return text


# Public alias — other modules (e.g. request logging) redact strings before they ever
# become a log message, on top of the SensitiveDataFilter safety net below.
redact = _mask_sensitive


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

    def format(self, record: logging.LogRecord) -> str:
        # Mask the fully formatted line (including any exception traceback), not just
        # record.msg — a raised exception's own str() can carry a leaked secret too.
        return _mask_sensitive(super().format(record))


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
        str(Path(log_dir) / APP_LOG),
        maxBytes=APP_LOG_MAX_BYTES,
        backupCount=APP_LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    app_handler.setLevel(logging.INFO)

    error_handler = logging.handlers.RotatingFileHandler(
        str(Path(log_dir) / ERROR_LOG),
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


_retention_logger = logging.getLogger("backend.log_retention")


def _cutoff_timestamp(max_age_days: int) -> float:
    """Epoch seconds older than which a log block/backup file should be purged."""
    now_vn = datetime.now(VN_TZ)
    cutoff_vn = now_vn.timestamp() - (max_age_days * 86400)
    return cutoff_vn


def _find_open_handler(target_path: Path):
    """Find a FileHandler on the root logger whose baseFilename matches target_path, if any."""
    root = logging.getLogger()
    resolved = str(target_path.resolve())
    for handler in root.handlers:
        base = getattr(handler, "baseFilename", None)
        if base and str(Path(base).resolve()) == resolved:
            return handler
    return None


def _trim_active_log(log_path: Path, cutoff_ts: float) -> int:
    """Rewrite log_path, dropping timestamped blocks (a timestamped line plus any
    non-timestamped continuation lines that follow it, e.g. a traceback) whose timestamp
    is older than cutoff_ts. Returns the number of dropped log lines (blocks' leading lines).
    Safe against a handler that currently holds the file open in append mode.
    """
    if not log_path.exists():
        return 0

    try:
        raw = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    if not raw:
        return 0

    lines = raw.splitlines(keepends=True)

    kept_lines: list[str] = []
    dropped_count = 0
    current_block_kept = True

    for line in lines:
        m = _LOG_LINE_TS_RE.match(line)
        if m:
            try:
                dt = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=VN_TZ)
                line_ts = dt.timestamp()
            except ValueError:
                line_ts = None
            if line_ts is not None and line_ts < cutoff_ts:
                current_block_kept = False
                dropped_count += 1
            else:
                current_block_kept = True
        # Non-timestamped lines are continuations of the current block's decision
        if current_block_kept:
            kept_lines.append(line)

    if dropped_count == 0:
        return 0

    new_content = "".join(kept_lines)

    handler = _find_open_handler(log_path)
    if handler is not None:
        handler.acquire()
        try:
            if handler.stream:
                handler.stream.close()
            log_path.write_text(new_content, encoding="utf-8")
            handler.stream = handler._open()
        finally:
            handler.release()
    else:
        log_path.write_text(new_content, encoding="utf-8")

    return dropped_count


def _delete_stale_backups(log_dir: Path, base_name: str, cutoff_ts: float) -> list[str]:
    """Delete RotatingFileHandler backup files (base_name.1, base_name.2, ...) older than cutoff_ts."""
    deleted = []
    for path_str in glob.glob(str(log_dir / f"{base_name}.*")):
        path = Path(path_str)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime < cutoff_ts:
            try:
                path.unlink()
                deleted.append(str(path))
            except OSError:
                _retention_logger.warning(f"Could not delete stale log backup {path.name}")
    return deleted


def purge_old_logs(max_age_days: int = 3) -> dict:
    """Delete rotated log backups and trim stale entries from the active app/error logs.

    Runs periodically (see backend.app.services.background_tasks) to bound log growth by
    TIME in addition to the existing size-based RotatingFileHandler rotation. Safe to call
    even when the corresponding logging handlers are not open (e.g. in tests).
    """
    log_dir = Path(get_log_dir())
    cutoff_ts = _cutoff_timestamp(max_age_days)

    deleted_backups: list[str] = []
    trimmed_files: dict[str, int] = {}

    for base_name in (APP_LOG, ERROR_LOG):
        deleted_backups.extend(_delete_stale_backups(log_dir, base_name, cutoff_ts))
        trimmed_files[base_name] = _trim_active_log(log_dir / base_name, cutoff_ts)

    result = {"deleted_backups": deleted_backups, "trimmed_files": trimmed_files}
    _retention_logger.info(
        f"Log retention: deleted {len(deleted_backups)} backup file(s), "
        f"trimmed {sum(trimmed_files.values())} stale log line(s) "
        f"(max_age_days={max_age_days})"
    )
    return result
