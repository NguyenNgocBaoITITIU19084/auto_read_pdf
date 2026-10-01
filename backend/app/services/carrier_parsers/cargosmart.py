"""
COSCO / OOCL booking confirmations (CargoSmart/IRIS layout, shared labels):

    BOOKING NUMBER: 6469390440
    INTENDED VESSEL/VOYAGE: COSCO SHIPPING ALPS 049W ETD: 03 Oct 2026 14:00(ICT)
    TRANSHIPMENT PORT: Singapore / Pasir Panjang Terminal ETA: ...
    T/S INTENDED VESSEL VOYAGE: CSCL VENUS 090W ETD: 13 Oct 2026 22:00(SGT)
    PORT OF DISCHARGE: Istanbul / Kumport Liman ETA: ...
    FINAL DESTINATION: Kumport,Istanbul, Turkey ETA: ...
    BLOCK NUMBER: USLGB
    INTENDED (FCL )CY CUT-OFF: 01 Oct 2026 23:59(ICT)
    BOOKING QTY SIZE/TYPE: 2 X 40' Hi-Cube Container
    FULL RETURN LOCATION: Icd Phuoc Long 3          (COSCO: stacked labels)
    EMPTY PICKUP LOCATION: FULL RETURN LOCATION:    (OOCL: side by side, values on the next row)
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, first_line_below, group_rows

LAYOUT_MARKERS = (
    re.compile(r"^BOOKING NUMBER:", re.MULTILINE),
    re.compile(r"^INTENDED VESSEL/VOYAGE:", re.MULTILINE),
)


def matches(text: str) -> bool:
    return all(rx.search(text) for rx in LAYOUT_MARKERS)


def _line_value(text: str, label: str) -> str:
    """Value after `label` on its own line, cut before a trailing 'ETA:'/'ETD:' column."""
    m = re.search(rf"^{label}[ \t]*(.*)$", text, re.MULTILINE)
    if not m:
        return ""
    return re.split(r"\s+ET[AD]:", m.group(1))[0].strip()


def _port_name(value: str) -> str:
    """'Istanbul / Kumport Liman' -> 'Istanbul' (port, without the terminal)."""
    return value.split(" / ")[0].strip()


def _vessel_etd(text: str, label: str):
    m = re.search(rf"^{label}[ \t]*(.+?)\s+ETD:\s*(.+)$", text, re.MULTILINE)
    if not m:
        return "", ""
    return m.group(1).strip(), m.group(2).strip()


def _equipment(text: str):
    """'BOOKING QTY SIZE/TYPE: 2 X 40' Hi-Cube Container' (several types -> one per line)."""
    m = re.search(r"^BOOKING QTY SIZE/TYPE:[ \t]*(.*)$", text, re.MULTILINE)
    if not m:
        return "", ""
    lines = [m.group(1)]
    for nxt in text[m.end():].lstrip("\n").splitlines():
        if not re.match(r"^\s*\d+\s*X\s+\S", nxt):
            break
        lines.append(nxt)
    items = []
    for line in lines:
        items += re.findall(r"(\d+)\s*X\s+(.+?)\s*(?=,\s*\d+\s*X\s|$)", line.strip())
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0][1], items[0][0]
    return " + ".join(f"{q} X {t}" for q, t in items), str(sum(int(q) for q, _ in items))


_EMPTY_LABEL = "EMPTY PICKUP LOCATION:"
_FULL_LABEL = "FULL RETURN LOCATION:"


def _depots_from_words(pages_words: Sequence[List[Dict]]):
    """OOCL: both labels on one row, depot names on the row below, split at the 'FULL' label."""
    for words in pages_words:
        rows = group_rows(words)
        empty = find_phrase(rows, _EMPTY_LABEL)
        full = find_phrase(rows, _FULL_LABEL)
        if not (empty and full) or abs(empty["top"] - full["top"]) > 3 or full["x0"] <= empty["x0"]:
            continue
        split_x = full["x0"] - 2
        return (first_line_below(rows, empty["top"], 0, split_x),
                first_line_below(rows, full["top"], split_x))
    return None


def _depots_from_text(text: str):
    """COSCO: each label on its own line with the value after it (blank = not assigned)."""
    def value(label: str, other: str) -> str:
        m = re.search(rf"^{label}[ \t]*(.*)$", text, re.MULTILINE)
        if not m or other in m.group(1):  # side-by-side labels: value is not on this line
            return ""
        return m.group(1).strip()
    return value(_EMPTY_LABEL, _FULL_LABEL), value(_FULL_LABEL, _EMPTY_LABEL)


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {}

    m = re.search(r"^BOOKING NUMBER:\s*([A-Z0-9]+)", text, re.MULTILINE)
    if m:
        out["Booking No"] = m.group(1)

    vessel, etd = _vessel_etd(text, "INTENDED VESSEL/VOYAGE:")
    ts_vessel, ts_etd = _vessel_etd(text, r"T/S INTENDED VESSEL\s*/?\s*VOYAGE:")
    out["T/S Port"] = _port_name(_line_value(text, "TRANSHIPMENT PORT:"))
    out["Vessel"], out["ETD"] = vessel, etd
    if out["T/S Port"] and ts_vessel:
        out["Pre Carrier"], out["ETD_Pre"] = vessel, etd
        out["Trunk Vessel"], out["ETD_Trunk"] = ts_vessel, ts_etd
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["Port of Discharging"] = _port_name(_line_value(text, "PORT OF DISCHARGE:"))
    out["Place of Delivery"] = _line_value(text, "FINAL DESTINATION:")

    m = re.search(r"^BLOCK NUMBER:[ \t]*(\S[^\n]*)?$", text, re.MULTILINE)
    if m and m.group(1):
        out["Block"] = m.group(1).strip()

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    m = re.search(r"INTENDED\s+(?:FCL\s+)?CY\s+CUT-OFF:\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}(?:\s+\d{1,2}:\d{2})?)", text)
    if m:
        out["Port Cargo Cut-off"] = m.group(1)

    depots = _depots_from_words(pages_words) if pages_words else None
    empty, full = depots or _depots_from_text(text)
    out["Empty Pick Up CY"], out["Full return CY"] = empty, full

    return {k: v for k, v in out.items() if v}
