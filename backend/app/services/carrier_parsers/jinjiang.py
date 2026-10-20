"""
Jinjiang Shipping 'CONTAINER ORDER' (JINJIANG SHIPPING (VIETNAM) CO., LTD, 'JJ SHIPPING'), a form of
'LABEL : value' pairs, two to a row:

    BookingNo : JJMSGZHY600023
    1 X 40HC ALUMINIUM FOIL 21487.00 /
    VESSEL & VOY NO : INFINITY 2640N - ETD 21/10/2026 05:00 AM
    PORT OF LOADING : VNSGN - HO CHI MINH CITY EMPTY PICKUP DATE : 13/10/2026
    PORT OF TRANSIT : CNSHA - SHANGHAI BOOKING VALIDITY : 21/10/2026
    FINAL DESTINATION : CNZHE - ZHENJIANG EMPTY PICKUP LOCATION :
    SI/VGM CUT OFF : 10H 19/10/2026 FULL RETURN LOCATION : VNCLI
    CY CUTOFF: 13H 20/10/2026

The final destination is both the port of discharge and the place of delivery (the form has no other).
'EMPTY PICKUP LOCATION' is often blank: releases are approved by email. The full return location is a
UN/LOCODE ('VNCLI'); Cat Lai gets its name added so the ePort site can be guessed from it. The CY
cut-off is 'CY CUTOFF' (not 'SI/VGM CUT OFF' or 'CDS CUTOFF'). No block.

Offline OCR prints a value either after its label or on the next line, so a blank same-line value
falls back to the next line unless that line is another label.
"""
import re
from typing import Dict, Optional, Sequence, List

ISSUER = re.compile(r"\bJINJIANG\s+SHIPPING\b|\bJJ\s+SHIPP?ING\b", re.IGNORECASE)

_DATE = r"(\d{1,2}/\d{1,2}/\d{4})"
_LABELS = (
    r"BOOKING\s*NO", r"BOOKING\s+PARTY", r"ADDRESS", r"PIC", r"CARRIER", r"VESSEL\s*&\s*VOY\s*NO",
    r"PORT\s+OF\s+LOADING", r"EMPTY\s+PICKUP\s+DATE", r"PORT\s+OF\s+TRANSIT", r"BOOKING\s+VALIDITY",
    r"FINAL\s+DESTINATION", r"EMPTY\s+PICKUP\s+LOCATION", r"FULL\s+RETURN\s+DATE", r"SI\s*/\s*VGM\s+CUT\s*OFF",
    r"FULL\s+RETURN\s+LOCATION", r"CY\s+CUT\s*OFF", r"CDS\s+CUT\s*OFF", r"REMARK",
)
# Any label, as it starts a value's neighbour on the same row or the next line
_ANY_LABEL = re.compile(r"\b(?:" + "|".join(_LABELS) + r")\s*:", re.IGNORECASE)
# '1 X 40HC' -> qty, size, kind
_EQ = re.compile(r"\b(\d+)\s*[xX]\s*(\d{2})'?\s*(DC|DV|GP|HC|HQ|RF|RH|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"DC": "GP", "DV": "GP", "HQ": "HC"}
_LOCODES = {"VNCLI": "CAT LAI"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"\bCONTAINER\s+ORDER\b", text, re.IGNORECASE))


def _value(text: str, label: str) -> str:
    """Value after `label :` up to the next label on the row; blank -> the next line unless it is a label."""
    m = re.search(rf"\b{label}\s*:[ \t]*", text, re.IGNORECASE)
    if not m:
        return ""
    rest = text[m.end():]
    line, _, after = rest.partition("\n")
    nxt = _ANY_LABEL.search(line)
    value = (line[:nxt.start()] if nxt else line).strip()
    if value:
        return value
    following = next((ln.strip() for ln in after.splitlines() if ln.strip()), "")
    if not following or _ANY_LABEL.match(following):
        return ""
    nxt = _ANY_LABEL.search(following)
    return (following[:nxt.start()] if nxt else following).strip()


def _time_24h(hour: str, minute: str, half: str) -> str:
    h = int(hour) % 12 + (12 if half.upper() == "PM" else 0) if half else int(hour)
    return f"{h:02d}:{minute}"


def _equipment(text: str):
    """'1 X 40HC' -> ("40'HC", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "JINJIANG"}

    m = re.search(r"Booking\s*No\s*:?\s*([A-Z0-9]{8,})\b", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    m = re.search(rf"VESSEL\s*&\s*VOY\s*NO\s*:\s*(.+?)\s*-\s*ETD\s*{_DATE}(?:\s+(\d{{1,2}}):(\d{{2}})\s*(AM|PM)?)?",
                  text, re.IGNORECASE)
    if m:
        vessel = re.sub(r"\s+", " ", m.group(1)).strip()
        etd = m.group(2) + (f" {_time_24h(m.group(3), m.group(4), m.group(5) or '')}" if m.group(3) else "")
        out["Vessel"], out["ETD"] = vessel, etd
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["T/S Port"] = _value(text, r"PORT\s+OF\s+TRANSIT")
    out["Port of Discharging"] = out["Place of Delivery"] = _value(text, r"FINAL\s+DESTINATION")

    out["Empty Pick Up CY"] = _value(text, r"EMPTY\s+PICKUP\s+LOCATION")
    full = _value(text, r"FULL\s+RETURN\s+LOCATION")
    out["Full return CY"] = f"{full} - {_LOCODES[full.upper()]}" if full.upper() in _LOCODES else full

    m = re.search(rf"\bCY\s+CUT\s*OFF\s*:\s*(\d{{1,2}})\s*H\s*(\d{{2}})?\s*{_DATE}", text, re.IGNORECASE)
    if m:
        out["Port Cargo Cut-off"] = f"{m.group(3)} {int(m.group(1)):02d}:{m.group(2) or '00'}"

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    return {k: v for k, v in out.items() if v}
