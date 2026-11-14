"""
Gate-open time ("mở cổng hạ / mở bãi") for ports whose schedule only gives the cut-off.

SP-ITC publishes no opening time: it opens the gate a fixed number of hours before the cut-off,
by cargo type (e.g. cut-off 07:00 16/11 - 144h = gate opens 07:00 10/11 for dry containers).
The hours live in system_settings ('port_gate_open_hours', JSON) so they can be edited from
Settings when the port changes them; the defaults below apply until then.
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Dict

logger = logging.getLogger(__name__)

SETTING_KEY = "port_gate_open_hours"

# Cargo type -> schedule column it fills
CARGO_COLUMNS = {"dry": "OPEN_TS", "reefer": "REEFER_OPEN_TS", "haz": "HAZ_OPEN_TS"}

DEFAULT_GATE_OPEN_HOURS: Dict[str, Dict[str, int]] = {
    "ITC": {"dry": 144, "reefer": 72, "haz": 48},
}

MAX_HOURS = 24 * 30
_TS_FORMAT = "%Y-%m-%d %H:%M:%S"


def _clean(saved: dict) -> Dict[str, Dict[str, int]]:
    """Defaults overlaid with the valid saved values (unknown ports/types and bad numbers are dropped)."""
    out = {port: dict(hours) for port, hours in DEFAULT_GATE_OPEN_HOURS.items()}
    for port, hours in (saved or {}).items():
        if port not in out or not isinstance(hours, dict):
            continue
        for cargo, value in hours.items():
            if cargo in CARGO_COLUMNS and isinstance(value, (int, float)) and 0 < value <= MAX_HOURS:
                out[port][cargo] = int(value)
    return out


# Read on every container list: cached, and dropped whenever the hours are saved
_cached_hours: Dict[str, Dict[str, int]] | None = None


def get_gate_open_hours() -> Dict[str, Dict[str, int]]:
    global _cached_hours
    if _cached_hours is not None:
        return {port: dict(h) for port, h in _cached_hours.items()}
    from backend.app.core.database import get_system_setting
    try:
        raw = get_system_setting(SETTING_KEY, "")
        hours = _clean(json.loads(raw) if raw else {})
    except Exception:
        logger.exception("Invalid %s in system_settings, using defaults", SETTING_KEY)
        hours = _clean({})
    _cached_hours = hours
    return {port: dict(h) for port, h in hours.items()}


def reset_gate_open_hours_cache() -> None:
    global _cached_hours
    _cached_hours = None


def set_gate_open_hours(hours: Dict[str, Dict[str, int]]) -> Dict[str, Dict[str, int]]:
    from backend.app.core.database import set_system_setting
    cleaned = _clean(hours)
    set_system_setting(SETTING_KEY, json.dumps(cleaned))
    reset_gate_open_hours_cache()
    apply_gate_open_hours(cleaned)
    return cleaned


def apply_gate_open_hours(hours: Dict[str, Dict[str, int]] | None = None) -> int:
    """Recomputes the gate-open times of the schedules already stored for these ports from their cut-off.

    Without this, only schedules fetched again after the change got the times: those saved before the
    feature, before an edit in Settings, or no longer synced (vessel already left) kept them empty.
    Returns the number of rows updated.
    """
    from backend.app.core.database import get_connection
    hours = hours if hours is not None else get_gate_open_hours()
    updated = 0
    with get_connection() as conn:
        for port, port_hours in hours.items():
            rows = conn.execute(
                "SELECT id, closing_time FROM vessel_schedules WHERE UPPER(site_id) = ? AND COALESCE(closing_time, '') <> ''",
                (port,),
            ).fetchall()
            for row_id, closing in rows:
                opens = gate_open_times(str(closing).split(".")[0], port_hours)
                if not opens:
                    continue
                conn.execute(
                    "UPDATE vessel_schedules SET open_ts = ?, reefer_open_ts = ?, haz_open_ts = ? WHERE id = ?",
                    (opens.get("OPEN_TS", ""), opens.get("REEFER_OPEN_TS", ""), opens.get("HAZ_OPEN_TS", ""), row_id),
                )
                updated += 1
    if updated:
        logger.info("Gate-open times recomputed for %d stored vessel schedule(s)", updated)
    return updated


def gate_open_times(closing: str, hours: Dict[str, int]) -> Dict[str, str]:
    """{'OPEN_TS': ..., 'REEFER_OPEN_TS': ..., 'HAZ_OPEN_TS': ...} = cut-off minus each cargo type's hours.

    `closing` is 'YYYY-MM-DD HH:MM:SS' (as SP-ITC gives it); anything else yields no times.
    """
    try:
        cut_off = datetime.strptime((closing or "").strip(), _TS_FORMAT)
    except ValueError:
        return {}
    return {column: (cut_off - timedelta(hours=hours[cargo])).strftime(_TS_FORMAT)
            for cargo, column in CARGO_COLUMNS.items() if hours.get(cargo)}


def container_cargo_type(iso: str, temp: str, haz: str = "") -> str:
    """'haz' for dangerous goods (the container's HAZ text is set), else 'reefer' for a reefer box (ISO size-type
    group R, e.g. 45R1 / 22R1, or a set temperature), else 'dry'. DG comes first: a reefer carrying DG is
    accepted only when the DG gate opens."""
    if (haz or "").strip() not in ("", "null", "None"):
        return "haz"
    code = (iso or "").strip().upper()
    if (len(code) >= 3 and code[2] == "R") or (temp or "").strip() not in ("", "0", "null", "None"):
        return "reefer"
    return "dry"


def container_gate_open_time(site_id: str, cutoff: str, iso: str = "", temp: str = "", haz: str = "") -> str:
    """Gate-open time of a container = its vessel's cut-off minus the hours of its cargo type at that port
    (now only SP-ITC). Computed when shown, so an edit in Settings applies at once. '' when unknown."""
    hours = get_gate_open_hours().get((site_id or "").strip().upper())
    if not hours or not cutoff:
        return ""
    column = CARGO_COLUMNS[container_cargo_type(iso, temp, haz)]
    return gate_open_times(str(cutoff).split(".")[0], hours).get(column, "")
