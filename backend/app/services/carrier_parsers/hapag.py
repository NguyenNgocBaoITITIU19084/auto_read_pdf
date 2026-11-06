"""
Hapag-Lloyd booking confirmations. Key data sits in tables, so it is read from word boxes:

    Export empty pick up depot(s)        Export terminal delivery address
    ANSON ICD                            ICD TANAMEXCO

    From             To                By               ETD          ETA
    HO CHI MINH CITY VUNG TAU          Inland Waterway
    VUNG TAU         TANJUNG PELEPAS   Vessel           02-Oct-2026  04-Oct-2026
    CMIT CAI MEP     PTP/PELABUHAN     ULSAN EXPRESS    15:00        22:00
                                       Voy. No: 639E
    ...

Rules: legs not carried by 'Vessel' (inland waterway, barge, truck, rail) are skipped. The first
vessel leg gives Vessel/ETD; its 'To' is the T/S port when another vessel leg follows; the last
vessel leg's 'To' is the port of discharge. Hapag bookings carry no CY cut-off.

Newer layout ('Booking Confirmation (Update)' with 'Booking Number:' instead of 'Our Reference:'):
each leg is a stacked block in From / To / Vessel columns, and a leg with an empty Vessel cell is
an inland leg (truck, barge, rail):

    From                  To                      Vessel
    12-NOV-2026 11:00     18-DEC-2026 18:00       WAN HAI A08
    VNVUT VUNG TAU        USORF NORFOLK, VA       DP Voyage: 207162
                                                  Voy. No: E018
    TAN CANG CAI MEP INT  NORFOLK INTL TERM'L     Service: AA7

The Deadline table gives the CY cut-off as 'FCL delivery date <LOCODE> <date> <time>'.
Place of Delivery is the 'To' of the last leg of any mode (e.g. an inland US ramp).
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import Row, find_phrase, first_line_below, group_rows, in_columns, row_text, row_top

HAPAG_ISSUER = re.compile(r"HAPAG[-\s]?LLOYD", re.IGNORECASE)
OUR_REFERENCE = re.compile(r"Our\s+Reference:\s*(\d+)", re.IGNORECASE)

_TIME = re.compile(r"^\d{1,2}:\d{2}$")
_MODE_WORDS = ("VESSEL", "INLAND", "BARGE", "TRUCK", "RAIL", "FEEDER")
_LEG_MAX_GAP = 15.0  # a leg's rows are ~10pt apart; a bigger gap ends the routing table


BOOKING_NUMBER = re.compile(r"Booking\s+Number:\s*(\d{8,})", re.IGNORECASE)
_DATE_DMY = re.compile(r"^\d{1,2}-[A-Za-z]{3}-\d{4}$")
_LOCODE = re.compile(r"^[A-Z]{5}$")


def _is_new_layout(text: str) -> bool:
    return not OUR_REFERENCE.search(text) and bool(BOOKING_NUMBER.search(text))


def matches(text: str) -> bool:
    return bool(HAPAG_ISSUER.search(text) and (OUR_REFERENCE.search(text) or BOOKING_NUMBER.search(text)))


def _depots(rows: Sequence[Row]):
    empty_hdr = find_phrase(rows, "Export empty pick up")
    term_hdr = find_phrase(rows, "Export terminal delivery")
    if not (empty_hdr and term_hdr) or term_hdr["x0"] <= empty_hdr["x0"]:
        return "", ""
    split_x = term_hdr["x0"] - 5
    return (first_line_below(rows, empty_hdr["top"], empty_hdr["x0"] - 5, split_x),
            first_line_below(rows, term_hdr["top"], split_x))


def _routing_legs(rows: Sequence[Row]) -> List[Dict[str, str]]:
    header = None
    for row in rows:
        texts = [w["text"] for w in row]
        if all(h in texts for h in ("From", "To", "By", "ETD", "ETA")):
            header = {w["text"]: w["x0"] - 3 for w in row}
            header_top = row_top(row)
            break
    if not header:
        return []
    to_col = (header["To"], header["By"])
    by_col = (header["By"], header["ETD"])
    etd_col = (header["ETD"], header["ETA"])

    body = [r for r in rows if row_top(r) > header_top + 3]
    # Each leg starts at a row whose 'By' cell begins with a transport mode
    starts = [i for i, r in enumerate(body)
              if (cell := in_columns(r, *by_col)) and cell[0]["text"].upper() in _MODE_WORDS]

    legs = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(body)
        leg_rows = [body[start]]
        for r in body[start + 1:end]:
            if row_top(r) - row_top(leg_rows[-1]) > _LEG_MAX_GAP:
                break
            leg_rows.append(r)

        by_lines = [row_text(in_columns(r, *by_col)) for r in leg_rows]
        etd_lines = [row_text(in_columns(r, *etd_col)) for r in leg_rows]
        mode = by_lines[0]
        name = by_lines[1] if len(by_lines) > 1 else ""
        voyage = next((re.sub(r"^Voy\.\s*No:\s*", "", ln) for ln in by_lines if ln.startswith("Voy.")), "")
        etd = etd_lines[0]
        if len(etd_lines) > 1 and _TIME.match(etd_lines[1]):
            etd = f"{etd} {etd_lines[1]}"
        legs.append({
            "mode": mode,
            "to": row_text(in_columns(leg_rows[0], *to_col)),
            "vessel": " ".join(p for p in (name, voyage) if p),
            "etd": etd,
        })
    return legs


def _place(cell: str) -> str:
    """'USORF NORFOLK, VA' -> 'NORFOLK, VA' (drops the leading UN/LOCODE)."""
    parts = cell.split(" ", 1)
    return parts[1].strip() if len(parts) == 2 and _LOCODE.match(parts[0]) else cell.strip()


def _new_legs(rows: Sequence[Row]) -> List[Dict[str, str]]:
    header = next((r for r in rows if [w["text"] for w in r] == ["From", "To", "Vessel"]), None)
    if not header:
        return []
    to_x, vessel_x = header[1]["x0"] - 3, header[2]["x0"] - 3
    right_x = vessel_x + 3 + 110  # right panel column (Equipment(s), From:, To:, Export:)
    body = [r for r in rows if row_top(r) > row_top(header) + 3]

    starts = [i for i, r in enumerate(body) if r[0]["x0"] < to_x and _DATE_DMY.match(r[0]["text"])]
    legs = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(body)
        block = body[start:end]
        first = block[0]
        etd = row_text(in_columns(first, 0, to_x))
        vessel_lines = [row_text(in_columns(r, vessel_x, right_x)) for r in block]
        name = vessel_lines[0]
        voyage = next((re.sub(r"^Voy\.\s*No:\s*", "", ln) for ln in vessel_lines if ln.startswith("Voy.")), "")
        # The row under the dates holds '<LOCODE> <city>' in each column
        place_row = next((r for r in block[1:] if in_columns(r, to_x, vessel_x)), [])
        legs.append({
            "vessel": " ".join(p for p in (name, voyage) if p) if name else "",
            "etd": etd,
            "to": _place(row_text(in_columns(place_row, to_x, vessel_x))),
        })
    return legs


def _new_depots(rows: Sequence[Row]):
    empty_hdr = find_phrase(rows, "Export empty pick up")
    term_hdr = find_phrase(rows, "Export terminal delivery")
    if not (empty_hdr and term_hdr) or term_hdr["x0"] <= empty_hdr["x0"]:
        return "", ""
    split_x = term_hdr["x0"] - 5
    # The right panel ('Import:', 'HL Booking Contact:') shares these rows
    right = next((w["x0"] for r in rows for w in r if w["text"] in ("Import:", "HL")
                  and w["x0"] > term_hdr["x0"] + 100), float("inf"))
    return (first_line_below(rows, empty_hdr["top"], empty_hdr["x0"] - 5, split_x),
            first_line_below(rows, term_hdr["top"], split_x, right - 5))


def _parse_new(text: str, pages_words) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "HAPAG-LLOYD"}
    m = BOOKING_NUMBER.search(text)
    if m:
        out["Booking No"] = m.group(1)

    m = re.search(r"\b(\d+)\s*x\s*(\d{2}[A-Z]{2}\d?)\b", text)
    if m:
        out["Q'ty"], out["Equipment Type"] = m.group(1), m.group(2)

    m = re.search(r"FCL\s+delivery\s+date\s+[A-Z]{5}\s+(\d{1,2}-[A-Za-z]{3}-\d{4}(?:\s+\d{1,2}:\d{2})?)", text)
    if m:
        out["Port Cargo Cut-off"] = m.group(1)

    for words in pages_words or []:
        rows = group_rows(words)
        empty, full = _new_depots(rows)
        if empty or full:
            out["Empty Pick Up CY"], out["Full return CY"] = empty, full
        legs = _new_legs(rows)
        vessel_legs = [leg for leg in legs if leg["vessel"]]
        if not vessel_legs:
            continue
        first, last = vessel_legs[0], vessel_legs[-1]
        out["Vessel"], out["ETD"] = first["vessel"], first["etd"]
        out["Port of Discharging"] = last["to"]
        out["Place of Delivery"] = legs[-1]["to"] or last["to"]
        if len(vessel_legs) > 1:
            out["T/S Port"] = first["to"]
            out["Pre Carrier"], out["ETD_Pre"] = first["vessel"], first["etd"]
            out["Trunk Vessel"], out["ETD_Trunk"] = vessel_legs[1]["vessel"], vessel_legs[1]["etd"]
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = first["vessel"], first["etd"]
        break

    return {k: v for k, v in out.items() if v}


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    if _is_new_layout(text):
        return _parse_new(text, pages_words)
    out: Dict[str, str] = {"Carrier": "HAPAG-LLOYD"}

    m = OUR_REFERENCE.search(text)
    if m:
        out["Booking No"] = m.group(1)

    m = re.search(r"Summary:\s*(\d+)\s*x\s*([A-Z0-9]+)", text, re.IGNORECASE)
    if m:
        out["Q'ty"], out["Equipment Type"] = m.group(1), m.group(2)

    # Container table row, e.g. '1 45GP N 26-Sep-2026 ANSON ICD' (text-only fallback for the depot)
    m = re.search(r"^\d+\s+[0-9]{2}[A-Z0-9]{2}\s+[YN]\s+\d{1,2}-[A-Za-z]{3}-\d{4}(?:\s+\d{1,2}:\d{2})?\s+(.+)$",
                  text, re.MULTILINE)
    if m:
        out["Empty Pick Up CY"] = m.group(1).strip()

    for words in pages_words or []:
        rows = group_rows(words)
        empty, full = _depots(rows)
        if empty or full:
            out["Empty Pick Up CY"] = empty or out.get("Empty Pick Up CY", "")
            out["Full return CY"] = full
        vessel_legs = [leg for leg in _routing_legs(rows) if leg["mode"].upper() == "VESSEL"]
        if not vessel_legs:
            continue
        first, last = vessel_legs[0], vessel_legs[-1]
        out["Vessel"], out["ETD"] = first["vessel"], first["etd"]
        out["Port of Discharging"] = out["Place of Delivery"] = last["to"]
        if len(vessel_legs) > 1:
            out["T/S Port"] = first["to"]
            out["Pre Carrier"], out["ETD_Pre"] = first["vessel"], first["etd"]
            out["Trunk Vessel"], out["ETD_Trunk"] = vessel_legs[1]["vessel"], vessel_legs[1]["etd"]
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = first["vessel"], first["etd"]
        break

    return {k: v for k, v in out.items() if v}
