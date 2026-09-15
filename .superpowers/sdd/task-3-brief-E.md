### Task 3: API nhật ký (nhận lỗi frontend, xem, xuất zip) + Electron

**Files:**
- Create: `backend/app/services/log_reader.py`, `backend/app/api/logs.py`
- Modify: `backend/app/main.py` (include router), `backend_app.spec` (hiddenimports `backend.app.api.logs`, `backend.app.services.log_reader`, `backend.app.core.logging_setup`, `backend.app.core.request_logging`, `backend.app.core.request_context`, `backend.app.core.timezone`)
- Modify: `electron/py_manager.js:344-366`, `electron/main.js:351-356`, `electron/preload.js`, `frontend/src/types/index.ts` (`ElectronAPI`)
- Test: `backend/tests/test_logs_api.py`

**Interfaces:**
- Consumes: `get_log_dir`, `APP_LOG`, `ERROR_LOG`, `redact` (Task 1)
- Produces (Python):
  - `log_reader.LogEntry = dict` với các key `time, level, logger, request_id, message` (`message` gồm cả traceback nhiều dòng)
  - `read_entries(log_dir: Path, source: str = "app", level: str | None = None, q: str | None = None, limit: int = 200) -> list[LogEntry]` — mới nhất trước, đọc tối đa 2MB cuối của `app.log` rồi tới `app.log.1`
- Produces (HTTP):
  - `POST /logs/client` body `{level: "error"|"warning"|"info", message: str, stack?: str, context?: object, url?: str, app_version?: str}` → `{status:"ok"}`. Cắt `message` 2000 ký tự, `stack` 8000; giới hạn 60 lần/phút, vượt thì trả `{status:"dropped"}`.
  - `GET /logs?source=app|errors&level=&q=&limit=200` → `{entries: LogEntry[], log_dir: str}`
  - `GET /logs/export` → file `application/zip` tên `auto-read-pdf-logs-YYYYMMDD-HHMM.zip`, gồm `logs/app.log*`, `logs/errors.log*`, `electron/backend.log*` (nếu env `ELECTRON_BACKEND_LOG` trỏ tới file có thật) và `system_info.json`
- `system_info.json`: `{app_version, python, platform, db_size_bytes, collections, bookings, vessel_schedules, containers, auto_sync: {enabled, mode, interval_minutes, times}, gemini_key_configured: bool, exported_at}` — không chứa key.
- Produces (Electron): env `LOG_DIR=<userData>/logs`, `ELECTRON_BACKEND_LOG=<userData>/backend.log`; `window.electronAPI.openLogFolder(): void`

- [ ] **Step 1: Viết test thất bại**

`backend/tests/test_logs_api.py`:
```python
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


@pytest.fixture
def env(tmp_path, fresh_db, monkeypatch):
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("LOG_DIR", str(log_dir))
    ls.setup_logging(log_dir=log_dir)
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
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

Run: `pytest backend/tests/test_logs_api.py -v`
Expected: FAIL — `ImportError: cannot import name 'log_reader'`

- [ ] **Step 3: Cài đặt `log_reader.py`**

```python
import re
from pathlib import Path

from backend.app.core.logging_setup import APP_LOG, ERROR_LOG

LINE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] \[([^\]]+)\] \[req=([^\]]*)\] ?(.*)$")
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


def _parse(text: str) -> list[dict]:
    entries: list[dict] = []
    for line in text.splitlines():
        m = LINE_RE.match(line)
        if m:
            entries.append({"time": m.group(1), "level": m.group(2), "logger": m.group(3),
                            "request_id": m.group(4), "message": m.group(5)})
        elif entries:
            entries[-1]["message"] += "\n" + line  # traceback / multi-line message
    return entries


def read_entries(log_dir: Path, source: str = "app", level: str | None = None, q: str | None = None,
                 limit: int = 200) -> list[dict]:
    base = ERROR_LOG if source == "errors" else APP_LOG
    limit = max(1, min(int(limit or 200), MAX_LIMIT))
    min_level = LEVEL_ORDER.get((level or "").upper(), 0)
    needle = (q or "").strip().lower()
    result: list[dict] = []
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
```

- [ ] **Step 4: Cài đặt `api/logs.py`**

```python
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
        "auto_sync": {k: status.get(k) for k in ("enabled", "mode", "interval_minutes", "times", "last_run_at")},
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
        for path in sorted(log_dir.glob("*.log*")):
            _add_redacted(zf, path, f"logs/{path.name}")
        electron_log = os.environ.get("ELECTRON_BACKEND_LOG")
        if electron_log:
            for path in sorted(Path(electron_log).parent.glob(Path(electron_log).name + "*")):
                _add_redacted(zf, path, f"electron/{path.name}")
        zf.writestr("system_info.json", json.dumps(_system_info(), ensure_ascii=False, indent=2))
    buf.seek(0)
    stamp = datetime.now(VN_TZ).strftime("%Y%m%d-%H%M")
    return StreamingResponse(buf, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="auto-read-pdf-logs-{stamp}.zip"'})
```
`APP_VERSION`: nếu `backend/app/core/version.py` (việc A2 trong `2026-09-15-remaining-work.md`) chưa có thì tạo file với một dòng `APP_VERSION = "2.0.0"` (đúng version trong `package.json` lúc làm), và cho `main.py` dùng hằng này ở `FastAPI(version=...)` và `/health`.

`.gitignore` — thêm 2 dòng `logs/` và `backend/logs/`.

`main.py`: `from backend.app.api.logs import router as logs_router` và `app.include_router(logs_router, prefix="/api/v1")`.

- [ ] **Step 5: Chạy test backend**

Run: `pytest backend/tests/test_logs_api.py backend/tests/test_logging_setup.py -v`
Expected: PASS

- [ ] **Step 6: Electron**

`electron/py_manager.js` — trong `_spawn()`, thêm vào `env` của `spawn`:
```js
        LOG_DIR: path.join(userDataDir, 'logs'),
        ELECTRON_BACKEND_LOG: this.logPath,
```
Thêm getter cạnh `logPath`:
```js
  get logDir() {
    const dir = app ? app.getPath('userData') : path.join(__dirname, '..');
    return path.join(dir, 'logs');
  }
```
`electron/main.js` — cạnh handler `backend-show-log` (L351):
```js
  ipcMain.on('open-log-folder', () => {
    const dir = backend.logDir;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
```
`electron/preload.js` — thêm vào object:
```js
  /** Open the folder containing app.log / errors.log. */
  openLogFolder: () => ipcRenderer.send('open-log-folder'),
```
`frontend/src/types/index.ts` — trong `interface ElectronAPI` thêm `openLogFolder?: () => void;`.

Kiểm tra thủ công: `npm run dev` → thao tác vài bước → `ls "$HOME/Library/Application Support/<tên app>/logs"`, hoặc thư mục `backend/logs` khi chạy dev không đóng gói (DB dev nằm ở `backend/booking_data.db`). Expected: có `app.log`, và dòng log có giờ VN.

- [ ] **Step 7: Commit**

```bash
git add .gitignore backend/app/services/log_reader.py backend/app/api/logs.py backend/app/core/version.py backend/app/main.py backend_app.spec backend/tests/test_logs_api.py electron/py_manager.js electron/main.js electron/preload.js frontend/src/types/index.ts
git commit -m "feat(logging): client error ingestion, log viewer API and redacted zip export

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

