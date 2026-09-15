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
            logger.exception(f"[req={rid}] Unhandled error")
            if not status_holder["sent"]:
                body = json.dumps({"detail": f"Lỗi hệ thống. Mã tra cứu: {rid}", "request_id": rid},
                                  ensure_ascii=False).encode("utf-8")
                await send_wrapper({"type": "http.response.start", "status": 500, "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(body)).encode()),
                ]})
                await send({"type": "http.response.body", "body": body})
        finally:
            self._log(scope, rid, status_holder["status"], (time.perf_counter() - started) * 1000)
            request_id_var.reset(token)

    @staticmethod
    def _log(scope, rid: str, status: int, elapsed_ms: float):
        path = scope.get("path", "")
        query = scope.get("query_string", b"").decode("latin-1")
        target = redact(f"{path}?{query}" if query else path)
        line = f"[req={rid}] {scope.get('method', '')} {target} -> {status} ({elapsed_ms:.0f} ms)"
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
