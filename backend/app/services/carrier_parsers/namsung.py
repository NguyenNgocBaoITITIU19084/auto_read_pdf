"""
Namsung (NSS) 'BOOKING RECEIPT NOTICE', two label/value columns per row:

    BOOKING NO. SGN26I02861 VESSEL VOYAGE YEOSU VOYAGER 2608S
    2ND VESSEL VOYAGE (IF          <- label wraps over 2 lines, value printed beside it
    REF. BKG NO. JPN
    ANY)
    PLACE OF RECEIPT HOCHIMINH PORT OF DISCHARGE JAKARTA
    PORT OF LOADING HOCHIMINH PLACE OF DELIVERY JAKARTA
    ESTIMATED DEPARTURE DATE 2026-10-19 ESTIMATED ARRIVAL DATE 2026-10-25
    PICK UP PLACE FULL RETURN PLACE CATLAI TERMINAL      <- empty pick-up place
    CNTR TYPE / QTY 4HDC x 1 NO. OF PACKAGES
    CARGO CLOSING 2026-10-17 (13:00)
    REMARK ...

With a 2nd vessel the transshipment port is only written in the REMARK. The notice carries
no block code. Word boxes (PDFs) locate the 2nd vessel; OCR text falls back to the text lines.

Offline OCR (Apple Vision) prints each column as its own block: a run of labels, then their values
('VESSEL VOYAGE / 2ND VESSEL VOYAGE (IF / ANY) / PORT OF DISCHARGE / PLACE OF DELIVERY /
YEOSU VOYAGER 2608S / JAKARTA / JAKARTA'), empty values simply missing. Those blocks are read by
the shape of each value (vessel + voyage, date, haulage...) instead of by position.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, in_columns, row_text, row_top

TITLE = re.compile(r"BOOKING\s+RECEIPT\s+NOTICE", re.IGNORECASE)
CNTR_LABEL = re.compile(r"CNTR\s+TYPE\s*/\s*QTY", re.IGNORECASE)
NAMSUNG = re.compile(r"\bNAM\s?SUNG\b", re.IGNORECASE)

# Labels printed in the right-hand column, used to cut a left-hand value
_RIGHT_LABELS = (r"VESSEL\s+VOYAGE|PORT\s+OF\s+DISCHARGE|PLACE\s+OF\s+DELIVERY|ESTIMATED\s+ARRIVAL|"
                 r"FULL\s+RETURN\s+PLACE|NO\.\s*OF\s+PACKAGES|KIND\s+OF\s+HAULAGE|TRUCKER")

# Namsung equipment codes: size digit, optional 'H' (high cube), type, e.g. 4HDC, 2DC, 4HRF
_EQ_CODE = re.compile(r"\b([245])(H?)(DC|GP|RF|RE|OT|FR|TK)\s*[xX]\s*(\d+)")
_EQ_SIZE = {"2": "20", "4": "40", "5": "45"}
_EQ_KIND = {"DC": "GP", "GP": "GP", "RE": "RF", "RF": "RF", "OT": "OT", "FR": "FR", "TK": "TK"}

_TS_IN_REMARK = re.compile(
    r"(?:T/S|TS\s+PORT|TRANS?SHIP(?:MENT)?(?:\s+PORT)?|TRANSIT|VIA)\s*(?:AT|PORT)?\s*[:\-]?\s*([A-Z][A-Z ]{2,}?)\s*(?:\(|,|\.|\n|$)",
    re.IGNORECASE)
_BLOCK_IN_REMARK = re.compile(r"\bBLOCK(?:\s+CODE)?\s*[:\-]?\s*([A-Z0-9]+)", re.IGNORECASE)

# Every label of the notice, to tell label lines from value lines in OCR blocks
_LABEL_LINE = re.compile(
    r"^(?:BOOKING\s+NO\.?|REF\.\s*BKG\s+NO\.?.*|(?:2ND\s+)?VESSEL\s+VOYAGE(?:\s*\(IF)?|ANY\)|"
    r"PLACE\s+OF\s+(?:RECEIPT|DELIVERY)|PORT\s+OF\s+(?:LOADING|DISCHARGE)|ESTIMATED\s+\w+\s+DATE.*|"
    r"DOOR\s+INFORMATION|SERVICE\s+TERM|KIND\s+OF\s+HAULAGE|PICK\s+UP\s+(?:DATE|PLACE)|TRUCKER\s+NAME|"
    r"FULL\s+RETURN\s+PLACE|CARGO\s+DETAILS|CNTR\s+TYPE\s*/\s*QTY|NO\.\s*OF\s+PACKAGES|COMMODITY|"
    r"PACKAGES\s+UNIT|GROSS\s+WEIGHT|TOTAL\s+MEASURE|SPECIAL\s+INFORMATION|CLOSING\s+TIME.*|REEFER|"
    r"TEMPERATURE|VENTILATION|OOG|00G|DG|REMARK|(?:DOCUMENT|CARGO)\s+CLOSING.*)$",
    re.IGNORECASE)
_VESSEL_VALUE = re.compile(r"^[A-Z][A-Z .\-]+\s+\d{2,5}[A-Z]{0,2}$")
_DATE_VALUE = re.compile(r"^\W*\d{4}-\d{1,2}-\d{1,2}")
_SERVICE_TERM_VALUE = re.compile(r"^[A-Z]{2,4}\s*/\s*[A-Z]{2,4}$")
_HAULAGE_VALUE = re.compile(r"^(?:SELF|CARRIER|MERCHANT|LINE)$", re.IGNORECASE)


def matches(text: str) -> bool:
    return bool(TITLE.search(text) and CNTR_LABEL.search(text))


def _value(text: str, label: str, stop: str = "") -> str:
    """Value after `label` on its line, cut before the `stop` label printed in the next column."""
    m = re.search(rf"{label}[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    value = m.group(1)
    if stop:
        value = re.split(stop, value, maxsplit=1, flags=re.IGNORECASE)[0]
    return value.strip()


def _equipment(value: str):
    """'4HDC x 1' -> ("40'HC", '1'); several types -> "1 X 40'HC + 2 X 20'GP" and the total."""
    items = []
    for size, high, kind, qty in _EQ_CODE.findall(value.upper()):
        kind = _EQ_KIND[kind]
        if high:
            kind = "RH" if kind == "RF" else "HC" if kind == "GP" else kind
        items.append((f"{_EQ_SIZE[size]}'{kind}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def equipment_name(value: str) -> str:
    """Namsung code read alone (e.g. by Gemini): '4HDC' -> "40'HC"; anything else is returned unchanged."""
    name, _qty = _equipment(f"{value} x 1") if re.fullmatch(r"[245]H?[A-Z]{2}", (value or "").strip().upper()) else ("", "")
    return name or value


def _closing(text: str, label: str) -> str:
    """'CARGO CLOSING 2026-10-17 (13:00)' -> '2026-10-17 13:00'."""
    m = re.search(rf"{label}\s+(\d{{4}}-\d{{1,2}}-\d{{1,2}})(?:\s*\(?\s*(\d{{1,2}}:\d{{2}})\s*\)?)?", text, re.IGNORECASE)
    if not m:
        return ""
    return f"{m.group(1)} {m.group(2)}" if m.group(2) else m.group(1)


def _second_vessel_from_words(pages_words) -> str:
    """Value column beside the wrapped '2ND VESSEL VOYAGE (IF / ANY)' label."""
    for words in pages_words or ():
        rows = group_rows(words)
        label = find_phrase(rows, "2ND VESSEL VOYAGE")
        vessel = find_phrase(rows, "VESSEL VOYAGE")
        if not label or not vessel:
            continue
        # Value column starts where the 1st vessel's value does
        first_row = next(r for r in rows if vessel in r)
        values = [w for w in first_row if w["x0"] > vessel["x1"] + 40]
        x_from = min((w["x0"] for w in values), default=label["x1"] + 30) - 5
        top = label["top"]
        parts = [row_text(in_columns(r, x_from)) for r in rows
                 if top - 8 <= row_top(r) <= top + 20 and in_columns(r, x_from)]
        return " ".join(parts).strip()
    return ""


def _second_vessel_from_text(text: str) -> str:
    m = re.search(r"2ND\s+VESSEL\s+VOYAGE\s*\(IF[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    value = m.group(1).strip() if m else ""
    if not value:
        m = re.search(r"^\s*ANY\)[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
        value = m.group(1).strip() if m else ""
    return value


def _ocr_block(text: str, label: str) -> List[str]:
    """Value lines of the OCR block whose labels include `label` (a whole label line)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    start = next((i for i, ln in enumerate(lines) if re.fullmatch(label, ln, re.IGNORECASE)), None)
    if start is None:
        return []
    i = start + 1
    while i < len(lines) and _LABEL_LINE.match(lines[i]):
        i += 1
    values = []
    while i < len(lines) and not _LABEL_LINE.match(lines[i]):
        values.append(lines[i])
        i += 1
    return values


def _ocr_route(text: str):
    """(vessel, 2nd vessel, POD, DEL) from the 'VESSEL VOYAGE ... PLACE OF DELIVERY' OCR block."""
    values = _ocr_block(text, r"VESSEL\s+VOYAGE")
    vessels = [v for v in values if _VESSEL_VALUE.match(v)]
    ports = [v for v in values if not _VESSEL_VALUE.match(v)]
    return (vessels + ["", ""])[0], (vessels + ["", ""])[1], (ports + ["", ""])[0], (ports + ["", ""])[1]


def _ocr_pick_up_place(text: str) -> str:
    values = [v for v in _ocr_block(text, r"PICK\s+UP\s+PLACE")
              if not _DATE_VALUE.match(v) and not _SERVICE_TERM_VALUE.match(v)]
    return values[0] if values else ""


def _ocr_full_return(text: str) -> str:
    values = [v for v in _ocr_block(text, r"FULL\s+RETURN\s+PLACE") if not _HAULAGE_VALUE.match(v)]
    # A trucker name may sit before the return place; the return place comes last
    return values[-1] if values else ""


def _remark(text: str) -> str:
    """REMARK block: from the 'REMARK' line up to the numbered carrier notes."""
    m = re.search(r"^\s*REMARK\b(.*?)(?=^\s*1\s*\.|\Z)", text, re.IGNORECASE | re.MULTILINE | re.DOTALL)
    if not m:
        return ""
    # Drop the empty left-hand labels printed beside the remark (OOG / DG)
    return re.sub(r"^\s*(?:OOG|DG)\b[ \t]*", "", m.group(1), flags=re.MULTILINE).strip()


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if NAMSUNG.search(text):
        out["Carrier"] = "NAMSUNG LINE"

    m = re.search(r"BOOKING\s+NO\.?\s+([A-Z0-9]{6,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1)

    vessel = _value(text, r"(?<!2ND )\bVESSEL\s+VOYAGE(?!\s*\(IF)")
    etd = _value(text, r"ESTIMATED\s+DEPARTURE\s+DATE", r"ESTIMATED\s+ARRIVAL")
    pod = _value(text, r"PORT\s+OF\s+DISCHARGE")
    dly = _value(text, r"PLACE\s+OF\s+DELIVERY")
    second = _second_vessel_from_words(pages_words) if pages_words else _second_vessel_from_text(text)
    if not vessel:  # OCR blocks
        vessel, second, ocr_pod, ocr_dly = _ocr_route(text)
        pod, dly = pod or ocr_pod, dly or ocr_dly
    out["Vessel"], out["ETD"] = vessel, etd
    out["Port of Discharging"], out["Place of Delivery"] = pod, dly

    remark = _remark(text)
    if second:
        out["Pre Carrier"], out["ETD_Pre"] = vessel, etd
        out["Trunk Vessel"] = second
        ts = _TS_IN_REMARK.search(remark)
        if ts:
            out["T/S Port"] = ts.group(1).strip()
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    block = _BLOCK_IN_REMARK.search(remark)
    if block:
        out["Block"] = block.group(1)

    out["Equipment Type"], out["Q'ty"] = _equipment(_value(text, r"CNTR\s+TYPE\s*/\s*QTY", _RIGHT_LABELS))
    if not out["Equipment Type"]:  # OCR: the '4HDC x 1' value sits on a line of its own
        out["Equipment Type"], out["Q'ty"] = _equipment(text)

    # The OCR block readers only match a label alone on its line, so they never fire on PDF text
    out["Empty Pick Up CY"] = _value(text, r"PICK\s+UP\s+PLACE", _RIGHT_LABELS) or _ocr_pick_up_place(text)
    out["Full return CY"] = _value(text, r"FULL\s+RETURN\s+PLACE") or _ocr_full_return(text)
    out["Port Cargo Cut-off"] = _closing(text, r"CARGO\s+CLOSING")

    return {k: v for k, v in out.items() if v}
