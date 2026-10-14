"""
SITC 'LỆNH GIAO CONTAINER RỖNG' (empty release order, New SITC Container Lines Vietnam), a form of
two label / value column pairs whose long values wrap onto lines above and below their label:

    B/L No:SITSGMNG531139
    NƠI CẤP RỖNG: TAN VAN SMART DEPOT
                                                                      MANILA NORTH
    Số lượng, loại container(Total   1 X 40HC   Cảng đích(DLY):
    Volume):                                                          HARBOUR
    Mặt hàng(Commodity):  ...                   Cảng chuyển tải (POD): MANILA NORTH HARBOUR
    Dự kiến xếp lên tàu(Vessel): PADIAN 3       tại kho riêng (Drop-off WH): √
    Chuyến(Voy): 2637N                          Nơi hạ bãi(Drop-off Place): CAT LAI
    Ngày tàu chạy (ETD): 25/10/2026             SI & VGM cut off time: 22/10/2026 11:00
    Terminal Xuất ( Export Terminal ) : PHUOC AN PORT
    Closing time: 2026-10-23 06:00:00

Despite its label, 'Cảng chuyển tải (POD)' is the port of discharge and 'Cảng đích(DLY)' the place
of delivery; the form has no transshipment port or block. The vessel is 'Vessel' + 'Voy'
('PADIAN 3 2637N'), '1 X 40HC' is 1 x 40'HC, the laden return is the drop-off place and the
CY cut-off is 'Closing time'.

In the word boxes each value word goes to the nearest label (by height) of its column pair. The
text layer interleaves the wrapped port lines with the left column, so without word boxes the
ports are only read from offline OCR, where both ports follow the commodity as 'NAME' / 'NAME'.
"""
import re
import unicodedata
from typing import Dict, List, Optional, Sequence

from .layout import find_phrase, group_rows, row_text

ISSUER = re.compile(r"\bSITC\b")

_DATE = r"(\d{1,2}/\d{1,2}/\d{4})"
# '1 X 40HC' -> qty, size, kind
_EQ = re.compile(r"\b(\d+)\s*X\s*(\d{2})'?\s*(HC|HQ|GP|DC|DV|RF|RH|HR|OT|FR|TK)\b", re.IGNORECASE)
_KINDS = {"HQ": "HC", "DC": "GP", "DV": "GP", "HR": "RH"}

# (field, label phrase as printed in the word boxes) for the left and right column pairs
_LEFT = (("Shipper", "Kính gửi(Shipper):"), ("Qty", "Số lượng, loại"), ("Commodity", "Mặt hàng(Commodity):"),
         ("Temp", "Nhiệt độ"), ("Vessel", "tàu(Vessel):"), ("Voy", "Chuyến(Voy):"), ("ETD", "chạy (ETD):"))
_RIGHT = (("DLY", "Cảng đích(DLY):"), ("POD", "chuyển tải (POD):"), ("Vent", "Thông gió(Vent):"),
          ("CY", "(Drop-off CY):"), ("WH", "(Drop-off WH):"), ("Drop-off", "bãi(Drop-off Place):"),
          ("SI", "SI & VGM"))


def matches(text: str) -> bool:
    text = unicodedata.normalize("NFC", text)
    return bool(ISSUER.search(text) and re.search(r"LỆNH\s+GIAO\s+CONTAINER\s+RỖNG", text, re.IGNORECASE)
                and re.search(r"B/L\s*No\s*:", text))


def _cells(pages_words) -> Dict[str, str]:
    """{field: value} from the word boxes: value words go to the nearest label of their column."""
    out: Dict[str, str] = {}
    for words in pages_words or ():
        words = [dict(w, text=unicodedata.normalize("NFC", w["text"])) for w in words]
        rows = group_rows(words)
        sides = []
        for labels in (_LEFT, _RIGHT):
            heads = [(field, find_phrase(rows, label)) for field, label in labels]
            sides.append([(field, w) for field, w in heads if w])
        if min(len(h) for h in sides) < 3:
            continue
        right_x = min(w["x0"] for _, w in sides[1])
        for heads, x_to in ((sides[0], right_x - 3), (sides[1], float("inf"))):
            label_x = min(w["x0"] for _, w in heads)
            # The value column: the most common left edge of the words right of the labels on their rows
            edges = [round(v["x0"] / 10) * 10 for _, w in heads for v in words
                     if abs(v["top"] - w["top"]) <= 3 and label_x + 60 < v["x0"] < x_to
                     and not v["text"].endswith(":")]
            if not edges:
                continue
            value_x = max(set(edges), key=edges.count) - 5
            top, bottom = min(w["top"] for _, w in heads) - 12, max(w["top"] for _, w in heads) + 12
            picked: Dict[str, List[Dict]] = {}
            for v in words:
                if not (value_x - 3 <= v["x0"] < x_to and top <= v["top"] <= bottom):
                    continue
                field, w = min(heads, key=lambda h: abs(h[1]["top"] - v["top"]))
                if abs(w["top"] - v["top"]) <= 12 and w["x0"] >= label_x - 3:
                    picked.setdefault(field, []).append(v)
            for field, ws in picked.items():
                out.setdefault(field, row_text(sorted(ws, key=lambda w: (round(w["top"]), w["x0"]))))
        if out:
            return out
    return out


def _value(text: str, label: str, stop: str = "$") -> str:
    """Value after 'label:' on its line, else (OCR) on the next line when that is not a label."""
    m = re.search(rf"{label}\s*:[ \t]*(.*?)[ \t]*(?:{stop})", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    if m.group(1).strip():
        return m.group(1).strip()
    nxt = text[m.end():].lstrip("\n").split("\n", 1)[0].strip()
    return "" if ":" in nxt else nxt


def _ocr_ports(text: str):
    """OCR: after the commodity, the two ports come out as 'MANILA NORTH' / 'HARBOUR' twice (DLY, POD)."""
    m = re.search(r"\(POD\)\s*:\s*\n((?:[^:\n]*\n)+?)\s*Nhiệt", text)
    if not m:
        return "", ""
    lines = [ln.strip() for ln in m.group(1).splitlines() if ln.strip()]
    for k in range(len(lines) // 2, 0, -1):
        if lines[-2 * k:-k] == lines[-k:]:
            port = " ".join(lines[-k:])
            return port, port
    return "", ""


def _equipment(value: str):
    """'1 X 40HC' -> ("40'HC", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for qty, size, kind in _EQ.findall(value)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    text = unicodedata.normalize("NFC", text)
    out: Dict[str, str] = {"Carrier": "SITC"}

    m = re.search(r"B/L\s*No\s*:\s*([A-Z0-9]{8,})", text)
    if m:
        out["Booking No"] = m.group(1)

    cells = _cells(pages_words)
    name = cells.get("Vessel") or _value(text, r"tàu\s*\(Vessel\)", r"\s+tại\s+kho|$")
    voyage = cells.get("Voy") or _value(text, r"Chuyến\s*\(Voy\)", r"\s+Nơi\s+hạ|$")
    vessel = f"{name} {voyage}".strip() if name else ""
    m = re.search(_DATE, cells.get("ETD") or _value(text, r"\(ETD\)", r"\s+SI\b|$"))
    etd = m.group(1) if m else ""
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd

    pod, dly = cells.get("POD", ""), cells.get("DLY", "")
    if not pod and not dly:
        dly, pod = _ocr_ports(text)
    out["Port of Discharging"], out["Place of Delivery"] = pod, dly or pod

    out["Equipment Type"], out["Q'ty"] = _equipment(cells.get("Qty") or text)

    out["Empty Pick Up CY"] = _value(text, r"NƠI\s+CẤP\s+RỖNG")
    laden = cells.get("Drop-off") or _value(text, r"\(Drop-off\s+Place\)", r"\s+Ngày\b|$")
    if not laden:  # OCR: the drop-off place comes a few lines below its label, after other labels / dates
        m = re.search(r"\(Drop-off\s+Place\)\s*:\s*\n((?:.*\n){1,6})", text)
        laden = next((ln.strip() for ln in (m.group(1).splitlines() if m else [])
                      if ln.strip() and ":" not in ln and not re.search(_DATE, ln)), "")
    out["Full return CY"] = laden

    m = re.search(r"^\s*Closing\s+time\s*:\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?|\d{1,2}/\d{1,2}/\d{4}(?:\s+\d{1,2}:\d{2})?)",
                  text, re.IGNORECASE | re.MULTILINE)
    if not m:  # OCR: the value on the next line
        m = re.search(r"^\s*Closing\s+time\s*:\s*\n\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)", text,
                      re.IGNORECASE | re.MULTILINE)
    if m:
        out["Port Cargo Cut-off"] = m.group(1)

    return {k: v for k, v in out.items() if v}
