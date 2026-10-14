"""
RCL (Regional Container Lines) 'BOOKING CONFIRMATION' (report BKG118), 'Label: value' fields and an
'Intended Transportation Plan' table of legs:

    RCL BOOKING NUMBER: BSGNC26019930
    Port of Discharge:LAEM CHABANG, THAILAND        Terminal Name: KERRY SIAM SEAPORT LTD.
    Place of Delivery: LAT KRABANG, THAILAND        Terminal or ICD Name:NH PROSPERITY CO LTD
    Seq From              To              Mode    Service Vessel / Voyage       ETD        ETA
    1   HO CHI MINH CITY, LAEM CHABANG,   VESSEL  RNV2    SKY SUNSHINE / 2609S  22/07/2026 24/07/2026
        VIETNAM           THAILAND
    2   LAEM CHABANG,     LAT KRABANG,    TRUCK                                 25/07/2026 26/07/2026
    No. of Containers: 1 x 40' HC
    MT Container Pickup Depot / CFS: SOTRANS INLAND CLEARANCE DEPOT - SOTRANS ICD Date:08/07/2026
    Return Location: HO CHI MINH CITY, CAT LAI PORT Date:22/07/2026

and, on page 2, the closing times per cargo kind:

    Cargo  VGM - Closing Time  ICD Closing Time  Terminal Closing Time  SI and eSI Closing Time
    NORMAL 21/07/2026 01:00    N/A               22/07/2026 13:00       21/07/2026 01:00

The vessel is the first sea leg (not BARGE, TRUCK, RAIL or other inland legs) leaving Vietnam, with its
ETD. The port that leg reaches is the transshipment port unless it is the port of discharge; a later
sea leg is then the trunk vessel. The CY cut-off is the 'Terminal Closing Time' of the NORMAL row
(REEFER for reefer containers). The return location is stored without its city ('CAT LAI PORT').
No block code is printed.

The table's values start left of their header labels, so word boxes are given to the column whose
span (midway between header labels) holds them. Without them the legs are read from the text lines;
offline OCR prints one cell per line, so only the first leg (under its header labels) is read there.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text, row_top

ISSUER = re.compile(r"\bREGIONAL\s+CONTAINER\s+LINES?\b|\bRCL\s+BOOKING\s+NUMBER\b", re.IGNORECASE)

_INLAND = re.compile(r"^(?:BARGE|TRUCK|RAIL|ROAD|INLAND\w*|IWT|LIGHTER)$", re.IGNORECASE)
_DAY = r"\d{1,2}/\d{1,2}/\d{4}"
_DAY_TIME = rf"{_DAY}\s+\d{{1,2}}:\d{{2}}"
# '1 x 40' HC' -> qty, size, kind
_EQ = re.compile(r"\b(\d+)\s*x\s*(\d{2})'?\s*(HC|HQ|GP|DC|DV|RF|RH|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"DC": "GP", "DV": "GP", "HQ": "HC"}
_COLUMNS = ("Seq", "From", "To", "Mode", "Service", "Vessel / Voyage", "ETD", "ETA")


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"BOOKING\s+CONFIRMATION", text, re.IGNORECASE)
                and re.search(r"Intended\s+Transportation\s+Plan", text, re.IGNORECASE))


def _field(text: str, label: str, stop: str = r"Date\s*:|Terminal|$", next_line: bool = False) -> str:
    """Value after 'label:' up to `stop`; `next_line` also takes it from the next line (OCR)."""
    gap = r"\s*" if next_line else r"[ \t]*"
    m = re.search(rf"{label}\s*:{gap}(.*?)[ \t]*(?:{stop})", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def _legs_from_words(pages_words) -> List[Dict[str, str]]:
    """Legs of the transportation plan, each {column: text}, from the word boxes."""
    for words in pages_words or ():
        rows = group_rows(words)
        head = find_phrase(rows, "Seq From")
        if not head:
            continue
        header = next(r for r in rows if abs(row_top(r) - head["top"]) <= 3)
        starts = [find_phrase([header], c)["x0"] for c in _COLUMNS]
        bounds = [(a + b) / 2 for a, b in zip(starts, starts[1:])]
        legs: List[Dict[str, List[str]]] = []
        for row in rows:
            if row_top(row) <= head["top"] + 3:
                continue
            if re.search(r"No\.\s+of\s+Containers|Full\s*/\s*Empty", row_text(row), re.IGNORECASE):
                break
            cols: Dict[str, List[str]] = {}
            for w in row:
                col = _COLUMNS[sum(w["x0"] >= b for b in bounds)]
                if col == "Seq" and not w["text"].isdigit():  # port names start left of 'From'
                    col = "From"
                cols.setdefault(col, []).append(w["text"])
            if cols.get("Seq", [""])[0].isdigit():
                legs.append(cols)
            elif legs:  # wrapped port / country lines of the leg above
                for col, texts in cols.items():
                    legs[-1].setdefault(col, []).extend(texts)
        return [{c: " ".join(t) for c, t in leg.items()} for leg in legs]
    return []


def _legs_from_text(text: str) -> List[Dict[str, str]]:
    """Text layer: '1 HO CHI MINH CITY, LAEM CHABANG, VESSEL RNV2 SKY SUNSHINE / 2609S 22/07/2026 24/07/2026'
    and the countries 'VIETNAM THAILAND' on the next line."""
    legs = []
    for m in re.finditer(rf"^(\d+)\s+([^,\n]+),\s*([^,\n]+),\s+([A-Z]+)\b(.*?)\s*({_DAY})\s+({_DAY})[ \t]*\n(.*)$",
                         text, re.MULTILINE):
        origin, dest, mode, rest, etd, eta, countries = m.group(2, 3, 4, 5, 6, 7, 8)
        tokens = rest.split()
        if tokens and re.fullmatch(r"(?=\w*\d)[A-Z0-9]{2,6}", tokens[0]) and "/" in rest:
            tokens = tokens[1:]  # the service code ('RNV2')
        pair = countries.split()
        if len(pair) == 2:
            origin, dest = f"{origin}, {pair[0]}", f"{dest}, {pair[1]}"
        legs.append({"From": origin, "To": dest, "Mode": mode, "Vessel / Voyage": " ".join(tokens),
                     "ETD": etd, "ETA": eta})
    return legs


def _legs_from_ocr(text: str) -> List[Dict[str, str]]:
    """OCR: one cell per line; the first leg's cells follow their header labels."""
    def after(label):
        m = re.search(rf"^\s*{label}\s*\n((?:.*\n){{1,2}})", text, re.MULTILINE)
        return [ln.strip() for ln in m.group(1).splitlines()] if m else []

    vessel, etd, mode = after(r"Vessel\s*/\s*Voyage"), after("ETD"), after("Mode")
    if not vessel or not re.fullmatch(r".+\s*/\s*\S+", vessel[0]):
        return []
    to = after("To")
    return [{"To": ", ".join(t.rstrip(",") for t in to), "Mode": mode[0] if mode else "VESSEL",
             "Vessel / Voyage": vessel[0],
             "ETD": etd[0] if etd and re.fullmatch(_DAY, etd[0]) else ""}]


def _vessel(value: str) -> str:
    """'SKY SUNSHINE / 2609S' -> 'SKY SUNSHINE 2609S'."""
    return re.sub(r"\s*/\s*", " ", value.strip())


def _port(value: str) -> str:
    """'LAEM CHABANG, THAILAND' with tidy spacing."""
    return re.sub(r"\s*,\s*", ", ", re.sub(r"\s+", " ", value)).strip(" ,")


def _equipment(text: str):
    """'1 x 40' HC' -> ("40'HC", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _closing_time(text: str, cargo: str) -> str:
    """'Terminal Closing Time' of the `cargo` row ('NORMAL' / 'REEFER')."""
    head = re.search(r"^.*Terminal\s+Closing\s+Time.*$", text, re.IGNORECASE | re.MULTILINE)
    row = re.search(rf"^\s*{cargo}\s+(.+)$", text, re.MULTILINE)
    if head and row and re.search(r"Cargo\s+VGM", head.group(0), re.IGNORECASE):
        line = head.group(0).upper()
        names = sorted(("VGM", "ICD CLOSING", "TERMINAL CLOSING", "SI AND ESI"), key=lambda n: line.find(n))
        cells = re.findall(rf"{_DAY_TIME}|N/A", row.group(1))
        if len(cells) == len(names):
            return cells[names.index("TERMINAL CLOSING")]
    # OCR: the column's label, then one line per cargo row (in the order printed under 'Cargo')
    kinds = re.search(r"^\s*Cargo\s*\n((?:\s*[A-Z0-9]{2,6}\s*\n)+)", text, re.MULTILINE)
    order = [k.strip().replace("0", "O") for k in kinds.group(1).splitlines()] if kinds else ["NORMAL"]
    m = re.search(r"^\s*Terminal\s+Closing\s+Time\s*\n((?:.*\n){1,4})", text, re.IGNORECASE | re.MULTILINE)
    if m:
        cells = [ln.strip() for ln in m.group(1).splitlines()]
        i = order.index(cargo) if cargo in order else 0
        if i < len(cells) and re.fullmatch(_DAY_TIME, cells[i]):
            return cells[i]
    return ""


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "RCL"}

    m = re.search(r"RCL\s+BOOKING\s+NUMBER\s*:\s*([A-Z0-9]{8,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    pod = _port(_field(text, r"Port\s+of\s+Discharge"))
    out["Port of Discharging"] = pod
    out["Place of Delivery"] = _port(_field(text, r"Place\s+of\s+Delivery"))

    legs = _legs_from_words(pages_words) or _legs_from_text(text) or _legs_from_ocr(text)
    sea = [leg for leg in legs if leg.get("Vessel / Voyage") and not _INLAND.match(leg.get("Mode", ""))]
    if sea:
        first = sea[0]
        vessel, etd = _vessel(first["Vessel / Voyage"]), first.get("ETD", "")
        out["Vessel"], out["ETD"] = vessel, etd
        reached = _port(first.get("To", ""))
        if reached and pod and reached.split(",")[0] != pod.split(",")[0]:
            out["T/S Port"] = reached
        if len(sea) > 1:
            out["Pre Carrier"], out["ETD_Pre"] = vessel, etd
            out["Trunk Vessel"], out["ETD_Trunk"] = _vessel(sea[1]["Vessel / Voyage"]), sea[1].get("ETD", "")
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    out["Equipment Type"], out["Q'ty"] = _equipment(_field(text, r"No\.\s+of\s+Containers", r"EQ\s+GRADE|$"))

    out["Empty Pick Up CY"] = _field(text, r"MT\s+Container\s+Pickup\s+Depot\s*/\s*CFS")
    # 'HO CHI MINH CITY, CAT LAI PORT' -> 'CAT LAI PORT' (the city of the port of loading)
    laden = _field(text, r"Return\s+Location")
    city = _field(text, r"Port\s+of\s+Loading", r",|$", next_line=True)
    if city and laden.upper().startswith(city.upper() + ","):
        laden = laden[len(city) + 1:].strip()
    out["Full return CY"] = laden

    reefer = out["Equipment Type"].endswith(("RF", "RH"))
    out["Port Cargo Cut-off"] = _closing_time(text, "REEFER" if reefer else "NORMAL")

    return {k: v for k, v in out.items() if v}
