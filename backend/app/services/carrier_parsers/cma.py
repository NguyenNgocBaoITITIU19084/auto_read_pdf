"""
CMA CGM group (CMA CGM, ANL, CNC) 'Booking Confirmation' with a ROUTE INFORMATION table:

    Location         Arrival (ETA)  Departure (ETD)  Vessel / Mode  LVR        Service  Terminal
    HO CHI MINH CITY                                 Barge
    VUNG TAU         20-OCT-2026    21-OCT-2026      CMA CGM LITANI PX30C0E19 PEX3     GEMALINK PORT
    SHEKOU           01-NOV-2026    01-NOV-2026      HENG HUI 6     CM30W0W19  CIMEX3   SHEKOU CONTAINER TERMINAL LTD
    FUJAIRAH         17-NOV-2026                     Rail/Road                          FUJAYRAH PORT
    JEBEL ALI

Barge / rail / road / truck legs are skipped. The first vessel leg leaves Vietnam: its vessel +
LVR voyage, ETD and terminal (where full containers go). With a second vessel leg, its location
is the transshipment port. The port of discharge and place of delivery are the last location
(the farthest point of the route). Cut-off is the 'Port Cut-Off' column of CUT-OFF INFORMATION.

Word boxes (PDFs) split the table by its header columns; text falls back to the text lines.
Offline OCR prints the table column by column (locations with their dates, then the vessels, then
LVR / service, then terminals), so those columns are zipped back together.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text, row_top

ISSUER = re.compile(r"\bCMA[\s-]?CGM\b|\bANL\b|\bCNC\s+LINE\b", re.IGNORECASE)
ROUTE = re.compile(r"ROUTE\s+INFORMATION", re.IGNORECASE)
CUT_OFF_SECTION = re.compile(r"CUT-OFF\s+INFORMATION", re.IGNORECASE)

_DATE = r"\d{1,2}-[A-Za-z]{3}-\d{4}"
_MODES = re.compile(r"^(?:BARGE|RAIL|ROAD|TRUCK|RAIL/ROAD|INTERMODAL)\b", re.IGNORECASE)
# Voyage (LVR) codes mix letters and digits: 'PX30C0E19', 'CM30W0W19', '0MXK5W1MA'
_VOYAGE = re.compile(r"^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{5,}$")
_EQ_ITEM = re.compile(r"^\s*(\d+)\s*[xX]\s*(\d{2}\s*['’]?\s*[A-Z]{2})\b", re.MULTILINE)


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and ROUTE.search(text) and CUT_OFF_SECTION.search(text))


def _route_from_words(pages_words) -> List[Dict[str, str]]:
    """Route rows split by the table header's column positions."""
    for words in pages_words or ():
        rows = group_rows(words)
        loc = find_phrase(rows, "Location")
        eta = find_phrase(rows, "Arrival (ETA)")
        vessel = find_phrase(rows, "Vessel / Mode")
        lvr = find_phrase(rows, "LVR")
        service = find_phrase(rows, "Service")
        terminal = find_phrase(rows, "Terminal")
        end = find_phrase(rows, "CUT-OFF INFORMATION")
        if not (loc and eta and vessel and lvr and service and terminal):
            continue
        departure = find_phrase(rows, "Departure")
        etd_x = departure["x0"] if departure and departure["x0"] < vessel["x0"] else (eta["x1"] + vessel["x0"]) / 2
        bounds = [("location", -1.0), ("eta", eta["x0"] - 8), ("etd", etd_x - 8), ("vessel", vessel["x0"] - 8),
                  ("voyage", lvr["x0"] - 8), ("service", service["x0"] - 8),
                  # service codes are short ('PEX3'); wrapped terminal names start left of their header
                  ("terminal", service["x0"] + 25)]
        header_bottom = max(loc["top"], terminal["top"]) + 8
        stop = end["top"] if end else float("inf")
        body = [w for r in rows if header_bottom < row_top(r) < stop for w in r]

        # A leg starts with a word in the Location column; wrapped terminal names attach to the nearest leg
        legs = sorted({round(w["top"]) for w in body if w["x0"] < eta["x0"] - 8})
        if not legs:
            continue
        cells: List[Dict[str, List[Dict]]] = [{name: [] for name, _ in bounds} for _ in legs]
        for w in body:
            i = min(range(len(legs)), key=lambda k: abs(legs[k] - w["top"]))
            col = [name for name, x in bounds if w["x0"] >= x][-1]
            cells[i][col].append(w)
        route = [{k: row_text(sorted(v, key=lambda w: (round(w["top"]), w["x0"]))) for k, v in c.items()}
                 for c in cells]
        for row in route:
            # The LVR voyage is printed left of its header, so it can land in the vessel cell
            name, _, last = row["vessel"].rpartition(" ")
            if not row["voyage"] and name and _VOYAGE.match(last):
                row["vessel"], row["voyage"] = name, last
        return route
    return []


def _route_from_text(text: str) -> List[Dict[str, str]]:
    """Route rows from the text lines: 'VUNG TAU 20-OCT-2026 21-OCT-2026 CMA CGM LITANI PX30C0E19 PEX3 GEMALINK PORT'."""
    m = re.search(r"ROUTE\s+INFORMATION(.*?)CUT-OFF\s+INFORMATION", text, re.IGNORECASE | re.DOTALL)
    if not m:
        return []
    legs = []
    for line in m.group(1).splitlines():
        line = line.strip()
        leg = re.match(rf"^([A-Z][A-Z .'-]*?)\s+({_DATE})(?:\s+({_DATE}))?\s*(.*)$", line)
        if leg:
            loc, eta, etd, rest = leg.groups()
        else:
            mode = re.match(r"^([A-Z][A-Z .'-]*?)\s+((?:Barge|Rail|Road|Truck)\S*.*)$", line, re.IGNORECASE)
            if not mode:
                continue
            (loc, rest), eta, etd = mode.groups(), "", ""
        row = {"location": loc, "eta": eta, "etd": etd or "", "vessel": "", "voyage": "", "service": "", "terminal": ""}
        tokens = rest.split()
        if tokens and _MODES.match(tokens[0]):
            row["vessel"], row["terminal"] = tokens[0], " ".join(tokens[1:])
        else:
            i = next((k for k, t in enumerate(tokens) if k and _VOYAGE.match(t)), None)
            if i is not None:
                row["vessel"], row["voyage"] = " ".join(tokens[:i]), tokens[i]
                row["service"] = tokens[i + 1] if i + 1 < len(tokens) else ""
                row["terminal"] = " ".join(tokens[i + 2:])
        legs.append(row)
    if not legs:  # OCR prints the table column by column: see _route_from_ocr_columns
        return []
    # The final place has no dates or mode: it is the last line of the table
    last = [ln.strip() for ln in m.group(1).splitlines() if ln.strip()]
    if last and not re.search(_DATE, last[-1]) and (not legs or last[-1] != legs[-1]["location"]):
        if re.fullmatch(r"[A-Z][A-Z .'-]+", last[-1]):
            legs.append({"location": last[-1], "eta": "", "etd": "", "vessel": "", "voyage": "",
                         "service": "", "terminal": ""})
    return legs


def _lines_after(text: str, label: str, stop: str) -> List[str]:
    """Non-empty lines after the line matching `label`, up to the first line matching `stop`."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    start = next((i for i, ln in enumerate(lines) if re.fullmatch(label, ln, re.IGNORECASE)), None)
    if start is None:
        return []
    out = []
    for ln in lines[start + 1:]:
        if re.match(stop, ln, re.IGNORECASE):
            break
        out.append(ln)
    return out


_OCR_STOP = (r"(?:CUT-OFF\s+INFORMATION|SI\s+Cut-Off|VGM\s+Cut-Off|Port\s+Cut-Off|CARGO\s+INFORMATION|LVR|"
             r"Service|Terminal|Movement\s+Terms|HS\s+Code|Vessel\s*/\s*Mode|DEPOT\s+AND)")


def _route_from_ocr_columns(text: str) -> List[Dict[str, str]]:
    """Zips the OCR columns: locations (+ dates) / vessels / 'voyage service' pairs / terminals."""
    legs: List[Dict[str, str]] = []
    for ln in _lines_after(text, r"\(ETD\)", _OCR_STOP):
        if re.fullmatch(rf"{_DATE}", ln):
            if legs:
                legs[-1]["dates"].append(ln)
        elif re.fullmatch(r"[A-Z][A-Z .'-]+", ln):
            legs.append({"location": ln, "dates": []})
    modes = _lines_after(text, r"Transport", _OCR_STOP)
    # Every place but the final one has a vessel or transport mode
    if len(legs) < 2 or len(modes) != len(legs) - 1:
        return []
    voyages = " ".join(_lines_after(text, r"Service", _OCR_STOP)).split()
    terminals = _lines_after(text, r"Terminal", _OCR_STOP)
    route, v = [], 0
    for i, leg in enumerate(legs):
        dates = leg["dates"]
        row = {"location": leg["location"], "eta": dates[0] if dates else "",
               "etd": dates[1] if len(dates) > 1 else "", "vessel": modes[i] if i < len(modes) else "",
               "voyage": "", "service": "", "terminal": ""}
        if row["vessel"] and not _MODES.match(row["vessel"]):
            row["voyage"], row["service"] = (voyages[v:v + 2] + ["", ""])[:2]
            # Wrapped terminal names break the column count: only the first vessel leg's is trusted
            row["terminal"] = terminals[0] if v == 0 and terminals else ""
            v += 2
        route.append(row)
    return route


_CUT_OFF_COLUMNS = ("SI", "VGM", "PORT")  # printed order of the CUT-OFF INFORMATION columns


def _port_cut_off(text: str) -> str:
    """'SI Cut-Off VGM Cut-Off Port Cut-Off' / '19-OCT-2026 11:59 19-OCT-2026 11:59 20-OCT-2026 21:21'."""
    m = re.search(r"^(.*\bPort\s+Cut-Off.*)\n(.*)$", text, re.IGNORECASE | re.MULTILINE)
    if m:
        labels = [lab.upper() for lab in re.findall(r"(\w+)\s+Cut-Off", m.group(1), re.IGNORECASE)]
        dates = re.findall(rf"{_DATE}(?:\s+\d{{1,2}}:\d{{2}})?", m.group(2))
        if "PORT" in labels and len(dates) == len(labels):
            return dates[labels.index("PORT")]
    # OCR shuffles the labels away from their dates: the dates keep the printed column order
    section = re.search(r"CUT-OFF\s+INFORMATION(.*?)(?:CARGO\s+INFORMATION|$)", text, re.IGNORECASE | re.DOTALL)
    dates = re.findall(rf"{_DATE}\s+\d{{1,2}}:\d{{2}}", section.group(1)) if section else []
    return dates[_CUT_OFF_COLUMNS.index("PORT")] if len(dates) == len(_CUT_OFF_COLUMNS) else ""


def _equipment(text: str):
    """'1 x 40'HC' rows of every CARGO INFORMATION block -> ("40'HC", '1'), or a combined list and total."""
    items = [(re.sub(r"\s+", "", size).replace("’", "'"), qty) for qty, size in _EQ_ITEM.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "CMA CGM"}

    m = re.search(r"Booking\s+(?:Number|Ref\.?|reference)\s*:?\s*([A-Z]{2,4}\d{6,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1)

    route = _route_from_words(pages_words) or _route_from_text(text) or _route_from_ocr_columns(text)
    vessel_legs = [r for r in route if r["vessel"] and not _MODES.match(r["vessel"])]
    if vessel_legs:
        first = vessel_legs[0]
        vessel = f"{first['vessel']} {first['voyage']}".strip()
        out["Vessel"], out["ETD"] = vessel, first["etd"]
        out["Full return CY"] = first["terminal"]
        if len(vessel_legs) > 1:
            second = vessel_legs[1]
            out["T/S Port"] = second["location"]
            out["Pre Carrier"], out["ETD_Pre"] = vessel, first["etd"]
            out["Trunk Vessel"] = f"{second['vessel']} {second['voyage']}".strip()
            out["ETD_Trunk"] = second["etd"]
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = vessel, first["etd"]
    if route:
        out["Port of Discharging"] = out["Place of Delivery"] = route[-1]["location"]

    out["Equipment Type"], out["Q'ty"] = _equipment(text)

    m = re.search(r"Empty\s+Pickup\s+Location\s*:[ \t]*(.*?)(?:\s+Eqp\s+Available|$)", text, re.IGNORECASE | re.MULTILINE)
    if m:
        out["Empty Pick Up CY"] = m.group(1).strip()
    out["Port Cargo Cut-off"] = _port_cut_off(text)

    return {k: v for k, v in out.items() if v}
