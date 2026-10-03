"""What counts as a notification-worthy change between two readings of the same vessel / container.

Pure functions (no DB): the write path in core.database loads the previous rows, calls these, and stores the result.
The rules are conservative on purpose — a wrong or repeated alert is worse than a missed one:
- something seen for the first time is never a change;
- times are compared as parsed datetimes (stored rows mix "06:00 16/09/2026", "2026-09-16 06:00:00" and
  "EST (dự kiến): 22:59 24/09/2026"), so a pure format difference is silent;
- a value that is blank / a placeholder / unparseable on either side is silent (ePort glitches).
"""
import re
from datetime import datetime

from backend.app.core.timezone import DATETIME_FMT  # noqa: F401  (re-exported for callers building "now")

MIN_YEAR, MAX_YEAR = 2000, 2100
_ISO = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})")
_HM_DMY = re.compile(r"(\d{1,2}):(\d{2})(?::\d{2})?\s+(\d{1,2})/(\d{1,2})/(\d{4})")
_DMY_HM = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})")

DISPLAY_FMT = "%d/%m/%Y %H:%M"

# --- kinds -------------------------------------------------------------------------------------------------
CONTAINER_CUSTOMS = "container_customs"
CONTAINER_INGATE = "container_ingate"
CONTAINER_OUTGATE = "container_outgate"
VESSEL_CLOSING = "vessel_closing"
VESSEL_CLOSING_ICD = "vessel_closing_icd"
VESSEL_OPEN_GATE = "vessel_open_gate"
VESSEL_ETA = "vessel_eta"
VESSEL_ETD = "vessel_etd"
# One notification per vessel/voyage and lookup, listing every time that changed (detail["changes"])
VESSEL_SCHEDULE = "vessel_schedule"

ALL_KINDS = (
    CONTAINER_CUSTOMS, CONTAINER_INGATE, CONTAINER_OUTGATE,
    VESSEL_CLOSING, VESSEL_CLOSING_ICD, VESSEL_OPEN_GATE, VESSEL_ETA, VESSEL_ETD,
)

# vessel_schedules column -> kind and its short label, in the order the changes are listed
VESSEL_FIELDS = (
    ("actual_departure_time", VESSEL_ETD, "ETD"),
    ("actual_berth_time", VESSEL_ETA, "ETA"),
    ("closing_time", VESSEL_CLOSING, "Cut-off"),
    ("closing_time_icd", VESSEL_CLOSING_ICD, "Cut-off ICD"),
    ("open_ts", VESSEL_OPEN_GATE, "Mở cổng hạ"),
)


def extract_datetime(value) -> datetime | None:
    """First date-time found in the text, whatever its layout; None for blanks, placeholders and non-dates."""
    text = " ".join(str(value or "").split())
    if not text:
        return None
    parts = None
    m = _ISO.search(text)
    if m:
        parts = tuple(int(m.group(i)) for i in (1, 2, 3, 4, 5))
    else:
        m = _HM_DMY.search(text)
        if m:
            hour, minute, day, month, year = (int(m.group(i)) for i in range(1, 6))
            parts = (year, month, day, hour, minute)
        else:
            m = _DMY_HM.search(text)
            if m:
                day, month, year, hour, minute = (int(m.group(i)) for i in range(1, 6))
                parts = (year, month, day, hour, minute)
    if parts is None or not (MIN_YEAR <= parts[0] <= MAX_YEAR):
        return None
    try:
        return datetime(*parts)
    except ValueError:
        return None


def fmt(dt: datetime) -> str:
    return dt.strftime(DISPLAY_FMT)


def change_lines(changes: list[dict]) -> str:
    """"ETD 06/10/2026 23:00 → 07/10/2026 23:00", one line per changed time."""
    return "\n".join(f"{c['label']} {c['old']} → {c['new']}" for c in changes)


def vessel_time_changes(old: dict, new: dict, enabled) -> list[dict]:
    """Changed schedule times of one vessel/voyage: [{kind, label, old, new}] (old/new as dd/mm/yyyy HH:MM)."""
    out = []
    for column, kind, label in VESSEL_FIELDS:
        if kind not in enabled:
            continue
        before, after = extract_datetime(old.get(column)), extract_datetime(new.get(column))
        if before is None or after is None or before == after:
            continue
        out.append({"kind": kind, "label": label, "old": fmt(before), "new": fmt(after)})
    return out


# --- containers --------------------------------------------------------------------------------------------
def _event_key(row: dict) -> tuple[str, str]:
    return (str(row.get("event_time") or "").strip(), str(row.get("event_type") or "").strip().upper())


def event_kind(event_type: str) -> str | None:
    up = (event_type or "").upper().replace(" ", "")
    if "OUTGATE" in up or "GATEOUT" in up:
        return CONTAINER_OUTGATE
    if "INGATE" in up or "GATEIN" in up:
        return CONTAINER_INGATE
    return None


def customs_state(rows: list[dict], status_of) -> str:
    """Customs status of the container = that of its latest event row (`status_of(row)` -> label or "")."""
    best, best_dt = None, None
    for r in rows:
        dt = extract_datetime(r.get("event_time"))
        if best is None or (dt is not None and (best_dt is None or dt >= best_dt)):
            best, best_dt = r, dt if dt is not None else best_dt
    return status_of(best) if best is not None else ""


def extra_gate_rows(results: list[dict], watched_nos, kept: list[dict], enabled) -> list[dict]:
    """INGATE / OUTGATE rows of watched containers that a per-event-type watch filter would drop.

    A row bookmarked in the Cont tab creates a watch for THAT row's event (e.g. UNLOAD), and the sync only stores
    rows matching it — so a later OUTGATE would never even be stored, let alone reported. Keeping the gate rows
    of every watched container (when their alerts are on) also stops the same gate re-alerting after the dedupe window.
    """
    wanted = {CONTAINER_INGATE, CONTAINER_OUTGATE} & set(enabled)
    if not wanted:
        return []
    kept_ids = {id(r) for r in kept}
    out = []
    for r in results:
        if id(r) in kept_ids:
            continue
        cont = str(r.get("CONTAINERNO", r.get("containerno", "")) or "").strip().upper()
        if cont in watched_nos and event_kind(str(r.get("EVENT_TYPE", r.get("event_type", "")) or "")) in wanted:
            out.append(r)
    return out


def container_changes(existing: list[dict], incoming: list[dict], enabled, status_of,
                      cleared_label: str, not_cleared_label: str) -> list[dict]:
    """New INGATE/OUTGATE events and a customs N -> Y switch of one already-known (watched) container.

    `existing` / `incoming` rows carry event_time, event_type, cust, custom_clearance_status.
    """
    if not existing:
        return []  # first time this container is seen in the collection: nothing to compare with
    out: list[dict] = []
    known = {_event_key(r) for r in existing}
    times = [dt for dt in (extract_datetime(r.get("event_time")) for r in existing) if dt is not None]
    latest_known = max(times) if times else None

    for r in sorted(incoming, key=lambda r: extract_datetime(r.get("event_time")) or datetime.min):
        key = _event_key(r)
        if key in known:
            continue
        kind = event_kind(key[1])
        if not kind or kind not in enabled:
            continue
        dt = extract_datetime(r.get("event_time"))
        # an event older than what we already know is history being back-filled, not news
        if dt is None or (latest_known is not None and dt <= latest_known):
            continue
        out.append({"kind": kind, "old": "", "new": fmt(dt), "event_type": key[1]})

    if CONTAINER_CUSTOMS in enabled:
        merged = {_event_key(r): r for r in existing}
        merged.update({_event_key(r): r for r in incoming})
        before = customs_state(existing, status_of)
        after = customs_state(list(merged.values()), status_of)
        if before == not_cleared_label and after == cleared_label:
            out.append({"kind": CONTAINER_CUSTOMS, "old": not_cleared_label, "new": cleared_label, "event_type": ""})
    return out
