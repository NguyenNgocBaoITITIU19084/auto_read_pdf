"""
DJ Shipping Lines 'SEA BOOKING' (DJ SHIPPING LINES CO.,LTD, Ho Chi Minh City), a form of
'Label: value' pairs, two or three to a row:

    Booking number :DJLSIN2606050 Ngày (Date):12/06/2026
    Vessel/ Voyage: INCRES 074S Closing time SI VGM: 09H00. 18 JUN 2026
    Port of Loading: CAT LAI HCMC, VIETNAM Port of Discharge: SINGAPORE, SINGAPORE
    Pick up empty: Drop off laden: CAT LAI PORT Fumigation: Yes:
    ETD: 21/06/2026 ETA: Closing time CY cut off: 02H00
    20/06/2026
    C2 Green Tea Lemon 455ml 15,000 1x20DC 0

The form has no place of delivery (the port of discharge is used) and no transshipment port or
block. 'Pick up empty' is usually blank: empty releases are approved by email. '1x20DC' is read as
1 x 20'GP. The CY cut-off hour comes before its date ('02H00' / '20/06/2026').

Offline OCR prints the labels and values apart, column by column; values are then picked by shape:
the vessel is the first 'NAME 074S' line, the port of discharge the first 'CITY, COUNTRY' line after
its label, the laden drop-off the first port / depot line after its label.
"""
import re
from typing import Dict, List, Optional, Sequence

ISSUER = re.compile(r"\bDJ\s+SHIPPING\s+LINES?\b", re.IGNORECASE)

_DATE = r"(\d{1,2}/\d{1,2}/\d{4})"
# '1x20DC' -> qty, size, kind (requires the 'N x' form: the terms quote '25 MTS/20'DC')
_EQ = re.compile(r"\b(\d+)\s*[xX]\s*(\d{2})'?\s*(DC|DV|GP|HC|HQ|RF|RH|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"DC": "GP", "DV": "GP", "HQ": "HC"}
_VESSEL = r"[A-Z][A-Z0-9 .'-]*?\s\d{2,4}[NSEW]"
_DEPOT = re.compile(r"\b(?:PORT|ICD|DEPOT|TERMINAL|CY|CANG|CẢNG)\b", re.IGNORECASE)


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"\bSEA\s+BOOKING\b", text, re.IGNORECASE))


def _same_line(text: str, label: str, stop: str) -> str:
    """Value after `label` on its own line, up to the next label `stop` (text layer)."""
    m = re.search(rf"{label}[ \t]*(.*?)[ \t]*(?:{stop}|$)", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def _lines_after(text: str, label: str, count: int = 12) -> List[str]:
    """OCR: the lines following the line that ends with `label`."""
    m = re.search(rf"{label}[ \t]*$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return []
    return [ln.strip() for ln in text[m.end():].splitlines() if ln.strip()][:count]


def _equipment(text: str):
    """'1x20DC' -> ("20'GP", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "DJ SHIPPING"}

    m = (re.search(r"Booking\s+number\s*:?\s*([A-Z]{3}[A-Z0-9]{5,})\b", text, re.IGNORECASE)
         or re.search(r"\b(DJL[A-Z]{3}\d{5,})\b", text))
    if m:
        out["Booking No"] = m.group(1).upper()

    vessel = _same_line(text, r"Vessel/?\s*Voyage\s*:", r"Closing\s+time")
    if not re.fullmatch(_VESSEL, vessel):  # OCR: the value is on a line of its own further down
        m = re.search(rf"^\s*({_VESSEL})\s*$", text, re.MULTILINE)
        vessel = m.group(1) if m else ""
    m = re.search(rf"\bETD\s*:\s*{_DATE}", text, re.IGNORECASE) or re.search(
        rf"\bETD\s*:\s*\n(?:.*\n){{0,6}}?\s*{_DATE}", text, re.IGNORECASE)
    etd = m.group(1) if m else ""
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    pod = _same_line(text, r"Port\s+of\s+Discharge\s*:", r"\n")
    if not pod:
        pod = next((ln for ln in _lines_after(text, r"Port\s+of\s+Discharge\s*:", 4) if "," in ln), "")
    out["Port of Discharging"] = out["Place of Delivery"] = pod

    empty = _same_line(text, r"Pick\s+up\s+empty\s*:", r"Drop\s+off\s+laden\s*:")
    out["Empty Pick Up CY"] = "" if re.fullmatch(r"(?:KHÔNG|NO|N/?A|-)?", empty, re.IGNORECASE) else empty
    laden = _same_line(text, r"Drop\s+off\s+laden\s*:", r"Fumigation\s*:")
    if not laden:
        laden = next((ln for ln in _lines_after(text, r"Drop\s+off\s+laden\s*:")
                      if _DEPOT.search(ln) and "," not in ln and ":" not in ln), "")
    out["Full return CY"] = laden

    m = re.search(rf"Closing\s+time\s+CY\s+cut\s*off\s*:\s*(\d{{1,2}})\s*[H:]\s*(\d{{2}})\s*{_DATE}", text,
                  re.IGNORECASE)
    if m:
        out["Port Cargo Cut-off"] = f"{m.group(3)} {int(m.group(1)):02d}:{m.group(2)}"

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    return {k: v for k, v in out.items() if v}
