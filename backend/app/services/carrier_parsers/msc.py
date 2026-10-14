"""
MSC 'BOOKING CONFIRMATION', 'LABEL value' lines (no colons), up to two pairs per line:

    BOOKING REFERENCE ORIGINAL/SEA WAYBILL(**) MEDUABE44198 BOOKING DATE
    339IVN0121044                                   <- booking reference on the next line
    GATE IN AT TERMINAL PHUOC AN PORT
    PORT OF LOADING DONG NAI EST. TIME OF ARRIVAL/DEPARTURE 24/10/2026 15:00 25/10/2026 03:00
    VESSEL NAME / FLAG MSC MONICA III (LLOYDS NO. 9060649) / LR VOYAGE NUMBER HR642R
    PORT OF TRANSHIPMENT N*1 BUSAN EST. TIME OF DEPARTURE 05/11/2026 21:30
    CONNECTING VESSEL N*1 / FLAG ONE SINCERITY (LLOYDS NO. 9976185) / SG VOYAGE NUMBER 2642E
    PORT OF DISCHARGE VALPARAISO EST. TIME OF ARRIVAL 13/12/2026 22:30
    FINAL DESTINATION CARRIER'S HAULAGE BY /SUBLOC.     <- empty
    DRY 06/10/2026 00:00 20/10/2026 02:00               <- gate-in at terminal: first receiving, cut-off
    SPECIAL CUT-OFF ( GATE IN AT ICDs - CUT OFF ) 19/10/2026 04:00
    EQUIP.TYPE/ISO/NUMBER 40HC/4510 QUANTITY 2 HAZARDOUS N S.O.C N
    PICK UP AT DEPOT AS FROM UNTIL

The vessel leaves Vietnam at the second date of 'EST. TIME OF ARRIVAL/DEPARTURE'. With a
transhipment port, connecting vessel N*1 is the trunk vessel. The CY cut-off is the special
(ICD gate-in) cut-off when printed, else the terminal gate-in cut-off. MSC prints no block code.

Offline OCR prints the page column by column (a run of labels, then a run of values), so the
fields are read from the shape of the values instead: vessels carry '(LLOYDS NO. ...)', voyages
are short letter+digit codes on their own line, and the ports sit around the vessels in route
order (loading, vessel, transhipment, connecting vessel, discharge). The final destination is
only read from PDF text.
"""
import re
from typing import Dict, List, Optional, Sequence

ISSUER = re.compile(r"\bMSC\b|\bMEDITERRANEAN\s+SHIPPING\b", re.IGNORECASE)
TITLE = re.compile(r"BOOKING\s+CONFIRMATION", re.IGNORECASE)
VESSEL_LABEL = re.compile(r"VESSEL\s+NAME\s*/\s*FLAG", re.IGNORECASE)

_DATETIME = r"\d{1,2}/\d{1,2}/\d{4}(?:\s+\d{1,2}:\d{2})?"
# Labels printed after a value on the same line (second column)
# (an empty value leaves the next label at the start)
_NEXT_LABEL = (r"(?:^|\s+)(?:EST\.\s*TIME|CARRIER'?S\s+HAULAGE|BOOKING\s+DATE|AS\s+FROM|UNTIL|VOYAGE\s+NUMBER|"
               r"QUANTITY|HAZARDOUS|TERMINAL\s+OF)\b")
# 'MSC MONICA III (LLOYDS NO. 9060649) / LR VOYAGE NUMBER HR642R'
_VESSEL = r"(.*?)\s*(?:\(LLOYDS\s+NO\.?\s*\d*\))?\s*/\s*[A-Z]{0,3}\s+VOYAGE\s+NUMBER\s*([A-Z0-9]*)"
_EQUIP = re.compile(r"EQUIP\.?\s*TYPE\s*/\s*ISO\s*/\s*NUMBER\s+(\d{2})([A-Z]{2})\s*/\s*\w+\s+QUANTITY\s+(\d+)",
                    re.IGNORECASE)


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and TITLE.search(text) and VESSEL_LABEL.search(text))


def _value(text: str, label: str) -> str:
    """Value after `label` on its line, cut before a label printed beside it."""
    m = re.search(rf"^\s*{label}[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    return re.split(_NEXT_LABEL, m.group(1), maxsplit=1, flags=re.IGNORECASE)[0].strip()


def _vessel(text: str, label: str) -> str:
    m = re.search(rf"^\s*{label}[ \t]*{_VESSEL}[ \t]*$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    return f"{m.group(1).strip()} {m.group(2)}".strip()


def _dates_after(text: str, label: str) -> List[str]:
    m = re.search(rf"^.*{label}(.*)$", text, re.IGNORECASE | re.MULTILINE)
    return re.findall(_DATETIME, m.group(1)) if m else []


def _equipment(text: str):
    """'EQUIP.TYPE/ISO/NUMBER 40HC/4510 QUANTITY 2' lines -> ("40'HC", '2'), or a combined list and total."""
    items = [(f"{size}'{kind.upper()}", qty) for size, kind, qty in _EQUIP.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _cut_off(text: str) -> str:
    special = _dates_after(text, r"SPECIAL\s+CUT-OFF")
    if special:
        return special[0]
    # GATE-IN AT TERMINAL rows: 'DRY <first receiving> <cut-off>'
    dry = re.search(rf"^[ \t]*DRY[ \t]+{_DATETIME}[ \t]+({_DATETIME})", text, re.IGNORECASE | re.MULTILINE)
    return dry.group(1) if dry else ""


# --- Offline OCR (column-by-column text) -------------------------------------------------
_OCR_VESSEL = re.compile(r"^(.+?)\s*\(LLOYDS\s+NO\.?\s*\d*\)", re.IGNORECASE)
_OCR_VOYAGE = re.compile(r"^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,8}$")
_OCR_PORT = re.compile(r"^[A-Z][A-Z .'-]+$")
_OCR_LABEL = re.compile(r"^(?:PLACE\s+OF|PORT\s+OF|VESSEL|CONNECTING|EST\.|VOYAGE|TERMINAL\s+OF|FINAL\s+DEST|"
                        r"CARRIER|TOTAL|CONTACT|GATE|CUSTOMER|PURCHASE|FREIGHT|EDI|SERVICE)", re.IGNORECASE)


def _ocr_section(text: str, start: str, end: str) -> List[str]:
    m = re.search(rf"{start}(.*?)(?:{end}|\Z)", text, re.IGNORECASE | re.DOTALL | re.MULTILINE)
    return [ln.strip() for ln in m.group(1).splitlines() if ln.strip()] if m else []


def _ocr_route(text: str) -> Dict[str, str]:
    lines = _ocr_section(text, r"PLACE\s+OF\s+ORIGIN", r"TOTAL\s+CONTAINER")
    vessels = [_OCR_VESSEL.match(ln).group(1).strip() for ln in lines if _OCR_VESSEL.match(ln)]
    voyages = [ln for ln in lines if _OCR_VOYAGE.match(ln)]
    dates = re.findall(_DATETIME, "\n".join(lines))
    # Ports and vessels in printed order: POL, vessel, T/S 1, connecting vessel 1, (T/S 2,) POD
    seq = [("V", ln) if _OCR_VESSEL.match(ln) else ("P", ln) for ln in lines
           if _OCR_VESSEL.match(ln) or (_OCR_PORT.match(ln) and not _OCR_LABEL.match(ln) and ln not in voyages)]
    out: Dict[str, str] = {}
    if not vessels:
        return out
    v_at = [i for i, (kind, _) in enumerate(seq) if kind == "V"]
    after_last = [ln for kind, ln in seq[v_at[-1] + 1:] if kind == "P"]
    out["vessel"] = f"{vessels[0]} {voyages[0] if voyages else ''}".strip()
    out["etd"] = dates[1] if len(dates) > 1 else ""
    if len(vessels) > 1:
        between = [ln for kind, ln in seq[v_at[0] + 1:v_at[1]] if kind == "P"]
        out["ts_port"] = between[0] if between else ""
        out["connecting"] = f"{vessels[1]} {voyages[1] if len(voyages) > 1 else ''}".strip()
        out["etd_trunk"] = dates[2] if len(dates) > 2 else ""
    elif len(after_last) > 1:
        out["ts_port"] = after_last[0]
    out["pod"] = after_last[-1] if after_last else ""
    return out


def _ocr_booking_no(text: str) -> str:
    m = re.search(r"BOOKING\s+REFERENCE(.{0,200})", text, re.IGNORECASE | re.DOTALL)
    code = re.search(r"\b(\d{3}[A-Z]{2,5}\d{6,})\b", m.group(1)) if m else None
    return code.group(1) if code else ""


def _ocr_equipment(text: str):
    types = re.findall(r"^\s*(\d{2})([A-Z]{2})\s*/\s*\d{4}\s*$", text, re.MULTILINE)
    qty = re.search(r"^\s*QUANTITY\s*$(.*?)^\s*(\d+)\s*$", text, re.MULTILINE | re.DOTALL)
    if len(types) != 1 or not qty:
        return "", ""
    return f"{types[0][0]}'{types[0][1]}", qty.group(2)


def _ocr_gate_in(text: str) -> str:
    lines = _ocr_section(text, r"^\s*GATE\s+IN\s+AT\s+TERMINAL\s*$", r"PLACE\s+OF\s+ORIGIN")
    return next((ln for ln in lines if _OCR_PORT.match(ln) and not _OCR_LABEL.match(ln)), "")


def _ocr_cut_off(text: str) -> str:
    """OTHERS block: the dates keep the printed order of the cut-off labels."""
    lines = _ocr_section(text, r"^\s*OTHERS\s*$", r"IMPORTANT")
    labels = [ln for ln in lines if re.search(r"CUT-OFF|CUT\s+OFF", ln, re.IGNORECASE)]
    dates = re.findall(_DATETIME, "\n".join(lines))
    idx = next((i for i, ln in enumerate(labels) if re.match(r"SPECIAL", ln, re.IGNORECASE)), None)
    if idx is not None and len(dates) == len(labels):
        return dates[idx]
    dry = _ocr_section(text, r"CUT-OFF\s*\(Date/Time\)", r"OTHERS")
    return next((d for ln in dry for d in re.findall(_DATETIME, ln)), "")


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "MSC"}

    m = re.search(r"BOOKING\s+REFERENCE[^\n]*\n\s*([A-Z0-9]{8,})\b", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1)

    vessel = _vessel(text, r"VESSEL\s+NAME\s*/\s*FLAG")
    dates = _dates_after(text, r"EST\.\s*TIME\s+OF\s+ARRIVAL\s*/\s*DEPARTURE")
    etd = dates[1] if len(dates) > 1 else ""
    out["Vessel"], out["ETD"] = vessel, etd

    ts_port = _value(text, r"PORT\s+OF\s+TRANSHIPMENT\s+N\W?1")
    connecting = _vessel(text, r"CONNECTING\s+VESSEL\s+N\W?1\s*/\s*FLAG")
    if ts_port:
        out["T/S Port"] = ts_port
    if ts_port and connecting:
        out["Pre Carrier"], out["ETD_Pre"] = vessel, etd
        out["Trunk Vessel"] = connecting
        ts_dates = _dates_after(text, r"PORT\s+OF\s+TRANSHIPMENT\s+N\W?1")
        out["ETD_Trunk"] = ts_dates[0] if ts_dates else ""
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["Port of Discharging"] = _value(text, r"PORT\s+OF\s+DISCHARGE")
    out["Place of Delivery"] = _value(text, r"FINAL\s+DESTINATION")

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    out["Empty Pick Up CY"] = _value(text, r"PICK\s+UP\s+AT\s+DEPOT")
    out["Full return CY"] = _value(text, r"GATE\s+IN\s+AT\s+TERMINAL(?!\s+First)")
    out["Port Cargo Cut-off"] = _cut_off(text)

    if not vessel:  # offline OCR: labels and values in separate runs
        route = _ocr_route(text)
        out["Booking No"] = out.get("Booking No") or _ocr_booking_no(text)
        out["Vessel"], out["ETD"] = route.get("vessel", ""), route.get("etd", "")
        out["T/S Port"] = route.get("ts_port", "")
        if route.get("connecting"):
            out["Pre Carrier"], out["ETD_Pre"] = out["Vessel"], out["ETD"]
            out["Trunk Vessel"], out["ETD_Trunk"] = route["connecting"], route.get("etd_trunk", "")
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = out["Vessel"], out["ETD"]
        out["Port of Discharging"] = out["Port of Discharging"] or route.get("pod", "")
        if not out["Equipment Type"]:
            out["Equipment Type"], out["Q'ty"] = _ocr_equipment(text)
        out["Full return CY"] = out["Full return CY"] or _ocr_gate_in(text)
        out["Port Cargo Cut-off"] = _ocr_cut_off(text)

    return {k: v for k, v in out.items() if v}
