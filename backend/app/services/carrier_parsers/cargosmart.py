"""
COSCO / OOCL booking confirmations (CargoSmart/IRIS layout, shared labels):

    BOOKING NUMBER: 6469390440
    INTENDED VESSEL/VOYAGE: COSCO SHIPPING ALPS 049W ETD: 03 Oct 2026 14:00(ICT)
    TRANSHIPMENT PORT: Singapore / Pasir Panjang Terminal ETA: ...     (or 'TRANSSHIPMENT PORT:')
    T/S INTENDED VESSEL VOYAGE: CSCL VENUS 090W ETD: 13 Oct 2026 22:00(SGT)
    PORT OF DISCHARGE: Istanbul / Kumport Liman ETA: ...
    FINAL DESTINATION: Kumport,Istanbul, Turkey ETA: ...
    BLOCK NUMBER: USLGB
    INTENDED (FCL )CY CUT-OFF: 01 Oct 2026 23:59(ICT)
    BOOKING QTY SIZE/TYPE: 2 X 40' Hi-Cube Container               -> 2 x 40'HC
    FULL RETURN LOCATION: Icd Phuoc Long 3          (COSCO: stacked labels)
    EMPTY PICKUP LOCATION: FULL RETURN LOCATION:    (OOCL: side by side, values on the next row)

The port of discharge keeps its terminal; long values wrap onto lines of their own
('Oakland / SSA Terminal, Berths 55-' / '59', 'Oakland,Alameda, California,' / 'United States'),
which are joined back.
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


# A label line ('FINAL DESTINATION:', 'ESTIMATED CARGO AVAILABILITY AT DESTINATION HUB:'), not a wrapped value
_LABEL_LINE = re.compile(r"^[A-Z][A-Z0-9 /()&.'-]*:")
_TIME_ZONE = re.compile(r"\s*\([A-Z]{2,4}\)$")  # '(ICT)' wrapped from the ETA column


def _wrapped_value(text: str, label: str) -> str:
    """`_line_value` plus the wrapped lines below it, up to the next label."""
    m = re.search(rf"^{label}[ \t]*(.*)$", text, re.MULTILINE)
    if not m:
        return ""
    value = re.split(r"\s+ET[AD]:", m.group(1))[0].strip()
    for line in text[m.end():].lstrip("\n").splitlines()[:2]:
        line = _TIME_ZONE.sub("", line.strip())
        if not line or _LABEL_LINE.match(line):
            break
        value = value + line if value.endswith("-") else f"{value} {line}"
    return value


def _place(value: str) -> str:
    """'Oakland,Alameda, California, United States' -> 'Oakland, Alameda, California, United States'."""
    return re.sub(r"\s*,\s*", ", ", value).strip(" ,")


def _port_name(value: str) -> str:
    """'Istanbul / Kumport Liman' -> 'Istanbul' (port, without the terminal)."""
    return value.split(" / ")[0].strip()


def _vessel_etd(text: str, label: str):
    m = re.search(rf"^{label}[ \t]*(.+?)\s+ETD:\s*(.+)$", text, re.MULTILINE)
    if not m:
        return "", ""
    return m.group(1).strip(), m.group(2).strip()


# Container names -> type codes (reefer high cube before reefer, high cube before the rest)
_KINDS = ((r"REEFER\s+HI(?:GH)?[-\s]?CUBE", "RH"), (r"HI(?:GH)?[-\s]?CUBE", "HC"), (r"REEFER", "RF"),
          (r"OPEN\s*TOP", "OT"), (r"FLAT\s*RACK", "FR"), (r"TANK", "TK"), (r"GENERAL\s+PURPOSE|DRY", "GP"))


def _type_code(name: str) -> str:
    """"40' Hi-Cube Container" -> "40'HC"; '20GP' -> "20'GP"; unknown names stay as printed."""
    m = re.match(r"(\d{2})\s*'?\s*([A-Z]{2})?\b(.*)$", name.strip(), re.IGNORECASE)
    if not m:
        return name
    size, code, rest = m.group(1), (m.group(2) or "").upper(), m.group(3)
    if code in ("GP", "HC", "HQ", "RF", "RH", "OT", "FR", "TK", "DC", "DV") and not rest.strip():
        return f"{size}'{ {'HQ': 'HC', 'DC': 'GP', 'DV': 'GP'}.get(code, code) }"
    kind = next((c for rx, c in _KINDS if re.search(rx, name, re.IGNORECASE)), "")
    return f"{size}'{kind}" if kind else name


def _equipment(text: str):
    """'BOOKING QTY SIZE/TYPE: 2 X 40' Hi-Cube Container' -> ("40'HC", '2') (several types -> one per line)."""
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
        items += [(q, _type_code(t)) for q, t in re.findall(r"(\d+)\s*X\s+(.+?)\s*(?=,\s*\d+\s*X\s|$)", line.strip())]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0][1], items[0][0]
    return " + ".join(f"{q} X {t}" for q, t in items), str(sum(int(q) for q, _ in items))


_EMPTY_LABEL = "EMPTY PICKUP LOCATION:"
_FULL_LABEL = "FULL RETURN LOCATION:"


_BARCODE_WORD = re.compile(r"^[A-Z]{18,}$")  # page header barcode rows ('AAAAAAAPPIIJJJJJJIIPP...')


def _page_body_top(rows: Sequence[List[Dict]]) -> float:
    """Top of the last barcode row of the repeated page header (the page body starts below it)."""
    tops = [w["top"] for r in rows for w in r if _BARCODE_WORD.match(w["text"])]
    return max(tops) if tops else 0.0


def _depots_from_words(pages_words: Sequence[List[Dict]]):
    """OOCL: both labels on one row, depot names on the row below, split at the 'FULL' label.

    When the labels are the last row of a page, the names open the next page, below its barcode header."""
    for i, words in enumerate(pages_words):
        rows = group_rows(words)
        empty = find_phrase(rows, _EMPTY_LABEL)
        full = find_phrase(rows, _FULL_LABEL)
        if not (empty and full) or abs(empty["top"] - full["top"]) > 3 or full["x0"] <= empty["x0"]:
            continue
        split_x = full["x0"] - 2
        depots = (first_line_below(rows, empty["top"], 0, split_x),
                  first_line_below(rows, full["top"], split_x))
        if not any(depots) and i + 1 < len(pages_words) and rows[-1][0]["top"] - empty["top"] <= 3:
            nxt = group_rows(pages_words[i + 1])
            top = _page_body_top(nxt)
            depots = (first_line_below(nxt, top, 0, split_x, max_gap=40),
                      first_line_below(nxt, top, split_x, max_gap=40))
        return depots
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
    # Spelled 'TRANSHIPMENT' on some confirmations, 'TRANSSHIPMENT' on others (OOCL App)
    out["T/S Port"] = _port_name(_line_value(text, "TRANS{1,2}HIPMENT PORT:"))
    out["Vessel"], out["ETD"] = vessel, etd
    if out["T/S Port"] and ts_vessel:
        out["Pre Carrier"], out["ETD_Pre"] = vessel, etd
        out["Trunk Vessel"], out["ETD_Trunk"] = ts_vessel, ts_etd
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["Port of Discharging"] = _place(_wrapped_value(text, "PORT OF DISCHARGE:"))
    out["Place of Delivery"] = _place(_wrapped_value(text, "FINAL DESTINATION:"))

    m = re.search(r"^BLOCK NUMBER:[ \t]*(\S[^\n]*)?$", text, re.MULTILINE)
    if m and m.group(1):
        out["Block"] = m.group(1).strip()

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    m = re.search(r"INTENDED\s+(?:FCL\s+)?CY\s+CUT-OFF:\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}(?:\s+\d{1,2}:\d{2})?)", text)
    if m:
        out["Port Cargo Cut-off"] = m.group(1)

    depots = _depots_from_words(pages_words) if pages_words else None
    empty, full = depots or _depots_from_text(text)
    # 'Cat Lai Terminal' -> 'Cat Lai': the trailing 'Terminal' adds nothing to the depot name
    out["Empty Pick Up CY"], out["Full return CY"] = empty, re.sub(r"\s+Terminal$", "", full, flags=re.IGNORECASE)

    return {k: v for k, v in out.items() if v}
