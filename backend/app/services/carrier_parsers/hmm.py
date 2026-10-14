"""
HMM (Hyundai) 'Booking Notice', 'Label : value' pairs, up to three per line:

    Booking Number : SGNM42330700
    1st Vessel/Voyage : HMM HANUL 025E(KMP/HMM) T/S Port : Call Sign : D7NO
    2nd Vessel/Voyage : T/S Port : Call Sign :
    ETB : 2026/04/03 19:00 ETD : 2026/04/05 02:00
    Port of Discharging : LONG BEACH, CA(USLGB) TML : INTERNATIONAL TRANSPORTATION SERVICES ETA : ...
    Place of Delivery : LONG BEACH, CA TML : INTERNATIONAL TRANSPORTATION SERVICES ETA : ...
    Rec./Del. Term : CY / CY Block : USLB6 Stop Off : N Rating Date : 2026/04/05
    Equipment Type : Dry Container Equipment Size : 4H Equipment Qty : 1 SOC Qty : 0
    Empty Pick-up CY : TAN CANG HMM LOGISTICS CO., LTD Estimated Empty Pick-up Date (...) : ...
    Full Return CY : CAT LAI TERMINAL
    Cargo Cut-off (Terminal Facility) (DC) 2026/04/02 07:00 Cargo Cut-off (Return Facility) (DC) 2026/04/02 07:00

The 1st vessel leaves Vietnam at the printed ETD; its 'T/S Port' is the transshipment port and the
2nd vessel then is the trunk vessel. The remark may repeat 'FULL RETURN CY:' with another terminal;
the field itself (first occurrence) wins.

Offline OCR prints many labels with their ': value' on the next line (joined back before reading),
the booking number away from its label (the 'Booking Reference No.' line repeats it), the
equipment type / size / qty as separate columns (a size may sit on the line below its label, without
a colon), drops the slash of 'Vessel/Voyage', reads 'Full Return' as 'Full Retum', and can stack a
neighbouring value before a CY ('Full Retum CY : Unknown : ICD PHUOC LONG 3': the CY is the last).
"""
import re
from typing import Dict, List, Optional, Sequence

ISSUER = re.compile(r"\bHMM\b|\bHYUNDAI\s+MERCHANT\b", re.IGNORECASE)
# OCR may drop the slash: '1st VesselVoyage :'
FIRST_VESSEL = re.compile(r"1st\s+Vessel\s*/?\s*Voyage\s*:", re.IGNORECASE)

# Labels printed after a value on the same line (an empty value leaves the next label at the start)
_NEXT_LABEL = (r"(?:^|\s+)(?:T/S\s+Port|Call\s+Sign|TML|ETA|ETD|Facility\s+Code|Trans\s+Mode|Stop\s+Off|"
               r"Rating\s+Date|Equipment\s+Size|Equipment\s+Qty|SOC\s+Qty|Tel\s+No\.?|Fax\s+No\.?)\s*:"
               r"|\s+Estimated\s+Empty")
_DATETIME = r"\d{4}/\d{1,2}/\d{1,2}(?:\s+\d{1,2}:\d{2})?"

# Equipment Size: '4H' = 40' high cube, '20' / '40' / '45'
_SIZES = {"2": "20", "20": "20", "4": "40", "40": "40", "4H": "40", "45": "45", "5H": "45"}
_KINDS = (("REEFER", "RF"), ("OPEN", "OT"), ("FLAT", "FR"), ("TANK", "TK"), ("DRY", "GP"))


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"Booking\s+Notice", text, re.IGNORECASE)
                and FIRST_VESSEL.search(text))


def _value(text: str, label: str, line: str = "") -> str:
    """Value after 'label :' (on the line starting with `line`, if given), cut before the next label."""
    m = re.search(rf"^{line}.*?{label}\s*:[ \t]*(.*)$" if line else rf"(?:^|\s){label}\s*:[ \t]*(.*)$",
                  text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    return re.split(_NEXT_LABEL, m.group(1), maxsplit=1, flags=re.IGNORECASE)[0].strip()


def _vessel(value: str) -> str:
    """'HMM HANUL 025E(KMP/HMM)' -> 'HMM HANUL 025E' (drops the operator/partner tag)."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", value).strip()


def _join_value_lines(text: str) -> str:
    """OCR: 'Full Return CY' / ': CAT LAI TERMINAL' -> 'Full Return CY : CAT LAI TERMINAL'."""
    return re.sub(r"\n[ \t]*(?=:)", " ", text)


def _cy(text: str, label: str) -> str:
    """CY name; OCR can stack a neighbouring ': value' before it, the CY's own value comes last."""
    return re.split(r"\s+:\s+", _value(text, label))[-1].strip()


def _equipment(text: str):
    """
    'Equipment Type : Dry Container Equipment Size : 4H Equipment Qty : 1' -> ("40'HC", '1').
    The three columns are zipped in order, so OCR printing them on separate lines reads the same.
    """
    kinds = [re.split(r"\s+Equipment\s+Size", v, flags=re.IGNORECASE)[0].strip()
             for v in re.findall(r"Equipment\s+Type\s*:?[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)]
    sizes = re.findall(r"Equipment\s+Size\s*:?\s*(\d[0-9A-Z]?\b)?", text, re.IGNORECASE)
    qtys = re.findall(r"Equipment\s+Qty\s*:?[ \t]*(\d*)", text, re.IGNORECASE)
    items = []
    for kind, size, qty in zip(kinds, sizes, qtys):
        if not size or not qty:
            continue
        code = next((c for word, c in _KINDS if word in kind.upper()), "GP")
        if size.upper().endswith("H"):
            code = {"GP": "HC", "RF": "RH"}.get(code, code)
        items.append((f"{_SIZES.get(size.upper(), size)}'{code}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _cut_off(text: str) -> str:
    for facility in ("Terminal", "Return"):
        m = re.search(rf"Cargo\s+Cut-\s?off\s*\({facility}\s+Facility\)\s*(?:\([A-Z]+\))?\s*({_DATETIME})",
                      text, re.IGNORECASE)
        if m:
            return m.group(1)
    return ""


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "HMM"}
    text = _join_value_lines(text)

    out["Booking No"] = _value(text, r"Booking\s+Number") or _value(text, r"Booking\s+Reference\s+No\.?")

    first = _vessel(_value(text, r"1st\s+Vessel\s*/?\s*Voyage"))
    second = _vessel(_value(text, r"2nd\s+Vessel\s*/?\s*Voyage"))
    etd = _value(text, r"ETD")
    out["Vessel"], out["ETD"] = first, etd
    out["T/S Port"] = _value(text, r"T/S\s+Port", r"\s*1st\s+Vessel")
    if second:
        out["Pre Carrier"], out["ETD_Pre"] = first, etd
        out["Trunk Vessel"] = second
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = first, etd

    out["Port of Discharging"] = _value(text, r"Port\s+of\s+Discharging")
    out["Place of Delivery"] = _value(text, r"Place\s+of\s+Delivery")
    out["Block"] = _value(text, r"Block")

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    out["Empty Pick Up CY"] = _cy(text, r"Empty\s+Pick-\s?up\s+CY")
    out["Full return CY"] = _cy(text, r"Full\s+Retu(?:rn|m)\s+CY")
    out["Port Cargo Cut-off"] = _cut_off(text)

    return {k: v for k, v in out.items() if v}
