"""Reads and parses the app/error log files written by ``logging_setup`` for the
log-viewer API (``backend.app.api.logs``).

Log lines look like (see ``logging_setup.configure_logging``'s formatter):
    2026-09-15 16:53:12 [INFO] [backend.main]: some message
Some messages themselves start with ``[req=<id>]`` (added by the request-logging
middleware and by a few business-event log calls); when present it is pulled out
into its own ``request_id`` field instead of staying in ``message``.
A line that doesn't match the pattern (a traceback line, a multi-line message) is
appended to the previous entry's ``message`` instead of starting a new entry.
"""

import re
from pathlib import Path

from backend.app.core.logging_setup import APP_LOG, ERROR_LOG

LINE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] \[([^\]]+)\]: ?(.*)$")
REQUEST_ID_RE = re.compile(r"^\[req=([^\]]*)\] ?(.*)$")
LEVEL_ORDER = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
TAIL_BYTES = 2 * 1024 * 1024
MAX_LIMIT = 1000


def _tail_text(path: Path, max_bytes: int) -> str:
    if not path.is_file():
        return ""
    size = path.stat().st_size
    with path.open("rb") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
            f.readline()  # skip the partial first line
        return f.read().decode("utf-8", errors="replace")


def _parse(text: str) -> list:
    entries: list = []
    for line in text.splitlines():
        m = LINE_RE.match(line)
        if m:
            time_, level, logger_name, rest = m.groups()
            rid_m = REQUEST_ID_RE.match(rest)
            if rid_m:
                request_id, message = rid_m.groups()
            else:
                request_id, message = "-", rest
            entries.append({
                "time": time_,
                "level": level,
                "logger": logger_name,
                "request_id": request_id,
                "message": message,
            })
        elif entries:
            entries[-1]["message"] += "\n" + line  # traceback / multi-line message continuation
    return entries


def read_entries(log_dir, source: str = "app", level: str = None, q: str = None,
                 limit: int = 200) -> list:
    """Newest-first log entries from ``<log_dir>/app.log`` (or ``errors.log``), reading at
    most the last ``TAIL_BYTES`` of the current file plus its immediate rotated backup."""
    base = ERROR_LOG if source == "errors" else APP_LOG
    limit = max(1, min(int(limit or 200), MAX_LIMIT))
    min_level = LEVEL_ORDER.get((level or "").upper(), 0)
    needle = (q or "").strip().lower()
    result: list = []
    for path in (Path(log_dir) / base, Path(log_dir) / f"{base}.1"):
        for entry in reversed(_parse(_tail_text(path, TAIL_BYTES))):
            if LEVEL_ORDER.get(entry["level"], 0) < min_level:
                continue
            if needle and needle not in f"{entry['message']} {entry['logger']} {entry['request_id']}".lower():
                continue
            result.append(entry)
            if len(result) >= limit:
                return result
    return result
