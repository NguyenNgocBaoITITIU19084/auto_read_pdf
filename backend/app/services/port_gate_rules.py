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


def get_gate_open_hours() -> Dict[str, Dict[str, int]]:
    from backend.app.core.database import get_system_setting
    try:
        raw = get_system_setting(SETTING_KEY, "")
        return _clean(json.loads(raw) if raw else {})
    except Exception:
        logger.exception("Invalid %s in system_settings, using defaults", SETTING_KEY)
        return _clean({})


def set_gate_open_hours(hours: Dict[str, Dict[str, int]]) -> Dict[str, Dict[str, int]]:
    from backend.app.core.database import set_system_setting
    cleaned = _clean(hours)
    set_system_setting(SETTING_KEY, json.dumps(cleaned))
    return cleaned


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
