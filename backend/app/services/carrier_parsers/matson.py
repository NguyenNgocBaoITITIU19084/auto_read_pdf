"""
Matson 'BOOKING CONFIRMATION' (issued in Vietnam by its agent S5 Asia), a form of labels with
their values on the row below, two columns side by side:

    INITIAL CARRIAGE          PLACE OF RECEIPT
    MILD SYMPHONY V. 2640 N                              <- feeder leaving Vietnam
    VESSEL VOYAGE             PORT OF LOADING
    MATSON OAHU 135 E         HO CHI MINH                <- Matson mother vessel
    PORT OF DISCHARGE         PLACE OF DELIVERY
    LONG BEACH, CA            LONG BEACH, CA
    10 x D40H                                            <- D = dry, H = high cube
    B/L NO.  MATS3264527-000

and, on page 2:

    TAN CANG HIEP PHUOC PORT
    Place of Laden Return ...
    ETD HCM Thursday 15-10-2026 SHANGHAI ETD SHA 22-Oct-2026 ETA LGB Monday 02-11-2026
    CY Cutoff Time 1800hr - Wednesday

The booking number is stored without its dash ('MATS3264527000'): Matson asks for that form at the
terminal / ePort. The CY cut-off names only a weekday and hour; it is dated to the last such
weekday before the ETD. No block code is printed.

Offline OCR prints the labels and values apart: the mother vessel's name follows 'VESSEL' and its
voyage starts the line after 'VOYAGE'; the ETD is the first '<weekday> dd-mm-yyyy'; the transit port
follows 'Last Foreign Port'. Its cut-off hours lose their labels, so the CY cut-off is left empty.
"""
import re
from datetime import date, timedelta
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text, row_top

ISSUER = re.compile(r"\bMATSON\b", re.IGNORECASE)

_WEEKDAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")
# '10 x D40H' -> qty, kind letter, size, high cube
_EQ = re.compile(r"\b(\d+)\s*x\s*([DRFOT])(\d{2})(H?)\b", re.IGNORECASE)
_KINDS = {"D": "GP", "R": "RF", "F": "FR", "O": "OT", "T": "TK"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"BOOKING\s+CONFIRMATION", text, re.IGNORECASE)
                and re.search(r"INITIAL\s+CARRIAGE", text, re.IGNORECASE))


def _column_value(pages_words, label: str, next_label: str) -> str:
    """Words on the row below `label`, between the label's column and `next_label`'s column."""
    for words in pages_words or ():
        rows = group_rows(words)
        head = find_phrase(rows, label)
        if not head:
            continue
        nxt = find_phrase([r for r in rows if abs(row_top(r) - head["top"]) <= 3], next_label)
        x_to = nxt["x0"] - 3 if nxt else float("inf")
        below = next((r for r in rows if 0 < row_top(r) - head["top"] <= 16), None)
        return row_text([w for w in below or () if head["x0"] - 3 <= w["x0"] < x_to])
    return ""


def _line_below(text: str, label: str) -> str:
    """Text fallback: the line after the label line."""
    m = re.search(rf"^.*{label}.*\n(.*)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def _vessel(value: str) -> str:
    """'MILD SYMPHONY V. 2640 N' -> 'MILD SYMPHONY 2640N'; 'MATSON OAHU 135 E' -> 'MATSON OAHU 135E'."""
    value = re.sub(r"\s+V\.?\s+(?=\d)", " ", value.strip())
    return re.sub(r"(\d)\s+([NSEW])$", r"\1\2", value)


def _equipment(text: str):
    """'10 x D40H' -> ("40'HC", '10'); several types -> combined list and total."""
    items = []
    for qty, kind, size, high in _EQ.findall(text):
        code = _KINDS[kind.upper()]
        if high:
            code = {"GP": "HC", "RF": "RH"}.get(code, code)
        items.append((f"{size}'{code}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _cy_cut_off(text: str, etd: str) -> str:
    """'CY Cutoff Time 1800hr - Wednesday' + ETD 15/10/2026 -> '14/10/2026 18:00' (last such day before the ETD)."""
    m = re.search(r"CY\s+Cutoff\s+Time\s+(\d{1,2})(\d{2})\s*hr\s*-\s*([A-Za-z]+)", text, re.IGNORECASE)
    d = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", etd)
    if not m or not d or m.group(3).upper() not in _WEEKDAYS:
        return ""
    etd_day = date(int(d.group(3)), int(d.group(2)), int(d.group(1)))
    back = (etd_day.weekday() - _WEEKDAYS.index(m.group(3).upper())) % 7 or 7
    cut = etd_day - timedelta(days=back)
    return f"{cut:%d/%m/%Y} {int(m.group(1)):02d}:{m.group(2)}"


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "MATSON"}

    m = re.search(r"\b(MATS\d{6,8})-?(\d{3})\b", text)
    if m:
        out["Booking No"] = m.group(1) + m.group(2)

    feeder = _vessel(_column_value(pages_words, "INITIAL CARRIAGE", "PLACE OF RECEIPT")
                     or _line_below(text, r"INITIAL\s+CARRIAGE"))
    mother = _vessel(_column_value(pages_words, "VESSEL", "PORT OF LOADING")
                     or re.sub(r"\s+HO\s+CHI\s+MINH.*$", "", _line_below(text, r"^VESSEL\s+VOYAGE")))
    if not mother:  # OCR: 'VESSEL' / 'MATSON OAHU' ... 'VOYAGE' / ... / '135 E HO CHI MINH'
        name = re.search(r"^\s*VESSEL\s*\n\s*([A-Z][A-Z .'-]+)$", text, re.MULTILINE)
        voyage = re.search(r"^\s*VOYAGE\s*$(?:\n.*){0,3}?\n\s*(\d{2,4})\s?([NSEW])\b", text, re.MULTILINE)
        mother = f"{name.group(1).strip()} {voyage.group(1)}{voyage.group(2)}" if name and voyage else ""
    route = re.search(r"ETD\s+HCM\s+[A-Za-z]*\s*(\d{1,2})-(\d{1,2})-(\d{4})\s+(.+?)\s+ETD\s+[A-Z]{3}\s+(\S+)", text,
                      re.IGNORECASE)
    if route:
        etd_day, ts_port, etd_trunk = route.group(1, 2, 3), route.group(4).strip(), route.group(5)
    else:  # OCR: the schedule row's cells come out one per line
        day = re.search(r"\b(?:MON|TUES|WEDNES|THURS|FRI|SATUR|SUN)DAY\s+(\d{1,2})-(\d{1,2})-(\d{4})", text, re.IGNORECASE)
        port = re.search(r"Last\s+Foreign\s+Port\s*\n\s*([A-Z][A-Z .'-]+)$", text, re.MULTILINE)
        trunk_etd = re.search(r"ETD\s+[A-Z]{3}\s*\n?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})", text)
        etd_day = day.group(1, 2, 3) if day else None
        ts_port = port.group(1).strip() if port else ""
        etd_trunk = trunk_etd.group(1) if trunk_etd else ""
    etd = f"{int(etd_day[0]):02d}/{int(etd_day[1]):02d}/{etd_day[2]}" if etd_day else ""
    vessel = feeder or mother
    out["Vessel"], out["ETD"] = vessel, etd
    if feeder and mother and feeder != mother:
        out["T/S Port"] = ts_port
        out["Pre Carrier"], out["ETD_Pre"] = feeder, etd
        out["Trunk Vessel"], out["ETD_Trunk"] = mother, etd_trunk
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    pod = _column_value(pages_words, "PORT OF DISCHARGE", "PLACE OF DELIVERY")
    pld = _column_value(pages_words, "PLACE OF DELIVERY", "OBL___")
    if not pod:  # text fallback: 'LONG BEACH, CA LONG BEACH, CA' -> the two halves when they repeat
        line = _line_below(text, r"^PORT\s+OF\s+DISCHARGE")
        half = re.fullmatch(r"(.+?)\s+\1", line)
        pod = pld = half.group(1) if half else line
    out["Port of Discharging"], out["Place of Delivery"] = pod, pld

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    # The port name sits on the line above its '(Port: VNTCH ...)' code
    m = re.search(r"^(.+)\n.*\(Port:\s*[A-Z]{5}", text, re.MULTILINE)
    out["Full return CY"] = m.group(1).strip() if m else ""
    out["Port Cargo Cut-off"] = _cy_cut_off(text, etd) if route else ""

    return {k: v for k, v in out.items() if v}
