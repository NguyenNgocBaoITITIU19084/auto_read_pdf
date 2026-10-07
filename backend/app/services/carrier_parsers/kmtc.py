"""
KMTC 'LỆNH CẤP CONTAINER' (booking note), bilingual Vietnamese/English labels, one field per line:

    BOOKING NOTE NO : VN01168960
    Số lượng cont (Total volume): 40 HC X 1
    Tên tàu, số chuyến (Vessel/ Voyage): KMTC TAIPEIS 2612S
    Ngày tàu chạy (ETD): 09/10/2026
    Cảng đích (POD): BANGKOK,THAILAND Cảng chuyển tải (T/S Port) :
    Cảng đích (DLY): BANGKOK,THAILAND
    Nơi cấp container (Pick-up Place): TAN CANG RACH CHIEC(DEPOT 5A-DUONG B, KCN CAT LAI)
    Nơi hạ bãi (Drop-off Place): Cat Lai Terminal(HCM)
    Closing time tại cảng xuất: 2026.10.08 00:00 Closing time tại ICD: ...

The note names a single vessel; KMTC booking notes carry no block code.
"""
import re
from typing import Dict, List, Optional, Sequence

BOOKING_NOTE = re.compile(r"BOOKING\s+NOTE\s+NO\s*:\s*([A-Z0-9]+)", re.IGNORECASE)
KMTC_ISSUER = re.compile(r"\bKMTC\b", re.IGNORECASE)

# Trailing city tag on terminal names, e.g. 'Cat Lai Terminal(HCM)'
_CITY_TAG = re.compile(r"\s*\([A-Z]{2,4}\)$")


def matches(text: str) -> bool:
    return bool(BOOKING_NOTE.search(text) and KMTC_ISSUER.search(text))


def _value(text: str, label: str, stop: str = "") -> str:
    """Value after `label` on its line, cut before the `stop` label printed in the next column."""
    m = re.search(rf"{label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    value = m.group(1)
    if stop:
        value = re.split(stop, value, maxsplit=1, flags=re.IGNORECASE)[0]
    return value.strip()


def _equipment(value: str):
    """'40 HC X 1' -> ('40 HC', '1'); several types -> '1 X 40 HC + 2 X 20 GP' and the total."""
    items = re.findall(r"(\d{2}\s*['’]?\s*[A-Z]{2})\s*X\s*(\d+)", value, re.IGNORECASE)
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0][0], items[0][1]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "KMTC"}

    m = BOOKING_NOTE.search(text)
    if m:
        out["Booking No"] = m.group(1)

    out["Equipment Type"], out["Q'ty"] = _equipment(_value(text, r"\(Total\s+volume\)"))

    vessel = _value(text, r"\(Vessel\s*/\s*Voyage\)")
    etd = _value(text, r"\(ETD\)")
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["Port of Discharging"] = _value(text, r"\(POD\)", r"Cảng\s+chuyển\s+tải|\(T/S\s+Port\)")
    out["T/S Port"] = _value(text, r"\(T/S\s+Port\)")
    out["Place of Delivery"] = _value(text, r"\(DLY\)")

    out["Empty Pick Up CY"] = _value(text, r"\(Pick-up\s+Place\)")
    out["Full return CY"] = _CITY_TAG.sub("", _value(text, r"\(Drop-off\s+Place\)"))

    m = re.search(r"Closing\s+time\s+tại\s+cảng\s+xuất\s*:\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2})?)",
                  text, re.IGNORECASE)
    if m:
        out["Port Cargo Cut-off"] = m.group(1)

    return {k: v for k, v in out.items() if v}
