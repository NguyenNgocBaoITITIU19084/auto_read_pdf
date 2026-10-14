"""
Sinokor 'Booking Notice', 'Label : value' pairs, up to two per line:

    BOOKING NO. SNKO101261000599
    VSL / VYG : PANCON CHAMPION // 2610N
    Loading : HOCHIMINH, VIETNAM Discharging : MANZANILLO, MEXICO
    L-Terminal : CAT LAI D-Terminal : OCUPA terminal (MANZANILLO PORT)
    E.T.D : 2026-10-14 E.T.A : 2026-11-23
    Delivery : MANZANILLO, MEXICO Delivery Type :
    D.O.C Cut-off : 2026-10-12 17:00 CY Cut-off : 2026-10-13 19:00
    CNTR Q'ty : 40Hx5 WGT / MSR : 90,000.00KGS 0.00CBM
    Pickup Area :
    T/S Info. : Port : BUSAN, KOREA
    VSL/VYG : HONG DA XIN TIAN JIN /
    02644E (Fixed)

The first VSL / VYG leaves Vietnam (its E.T.D is the one printed); with T/S Info. the second
vessel is the trunk vessel. Full containers go to the L-Terminal. A stowage code, when printed,
is the block code.

Offline OCR prints most labels and their ': value' on separate lines, and the booking number a few
lines below its label; ': value' lines are joined back onto their label before reading.
"""
import re
from typing import Dict, List, Optional, Sequence

SINOKOR = re.compile(r"\bSINOKOR\b", re.IGNORECASE)
BOOKING_LABEL = re.compile(r"BOOKING\s+NO\b", re.IGNORECASE)
# 'SNKO101261000599': letters then digits; OCR may print it a few lines below the label
BOOKING_CODE = re.compile(r"\b([A-Z]{2,5}\d{8,})\b")
VSL_VYG = re.compile(r"VSL\s*/\s*VYG\s*:", re.IGNORECASE)

# Labels that can follow a value on the same line (second column)
_NEXT_LABEL = (r"\s+(?:Discharging|D-Terminal|E\.T\.A|Delivery\s+Type|CY\s+Cut-off|WGT\s*/\s*MSR|"
               r"Pickup\s+Date|Factory|Booking\s+Date|P\.I\.C)\s*:")

# '40Hx5', '20GP x 2' -> size, type letters, qty
_EQ_ITEM = re.compile(r"(\d{2})\s*['’]?\s*([A-Z]{1,2})\s*[xX]\s*(\d+)")
_EQ_KIND = {"G": "GP", "GP": "GP", "D": "GP", "DV": "GP", "DC": "GP", "H": "HC", "HC": "HC", "HQ": "HC",
            "R": "RF", "RF": "RF", "RH": "RH", "O": "OT", "OT": "OT", "F": "FR", "FR": "FR", "T": "TK", "TK": "TK"}


def matches(text: str) -> bool:
    return bool(SINOKOR.search(text) and BOOKING_LABEL.search(text) and VSL_VYG.search(text))


def _join_value_lines(text: str) -> str:
    """OCR: 'L-Terminal' / ': CAT LAI' -> 'L-Terminal : CAT LAI'."""
    return re.sub(r"\n[ \t]*(?=:)", " ", text)


def _value(text: str, label: str) -> str:
    """Value after 'label :' on its line, cut before the next 'Label :' printed beside it."""
    m = re.search(rf"(?:^|\s){label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    return re.split(_NEXT_LABEL, m.group(1), maxsplit=1, flags=re.IGNORECASE)[0].strip()


def _vessels(text: str) -> List[str]:
    """Every 'VSL / VYG' as 'NAME VOYAGE' (the voyage may wrap onto the next line)."""
    out = []
    for m in re.finditer(r"VSL\s*/\s*VYG\s*:[ \t]*([^\n]*)(?:\n([^\n]*))?", text, re.IGNORECASE):
        line, nxt = m.group(1).strip(), (m.group(2) or "").strip()
        if line.endswith("/") and nxt:
            line = f"{line} {nxt}"
        line = re.sub(r"\s*\((?:Fixed|TBN|TBA)\)", "", line, flags=re.IGNORECASE)
        name, _, voyage = line.partition("/")
        voyage = voyage.strip(" /")
        if name.strip():
            out.append(f"{name.strip()} {voyage}".strip())
    return out


def _equipment(value: str):
    """'40Hx5' -> ("40'HC", '5'); several types -> "5 X 40'HC + 1 X 20'GP" and the total."""
    items = [(f"{size}'{_EQ_KIND[kind]}", qty) for size, kind, qty in _EQ_ITEM.findall(value.upper())
             if kind in _EQ_KIND]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "SINOKOR LINE"}
    text = _join_value_lines(text)

    label = BOOKING_LABEL.search(text)
    m = BOOKING_CODE.search(text, label.end(), label.end() + 200) if label else None
    if m:
        out["Booking No"] = m.group(1)

    vessels = _vessels(text)
    first = vessels[0] if vessels else ""
    etd = _value(text, r"E\.T\.D")
    out["Vessel"], out["ETD"] = first, etd

    ts_info = re.search(r"T/S\s+Info\.?[^\n]*?\bPort\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    out["T/S Port"] = ts_info.group(1).strip() if ts_info else ""
    if out["T/S Port"] and len(vessels) > 1:
        out["Pre Carrier"], out["ETD_Pre"] = first, etd
        out["Trunk Vessel"] = vessels[1]
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = first, etd

    out["Port of Discharging"] = _value(text, r"Discharging")
    out["Place of Delivery"] = _value(text, r"Delivery")
    out["Block"] = _value(text, r"Stowage\s+Code")

    out["Equipment Type"], out["Q'ty"] = _equipment(_value(text, r"CNTR\s+Q['’]ty"))

    out["Empty Pick Up CY"] = _value(text, r"Pickup\s+Area")
    out["Full return CY"] = _value(text, r"L-Terminal")
    out["Port Cargo Cut-off"] = _value(text, r"CY\s+Cut-off")

    return {k: v for k, v in out.items() if v}
