"""
Wan Hai 'BOOKING CONFIRMATION' (wdbkg510), 'Label : value' lines, dates as YYYYMMDD:

    Booking Number : 039GY05862
    Mother Vessel : WAN HAI 286 Voy : S115 SCN :
    Place of Receipt : CAT LAI PORT HOCHIMINH
    Port of Loading : CAT LAI PORT HOCHIMINH ETD : 20261017
    Port of Transship : PORT KLANG NORTH PORT ETA : 20261020
    Port of Discharge : IZMIT ETA : 20261127
    Place of Delivery : IZMIT
    Close Date : 20261015 21:00
    Ctnr Type Size HeightQty Temp Humi. Vent PU Date Status
    COC General Purpose 20' 86 1 FCL TO FCL
    Releasing Empty Container : PHUC XUAN TAN VAN TEL: 0274 6562618 Address: ...
    Laden Place Of Receipt :

The mother vessel is the one leaving Vietnam (ETD at the port of loading); the transshipment port
has its own line. Full containers go to 'Laden Place Of Receipt', else the port of loading.
Wan Hai confirmations carry no block code. Offline OCR prints each 'Label : value' on its own line,
so the same regexes read it, but it tends to drop the small container-table row.
"""
import re
from typing import Dict, List, Optional, Sequence

TITLE = re.compile(r"BOOKING\s+CONFIRMATION", re.IGNORECASE)
MOTHER_VESSEL = re.compile(r"Mother\s+Vessel\s*:", re.IGNORECASE)
WAN_HAI = re.compile(r"\bWAN\s?HAI\b", re.IGNORECASE)

# Labels that can follow a value on the same line (second column)
_NEXT_LABEL = r"\s+(?:Voy|SCN|ETD|ETA|TEL|Address|Stuff\s+Place)\s*:"

# 'COC General Purpose 20' 86 1 FCL TO FCL' -> kind, size, height, qty
_CNTR_ROW = re.compile(r"^(?:COC|SOC)\s+([A-Za-z][A-Za-z ]*?)\s+(\d{2})['’]?\s+(\d{2})\s+(\d+)\b", re.MULTILINE)
_KINDS = (("REEFER", "RF"), ("OPEN TOP", "OT"), ("FLAT", "FR"), ("TANK", "TK"), ("GENERAL", "GP"), ("DRY", "GP"))
_HIGH_CUBE_HEIGHTS = ("96", "95")


def matches(text: str) -> bool:
    return bool(TITLE.search(text) and MOTHER_VESSEL.search(text) and WAN_HAI.search(text))


def _value(text: str, label: str) -> str:
    """Value after 'label :' on its line, cut before the next 'Label :' printed beside it."""
    m = re.search(rf"^\s*{label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    return re.split(_NEXT_LABEL, m.group(1), maxsplit=1, flags=re.IGNORECASE)[0].strip()


def _date(text: str, label: str) -> str:
    """First 'label : YYYYMMDD[ HH:MM]' anywhere (the ETD sits beside Port of Loading)."""
    m = re.search(rf"\b{label}\s*:\s*(\d{{8}}(?:\s+\d{{1,2}}:\d{{2}})?)", text, re.IGNORECASE)
    return m.group(1) if m else ""


def _equipment(text: str):
    """Container table rows -> ("20'GP", '1'); several rows -> "1 X 20'GP + 2 X 40'HC" and the total."""
    items = []
    for kind, size, height, qty in _CNTR_ROW.findall(text):
        code = next((c for word, c in _KINDS if word in kind.upper()), kind.upper())
        if height in _HIGH_CUBE_HEIGHTS:
            code = {"GP": "HC", "RF": "RH"}.get(code, code)
        items.append((f"{size}'{code}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "WAN HAI"}

    out["Booking No"] = _value(text, r"Booking\s+Number")

    vessel = _value(text, r"Mother\s+Vessel")
    voyage = _value(text, r"(?:.*\s)?Voy")  # beside the vessel in PDFs, on its own line in OCR
    vessel = f"{vessel} {voyage}".strip() if vessel and voyage else vessel
    etd = _date(text, "ETD")
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["T/S Port"] = _value(text, r"Port\s+of\s+Transship(?:ment)?")
    out["Port of Discharging"] = _value(text, r"Port\s+of\s+Discharge")
    out["Place of Delivery"] = _value(text, r"Place\s+of\s+Delivery")

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    out["Empty Pick Up CY"] = _value(text, r"Releasing\s+Empty\s+Container")
    out["Full return CY"] = _value(text, r"Laden\s+Place\s+Of\s+Receipt") or _value(text, r"Port\s+of\s+Loading")
    out["Port Cargo Cut-off"] = _date(text, r"Close\s+Date")

    return {k: v for k, v in out.items() if v}
