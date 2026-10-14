"""
T.S. Lines 'RELEASE ORDER' (booking release):

    BOOKING NO.: 341BK6004600
    RELEASE FROM: G-FORTUNE DONG AN
    RETURN INTO: CAT LAI CLOSING DATE: 10-JUL-2026 05:00
    LEG VESSEL VESSEL NAME VOYAGE POL POL ETA/ETD POD POD ETA
    1 IETE INTERASIA ELEVATE N068 VNHCM 10-JUL-2026 00:00/11-JUL-2026 00:00 CNSKU 14-JUL-2026 00:00
    2 EVEN EVER ENVOY 203S CNSKU 15-JUL-2026 00:00/16-JUL-2026 00:00 AUBNE 01-AUG-2026 00:00
    PORT OF DISCHARGE: BRISBANE
    FINAL PLACE OF DELIVERY: BRISBANE
    CONT. QTY/TYPE: 1X40HQ
    SPECIAL INSTRUCTION: CAP CONT SACH TOT//TS PORT SHEKOU

Leg 1 leaves Vietnam (its ETD is the second POL date); with a second leg, leg 1's POD is the
transshipment port (named by 'TS PORT ...' in the special instruction when given) and leg 2's vessel
is the trunk vessel. Ports are written as 'NAME (CODE)'. Vessel names may belong to partner lines
(e.g. INTERASIA ELEVATE): the carrier is T.S. Lines. No block code is printed.

Offline OCR prints 'LABEL:' with its value on the next line, and splits the leg table into a vessel
column (4-letter vessel codes, names, voyages) and a port/date column ('VNHCM <ETA>/<ETD>',
'CNSKU <ETA>'); the two are zipped back in order.
"""
import re
from typing import Dict, List, Optional, Sequence

ISSUER = re.compile(r"\bT\.?\s?S\.?\s+(?:CONTAINER\s+)?LINES?\b|\bTSLINES\b", re.IGNORECASE)
TITLE = re.compile(r"RELEASE\s+ORDER", re.IGNORECASE)

_DT = r"\d{1,2}-[A-Z]{3}-\d{4}(?:\s+\d{1,2}:\d{2})?"
# '1 IETE INTERASIA ELEVATE N068 VNHCM 10-JUL-2026 00:00/11-JUL-2026 00:00 CNSKU 14-JUL-2026 00:00'
_LEG = re.compile(
    rf"^\s*(\d+)\s+[A-Z0-9]{{3,5}}\s+(.+?)\s+([A-Z0-9]+)\s+([A-Z]{{5}})\s+({_DT})?\s*/\s*({_DT})?\s+([A-Z]{{5}})\b",
    re.IGNORECASE | re.MULTILINE)
_EQ = re.compile(r"(\d+)\s*X\s*(\d{2})\s*([A-Z]{2})\b", re.IGNORECASE)
_KINDS = {"GP": "GP", "DC": "GP", "DV": "GP", "HQ": "HC", "HC": "HC", "RF": "RF", "RE": "RF", "RH": "RH",
          "RQ": "RH", "OT": "OT", "FR": "FR", "TK": "TK"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and TITLE.search(text) and re.search(r"BOOKING\s+NO\.?\s*:", text, re.IGNORECASE))


def _value(text: str, label: str, stop: str = "") -> str:
    """Value after 'LABEL:' on its line, else (OCR) the next line when it is not another 'LABEL:'."""
    m = re.search(rf"^\s*{label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    value = m.group(1)
    if not value.strip():
        nxt = re.search(rf"^\s*{label}\s*:[ \t]*\n[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
        value = nxt.group(1) if nxt and not re.search(r":\s*$|^[A-Z .]+:", nxt.group(1)) else ""
    if stop:
        value = re.split(stop, value, maxsplit=1, flags=re.IGNORECASE)[0]
    return value.strip()


def _equipment(value: str):
    """'1X40HQ' -> ("40'HC", '1'); '1X40HQ, 2X20GP' -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(value)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _legs_from_ocr(text: str) -> List[Dict[str, str]]:
    """OCR columns: vessels (code / name / voyage lines) and 'POL <ETA>/<ETD>' lines, zipped in order."""
    block = re.search(r"VOYAGE\s*\n(.*?)\n\s*PLACE\s+OF\s+RECEIPT", text, re.IGNORECASE | re.DOTALL)
    vessels: List[str] = []
    for line in (block.group(1).splitlines() if block else []):
        line = line.strip()
        if not line or re.fullmatch(r"[A-Z]{4}", line):  # vessel code column ('IETE')
            continue
        if re.fullmatch(r"[A-Z0-9]*\d[A-Z0-9]*", line) and vessels:  # voyage printed on its own line
            vessels[-1] += f" {line}"
        else:
            vessels.append(line)
    pols = re.findall(rf"\b([A-Z]{{5}})\s+(?:{_DT})?\s*/\s*({_DT})", text)
    pods = [code for code in re.findall(rf"\b([A-Z]{{5}})\s+{_DT}(?!\s*/)", text)]
    if not vessels or len(vessels) != len(pols):
        return []
    legs = []
    for i, (vessel, (pol, etd)) in enumerate(zip(vessels, pols)):
        pod = pols[i + 1][0] if i + 1 < len(pols) else (pods[-1] if pods else "")
        legs.append({"vessel": vessel, "pol": pol, "etd": etd, "pod": pod})
    return legs


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "TS LINE"}

    out["Booking No"] = _value(text, r"BOOKING\s+NO\.?")

    legs = [{"vessel": f"{name.strip()} {voy}", "pol": pol, "etd": etd or "", "pod": pod}
            for _n, name, voy, pol, _eta, etd, pod in _LEG.findall(text)] or _legs_from_ocr(text)
    pod_name = _value(text, r"PORT\s+OF\s+DISCHARGE")
    if legs:
        first = legs[0]
        out["Vessel"], out["ETD"] = first["vessel"], first["etd"]
        if len(legs) > 1:
            ts_name = re.search(r"\bT/?S\s+PORT\s*:?\s*([A-Z][A-Z .'-]*?)\s*(?:/|,|$)",
                                _value(text, r"SPECIAL\s+INSTRUCTION"), re.IGNORECASE)
            out["T/S Port"] = f"{ts_name.group(1).strip()} ({first['pod']})" if ts_name else first["pod"]
            out["Pre Carrier"], out["ETD_Pre"] = first["vessel"], first["etd"]
            out["Trunk Vessel"], out["ETD_Trunk"] = legs[1]["vessel"], legs[1]["etd"]
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = first["vessel"], first["etd"]
        last_pod = legs[-1]["pod"]
        out["Port of Discharging"] = f"{pod_name} ({last_pod})" if pod_name else last_pod
    else:
        out["Port of Discharging"] = pod_name
    out["Place of Delivery"] = _value(text, r"FINAL\s+PLACE\s+OF\s+DELIVERY")

    out["Equipment Type"], out["Q'ty"] = _equipment(_value(text, r"CONT\.?\s*QTY\s*/\s*TYPE"))

    out["Empty Pick Up CY"] = _value(text, r"RELEASE\s+FROM")
    out["Full return CY"] = _value(text, r"RETURN\s+INTO", r"\s+CLOSING\s+DATE")
    m = re.search(rf"CLOSING\s+DATE\s*:\s*({_DT})", text, re.IGNORECASE)
    out["Port Cargo Cut-off"] = m.group(1) if m else ""

    return {k: v for k, v in out.items() if v}
