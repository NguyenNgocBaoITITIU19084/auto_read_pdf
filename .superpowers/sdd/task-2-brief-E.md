### Task 2: Log từng request + mã tra cứu lỗi

**Files:**
- Create: `backend/app/core/request_logging.py`
- Modify: `backend/app/main.py` (đăng ký middleware sau CORS; thêm `expose_headers=["X-Request-ID"]` cho CORS)
- Modify: `backend/app/api/bookings.py`, `backend/app/api/collections.py`, `backend/app/api/export_backup.py` (log thao tác quan trọng)
- Test: `backend/tests/test_request_logging.py`

**Interfaces:**
- Consumes: `request_id_var`, `setup_logging`, `ERROR_LOG` (Task 1)
- Produces:
  - `RequestLoggingMiddleware` (ASGI thuần, không đọc body)
  - Mọi response có header `X-Request-ID`. Nếu client gửi `X-Request-ID` hợp lệ (`^[A-Za-z0-9-]{6,64}$`) thì dùng lại mã đó.
  - Lỗi không bắt được → HTTP 500 `{"detail": "Lỗi hệ thống. Mã tra cứu: <id>", "request_id": "<id>"}`, kèm traceback trong `errors.log`.
- Mức log:
  - `GET /health`, `GET /api/v1/scheduler/status`, `GET /api/v1/logs*`, `POST /api/v1/logs/client` → DEBUG
  - status ≥ 500 → ERROR
  - status ≥ 400 → WARNING
  - thời gian > 3000ms → WARNING kèm chữ `SLOW`
  - còn lại → INFO
- Dòng log: `POST /api/v1/bookings/upload -> 200 (153 ms)`; query string đi qua `redact`.

- [ ] **Step 1: Viết test thất bại**

`backend/tests/test_request_logging.py`:
```python
import logging

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.core import logging_setup as ls
from backend.app.main import app


@pytest.fixture
def client(tmp_path, fresh_db):
    ls.setup_logging(log_dir=tmp_path)

    def boom():
        raise RuntimeError("kaboom key=AIzaSyA1234567890abcdefghijklmnopqrstuv")

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
    assert f"[req={rid}] GET /api/v1/collections?api_key=*** -> 200" in content
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
    assert "/health" not in content and "/scheduler/status" not in content


def test_invalid_incoming_request_id_is_replaced(client):
    c, _ = client
    res = c.get("/health", headers={"X-Request-ID": "bad id with spaces"})
    assert res.headers["X-Request-ID"] != "bad id with spaces"
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

Run: `pytest backend/tests/test_request_logging.py -v`
Expected: FAIL — `KeyError: 'x-request-id'`

- [ ] **Step 3: Cài đặt middleware**

`backend/app/core/request_logging.py`:
```python
import json
import logging
import re
import time
import uuid

from backend.app.core.logging_setup import redact
from backend.app.core.request_context import request_id_var

logger = logging.getLogger("backend.request")

_VALID_ID = re.compile(r"^[A-Za-z0-9-]{6,64}$")
_QUIET = ("/health", "/api/v1/scheduler/status", "/api/v1/logs")
SLOW_MS = 3000


class RequestLoggingMiddleware:
    """Pure ASGI middleware: request id, one log line per request, JSON 500 with a lookup code."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        incoming = headers.get("x-request-id", "")
        rid = incoming if _VALID_ID.match(incoming) else uuid.uuid4().hex[:8]
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status_holder = {"status": 500, "sent": False}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                status_holder["sent"] = True
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("Unhandled error")
            if not status_holder["sent"]:
                body = json.dumps({"detail": f"Lỗi hệ thống. Mã tra cứu: {rid}", "request_id": rid},
                                  ensure_ascii=False).encode("utf-8")
                await send_wrapper({"type": "http.response.start", "status": 500, "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(body)).encode()),
                ]})
                await send({"type": "http.response.body", "body": body})
        finally:
            self._log(scope, status_holder["status"], (time.perf_counter() - started) * 1000)
            request_id_var.reset(token)

    @staticmethod
    def _log(scope, status: int, elapsed_ms: float):
        path = scope.get("path", "")
        query = scope.get("query_string", b"").decode("latin-1")
        target = redact(f"{path}?{query}" if query else path)
        line = f"{scope.get('method', '')} {target} -> {status} ({elapsed_ms:.0f} ms)"
        if status >= 500:
            logger.error(line)
        elif status >= 400:
            logger.warning(line)
        elif elapsed_ms > SLOW_MS:
            logger.warning(f"SLOW {line}")
        elif path.startswith(_QUIET):
            logger.debug(line)
        else:
            logger.info(line)
```
Lưu ý: middleware đặt **ngoài cùng** nên lỗi vẫn được bắt khi `ServerErrorMiddleware` của Starlette re-raise. Trong test dùng `raise_server_exceptions=False` để TestClient nhận response 500.

`main.py` — sau `app.add_middleware(CORSMiddleware, ...)`:
```python
from backend.app.core.request_logging import RequestLoggingMiddleware

app.add_middleware(RequestLoggingMiddleware)
```
và thêm `expose_headers=["X-Request-ID"]` vào `CORSMiddleware` (để axios đọc được header).

- [ ] **Step 4: Log thao tác nghiệp vụ quan trọng** — mỗi dòng dưới đây là `logger.info` tại chỗ tương ứng (không ghi nội dung dữ liệu):
- `bookings.py`
  - upload: `f"Upload {len(uploads)} file(s) to collection {collection_id} -> {len(extracted_results)} booking(s)"`
  - batch-delete: `f"Deleted {deleted} booking(s)"`
  - clear: `f"Cleared bookings of collection {collection_id}"`
  - extract-image, sau khi có kết quả: `f"Image extract engine={result['engine_used']} warnings={len(result['warnings'])}"`
- `collections.py`, logger `backend.api.collections`
  - tạo: `f"Created collection id={col_id}"`
  - xoá: `f"Deleted collection id={col_id}"`
  - move: `f"Moved {moved} {payload.entity} to collection {payload.target_collection_id} (copy={bool(payload.copy_items)})"`
- `export_backup.py`, logger `backend.api.backup`
  - backup: `"Backup exported"`
  - restore: `f"Restore finished mode={mode}"`, hoặc `logger.exception("Restore failed")` trong nhánh `except`

- [ ] **Step 5: Chạy test**

Run: `pytest backend/tests tests -q`
Expected: PASS toàn bộ

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/request_logging.py backend/app/main.py backend/app/api/bookings.py backend/app/api/collections.py backend/app/api/export_backup.py backend/tests/test_request_logging.py
git commit -m "feat(logging): per-request log lines, X-Request-ID and lookup codes for 500 errors

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

