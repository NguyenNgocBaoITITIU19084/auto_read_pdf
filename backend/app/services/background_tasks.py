import asyncio
import json
import logging
import re
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.schedulers.base import BaseScheduler
from apscheduler.triggers.combining import OrTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

from backend.app.core.timezone import VN_TZ, DATETIME_FMT, now_vn_str
from backend.app.core.database import (
    get_all_watchlists, get_all_container_watchlists,
    insert_vessel_schedules, insert_containers,
    get_system_setting, set_system_setting,
)
from backend.app.services.eport_client import search_vessels_detailed, search_containers

logger = logging.getLogger("backend.background_tasks")

AUTO_SYNC_JOB_ID = "auto_sync_job"
AUTO_SYNC_KICK_JOB_ID = "auto_sync_kick"
STARTUP_DELAY_SECONDS = 30
DEFAULT_INTERVAL_MINUTES = 10
MAX_INTERVAL_MINUTES = 10080  # 1 week
VALID_MODES = ("interval", "times")

JOB_OPTIONS = {
    "misfire_grace_time": 3600,
    "coalesce": True,
    "max_instances": 1,
    "replace_existing": True,
}

_TIME_RE = re.compile(r"^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$")

scheduler = AsyncIOScheduler(timezone=VN_TZ)
_sync_lock = asyncio.Lock()

# In-memory mirror of persisted settings + runtime status
_state = {
    "loaded": False,
    "enabled": False,
    "mode": "interval",
    "interval_minutes": DEFAULT_INTERVAL_MINUTES,
    "times": [],
    "last_run_at": None,
    "last_run_result": None,
}


def _now_str() -> str:
    return now_vn_str()


def _empty_result() -> dict:
    return {"vessels_ok": 0, "vessels_not_found": 0, "containers_ok": 0, "errors": 0}


# ---------------------------------------------------------------------------
# Validation / persistence
# ---------------------------------------------------------------------------

def normalize_times(times) -> list[str]:
    """Validate + canonicalize a list of 'HH:MM' strings (24h format). Deduplicated and sorted."""
    if not times:
        return []
    if not isinstance(times, (list, tuple)):
        raise ValueError("times must be a list of 'HH:MM' strings")
    result = set()
    for t in times:
        m = _TIME_RE.match(str(t)) if t is not None else None
        if not m:
            raise ValueError(f"Invalid time '{t}', expected HH:MM (00:00-23:59)")
        result.add(f"{int(m.group(1)):02d}:{m.group(2)}")
    return sorted(result)


def missed_times_slot(times: list[str], last_run_at: str | None, now: datetime) -> bool:
    """True when the most recent fixed HH:MM slot (VN time, at or before `now`) happened after the last run."""
    try:
        slots = normalize_times(times)
    except ValueError:
        return False
    if not slots:
        return False
    now = now.astimezone(VN_TZ)
    candidates = []
    for day_offset in (0, -1):
        day = (now + timedelta(days=day_offset)).date()
        for t in slots:
            h, m = (int(x) for x in t.split(":"))
            slot = datetime(day.year, day.month, day.day, h, m, tzinfo=VN_TZ)
            if slot <= now:
                candidates.append(slot)
    if not candidates:
        return False
    latest_slot = max(candidates)
    try:
        last = datetime.strptime(last_run_at or "", DATETIME_FMT).replace(tzinfo=VN_TZ)
    except ValueError:
        return True
    return last < latest_slot


def load_settings() -> dict:
    """Read auto-sync settings from system_settings into memory."""
    enabled = get_system_setting("auto_sync_enabled", "0") == "1"
    mode = get_system_setting("auto_sync_mode", "interval") or "interval"
    if mode not in VALID_MODES:
        mode = "interval"
    try:
        interval = min(MAX_INTERVAL_MINUTES,
                       max(1, int(get_system_setting("auto_sync_interval", str(DEFAULT_INTERVAL_MINUTES)))))
    except (TypeError, ValueError):
        interval = DEFAULT_INTERVAL_MINUTES
    try:
        times = normalize_times(json.loads(get_system_setting("auto_sync_times", "[]") or "[]"))
    except Exception:
        logger.exception("Invalid auto_sync_times in system_settings, ignoring")
        times = []
    last_run_at = get_system_setting("auto_sync_last_run_at", "") or None
    _state.update({"loaded": True, "enabled": enabled, "mode": mode,
                   "interval_minutes": interval, "times": times, "last_run_at": last_run_at})
    return dict(_state)


def save_settings():
    set_system_setting("auto_sync_enabled", "1" if _state["enabled"] else "0")
    set_system_setting("auto_sync_mode", _state["mode"])
    set_system_setting("auto_sync_interval", str(_state["interval_minutes"]))
    set_system_setting("auto_sync_times", json.dumps(_state["times"]))


def _ensure_loaded():
    if not _state["loaded"]:
        try:
            load_settings()
        except Exception:
            logger.exception("Could not load auto-sync settings")


# ---------------------------------------------------------------------------
# Watchlist status helper
# ---------------------------------------------------------------------------

def _report_watchlist_status(kind: str, watchlist_id, status: str, message: str = ""):
    if watchlist_id is None:
        return
    try:
        from backend.app.core.database import update_watchlist_sync_status
    except ImportError:
        return
    try:
        update_watchlist_sync_status(kind, watchlist_id, status, message)
    except Exception:
        logger.exception(f"Could not update sync status for {kind} watchlist {watchlist_id}")


# ---------------------------------------------------------------------------
# Sync work
# ---------------------------------------------------------------------------

async def sync_vessel_watchlists() -> dict:
    result = _empty_result()
    try:
        watchlists = await asyncio.to_thread(get_all_watchlists)
        if not watchlists:
            logger.info("[Auto-Sync Vessels] Watchlist is empty, nothing to sync.")
            return result

        logger.info(f"[Auto-Sync Vessels] Auto-syncing {len(watchlists)} vessel watchlist item(s)...")
        for idx, item in enumerate(watchlists):
            wl_id = item.get("id")
            col_id = item["collection_id"]
            site_id = item["site_id"]
            vessel_name = item["vessel_name"]
            voyage = item.get("voyage", "") or ""
            logger.info(f"[Auto-Sync Vessels] ({idx + 1}/{len(watchlists)}) Vessel='{vessel_name}', Voyage='{voyage}', Site='{site_id}', Collection={col_id}")
            try:
                detail = await asyncio.to_thread(search_vessels_detailed, site_id, vessel_name, voyage)
                schedules = detail.get("items") or []
                if schedules:
                    await asyncio.to_thread(insert_vessel_schedules, col_id, schedules)
                    result["vessels_ok"] += 1
                    await asyncio.to_thread(_report_watchlist_status, "vessel", wl_id, "ok",
                                            f"Đã cập nhật {len(schedules)} lịch tàu")
                    logger.info(f"[Auto-Sync Vessels] Updated {len(schedules)} schedule(s) for '{vessel_name}' ({voyage})")
                else:
                    result["vessels_not_found"] += 1
                    available = detail.get("available_voyages") or []
                    if available:
                        msg = (f"Không có chuyến '{voyage}' trên ePort. "
                               f"Các chuyến hiện có: {', '.join(available)}")
                    else:
                        msg = detail.get("message") or f"Không tìm thấy tàu '{vessel_name}' tại cảng '{site_id}' trên ePort"
                    await asyncio.to_thread(_report_watchlist_status, "vessel", wl_id, "not_found", msg)
                    logger.warning(f"[Auto-Sync Vessels] No schedules for '{vessel_name}' ({voyage}) at '{site_id}': {msg}")
            except Exception as e:
                result["errors"] += 1
                logger.exception(f"[Auto-Sync Vessels] Error syncing vessel {vessel_name}/{voyage}")
                await asyncio.to_thread(_report_watchlist_status, "vessel", wl_id, "error", str(e))

            # Wait 2 seconds between each vessel API call to avoid overloading ePort
            if idx < len(watchlists) - 1:
                await asyncio.sleep(2)
        logger.info("[Auto-Sync Vessels] Completed syncing all vessel watchlists.")
    except Exception:
        result["errors"] += 1
        logger.exception("[Auto-Sync Vessels] Fatal error in sync_vessel_watchlists")
    return result


def _item_matches(it: dict, r_cont: str, r_event: str) -> bool:
    ev = (it.get("event_type") or "").strip().upper()
    return (it.get("container_no") or "").strip().upper() == r_cont and (not ev or ev == "ALL" or ev == r_event)


async def sync_container_watchlists() -> dict:
    result = _empty_result()
    try:
        c_watchlists = await asyncio.to_thread(get_all_container_watchlists)
        if not c_watchlists:
            logger.info("[Auto-Sync Containers] Watchlist is empty, nothing to sync.")
            return result

        logger.info(f"[Auto-Sync Containers] Auto-syncing {len(c_watchlists)} container watchlist item(s)...")
        by_col_and_site: dict[tuple, list] = {}
        for cw in c_watchlists:
            by_col_and_site.setdefault((cw["collection_id"], cw["site_id"]), []).append(cw)

        for (col_id, site_id), items in by_col_and_site.items():
            items = [it for it in items if it.get("container_no")]
            unique_cont_nos = sorted({it["container_no"].strip().upper() for it in items})
            if not unique_cont_nos:
                continue
            cont_str = ",".join(unique_cont_nos)
            logger.info(f"[Auto-Sync Containers] Syncing {len(unique_cont_nos)} container(s) for Collection {col_id} at site '{site_id}': {cont_str}")
            try:
                results = await asyncio.to_thread(search_containers, site_id, cont_str) or []
                # Only keep results strictly matching watched container_no AND event_type (if specified)
                filtered_results = []
                matched_ids = set()
                for r in results:
                    r_cont = str(r.get("CONTAINERNO", r.get("containerno", ""))).strip().upper()
                    r_event = str(r.get("EVENT_TYPE", r.get("event_type", ""))).strip().upper()
                    hit = False
                    for it in items:
                        if _item_matches(it, r_cont, r_event):
                            matched_ids.add(it.get("id"))
                            hit = True
                    if hit:
                        filtered_results.append(r)

                if filtered_results:
                    await asyncio.to_thread(insert_containers, col_id, filtered_results)
                    logger.info(f"[Auto-Sync Containers] Updated {len(filtered_results)} container event(s) for {cont_str}")
                elif results:
                    logger.info(f"[Auto-Sync Containers] No matching events for watched event_types for {cont_str}")
                else:
                    logger.warning(f"[Auto-Sync Containers] No container info found for {cont_str} at site '{site_id}'")

                for it in items:
                    if it.get("id") in matched_ids:
                        result["containers_ok"] += 1
                        await asyncio.to_thread(_report_watchlist_status, "container", it.get("id"), "ok", "")
                    else:
                        ev = (it.get("event_type") or "").strip()
                        msg = (f"Không có sự kiện '{ev}' cho container {it['container_no']} trên ePort"
                               if ev and ev.upper() != "ALL"
                               else f"Không tìm thấy container {it['container_no']} tại cảng '{site_id}' trên ePort")
                        await asyncio.to_thread(_report_watchlist_status, "container", it.get("id"), "not_found", msg)
            except Exception as e:
                result["errors"] += 1
                logger.exception(f"[Auto-Sync Containers] Error syncing containers {unique_cont_nos}")
                for it in items:
                    await asyncio.to_thread(_report_watchlist_status, "container", it.get("id"), "error", str(e))
        logger.info("[Auto-Sync Containers] Completed syncing all container watchlists.")
    except Exception:
        result["errors"] += 1
        logger.exception("[Auto-Sync Containers] Fatal error in sync_container_watchlists")
    return result


async def run_sync_all() -> str:
    """Run one full sync cycle. Never overlaps: returns "already_running" if a cycle is in progress."""
    if _sync_lock.locked():
        logger.info("Auto-sync cycle already running, skipping this trigger.")
        return "already_running"
    async with _sync_lock:
        logger.info("==================== Starting Auto-Sync Cycle ====================")
        total = _empty_result()
        try:
            for part in (await sync_vessel_watchlists(), await sync_container_watchlists()):
                for k in total:
                    total[k] += int((part or {}).get(k, 0))
        except Exception:
            total["errors"] += 1
            logger.exception("Auto-sync cycle failed")
        finally:
            _state["last_run_at"] = _now_str()
            _state["last_run_result"] = total
            try:
                await asyncio.to_thread(set_system_setting, "auto_sync_last_run_at", _state["last_run_at"])
            except Exception:
                logger.exception("Could not persist auto_sync_last_run_at")
        logger.info(f"==================== Auto-Sync Cycle Finished {total} ====================")
        return "completed"


async def _scheduled_run():
    # Resolve run_sync_all at call time (keeps it patchable in tests)
    await run_sync_all()


# ---------------------------------------------------------------------------
# Scheduler management
# ---------------------------------------------------------------------------

def setup_scheduler():
    """Start the scheduler on the current running event loop (restarting if bound to a dead/other loop)."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    try:
        if scheduler.running:
            current = getattr(scheduler, "_eventloop", None)
            if loop is None or current is loop:
                return
            if current is not None and not current.is_closed() and current.is_running():
                return  # healthy loop elsewhere (should not happen in production)
            # Bound to a closed loop: stop synchronously and restart on the current loop
            BaseScheduler.shutdown(scheduler, wait=False)
            scheduler._stop_timer()
            scheduler._eventloop = None
        if loop is None:
            return
        scheduler.start()
        logger.info("AsyncIOScheduler started (timezone Asia/Ho_Chi_Minh).")
    except Exception:
        logger.exception("Could not start scheduler")


def build_trigger(mode: str, interval_minutes: int, times: list[str]):
    if mode == "times":
        if not times:
            raise ValueError("times mode requires at least one 'HH:MM' time")
        crons = []
        for t in normalize_times(times):
            h, m = t.split(":")
            crons.append(CronTrigger(hour=int(h), minute=int(m), timezone=VN_TZ))
        return crons[0] if len(crons) == 1 else OrTrigger(crons)
    return IntervalTrigger(minutes=max(1, int(interval_minutes)), timezone=VN_TZ)


def _remove_job(job_id: str):
    try:
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)
    except Exception:
        logger.exception(f"Could not remove job {job_id}")


def _schedule_kick(delay_seconds: float = 0):
    """One-off run through the scheduler (guarded by max_instances + the sync lock)."""
    run_at = datetime.now(VN_TZ) + timedelta(seconds=max(0, delay_seconds))
    scheduler.add_job(_scheduled_run, DateTrigger(run_date=run_at, timezone=VN_TZ),
                      id=AUTO_SYNC_KICK_JOB_ID, name="auto_sync_kick", **JOB_OPTIONS)


def apply_schedule(kick_delay_seconds: float | None = None):
    """(Re)register jobs according to in-memory state."""
    setup_scheduler()
    _remove_job(AUTO_SYNC_JOB_ID)
    if not _state["enabled"]:
        _remove_job(AUTO_SYNC_KICK_JOB_ID)
        logger.info("Auto-sync disabled")
        return
    trigger = build_trigger(_state["mode"], _state["interval_minutes"], _state["times"])
    scheduler.add_job(_scheduled_run, trigger, id=AUTO_SYNC_JOB_ID, name="auto_sync", **JOB_OPTIONS)
    if _state["mode"] == "times":
        logger.info(f"Auto-sync scheduled at {', '.join(_state['times'])} (Asia/Ho_Chi_Minh)")
    else:
        logger.info(f"Auto-sync scheduled every {_state['interval_minutes']} minutes")
    if kick_delay_seconds is not None:
        _schedule_kick(kick_delay_seconds)


async def restore_auto_sync(startup_delay_seconds: float = STARTUP_DELAY_SECONDS):
    """Called from app lifespan: restore persisted settings and register jobs.
    Interval mode catches up after a short delay; fixed-times mode only when a slot was actually missed."""
    try:
        await asyncio.to_thread(load_settings)
        kick = None
        if _state["enabled"]:
            if _state["mode"] != "times" or missed_times_slot(_state["times"], _state["last_run_at"], datetime.now(VN_TZ)):
                kick = startup_delay_seconds
            else:
                logger.info("Fixed-times auto-sync: no slot missed since last run, skipping catch-up")
        apply_schedule(kick_delay_seconds=kick)
    except Exception:
        logger.exception("Could not restore auto-sync schedule")


def shutdown_scheduler():
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
    except Exception:
        logger.exception("Error shutting down scheduler")


async def toggle_auto_sync(enable: bool, interval_minutes: int | None = None,
                           mode: str | None = None, times: list[str] | None = None) -> dict:
    """Update + persist settings. Unspecified fields keep their current values. Raises ValueError on bad input."""
    _ensure_loaded()
    new_mode = mode if mode is not None else _state["mode"]
    if new_mode not in VALID_MODES:
        raise ValueError(f"mode must be one of {VALID_MODES}")
    new_interval = _state["interval_minutes"] if interval_minutes is None else max(1, int(interval_minutes))
    if new_interval > MAX_INTERVAL_MINUTES:
        raise ValueError(f"interval_minutes must be between 1 and {MAX_INTERVAL_MINUTES}")
    new_times = normalize_times(times) if times is not None else _state["times"]
    if enable and new_mode == "times" and not new_times:
        raise ValueError("times mode requires at least one 'HH:MM' time")
    if enable:
        # Build the trigger before persisting so invalid settings are never saved
        build_trigger(new_mode, new_interval, new_times)

    was_enabled = _state["enabled"]
    _state.update({"enabled": bool(enable), "mode": new_mode,
                   "interval_minutes": new_interval, "times": new_times})
    await asyncio.to_thread(save_settings)
    # Only kick an immediate cycle on OFF -> ON; schedule edits while enabled must not trigger a full sync
    just_enabled = bool(enable) and not was_enabled
    apply_schedule(kick_delay_seconds=0 if just_enabled else None)
    if just_enabled:
        logger.info("Triggered immediate sync cycle upon enabling auto-sync")
    return get_auto_sync_status()


async def run_now() -> str:
    if _sync_lock.locked():
        return "already_running"
    setup_scheduler()
    _schedule_kick(0)
    return "started"


def _next_run_at() -> str | None:
    if not _state["enabled"]:
        return None
    candidates = []
    for job_id in (AUTO_SYNC_JOB_ID, AUTO_SYNC_KICK_JOB_ID):
        try:
            job = scheduler.get_job(job_id)
        except Exception:
            job = None
        nrt = getattr(job, "next_run_time", None) if job else None
        if nrt:
            candidates.append(nrt)
    if not candidates:
        return None
    return min(candidates).astimezone(VN_TZ).strftime(DATETIME_FMT)


def get_auto_sync_status() -> dict:
    _ensure_loaded()
    return {
        "enabled": _state["enabled"],
        "mode": _state["mode"],
        "interval_minutes": _state["interval_minutes"],
        "times": list(_state["times"]),
        "running": _sync_lock.locked(),
        "last_run_at": _state["last_run_at"],
        "last_run_result": _state["last_run_result"],
        "next_run_at": _next_run_at(),
    }
