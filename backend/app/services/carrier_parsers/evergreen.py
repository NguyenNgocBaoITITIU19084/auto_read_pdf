"""
Evergreen 'BOOKING CONFIRMATION', 'LABEL :value' lines. The text layer prints a few values on the
line *above* their label:

    235601994716 APPLICATION NO.:26100104051255
    BOOKING NO :
    *VSL/VOY: EVER LEGION 1290-072E          <- ACE box: the connecting vessel, not the booked one
    EVER MAGNA 1382-006E
    VESSEL/VOYAGE :
    CUT OFF DATE /TIME:2026/10/17 17:00 PM
    ETD DATE :2026/10/19
    TRANSSHIP PORT :COLON CONTAINER TERMINAL
    CONNECTION VSL/VOY :EVER LEGION 1290-072E
    PORT OF DISCHARGE :BOSTON, MA,UNITED STATES OF AMERICA
    FINAL DESTINATION :BOSTON, MA,UNITED STATES OF AMERICA
    1 /20' STANDARD DRY 19,500.00 +2,400 28,080 (NON-HAZARDOUS)
    EMPTY PICK UP AT:SOTRANS ICD (ICD SOTRANS)
    INLAND RETURN TO:TERMINAL CAT LAI GIANG NAM (Gate E)

The booked vessel leaves Vietnam at the first ETD DATE; with a transship port the connection
vessel is the trunk vessel. A stowage code, when printed, is the block code.

Offline OCR drops some colons ('BOOKING NO', 'VESSEL/ VOYAGE', 'PORT OF DISCHARGE'), prints
': value' on the line below its label (joined back before reading), the booking number below its
label and the vessel a few lines below its label, after the run of the next labels. When OCR prints
a whole run of labels before their values (some values missing), those fields are left empty rather
than paired by position. The ACE box's '*B/L NO.' repeats the booking number.
"""
import re
from typing import Dict, List, Optional, Sequence

ISSUER = re.compile(r"\bEVERGREEN\b", re.IGNORECASE)

_DATE = r"\d{4}/\d{1,2}/\d{1,2}"
# Vessel + voyage: 'EVER MAGNA 1382-006E', 'YM CELEBRITY 098A' (the voyage holds a digit)
_VESSEL = r"[A-Z][A-Z0-9 .'-]*\s+[A-Z0-9]*\d[A-Z0-9]*(?:-[A-Z0-9]+)?"
# '1 /20' STANDARD DRY 19,500.00 ...' -> qty, size, type words
_EQ_ROW = re.compile(r"^\s*(\d+)\s*/\s*(\d{2})['’]?\s*([A-Z][A-Z -]*?[A-Z])\s+[\d,.]+", re.MULTILINE)
_KINDS = (("REEFER HIGH CUBE", "RH"), ("REEFER HI-CUBE", "RH"), ("HIGH CUBE REEFER", "RH"), ("REEFER", "RF"),
          ("HIGH CUBE", "HC"), ("HI-CUBE", "HC"), ("HI CUBE", "HC"),
          ("OPEN TOP", "OT"), ("FLAT", "FR"), ("TANK", "TK"), ("DRY", "GP"), ("STANDARD", "GP"))
# Labels of the notice, to tell a value line from the next label in OCR runs
_LABEL_LINE = re.compile(
    r"^(?:ETA\s+DATE|ETD\s+DATE|PORT\s+OF\s+(?:DISCHARGE|LOADING|RECEIPT)|FINAL\s+DESTINATION|SHIPPER|"
    r"SERVICE\s+TYPE\W*MODE|STUFFING\s+PLACE|COMMODITY|REMARKS|QTY\s*/\s*TYPE|TRANSSHIP(?:MENT)?\s+PORT|"
    r"CONNECTION\s+VSL\s*/\s*VOY|CARRIER|ON\s+BEHALF\s+OF|FROM|TO|BOOKING\s+NO|VESSEL\s*/\s*VOYAGE)\s*$",
    re.IGNORECASE)


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"BOOKING\s+NO\b", text, re.IGNORECASE)
                and re.search(r"VESSEL\s*/\s*VOYAGE", text, re.IGNORECASE))


def _join_value_lines(text: str) -> str:
    """OCR: 'ETD DATE' / ':2026/10/19' -> 'ETD DATE :2026/10/19'."""
    return re.sub(r"\n[ \t]*(?=:)", " ", text)


def _value(text: str, label: str) -> str:
    """Value after 'LABEL :' at the start of a line; OCR may drop the colon and print it on the next line."""
    m = re.search(rf"^\s*{label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if m:
        return m.group(1).strip()
    m = re.search(rf"^\s*{label}\s*\n\s*([^:\n][^\n]*)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m and not _LABEL_LINE.match(m.group(1).strip()) else ""


def _value_or_line_above(text: str, label: str, value: str) -> str:
    """Value after 'LABEL :', or a `value`-shaped token opening the line above an empty label."""
    m = re.search(rf"^(.*)\n\s*{label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    if m.group(2).strip():
        return m.group(2).strip()
    above = re.fullmatch(rf"\s*({value})(?:\s+APPLICATION\s+NO.*)?", m.group(1).strip())
    return above.group(1).strip() if above else ""


def _cut_off(text: str) -> str:
    """'CUT OFF DATE /TIME:2026/10/17 17:00 PM' -> '2026/10/17 17:00' (12-hour times converted)."""
    m = re.search(rf"^\s*CUT\s+OFF\s+DATE\s*/\s*TIME\s*:\s*({_DATE})(?:\s+(\d{{1,2}}):(\d{{2}})(?:\s*([AP]M))?)?",
                  text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    date, hh, mm, ampm = m.groups()
    if not hh:
        return date
    h = int(hh)
    if ampm and ampm.upper() == "PM" and h < 12:
        h += 12
    elif ampm and ampm.upper() == "AM" and h == 12:
        h = 0
    return f"{date} {h:02d}:{mm}"


def _equipment(text: str):
    """'1 /20' STANDARD DRY ...' rows -> ("20'GP", '1'); several rows are combined."""
    items = []
    for qty, size, kind in _EQ_ROW.findall(text):
        code = next((c for word, c in _KINDS if word in kind.upper()), kind.upper())
        items.append((f"{size}'{code}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "EVERGREEN"}
    text = _join_value_lines(text)

    bl_no = re.search(r"\*B/L\s+NO\.?\s*(\d{10,})", text, re.IGNORECASE)
    out["Booking No"] = (_value_or_line_above(text, r"BOOKING\s+NO", r"\d{10,}")
                         or re.sub(r"\D", "", _value(text, r"BOOKING\s+NO"))
                         or (bl_no.group(1) if bl_no else ""))
    vessel = _value_or_line_above(text, r"VESSEL\s*/\s*VOYAGE", _VESSEL)
    if not vessel:  # OCR: the vessel follows the run of labels printed after 'VESSEL/ VOYAGE'
        m = re.search(r"^\s*VESSEL\s*/\s*VOYAGE\s*$((?:\n.*){1,8})", text, re.IGNORECASE | re.MULTILINE)
        below = re.search(rf"^\s*({_VESSEL})(?:\s+:.*)?$", m.group(1), re.MULTILINE) if m else None
        vessel = below.group(1) if below else ""
    etd = _value(text, r"ETD\s+DATE")
    out["Vessel"], out["ETD"] = vessel, etd

    out["T/S Port"] = _value(text, r"TRANSSHIP(?:MENT)?\s+PORT")
    connection = _value(text, r"CONNECTION\s+VSL\s*/\s*VOY")
    if out["T/S Port"] and connection:
        out["Pre Carrier"], out["ETD_Pre"] = vessel, etd
        out["Trunk Vessel"] = connection
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["Port of Discharging"] = _value(text, r"PORT\s+OF\s+DISCHARGE")
    out["Place of Delivery"] = _value(text, r"FINAL\s+DESTINATION")
    # Upper-case label on one line: a later table prints 'Stowage' / 'code' as a column header
    out["Block"] = _value(text, r"(?-i:STOWAGE[ \t]+CODE)")

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    out["Empty Pick Up CY"] = _value(text, r"EMPTY\s+PICK\s*UP\s+AT")
    out["Full return CY"] = _value(text, r"(?:INLAND\s+)?RETURN\s+TO")
    out["Port Cargo Cut-off"] = _cut_off(text)

    return {k: v for k, v in out.items() if v}
