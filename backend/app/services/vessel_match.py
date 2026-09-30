"""Match a booking's free-text vessel ("HMM HOPE 062E(EC2)") to ePort vessel schedules.

A wrong match puts a wrong cut-off into the alerts, so matching is deliberately strict:
the vessel name must be identical (whole words) and the leftover text must be a voyage that
ePort lists for that vessel.
"""
import re
import unicodedata
from datetime import datetime

from backend.app.services.eport_client import is_voyage_match

EPORT_CUTOFF_FORMAT = "%d/%m/%Y %H:%M"
_MIN_YEAR, _MAX_YEAR = 2000, 2100
_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$")
_HM_DMY_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::\d{2})? (\d{1,2})/(\d{1,2})/(\d{4})$")
_DMY_HM_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4}) (\d{1,2}):(\d{2})(?::\d{2})?$")
_PAREN_RE = re.compile(r"\([^)]*\)")
_PREFIX_RE = re.compile(r"^(?:tàu|tau|vessel|ship)\s*[:.]\s*", re.IGNORECASE)


def _tokens(text) -> list[str]:
    """Upper-case, accent-free alphanumeric words."""
    s = unicodedata.normalize("NFD", str(text or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("đ", "d").replace("Đ", "D").upper()
    return re.sub(r"[^A-Z0-9]+", " ", s).split()


def booking_vessel_tokens(vessel_text) -> list[str]:
    """Words of the booking vessel text with the service suffix "(EC2)" / "(CTP)" and label prefix dropped."""
    text = _PREFIX_RE.sub("", " ".join(str(vessel_text or "").split()))
    return _tokens(_PAREN_RE.sub(" ", text))


def match_voyage(remainder: list[str], eport_voyage: str) -> bool:
    """Leftover words (all must look like voyage codes) against ePort's "in-out" voyage, e.g. 062E-062E."""
    if not remainder or not all(any(c.isdigit() for c in w) for w in remainder):
        return False
    candidates = {"-".join(remainder), "".join(remainder), *remainder}
    return any(is_voyage_match(c, eport_voyage) for c in candidates)


def parse_closing_time(value) -> str | None:
    """ePort closing time -> booking format "DD/MM/YYYY HH:MM", or None for blanks / placeholders / unparsed text.

    Stored vessel rows come in three shapes: "2026-09-23 11:00:00" (ePort client), "11:00 23/09/2026"
    (older rows / display format) and "23/09/2026 11:00". A date without a time is not a usable cut-off.
    """
    text = " ".join(str(value or "").split())
    m = _ISO_RE.match(text)
    if m:
        year, month, day, hour, minute = (int(m.group(i)) for i in range(1, 6))
    else:
        m = _HM_DMY_RE.match(text)
        if m:
            hour, minute, day, month, year = (int(m.group(i)) for i in range(1, 6))
        else:
            m = _DMY_HM_RE.match(text)
            if not m:
                return None
            day, month, year, hour, minute = (int(m.group(i)) for i in range(1, 6))
    if not (_MIN_YEAR <= year <= _MAX_YEAR):
        return None
    try:
        return datetime(year, month, day, hour, minute).strftime(EPORT_CUTOFF_FORMAT)
    except ValueError:
        return None


def build_schedule_index(schedules: list[dict]) -> dict[tuple[str, ...], list[dict]]:
    """Schedules keyed by their vessel-name words."""
    index: dict[tuple[str, ...], list[dict]] = {}
    for s in schedules:
        key = tuple(_tokens(s.get("vessel_name")))
        if key:
            index.setdefault(key, []).append(s)
    return index


def find_eport_cutoff(vessel_text, index: dict[tuple[str, ...], list[dict]]) -> str | None:
    """The single ePort closing time for this booking's vessel + voyage, or None when there is no
    (or no unambiguous) match."""
    words = booking_vessel_tokens(vessel_text)
    times: set[str] = set()
    for k in range(1, len(words)):
        for s in index.get(tuple(words[:k]), ()):
            if match_voyage(words[k:], s.get("in_out_voyage") or ""):
                parsed = parse_closing_time(s.get("closing_time"))
                if parsed:
                    times.add(parsed)
    return next(iter(times)) if len(times) == 1 else None
