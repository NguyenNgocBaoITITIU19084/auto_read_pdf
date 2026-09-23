"""CPU / RAM snapshot of the whole machine and of this backend process (plus its children).

The OCR engines (macOS Vision via swift, tesseract) run as subprocesses, so child processes
are included -- otherwise an OCR spike would be invisible on the dashboard.
"""
import ctypes
import ctypes.util
import gc
import logging
import sys
from typing import Dict

import psutil

from backend.app.core.timezone import now_vn_str

logger = logging.getLogger("backend.services.resource_monitor")

# Process.cpu_percent() measures since the previous call on the SAME object; the first call
# (and any call on a fresh object) returns 0. Keep long-lived objects and prime them once.
_SELF = psutil.Process()
_children: Dict[int, psutil.Process] = {}
try:
    _SELF.cpu_percent(None)
    psutil.cpu_percent(None)
except Exception:  # pragma: no cover - priming is best effort
    pass


def _cpu_count() -> int:
    return psutil.cpu_count() or 1


def _backend_usage() -> dict:
    """RSS (bytes) and CPU (% of the whole machine, 0-100) of this process + live children."""
    rss = _SELF.memory_info().rss
    cpu = _SELF.cpu_percent(None)

    try:
        live = _SELF.children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        live = []
    live_pids = set()
    for child in live:
        proc = _children.get(child.pid)
        if proc is None:
            proc = _children[child.pid] = child
        try:
            rss += proc.memory_info().rss
            cpu += proc.cpu_percent(None)
            live_pids.add(child.pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    for pid in list(_children):
        if pid not in live_pids:
            _children.pop(pid, None)

    return {
        "pid": _SELF.pid,
        "rss": int(rss),
        # psutil reports per-core percent (can exceed 100) -> normalize to the whole machine
        "cpu_percent": round(min(cpu / _cpu_count(), 100.0), 1),
        "child_count": len(live_pids),
    }


def get_resource_snapshot() -> dict:
    vm = psutil.virtual_memory()
    return {
        "sampled_at": now_vn_str(),
        "system": {
            "cpu_percent": round(psutil.cpu_percent(None), 1),
            "cpu_count": _cpu_count(),
            "ram_total": int(vm.total),
            "ram_used": int(vm.total - vm.available),
            "ram_percent": round(vm.percent, 1),
        },
        "backend": _backend_usage(),
    }


def _malloc_trim() -> None:
    """Return freed heap pages to the OS (glibc only; no-op elsewhere)."""
    if not sys.platform.startswith("linux"):
        return
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6")
        libc.malloc_trim(0)
    except Exception:
        pass


def free_backend_memory() -> dict:
    before = _SELF.memory_info().rss
    collected = gc.collect()
    _malloc_trim()
    after = _SELF.memory_info().rss
    logger.info(f"Free memory requested: gc collected {collected} objects, rss {before} -> {after}")
    return {"rss_before": int(before), "rss_after": int(after), "collected_objects": collected}
