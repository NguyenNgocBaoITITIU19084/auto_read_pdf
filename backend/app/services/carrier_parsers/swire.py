"""
Swire Shipping 'BOOKING CONFIRMATION' (issued by its Vietnam agent, Ben Line), a grid of bilingual
labels with the values below them; labels and values wrap onto further rows:

    TÊN TÀU (FEEDER VESSEL NAME):  CHUYẾN (VOY. NO.):  S/I CUT-OFF/VGM CUT-OFF:  NGÀY TÀU CHẠY (ETD):
    SAN PEDRO                      114S                24 HRS BEFORE CY CUT      17.09.2026
    TÀU NỐI DỰ KIẾN (INTENDED M/V): CHUYẾN (VOY. NO.): ETA T/S PORT:            ETA POD:
    CARPENTERS ORION               2643S              28.09.2026               15.10.2026
    ... CẢNG CHUYỂN TẢI   CẢNG DỠ KẾ TIẾP (NEXT   NƠI GIAO HÀNG (PLD):
        (POT):            POD):
        PORT KLANG,       LAE                     LAE
        MALAYSIA

A label's cell runs from its first word to the next label starting on the same row; its value is
the words inside that column on the following rows, up to the next row of labels. Rows ending a
wrapped label ('(POT):', '-IN):') carry a colon and are skipped. The feeder vessel leaves Vietnam;
the intended mother vessel is the trunk vessel and the POT the transshipment port. No block code.
Offline OCR prints each label with its value on the following line(s) but garbles the Vietnamese
diacritics ('CĂNG CHUYỂN TÀI'), so there labels are found by their English part ('(POT)', '(ETD)')
and a run of two labels ('START DATE...' / 'CY CUT-OFF') is resolved by the value's shape.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import group_rows, row_text, row_top

ISSUER = re.compile(r"\bSWIRE\s+SHIPPING\b", re.IGNORECASE)

# First words of every label of the grid, to find where each cell starts
_LABEL_STARTS = (
    "KHÁCH HÀNG", "SỐ LƯỢNG,", "CONT CỦA", "PIC", "YÊU CẦU", "AGREEMENT PARTY", "CONTRACT NO.", "MẶT HÀNG",
    "TRỌNG LƯỢNG", "BÃI CẤP", "NƠI ĐÓNG", "NGÀY CẤP", "NƠI HẠ", "NGÀY BẮT", "CY CUT-OFF", "TÊN TÀU", "CHUYẾN",
    "S/I CUT-OFF/VGM", "NGÀY TÀU", "TÀU NỐI", "ETA T/S", "ETA POD:", "NƠI NHẬN", "CẢNG XẾP", "CẢNG CHUYỂN",
    "CẢNG DỠ", "NƠI GIAO", "CƯỚC", "NGÀY GỬI", "GHI CHÚ",
)
_EQ = re.compile(r"(\d+)\s*X\s*(\d{2})\s*['’]?\s*([A-Z]{2})\b", re.IGNORECASE)
_KINDS = {"GP": "GP", "DC": "GP", "DV": "GP", "HC": "HC", "HQ": "HC", "RF": "RF", "RH": "RH", "OT": "OT",
          "FR": "FR", "TK": "TK"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"BKG\s+NO\.?\s*:", text, re.IGNORECASE)
                and re.search(r"FEEDER\s+VESSEL\s+NAME", text, re.IGNORECASE))


def _label_starts(row) -> List[int]:
    """Indexes of the words of `row` that start a label."""
    texts = [w["text"].upper() for w in row]
    starts = []
    for i in range(len(texts)):
        for label in _LABEL_STARTS:
            tokens = label.split()
            if texts[i:i + len(tokens)] == tokens and (i == 0 or texts[i - 1].endswith(":") or texts[i - 1].endswith(")")
                                                       or row[i]["x0"] - row[i - 1]["x1"] > 5):
                starts.append(i)
                break
    return starts


def _cells(pages_words) -> List[Dict]:
    """[{'label': 'TÊN TÀU (FEEDER VESSEL NAME):', 'value': 'SAN PEDRO'}, ...] in reading order."""
    cells = []
    for words in pages_words or ():
        rows = group_rows(words)
        label_rows = [i for i, r in enumerate(rows) if _label_starts(r)]
        for n, i in enumerate(label_rows):
            row = rows[i]
            starts = _label_starts(row)
            stop = label_rows[n + 1] if n + 1 < len(label_rows) else len(rows)
            # Value rows: up to the next label row, skipping wrapped label endings ('(POT):')
            below = [r for r in rows[i + 1:stop] if not any(w["text"].endswith(":") for w in r)
                     and row_top(r) - row_top(row) < 60]
            for k, s in enumerate(starts):
                x_from = row[s]["x0"] - 3
                x_to = row[starts[k + 1]]["x0"] - 3 if k + 1 < len(starts) else float("inf")
                end = starts[k + 1] if k + 1 < len(starts) else len(row)
                value = " ".join(row_text([w for w in r if x_from <= w["x0"] < x_to]) for r in below)
                cells.append({"label": row_text(row[s:end]).upper(), "value": re.sub(r"\s+", " ", value).strip()})
    return cells


def _cell(cells: List[Dict], key: str, after: str = "") -> str:
    """Value of the first cell whose label contains `key` (after the cell labelled `after`, if given)."""
    start = 0
    if after:
        start = next((i + 1 for i, c in enumerate(cells) if after in c["label"]), len(cells))
    return next((c["value"] for c in cells[start:] if key in c["label"]), "")


# English parts of the labels, to tell a label line from a value line in OCR text
_OCR_LABEL = re.compile(
    r"\((?:SHIPPER|CONTAINER|SPECIAL|EMPTY|STUFFING|PICK-UP|GATE-IN|START|FEEDER|VOY\.|INTENDED|ETD|POR|POL|POT|"
    r"NEXT|PLD|FREIGHT|BOOKING|REMARKS|SỐ|BÊN|COMMODITY|CARGO)|CUT-OFF|ETA\s+(?:T/S|POD)|:\s*$|^\S*\):$",
    re.IGNORECASE)
_DATE = r"\d{1,2}\.\d{1,2}\.\d{4}"


def _ocr_value(text: str, key: str, after: str = "", shape: str = "") -> str:
    """Value lines after the label line holding `key` (after the line holding `after`, if given)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    start = 0
    if after:
        start = next((i + 1 for i, ln in enumerate(lines) if after.upper() in ln.upper()), len(lines))
    i = next((i for i in range(start, len(lines)) if key.upper() in lines[i].upper()), None)
    if i is None:
        return ""
    values = []
    for ln in lines[i + 1:i + 8]:
        if re.fullmatch(r"\S*\):|\([^()]*\):", ln):
            continue  # the wrapped end of a label: '(POT):', '-IN):', '(CONTAINER OWNER):'
        if _OCR_LABEL.search(ln):
            if values or not shape:
                break  # the next label: an empty value ends here
            continue  # a run of labels ('START DATE...' / 'CY CUT-OFF'): the value is found by its shape
        if shape and not re.fullmatch(shape, ln):
            continue
        values.append(ln)
        if shape:
            break
    return " ".join(values)


def _equipment(value: str):
    """'1 X 40'HC (F )' -> ("40'HC", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(value)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "SWIRE SHIPPING"}

    m = re.search(r"BKG\s+NO\.?\s*:\s*([A-Z0-9]{6,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1)

    cells = _cells(pages_words)
    feeder = " ".join(v for v in (_cell(cells, "FEEDER VESSEL"), _cell(cells, "VOY. NO.", "FEEDER VESSEL")) if v)
    mother = " ".join(v for v in (_cell(cells, "INTENDED M/V"), _cell(cells, "VOY. NO.", "INTENDED M/V")) if v)
    etd = _cell(cells, "(ETD)")
    out["Vessel"], out["ETD"] = feeder, etd
    out["T/S Port"] = _cell(cells, "CẢNG CHUYỂN TẢI")
    if mother:
        out["Pre Carrier"], out["ETD_Pre"] = feeder, etd
        out["Trunk Vessel"] = mother
    else:
        out["Trunk Vessel"], out["ETD_Trunk"] = feeder, etd

    out["Port of Discharging"] = _cell(cells, "CẢNG DỠ")
    out["Place of Delivery"] = _cell(cells, "NƠI GIAO HÀNG")

    out["Equipment Type"], out["Q'ty"] = _equipment(_cell(cells, "CONTAINER TYPE") or text)

    out["Empty Pick Up CY"] = _cell(cells, "EMPTY CONT. DEPOT")
    out["Full return CY"] = _cell(cells, "GATE-IN TERMINAL")
    out["Port Cargo Cut-off"] = _cell(cells, "CY CUT-OFF")

    if not cells:  # offline OCR
        feeder = " ".join(v for v in (_ocr_value(text, "(FEEDER"), _ocr_value(text, "(VOY.", "(FEEDER")) if v)
        mother = " ".join(v for v in (_ocr_value(text, "(INTENDED"), _ocr_value(text, "(VOY.", "(INTENDED")) if v)
        etd = _ocr_value(text, "(ETD)", shape=_DATE)
        out["Vessel"], out["ETD"] = feeder, etd
        out["T/S Port"] = _ocr_value(text, "(POT)")
        if mother:
            out["Pre Carrier"], out["ETD_Pre"] = feeder, etd
            out["Trunk Vessel"], out["ETD_Trunk"] = mother, ""
        else:
            out["Trunk Vessel"], out["ETD_Trunk"] = feeder, etd
        out["Port of Discharging"] = _ocr_value(text, "(NEXT")
        out["Place of Delivery"] = _ocr_value(text, "(PLD)")
        out["Empty Pick Up CY"] = _ocr_value(text, "(EMPTY CONT. DEPOT)")
        out["Full return CY"] = _ocr_value(text, "(GATE-IN TERMINAL)")
        out["Port Cargo Cut-off"] = _ocr_value(text, "CY CUT-OFF (", shape=rf"{_DATE}\s+\d{{1,2}}:\d{{2}}")

    return {k: v for k, v in out.items() if v}
