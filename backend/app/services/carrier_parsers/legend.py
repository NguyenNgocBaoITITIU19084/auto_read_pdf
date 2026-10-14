"""
Legend Shipping 'BOOKING CONFIRMATION' (LEGEND SHIPPING GROUP JSC, Ho Chi Minh City), a grid of
label rows with their values on the row below, four columns:

    Vessel/ Voy      ETD           ETA           Place of Receipt     Port of Loading
    INCEDA / 052S    Aug 02, 2026  Aug 04, 2026  CAT LAI, VN (VNCLI)  CAT LAI, VN (VNCLI)
    Date of Pick up  Place of Pick up            Port of Discharge    Place of Delivery
                                                 SINGAPORE, SG (SGSIN) SINGAPORE, SG (SGSIN)
    Place of Drop off  Closing Time              SI Cut off           Contact
    CAT LAI PORT       Aug 01, 2026 09:00:00     Jul 30, 2026 09:00:00
    Commodity        Volume        Gross Weight  Measurement          Transit Port
    General cargo    1x20'DC
    Special Remark   Mother vessel               Mother voyage
    CODE HẠ BÃI ...  INCEDA                      052S

    Booking No.: LGVN26080201

The text layer merges the columns, so cells are cut by the label columns of the word boxes. Without
them (OCR), each label is on its own line with its value on the next; empty cells are followed by
another label. 'Vessel/ Voy' is the vessel leaving Vietnam; a different 'Mother vessel' is then the
trunk vessel and 'Transit Port' the transshipment port. 'Closing Time' is the CY cut-off.
'1x20'DC' is read as 1 x 20'GP. No block code is printed.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text, row_top

ISSUER = re.compile(r"\bLEGEND\s+SHIPPING\b", re.IGNORECASE)

# Label rows of the grid, left to right (a cell runs from its label to the next label of the row)
_HEADERS = (
    ("Vessel/ Voy", "ETD", "ETA", "Place of Receipt", "Port of Loading"),
    ("Date of Pick up", "Place of Pick up", "Port of Discharge", "Place of Delivery"),
    ("Place of Drop off", "Closing Time", "SI Cut off", "Contact"),
    ("Commodity", "Volume", "Gross Weight", "Measurement", "Transit Port"),
    ("Special Remark", "Mother vessel", "Mother voyage"),
)
_LABELS = {label.upper() for row in _HEADERS for label in row} | {"VGM CUT OFF", "(KGS)", "(CBM)"}

_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
_DATE = re.compile(r"\b([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?")
# '1x20'DC' -> qty, size, kind
_EQ = re.compile(r"\b(\d+)\s*[xX]\s*(\d{2})'?\s*(DC|DV|GP|HC|HQ|RF|RH|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"DC": "GP", "DV": "GP", "HQ": "HC"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"BOOKING\s+CONFIRMATION", text, re.IGNORECASE)
                and re.search(r"Vessel/\s*Voy\b", text, re.IGNORECASE))


def _cells(pages_words) -> Dict[str, str]:
    """{label: value} from the word boxes: the row below each label row, cut by the label columns."""
    out: Dict[str, str] = {}
    for words in pages_words or ():
        rows = group_rows(words)
        for header in _HEADERS:
            heads = [(label, find_phrase(rows, label)) for label in header]
            heads = [(label, w) for label, w in heads if w]
            if not heads:
                continue
            top = min(w["top"] for _, w in heads)
            below = next((r for r in rows if 0 < row_top(r) - top <= 16), [])
            for i, (label, w) in enumerate(heads):
                x_to = heads[i + 1][1]["x0"] - 3 if i + 1 < len(heads) else float("inf")
                out.setdefault(label, row_text([v for v in below if w["x0"] - 3 <= v["x0"] < x_to]))
    return out


def _after_label(text: str, label: str) -> str:
    """OCR: the line after the line that is exactly `label`, unless that line is another label."""
    m = re.search(rf"^\s*{re.escape(label)}\s*\n\s*(.+?)\s*$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1) if m and m.group(1).upper() not in _LABELS else ""


def _line_after(text: str, header: str) -> str:
    """Text layer: the line after the label row starting with `header`."""
    m = re.search(rf"^\s*{header}.*\n(.*)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def _date(value: str) -> str:
    """'Aug 02, 2026' -> '02/08/2026'; 'Aug 01, 2026 09:00:00' -> '01/08/2026 09:00'."""
    m = _DATE.search(value or "")
    if not m or m.group(1).upper() not in _MONTHS:
        return ""
    day = f"{int(m.group(2)):02d}/{_MONTHS.index(m.group(1).upper()) + 1:02d}/{m.group(3)}"
    return f"{day} {int(m.group(4)):02d}:{m.group(5)}" if m.group(4) else day


def _vessel(value: str) -> str:
    """'INCEDA / 052S' -> 'INCEDA 052S'."""
    return re.sub(r"\s*/\s*", " ", value.strip())


def _equipment(text: str):
    """'1x20'DC' -> ("20'GP", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _text_cells(text: str) -> Dict[str, str]:
    """Cells from the text layer alone (merged columns), told apart by their shape."""
    out: Dict[str, str] = {}
    m = re.match(rf"(.+?)\s+({_DATE.pattern})", _line_after(text, r"Vessel/\s*Voy"))
    if m:
        out["Vessel/ Voy"], out["ETD"] = m.group(1), m.group(2)
    # '[pick-up date] [pick-up place] POD (CODE) PLD (CODE)'
    line = _line_after(text, r"Date\s+of\s+Pick\s+up")
    ports = re.findall(r"\S[^()]*?\([A-Z]{5}\)", line)
    if len(ports) >= 2:
        out["Port of Discharge"], out["Place of Delivery"] = ports[-2].strip(), ports[-1].strip()
        rest = line[:line.index(ports[-2])]
        out["Place of Pick up"] = _DATE.sub("", rest).strip()
    m = re.match(rf"(.*?)\s*({_DATE.pattern})", _line_after(text, r"Place\s+of\s+Drop\s+off"))
    if m:
        out["Place of Drop off"], out["Closing Time"] = m.group(1), m.group(2)
    return out


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "LEGEND SHIPPING"}

    m = re.search(r"Booking\s+No\.?\s*:\s*([A-Z0-9]{6,})\b", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    cells = _cells(pages_words)
    if not cells.get("Vessel/ Voy"):
        cells = {label: _after_label(text, label) for row in _HEADERS for label in row}
    if not cells.get("Vessel/ Voy"):
        cells = _text_cells(text)

    feeder, etd = _vessel(cells.get("Vessel/ Voy", "")), _date(cells.get("ETD", ""))
    mother = _vessel(f"{cells.get('Mother vessel', '')} {cells.get('Mother voyage', '')}")
    out["Vessel"], out["ETD"] = feeder, etd
    if feeder and mother and mother != feeder:
        out["T/S Port"] = cells.get("Transit Port", "")
        out["Pre Carrier"], out["ETD_Pre"] = feeder, etd
        out["Trunk Vessel"] = mother
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = feeder, etd

    out["Port of Discharging"] = cells.get("Port of Discharge", "")
    out["Place of Delivery"] = cells.get("Place of Delivery", "")
    out["Empty Pick Up CY"] = cells.get("Place of Pick up", "")
    out["Full return CY"] = cells.get("Place of Drop off", "")
    out["Port Cargo Cut-off"] = _date(cells.get("Closing Time", ""))
    out["Equipment Type"], out["Q'ty"] = _equipment(cells.get("Volume") or text)

    return {k: v for k, v in out.items() if v}
