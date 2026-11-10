"""
Sinolines 'SINOLINES BOOKING INFORMATION' (SINOTRANS CONTAINER LINES (VIETNAM) CO., LTD). Two header
lines, then a grid of three columns: a row of labels, their values on the row(s) below:

    Booking / Bill No. SNLGHMCL012371 Date of issue 2026-10-13
    Intended Vessel/Voy No. HONG AN 2626N
    Port of Loading:      Port of Discharge:    Port of Delivery:
    HOCHIMINH             SHANGHAI              SHANGHAI
    Container Information: Payment:             ETD:
    20 GP × 1             FREIGHT PREPAID       2026-11-07
    Cut off CDS/CY:       Cut off SI,VGM:       Deadline of Amendment:
    2026-11-06 08:00      2026-11-05 10:00      2026-11-06 15:00

Grid values are cut by the label columns (word boxes); without them (offline OCR) a value is read after
its label, or from the row below when that row splits into one token per label. The CY cut-off is
'Cut off CDS/CY' (not SI/VGM or the amendment deadline). The notice prints no T/S port, block, empty
pick-up depot or return CY: empty releases are requested by email and drop-off follows ePort.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import group_rows, row_top

ISSUER = re.compile(r"\bSINOLINES\b|\bSINOTRANS\s+CONTAINER\s+LINES?\b", re.IGNORECASE)

_DATE = r"(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)"
# The grid's labels, as printed (the trailing ':' is part of the last token)
_GRID_LABELS = (
    ("Customer", "Order", "No.:"), ("Delivery", "Status:"), ("Booking", "Party:"),
    ("Port", "of", "Loading:"), ("Port", "of", "Discharge:"), ("Port", "of", "Delivery:"),
    ("Container", "Information:"), ("Payment:",), ("ETD:",),
    ("Cut", "off", "CDS/CY:"), ("Cut", "off", "SI,VGM:"), ("Deadline", "of", "Amendment:"),
    ("Cargo", "Information:"), ("Remark:",),
)
_ANY_LABEL = re.compile(r"(?:" + "|".join(r"\s+".join(re.escape(t) for t in lab) for lab in _GRID_LABELS) + r")",
                        re.IGNORECASE)
# '20 GP × 1' / '40 HQ x 2' -> size, kind, qty
_EQ = re.compile(r"\b(\d{2})\s*'?\s*(GP|DC|DV|HC|HQ|RF|RH|OT|FR|TK)\s*[×xX*]\s*(\d+)\b", re.IGNORECASE)
_KINDS = {"DC": "GP", "DV": "GP", "HQ": "HC"}


def matches(text: str) -> bool:
    return bool(ISSUER.search(text) and re.search(r"\bIntended\s+Vessel\s*/\s*Voy\b", text, re.IGNORECASE))


def _label_positions(rows) -> List[tuple]:
    """(row index, label tokens, x0) of every grid label found."""
    found = []
    for i, row in enumerate(rows):
        texts = [w["text"].lower() for w in row]
        for label in _GRID_LABELS:
            toks = [t.lower() for t in label]
            for k in range(len(texts) - len(toks) + 1):
                if texts[k:k + len(toks)] == toks:
                    found.append((i, label, row[k]["x0"]))
    return found


def _grid_from_words(pages_words, label: tuple) -> str:
    """Words under `label`, in its column, down to the next row of labels (values may wrap)."""
    for words in pages_words or ():
        rows = group_rows(words)
        labels = _label_positions(rows)
        label_rows = sorted({i for i, _, _ in labels})
        for i, lab, x0 in labels:
            if lab != label:
                continue
            # Column: from this label's left edge to the next label's on the same row
            right = min((x for j, _, x in labels if j == i and x > x0), default=float("inf"))
            stop = next((j for j in label_rows if j > i), len(rows))
            if stop - i > 4:  # the last row of labels: values are the next two rows at most
                stop = i + 3
            parts = [w["text"] for row in rows[i + 1:stop] for w in row if x0 - 4 <= w["x0"] < right - 4
                     and row_top(row) - row_top(rows[i]) < 60]
            return " ".join(parts).strip()
    return ""


def _grid_from_text(text: str, label: tuple) -> str:
    """OCR: the value after the label on its line, or the label's token on the line below a row of labels."""
    rx = r"\s+".join(re.escape(t) for t in label)
    for m in re.finditer(rx, text, re.IGNORECASE):
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.end())
        line_end = len(text) if line_end < 0 else line_end
        line = text[line_start:line_end]
        after = text[m.end():line_end]
        nxt = _ANY_LABEL.search(after)
        same = (after[:nxt.start()] if nxt else after).strip()
        if same:
            return same
        labels_on_line = [lm for lm in _ANY_LABEL.finditer(line)]
        below = next((ln.strip() for ln in text[line_end:].splitlines() if ln.strip()), "")
        if not below or _ANY_LABEL.match(below):
            return ""
        if len(labels_on_line) == 1:
            return below
        tokens = below.split()
        if len(tokens) == len(labels_on_line):
            idx = next(n for n, lm in enumerate(labels_on_line) if lm.start() == m.start() - line_start)
            return tokens[idx]
        return ""
    return ""


def _grid(pages_words, text: str, label: tuple) -> str:
    return _grid_from_words(pages_words, label) or _grid_from_text(text, label)


def _equipment(text: str):
    """'20 GP × 1' -> ("20'GP", '1'); several types -> combined list and total."""
    items = [(f"{size}'{_KINDS.get(kind.upper(), kind.upper())}", qty) for size, kind, qty in _EQ.findall(text)]
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def _first_date(value: str) -> str:
    m = re.search(_DATE, value or "")
    return re.sub(r"\s+", " ", m.group(1)) if m else ""


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    out: Dict[str, str] = {"Carrier": "SINOLINES"}

    m = re.search(r"Booking\s*/\s*Bill\s+No\.?\s*:?\s*([A-Z0-9]{8,})", text, re.IGNORECASE)
    if m:
        out["Booking No"] = m.group(1).upper()

    m = re.search(r"Intended\s+Vessel\s*/\s*Voy\.?\s*No\.?\s*:?[ \t]*([^\n]*)", text, re.IGNORECASE)
    vessel = re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
    etd = _first_date(_grid(pages_words, text, ("ETD:",)))
    if not etd:  # OCR: the ETD may land after other cells of its row
        m = re.search(r"\bETD\s*:[\s\S]{0,80}?" + _DATE, text, re.IGNORECASE)
        etd = re.sub(r"\s+", " ", m.group(1)) if m else ""
    if vessel:
        out["Vessel"] = out["Trunk Vessel"] = vessel
    if etd:
        out["ETD"] = out["ETD_Trunk"] = etd

    out["Port of Discharging"] = _grid(pages_words, text, ("Port", "of", "Discharge:"))
    out["Place of Delivery"] = _grid(pages_words, text, ("Port", "of", "Delivery:")) or out["Port of Discharging"]

    out["Equipment Type"], out["Q'ty"] = _equipment(_grid(pages_words, text, ("Container", "Information:")) or text)

    cutoff = _first_date(_grid(pages_words, text, ("Cut", "off", "CDS/CY:")))
    if not cutoff:
        m = re.search(r"Cut\s+off\s+CDS\s*/\s*CY\s*:[\s\S]{0,120}?" + _DATE, text, re.IGNORECASE)
        cutoff = re.sub(r"\s+", " ", m.group(1)) if m else ""
    out["Port Cargo Cut-off"] = cutoff

    return {k: v for k, v in out.items() if v}
