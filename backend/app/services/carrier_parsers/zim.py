"""
ZIM 'BOOKING CONFIRMATION' (ZIM Integrated Shipping Services (Vietnam)), 'Label: value' fields and a
small table of depots:

    BOOKING CONFIRMATION : ZIMUHCM80682914
    Vessel/Voyage: SHENZHEN 16/W
    Port of Discharge: BARCELONA
    Transit Port:
    Sailing Date: 05/09/2026
    Closing Date: 03/09/2026 22:00 Closing date at Place Acceptance:
    Place Acceptance: HO CHI MINH CITY - ICD PHUOC LONG
    Place Delivery:
    Booking details:
    1 X HC40
    Order Reference: Quantity: PickUp at :            Return to :
    ROHCM1615048     1         TCS - ZIM DEPOT;HO CHI MINH CITY ICD PHUOC LONG;HO CHI MINH
                                                    CITY - ICD PHUOC LONG

The vessel is kept as printed ('SHENZHEN 16/W'), 'Sailing Date' is the ETD and 'Closing Date' the
CY cut-off; an empty place of delivery is the port of discharge. '1 X HC40' is 1 x 40'HC. No block
code is printed.

The depot values start left of their headers: in the word boxes a column starts just left of its
header. In the text layer and offline OCR both depots run together on one line; each is
'NAME;CITY...', so they are split where the pickup's city starts the return depot's city.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text, row_top

ISSUER = re.compile(r"\bZIM\s+INTEGRATED\s+SHIPPING\b", re.IGNORECASE)

_DATE = r"\d{1,2}/\d{1,2}/\d{4}"
# '1 X HC40' (type before size) or '1 X 40HC' -> qty, kind, size
_EQ = re.compile(r"\b(\d+)\s*X\s*(?:(HC|HQ|GP|DC|DV|DR|RF|RH|OT|FR|TK)(\d{2})|(\d{2})'?(HC|HQ|GP|DC|DV|DR|RF|RH|OT|FR|TK))\b",
                 re.IGNORECASE)
_KINDS = {"HQ": "HC", "DC": "GP", "DV": "GP", "DR": "GP"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"BOOKING\s+CONFIRMATION\s*:", text, re.IGNORECASE)
                and re.search(r"Vessel/Voyage\s*:", text, re.IGNORECASE))


def _value(text: str, label: str, stop: str = "$") -> str:
    """Value after 'label:' on its line, else (OCR) the next line when that is not a label."""
    m = re.search(rf"^\s*{label}\s*:[ \t]*(.*?)[ \t]*(?:{stop})", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    if m.group(1).strip():
        return m.group(1).strip()
    nxt = text[m.end():].lstrip("\n").split("\n", 1)[0].strip()
    return "" if re.match(r"[A-Za-z][A-Za-z /().]*:", nxt) else nxt  # another label, not '22:00'


def _equipment(text: str):
    """'1 X HC40' -> ("40'HC", '1'); several types -> combined list and total."""
    items = []
    for qty, kind_a, size_a, size_b, kind_b in _EQ.findall(text):
        kind = (kind_a or kind_b).upper()
        items.append((f"{size_a or size_b}'{_KINDS.get(kind, kind)}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _depot(value: str) -> str:
    """'TCS - ZIM DEPOT;HO CHI MINH CITY' -> 'TCS - ZIM DEPOT; HO CHI MINH CITY'."""
    return re.sub(r"\s*;\s*", "; ", re.sub(r"\s+", " ", value)).strip(" ;")


def _depots_from_words(pages_words):
    """(pickup, return) from the word boxes: a column starts just left of its header."""
    for words in pages_words or ():
        rows = group_rows(words)
        pick, ret = find_phrase(rows, "PickUp at"), find_phrase(rows, "Return to")
        if not (pick and ret):
            continue
        out = {"pick": [], "ret": []}
        for row in rows:
            if row_top(row) <= pick["top"] + 3:
                continue
            if row_top(row) > pick["top"] + 40 or re.match(r"Booking\s+Clauses", row_text(row), re.IGNORECASE):
                break
            for w in row:
                if w["x0"] >= ret["x0"] - 15:
                    out["ret"].append(w["text"])
                elif w["x0"] >= pick["x0"] - 15:
                    out["pick"].append(w["text"])
        return _depot(" ".join(out["pick"])), _depot(" ".join(out["ret"]))
    return None


def _depots_from_text(text: str):
    """Text layer / OCR: 'NAME;CITY NAME;CITY...' on the line(s) after the 'Return to :' header."""
    m = re.search(r"Return\s+to\s*:\s*\n(.*)\n(.*)", text, re.IGNORECASE)
    if not m:
        return "", ""
    line = m.group(1).strip()
    if m.group(2).strip() and ":" not in m.group(2):
        line += " " + m.group(2).strip()
    line = re.sub(r"^\S*\d\S*\s+\d+\s+", "", line)  # order reference and quantity
    tokens = re.sub(r"\s*;\s*", ";", line).split()
    for k in range(len(tokens) - 1, 0, -1):
        first, second = " ".join(tokens[:k]), " ".join(tokens[k:])
        if first.count(";") == 1 and second.count(";") == 1:
            city = first.split(";")[1]
            if city and second.split(";")[1].startswith(city):
                return _depot(first), _depot(second)
    return "", ""


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "ZIM"}

    m = re.search(r"BOOKING\s+CONFIRMATION\s*:\s*([A-Z0-9]{8,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    vessel = _value(text, r"Vessel/Voyage")
    m = re.search(_DATE, _value(text, r"Sailing\s+Date"))
    etd = m.group(0) if m else ""
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["T/S Port"] = _value(text, r"Transit\s+Port")
    pod = _value(text, r"Port\s+of\s+Discharge")
    out["Port of Discharging"] = pod
    out["Place of Delivery"] = _value(text, r"Place\s+Delivery") or pod

    m = re.search(rf"{_DATE}(?:\s+\d{{1,2}}:\d{{2}})?", _value(text, r"Closing\s+Date", r"\s+Closing\s+date\s+at|$"))
    out["Port Cargo Cut-off"] = m.group(0) if m else ""

    m = re.search(r"Booking\s+details\s*:\s*\n(.*)", text, re.IGNORECASE)
    out["Equipment Type"], out["Q'ty"] = _equipment(m.group(1) if m else "")

    depots = _depots_from_words(pages_words) or _depots_from_text(text)
    out["Empty Pick Up CY"], out["Full return CY"] = depots

    return {k: v for k, v in out.items() if v}
