"""
Maersk 'BOOKING CONFIRMATION'. The route is the 'Intended Transport Plan' table, which can sit on
the first or the last page; its place names wrap onto the next row:

    From              To                         Mode  Vessel                Voy No.  ETD         ETA
    Cat Lai Terminal  Pelabuhan Tanjung Pelepas  MVS   MAERSK NUSSFJORD(PA)  641S     2026-10-26  2026-10-31
                      Terminal
    Pelabuhan Tanjung Mindanao Container         MVS   AS SOPHIA(PT)         645N     2026-11-02  2026-11-18
    Pelepas Terminal  Terminal

Barge / feeder / truck / rail / inland legs are skipped. The first vessel leg leaves Vietnam
(vessel without its flag tag + voyage, ETD); with a second vessel leg, the first leg's 'To' is the
transshipment port. The port of discharge is the 'To' of the last leg, the place of delivery the
booking's 'To:'. Equipment rows read '2 40 DRY 9 6' (qty, size, type, height 9'6" = high cube).
Empty depot and return terminal come from the Load Itinerary. Maersk prints no CY cut-off date
(only a weekly table per service) and no block code.

Offline OCR prints the plan column by column and merges From / To names, so OCR text only gives
the vessels, voyages and ETDs (in order); the transshipment port and discharge port stay empty.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text, row_top

ISSUER = re.compile(r"\bMAERSK\b", re.IGNORECASE)
PLAN = re.compile(r"Intended\s+Transport\s+Plan", re.IGNORECASE)

# Legs that are not the ocean vessel leaving Vietnam
_SKIP_MODES = re.compile(r"^(?:BAR|BARGE|FEF|FEO|FEEDER|TRK|TRUCK|RAIL|RCO|RAL|IWW|INL|INLAND)", re.IGNORECASE)
_DATE = r"\d{4}-\d{2}-\d{2}"
_FLAG = re.compile(r"\s*\([A-Z]{2}\)$")  # 'MAERSK NUSSFJORD(PA)' -> 'MAERSK NUSSFJORD'
_EQ_ROW = re.compile(r"^\s*(\d+)\s+(\d{2})\s+(DRY|REEF|REEFER|OPEN\s+TOP|FLAT\s+RACK|TANK)\s+(\d)\s*(\d)\b",
                     re.IGNORECASE | re.MULTILINE)
_EQ_KIND = {"DRY": "GP", "REEF": "RF", "REEFER": "RF", "OPEN TOP": "OT", "FLAT RACK": "FR", "TANK": "TK"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and PLAN.search(text) and re.search(r"Booking\s+No\.?\s*:", text, re.IGNORECASE))


def _plan_from_words(pages_words) -> List[Dict[str, str]]:
    """Legs of the Intended Transport Plan, columns split by its header; wrapped names join their leg."""
    for words in pages_words or ():
        rows = group_rows(words)
        title = find_phrase(rows, "Intended Transport Plan")
        if not title:
            continue
        header = next((r for r in rows if row_top(r) > title["top"] + 2
                       and {"From", "To", "Mode", "Vessel", "ETD"} <= {w["text"] for w in r}), None)
        if not header:
            continue
        x = {w["text"]: w["x0"] for w in header}
        bounds = [("from", -1.0), ("to", x["To"] - 4), ("mode", x["Mode"] - 4), ("vessel", x["Vessel"] - 4),
                  ("voyage", x.get("Voy", x["ETD"]) - 4), ("etd", x["ETD"] - 4), ("eta", x.get("ETA", 1e9) - 4)]
        legs: List[Dict[str, List[str]]] = []
        prev = row_top(header)
        for row in rows:
            top = row_top(row)
            if top <= prev or top - prev > 16:  # rows before the header / the gap after the table
                if top > row_top(header):
                    break
                continue
            prev = top
            cells: Dict[str, List[str]] = {name: [] for name, _ in bounds}
            for w in row:
                cells[[name for name, bx in bounds if w["x0"] >= bx][-1]].append(w["text"])
            # A leg row has a mode or an ETD; other rows are wrapped place names of the leg above
            if cells["mode"] or cells["etd"] or not legs:
                legs.append(cells)
            else:
                for name in ("from", "to"):
                    legs[-1][name] += cells[name]
        return [{k: " ".join(v) for k, v in leg.items()} for leg in legs]
    return []


def _plan_from_ocr(text: str) -> List[Dict[str, str]]:
    """OCR columns: vessels (with their flag tag), then 'Voy No.' values, then 'ETD' values."""
    m = re.search(r"Intended\s+Transport\s+Plan(.*?)(?:Load\s+Itinerary|\Z)", text, re.IGNORECASE | re.DOTALL)
    if not m:
        return []
    lines = [ln.strip() for ln in m.group(1).splitlines() if ln.strip()]
    vessels = [ln for ln in lines if re.fullmatch(r"[A-Z][A-Z0-9 .'-]+\([A-Z]{2}\)", ln)]

    def column(label: str) -> List[str]:
        start = next((i for i, ln in enumerate(lines) if re.fullmatch(label, ln, re.IGNORECASE)), None)
        values = []
        for ln in lines[start + 1:] if start is not None else []:
            if not re.fullmatch(r"(?=[A-Z0-9]*\d)[A-Z0-9]{3,8}|" + _DATE, ln):
                break
            values.append(ln)
        return values

    voyages, etds = column(r"Voy\s+No\.?"), column(r"ETD")
    if not vessels or len(voyages) != len(vessels):
        return []
    return [{"from": "", "to": "", "mode": "", "vessel": v, "voyage": voy, "etd": etds[i] if i < len(etds) else "",
             "eta": ""} for i, (v, voy) in enumerate(zip(vessels, voyages))]


def _equipment(text: str):
    """'2 40 DRY 9 6' -> ("40'HC", '2'): height 9'6" is high cube; several rows are combined."""
    items = []
    for qty, size, kind, ft, inch in _EQ_ROW.findall(text):
        code = _EQ_KIND[re.sub(r"\s+", " ", kind.upper())]
        if (ft, inch) == ("9", "6"):
            code = {"GP": "HC", "RF": "RH"}.get(code, code)
        items.append((f"{size}'{code}", qty))
    if not items:  # OCR: '2' / ... / '40 DRY 96' on separate lines
        qty = re.search(r"^\s*Quantity\s*\n\s*(\d+)\s*$", text, re.IGNORECASE | re.MULTILINE)
        size = re.search(r"^\s*(\d{2})\s+(DRY|REEF|REEFER)\s+(\d)\s*(\d)\s*$", text, re.IGNORECASE | re.MULTILINE)
        if qty and size:
            code = _EQ_KIND[size.group(2).upper()]
            if size.group(3, 4) == ("9", "6"):
                code = {"GP": "HC", "RF": "RH"}[code]
            items.append((f"{size.group(1)}'{code}", qty.group(1)))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _itinerary(text: str, label: str) -> str:
    """Load Itinerary location: on the label's line (PDF text) or the first place line after 'Location' (OCR)."""
    m = re.search(rf"^\s*{label}[ \t]+(.+?)(?:\s+{_DATE}.*)?$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def _ocr_itinerary(text: str) -> Dict[str, str]:
    """OCR: 'Location' is followed by each stop's name twice (type row + wrapped row), then its address."""
    m = re.search(r"^\s*Location\s*$(.*?)(?:This\s+document|\Z)", text, re.IGNORECASE | re.MULTILINE | re.DOTALL)
    if not m:
        return {}
    lines = [ln.strip() for ln in m.group(1).splitlines() if ln.strip()]
    names = [ln for i, ln in enumerate(lines) if i + 1 < len(lines) and lines[i + 1] == ln]
    return {"empty": names[0] if names else "", "return": names[1] if len(names) > 1 else ""}


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "MAERSK"}

    m = re.search(r"Booking\s+No\.?\s*:\s*(\d{6,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1)

    plan = _plan_from_words(pages_words) or _plan_from_ocr(text)
    vessel_legs = [leg for leg in plan if leg["vessel"] and not _SKIP_MODES.match(leg["mode"])]
    if vessel_legs:
        first = vessel_legs[0]
        vessel = f"{_FLAG.sub('', first['vessel'])} {first['voyage']}".strip()
        out["Vessel"], out["ETD"] = vessel, first["etd"]
        if len(vessel_legs) > 1:
            second = vessel_legs[1]
            out["T/S Port"] = first["to"]
            out["Pre Carrier"], out["ETD_Pre"] = vessel, first["etd"]
            out["Trunk Vessel"] = f"{_FLAG.sub('', second['vessel'])} {second['voyage']}".strip()
            out["ETD_Trunk"] = second["etd"]
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = vessel, first["etd"]
        out["Port of Discharging"] = plan[-1]["to"]

    # Booking 'To:' (same line in PDF text, next line in OCR)
    m = re.search(r"(?:^|\s)To:[ \t]*(\S.*)$", text, re.MULTILINE) or re.search(r"^\s*To:\s*\n\s*(.+)$", text, re.MULTILINE)
    if m:
        out["Place of Delivery"] = m.group(1).strip()

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    out["Empty Pick Up CY"] = _itinerary(text, r"Empty\s+Container")
    out["Full return CY"] = _itinerary(text, r"Return\s+Equip")
    if not out["Empty Pick Up CY"] and not out["Full return CY"]:
        stops = _ocr_itinerary(text)
        out["Empty Pick Up CY"], out["Full return CY"] = stops.get("empty", ""), stops.get("return", "")

    return {k: v for k, v in out.items() if v}
