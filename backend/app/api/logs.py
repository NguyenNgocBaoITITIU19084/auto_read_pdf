import io
import json
import logging
import os
import platform
import sys
import time
import zipfile
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.app.core import database as db
from backend.app.core.logging_setup import get_log_dir, redact
from backend.app.core.timezone import VN_TZ
from backend.app.core.version import APP_VERSION
from backend.app.services import background_tasks
from backend.app.services.log_reader import read_entries

router = APIRouter(prefix="/logs", tags=["Logs"])
frontend_logger = logging.getLogger("frontend")

RATE_LIMIT_PER_MINUTE = 60
_rate_window: deque = deque()


class ClientLogRequest(BaseModel):
    level: Literal["error", "warning", "info"] = "error"
    message: str
    stack: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    url: Optional[str] = None
    app_version: Optional[str] = None


@router.post("/client")
def ingest_client_log(payload: ClientLogRequest):
    now = time.monotonic()
    while _rate_window and now - _rate_window[0] > 60:
        _rate_window.popleft()
    if len(_rate_window) >= RATE_LIMIT_PER_MINUTE:
        return {"status": "dropped"}
    _rate_window.append(now)
    parts = [payload.message[:2000]]
    if payload.url:
        parts.append(f"url={payload.url[:300]}")
    if payload.app_version:
        parts.append(f"version={payload.app_version[:40]}")
    if payload.context:
        parts.append(f"context={json.dumps(payload.context, ensure_ascii=False, default=str)[:1000]}")
    if payload.stack:
        parts.append("\n" + payload.stack[:8000])
    level = {"error": logging.ERROR, "warning": logging.WARNING, "info": logging.INFO}[payload.level]
    frontend_logger.log(level, " | ".join(parts))
    return {"status": "ok"}


@router.get("")
def list_logs(source: Literal["app", "errors"] = "app", level: Optional[str] = None,
              q: Optional[str] = None, limit: int = Query(200, ge=1, le=1000)):
    log_dir = get_log_dir()
    return {"entries": read_entries(log_dir, source, level, q, limit), "log_dir": str(log_dir)}


def _system_info() -> dict:
    db_path = Path(db.get_db_path())
    counts = {}
    with db.get_connection() as conn:
        for table in ("collections", "bookings", "vessel_schedules", "containers"):
            counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table};").fetchone()[0]
    status = background_tasks.get_auto_sync_status()
    return {
        "app_version": APP_VERSION,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "db_size_bytes": db_path.stat().st_size if db_path.is_file() else 0,
        **counts,
        "auto_sync": {k: status.get(k) for k in ("enabled", "mode", "interval_minutes", "times")},
        "gemini_key_configured": bool(db.get_system_setting("gemini_api_key", "")),
        "exported_at": datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M:%S"),
    }


def _add_redacted(zf: zipfile.ZipFile, path: Path, arcname: str):
    zf.writestr(arcname, redact(path.read_text(encoding="utf-8", errors="replace")))


@router.get("/export")
def export_logs():
    log_dir = get_log_dir()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(Path(log_dir).glob("*.log*")):
            _add_redacted(zf, path, f"logs/{path.name}")
        electron_log = os.environ.get("ELECTRON_BACKEND_LOG")
        if electron_log and Path(electron_log).is_file():
            electron_path = Path(electron_log)
            for path in sorted(electron_path.parent.glob(electron_path.name + "*")):
                _add_redacted(zf, path, f"electron/{path.name}")
        zf.writestr("system_info.json", json.dumps(_system_info(), ensure_ascii=False, indent=2))
    buf.seek(0)
    stamp = datetime.now(VN_TZ).strftime("%Y%m%d-%H%M")
    return StreamingResponse(buf, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="auto-read-pdf-logs-{stamp}.zip"'})
