"""
Topaz Marine 'BOOKING CONFIRMATION' (TOPAZ MARINE CO., LTD, printed from forwardersoftware.com), a
two-column form of 'Label: value' pairs: POL details on the left, POD details on the right.

    No.: FBC26100069 Date: 14 Oct, 2026
    Mother Vessel:
    Vessel Name: INCEDA Voyage:
    Voyage: 056S Port of Transit:
    ETD: 21-Oct-26 ETA: 23-Oct-26
    Place of Receipt: HOCHIMINH CITY Port of Discharge: SINGAPORE
    Port of Loading: HOCHIMINH CITY Terminal: SINGAPORE
    Terminal: Place of Delivery:
    CTNR Owner : SOC Empty Pickup CY: SUOI TIEN
    01X40HC DONG KHO Return Date: 18-Oct-26        ('Full Return CY: CAT LAI' on the row above)
    CustomsCutOff: Port CutOff: Oct 20 2026 6:00PM

The left 'Vessel Name' + 'Voyage' is the vessel leaving Vietnam. A right 'Mother Vessel' + its
'Voyage' is then the Trunk Vessel and the left one the Pre Carrier. A blank 'Place of Delivery' is
the port of discharge. '01X40HC' is read as 1 x 40'HC. The cut-off is 'Port CutOff' (not Doc / VGM /
Customs). No block.

Word boxes split the two columns at the right column's labels, so a right label never ends a left
value; the plain text layer would put the right column's 'Voyage:' before the left one's. Offline
OCR prints the left column, then the right one, each value after its label or on the next line.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text

ISSUER = re.compile(r"\bTOPAZ\s+MARINE\b", re.IGNORECASE)

_LABELS = (
    r"No\.", r"Date", r"To", r"From", r"Shipper", r"Mother\s+Vessel", r"Vessel\s+Name", r"Voyage",
    r"Port\s+of\s+Transit", r"ETD", r"ETA", r"Place\s+of\s+Receipt", r"Port\s+of\s+Discharge",
    r"Port\s+of\s+Loading", r"Terminal", r"Place\s+of\s+Delivery", r"Commodity", r"Quantity",
    r"CTNR\s+Owner", r"CTNR\s+\d{2}", r"CTNR\s+Type\s+and\s+Quantity\s+Description", r"Empty\s+Pickup\s+CY",
    r"Pickup\s+Date", r"CY\s*Contact", r"Full\s+Return\s+CY", r"Return\s+Date", r"Doc\s*Cut\s*Off",
    r"VGM\s*Cut\s*Off", r"Customs\s*Cut\s*Off", r"Port\s*Cut\s*Off", r"Special\s+Cargo\s+Info", r"REMARK",
)
_ANY_LABEL = re.compile(r"(?<![A-Za-z])(?:" + "|".join(_LABELS) + r")\s*:", re.IGNORECASE)
# '01X40HC' -> qty, size, kind
_EQ = re.compile(r"\b(\d+)\s*[xX]\s*(\d{2})'?\s*(DC|DV|GP|HC|HQ|RF|RH|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"DC": "GP", "DV": "GP", "HQ": "HC"}
_MONTHS = {m: i for i, m in enumerate(
    ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"\bBOOKING\s+CONFIRMATION\b", text, re.IGNORECASE))


def _value(text: str, label: str, nth: int = 0, next_line: bool = True) -> str:
    """
    Value after the `nth` `label:` up to the next label on the line; blank -> the next line unless it
    is a label (OCR only: in a word-box column the next line is another field's row).
    """
    found = list(re.finditer(rf"(?<![A-Za-z]){label}\s*:[ \t]*", text, re.IGNORECASE))
    if len(found) <= nth:
        return ""
    line, _, after = text[found[nth].end():].partition("\n")
    nxt = _ANY_LABEL.search(line)
    value = (line[:nxt.start()] if nxt else line).strip()
    if value or not next_line:
        return value
    following = next((ln.strip() for ln in after.splitlines() if ln.strip()), "")
    if not following or _ANY_LABEL.match(following):
        return ""
    nxt = _ANY_LABEL.search(following)
    return (following[:nxt.start()] if nxt else following).strip()


def _columns(pages_words) -> Optional[tuple]:
    """(left text, right text) of the first page, split where the right column's labels start."""
    if not pages_words:
        return None
    rows = group_rows(pages_words[0])
    anchor = find_phrase(rows, "Port of Discharge:") or find_phrase(rows, "Mother Vessel:")
    if not anchor:
        return None
    split = anchor["x0"] - 5
    left = [row_text([w for w in r if w["x0"] < split]) for r in rows]
    right = [row_text([w for w in r if w["x0"] >= split]) for r in rows]
    return "\n".join(ln for ln in left if ln), "\n".join(ln for ln in right if ln)


def _cut_off(text: str) -> str:
    """'Port CutOff: Oct 20 2026 6:00PM' -> '20/10/2026 18:00'."""
    m = re.search(r"Port\s*Cut\s*Off\s*:\s*([A-Za-z0-9]{3})\s+(\d{1,2})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M)?)?",
                  text, re.IGNORECASE)
    if not m:
        return ""
    month = _MONTHS.get(m.group(1).upper().replace("0", "O"))
    if not month:
        return ""
    date = f"{int(m.group(2)):02d}/{month:02d}/{m.group(3)}"
    if not m.group(4):
        return date
    hour = int(m.group(4))
    if m.group(6):
        hour = hour % 12 + (12 if m.group(6).upper() == "PM" else 0)
    return f"{date} {hour:02d}:{m.group(5)}"


def _equipment(text: str):
    """'01X40HC' -> ("40'HC", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", str(int(qty)))
             for qty, size, kind in _EQ.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _vessel(name: str, voyage: str) -> str:
    return re.sub(r"\s+", " ", f"{name} {voyage}").strip()


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "TOPAZ MARINE"}
    columns = _columns(pages_words)
    # Without word boxes (OCR) the left column comes first: its 'Voyage' is the first one
    left, right, mother_voyage_nth = (columns[0], columns[1], 0) if columns else (text, text, 1)
    ocr = columns is None

    m = re.search(r"\bNo\.\s*:\s*([A-Z0-9-]{6,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    feeder = _vessel(_value(left, r"Vessel\s+Name", next_line=ocr), _value(left, r"Voyage", next_line=ocr))
    etd = _value(left, r"ETD", next_line=ocr).replace("0ct", "Oct")
    mother = _value(right, r"Mother\s+Vessel", next_line=ocr)
    if mother:
        out["Pre Carrier"], out["ETD_Pre"] = feeder, etd
        out["Trunk Vessel"] = _vessel(mother, _value(right, r"Voyage", mother_voyage_nth, ocr))
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = feeder, etd
    out["Vessel"], out["ETD"] = feeder, etd

    out["T/S Port"] = _value(right, r"Port\s+of\s+Transit", next_line=ocr)
    pod = _value(right, r"Port\s+of\s+Discharge", next_line=ocr)
    out["Port of Discharging"] = pod
    out["Place of Delivery"] = _value(right, r"Place\s+of\s+Delivery", next_line=ocr) or pod

    out["Empty Pick Up CY"] = _value(right, r"Empty\s+Pickup\s+CY", next_line=ocr)
    out["Full return CY"] = _value(right, r"Full\s+Return\s+CY", next_line=ocr)
    out["Port Cargo Cut-off"] = _cut_off(text)

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    return {k: v for k, v in out.items() if v}
