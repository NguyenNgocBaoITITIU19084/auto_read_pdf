"""
Yang Ming 'BOOKING NOTE' (Yang Ming Shipping (Viet Nam)), Vietnamese 'Label : value' pairs:

    Cấp cho booking số : YMJAE490413860 Người đại diện : ...
    Tên tàu : ZEPHYR LUMOS 019E
    Ngày tàu chạy : 30/08/2026
    Số lượng container : 1X40HQ
    BLOCK CODE USNY2
    Cảng L/D : CAI MEP , TCIT Loại hàng hoá : ...
    Cảng T/S : Cảng đích : NEW YORK, NY                 <- no transshipment port
    Cảng D/C : NEW YORK, NY Load Mode/Discharge Mode : CY/CY
    Nơi cấp container: Suoi Tien Long Thanh My Depot
    Nơi hạ bãi : BINH DUONG PORT
    Closing time : TRƯỚC 18:00 GIỜ NGÀY 26/08/2026

'Cảng D/C' (delivery) is the place of delivery, '1X40HQ' is 1 x 40'HC and the closing time
('before 18:00 on 26/08/2026') is the CY cut-off. The schedule table below it (ETD / DISCHARGE
PORT / SI CUT OFF per service) is not booking data.

The company header is a logo: the text layer names Yang Ming only in its closing line
('... DỊCH VỤ CỦA YANGMING') and e-mail addresses. Offline OCR may drop accented letters
('Tên àu') and puts empty or long values on the next line.
"""
import re
import unicodedata
from typing import Dict, List, Optional, Sequence

ISSUER = re.compile(r"\bYANG\s?MING\b|@vn\.yangming\.com", re.IGNORECASE)

_DATE = r"(\d{1,2}/\d{1,2}/\d{4})"
# '1X40HQ' -> qty, size, kind
_EQ = re.compile(r"\b(\d+)\s*X\s*(\d{2})'?\s*(HQ|HC|GP|DC|DV|RF|RH|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"HQ": "HC", "DC": "GP", "DV": "GP"}
# Lines that are labels, not values of the label above them (OCR)
_LABEL = re.compile(r"^(?:Cảng|Nơi|Closing|Người|Loại|Load|ETD|Số|Tên|Ngày)\b.*:", re.IGNORECASE)


def matches(text: str) -> bool:
    text = unicodedata.normalize("NFC", text)
    return bool(ISSUER.search(text) and re.search(r"\bBOOKING\s+NOTE\b", text)
                and re.search(r"Cấp\s+cho\s+booking", text, re.IGNORECASE))


def _value(text: str, label: str, stop: str = "$", next_line: bool = False) -> str:
    """Value after 'label :' on its line up to `stop`; with `next_line`, an empty one is read from the next line."""
    m = re.search(rf"{label}\s*:[ \t]*(.*?)[ \t]*(?:{stop})", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    value = m.group(1).strip()
    if not value and next_line:
        nxt = text[m.end():].lstrip("\n").split("\n", 1)[0].strip()
        value = "" if _LABEL.match(nxt) else nxt
    return value


def _equipment(value: str):
    """'1X40HQ' -> ("40'HC", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(value)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _port(value: str) -> str:
    """'CAI MEP , TCIT' -> 'CAI MEP, TCIT'."""
    return re.sub(r"\s*,\s*", ", ", value).strip(" ,")


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    text = unicodedata.normalize("NFC", text)
    out: Dict[str, str] = {"Carrier": "YANG MING"}

    m = re.search(r"booking\s+số\s*:\s*([A-Z0-9]{8,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    # 'Tên tàu' ('Tên àu' in OCR)
    vessel = _value(text, r"^\s*T[êe]n\s+\S*u")
    m = re.search(rf"ch\S*y\s*:\s*{_DATE}", text, re.IGNORECASE)  # 'Ngày tàu chạy'
    etd = m.group(1) if m else ""
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["T/S Port"] = _port(_value(text, r"Cảng\s+T/S", r"Cảng\s+đích|$"))
    out["Port of Discharging"] = _port(_value(text, r"Cảng\s+đích", r"Load\s+Mode|$"))
    out["Place of Delivery"] = _port(_value(text, r"Cảng\s+D/C", r"Load\s+Mode|$")) or out["Port of Discharging"]

    m = re.search(r"\bBLOCK\s+CODE\s*:?\s*([A-Z0-9]{3,})\b", text)
    if m:
        out["Block"] = m.group(1)

    out["Equipment Type"], out["Q'ty"] = _equipment(_value(text, r"Số\s+lượng\s+container"))

    out["Empty Pick Up CY"] = _value(text, r"Nơi\s+cấp\s+container", next_line=True)
    out["Full return CY"] = _value(text, r"Nơi\s+hạ\s+bãi", next_line=True)

    # 'TRƯỚC 18:00 GIỜ NGÀY 26/08/2026' -> '26/08/2026 18:00'
    closing = _value(text, r"Closing\s+time", next_line=True)
    m = re.search(rf"(\d{{1,2}}):(\d{{2}}).*?{_DATE}", closing)
    if m:
        out["Port Cargo Cut-off"] = f"{m.group(3)} {int(m.group(1)):02d}:{m.group(2)}"
    else:
        m = re.search(_DATE, closing)
        out["Port Cargo Cut-off"] = m.group(1) if m else ""

    return {k: v for k, v in out.items() if v}
