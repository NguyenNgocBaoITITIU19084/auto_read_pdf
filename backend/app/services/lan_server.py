"""On-demand LAN-bound uvicorn server for the phone-camera-QR mobile app.

Started only when the desktop app requests a mobile session (``POST
/api/v1/mobile/session``); never runs otherwise. Runs ``mobile_app`` (see
``backend.app.mobile.app``) in a background daemon thread bound to
``0.0.0.0`` (or whatever host is passed in) so phones on the same LAN can
reach it, while the main FastAPI app stays on loopback only.

Idle-expiry: a self-re-arming ``threading.Timer`` calls
``bridge.expire_if_idle()`` every 60 seconds while the server is running.
A plain ``threading.Timer`` is used instead of the app's existing
``AsyncIOScheduler`` (see ``background_tasks.py``) because that scheduler
needs a running asyncio event loop; this server (and the tests that exercise
it, including the real-port integration test) has no such loop guaranteed to
be running in the same thread, whereas a daemon timer is fully
self-contained, trivially cancellable from ``stop()``, and easy to unit
test without an event loop.
"""

from __future__ import annotations

import logging
import socket
import threading
import time
from typing import Optional

import uvicorn

from backend.app.services.mobile_bridge import bridge

logger = logging.getLogger("backend.lan_server")

IDLE_CHECK_INTERVAL_SECONDS = 60.0
PORT_SCAN_START = 8765
PORT_SCAN_END = 8775  # inclusive


def _port_is_free(port: int, host: str) -> bool:
    probe_host = "0.0.0.0" if host in ("0.0.0.0", "") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((probe_host, port))
        except OSError:
            return False
        return True


def _pick_free_port(host: str) -> int:
    """Return a free port: try PORT_SCAN_START..PORT_SCAN_END, else OS-assigned (0).

    Binds and immediately closes a probe socket to test each candidate; this
    leaves a small time-of-check/time-of-use window before uvicorn binds the
    real socket, which is an accepted tradeoff for keeping ``start()``'s
    returned port simple and synchronous.
    """
    for port in range(PORT_SCAN_START, PORT_SCAN_END + 1):
        if _port_is_free(port, host):
            return port
    probe_host = "0.0.0.0" if host in ("0.0.0.0", "") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((probe_host, 0))
        return sock.getsockname()[1]


class LanServerStartError(RuntimeError):
    """Raised when the LAN server's uvicorn thread dies before starting."""


class LanServer:
    """Owns the lifecycle of the on-demand, LAN-bound mobile uvicorn server."""

    def __init__(self) -> None:
        self._server: Optional[uvicorn.Server] = None
        self._thread: Optional[threading.Thread] = None
        self._idle_timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()
        self.selected_ip: Optional[str] = None
        self.port: Optional[int] = None

    @property
    def running(self) -> bool:
        return self._server is not None and self._thread is not None and self._thread.is_alive()

    def start(self, app, host: str = "0.0.0.0", preferred_port: int = PORT_SCAN_START) -> int:
        with self._lock:
            if self.running:
                return self.port  # type: ignore[return-value]

            port = _pick_free_port(host) if not _port_is_free(preferred_port, host) else preferred_port
            config = uvicorn.Config(
                app,
                host=host,
                port=port,
                log_level="warning",
                access_log=False,
                lifespan="off",
            )
            server = uvicorn.Server(config)
            thread = threading.Thread(target=server.run, name="mobile-lan", daemon=True)
            self._server = server
            self._thread = thread
            self.port = port
            thread.start()
            self._wait_started(timeout=5)
            self._start_idle_timer_locked()
            return port

    def _wait_started(self, timeout: float) -> None:
        server = self._server
        thread = self._thread
        assert server is not None and thread is not None
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if getattr(server, "started", False):
                return
            if not thread.is_alive():
                raise LanServerStartError(
                    "LAN server thread exited before starting (likely a bind failure)"
                )
            time.sleep(0.02)
        if not getattr(server, "started", False):
            raise LanServerStartError("LAN server did not start within timeout")

    def _start_idle_timer_locked(self) -> None:
        self._cancel_idle_timer_locked()
        timer = threading.Timer(IDLE_CHECK_INTERVAL_SECONDS, self._idle_tick)
        timer.daemon = True
        self._idle_timer = timer
        timer.start()

    def _cancel_idle_timer_locked(self) -> None:
        if self._idle_timer is not None:
            self._idle_timer.cancel()
            self._idle_timer = None

    def _idle_tick(self) -> None:
        try:
            bridge.expire_if_idle()
        except Exception:  # pragma: no cover - defensive
            logger.exception("Error while checking mobile session idle-expiry")
        finally:
            with self._lock:
                # Only re-arm if still running (stop() may have cancelled us).
                if self.running:
                    timer = threading.Timer(IDLE_CHECK_INTERVAL_SECONDS, self._idle_tick)
                    timer.daemon = True
                    self._idle_timer = timer
                    timer.start()

    def stop(self, timeout: float = 3) -> None:
        with self._lock:
            self._cancel_idle_timer_locked()
            server = self._server
            thread = self._thread
            self._server = None
            self._thread = None
            self.port = None
            self.selected_ip = None

        if server is None:
            return
        server.should_exit = True
        if thread is not None and threading.current_thread() is not thread:
            thread.join(timeout)


lan_server = LanServer()
# Wire the bridge's teardown callback to also tear down the LAN server, so
# ending the mobile session (explicit stop, or 30-minute idle expiry) always
# closes the LAN-bound socket too.
bridge.set_on_stop(lan_server.stop)
