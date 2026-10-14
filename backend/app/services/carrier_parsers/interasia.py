"""
Interasia Lines (Wan Hai group) 'BOOKING CONFIRMATION'. Bold labels come out of the text layer with
every character doubled ('BBooookk NNoo', 'PPOODD::'), so tokens are un-doubled first. Two layouts mix:

    POD: PASIR GUDANG,JOHOR, MALAYSIA          'Label: value' lines
    PLD: PASIR GUDANG,JOHOR, MALAYSIA
    Close Date: 2026-10-14 09:00
    ETD: 2026-10-15

    Book No      Booking Status  Vessel Name   Voyage            a grid: labels on one row,
    A59GX32592   Confirmed       WAN HAI 286   S115              values on the row below
    TS Port
    MYPKG
    Out Depot                    In Depot
    Phuc Xuan Tan Van Depot      CAT LAI TML
    Container Type  Container Size  Container Height  Container Volume
    SD              40              96                1

Grid cells are split by the label columns (word boxes); offline OCR prints each label with its value
on the next line, or a run of labels then their values (paired only when the counts match).
Container type SD = standard dry; height 96 = high cube. Interasia prints no block code.
"""
import re
from typing import Dict, List, Optional, Sequence

from .layout import group_rows, row_top

ISSUER = re.compile(r"\bINTER\s?ASIA\b", re.IGNORECASE)

_GRID_LABELS = ("Book No", "Booking Status", "Vessel Name", "Voyage", "TS Port", "Out Depot", "In Depot",
                "Container Type", "Container Size", "Container Height", "Container Volume", "Container Kind",
                "POL Term", "POD Term", "Full/Empty", "Commodity", "Over Weight", "Remark", "Tel:", "Add:")
_LABEL_LINE = re.compile(r"^(?:" + "|".join(re.escape(lab) for lab in _GRID_LABELS) + r")$", re.IGNORECASE)
# Section titles end a run of values but carry no value of their own
_SECTION_LINE = re.compile(r"^(?:Container\s+Information\s*\d*|Bulletin)$", re.IGNORECASE)
_KINDS = {"SD": "GP", "GP": "GP", "DC": "GP", "DV": "GP", "HC": "HC", "HQ": "HC", "RF": "RF", "RE": "RF",
          "RH": "RH", "OT": "OT", "FR": "FR", "TK": "TK"}


def _undouble(token: str) -> str:
    """'BBooookk' -> 'Book', 'PPOODD::' -> 'POD:'; values ('A59GX32592', '11') are left alone."""
    if len(token) >= 4 and len(token) % 2 == 0 and re.search(r"[A-Za-z]", token) and token[0::2] == token[1::2]:
        return token[0::2]
    return token


def _undouble_text(text: str) -> str:
    return "\n".join(" ".join(_undouble(t) for t in line.split(" ")) for line in text.splitlines())


def matches(text: str) -> bool:
    text = _undouble_text(text)
    return bool(ISSUER.search(text) and re.search(r"\bBook\s+No\b", text, re.IGNORECASE)
                and re.search(r"\bVessel\s+Name\b", text, re.IGNORECASE))


def _value(text: str, label: str) -> str:
    m = re.search(rf"^\s*{label}\s*:[ \t]*(.*)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else ""


def _grid_from_words(pages_words, label: str) -> List[str]:
    """Every value printed under `label` in the grid: the next row's words inside the label's column."""
    tokens = label.split()
    values = []
    for words in pages_words or ():
        rows = group_rows([dict(w, text=_undouble(w["text"])) for w in words])
        for i, row in enumerate(rows):
            texts = [w["text"] for w in row]
            for k in range(len(texts) - len(tokens) + 1):
                if texts[k:k + len(tokens)] != tokens:
                    continue
                start = row[k]["x0"] - 3
                end = row[k + len(tokens)]["x0"] - 3 if k + len(tokens) < len(row) else float("inf")
                below = next((r for r in rows[i + 1:] if 0 < row_top(r) - row_top(row) <= 30), None)
                values.append(" ".join(w["text"] for w in below or () if start <= w["x0"] < end))
    return values


def _grid_from_text(text: str, label: str) -> List[str]:
    """OCR: the value on the line after the label, or the label's share of a run of labels."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    values = []
    for i, ln in enumerate(lines):
        if ln.lower() != label.lower():
            continue
        start = i
        while start > 0 and _LABEL_LINE.match(lines[start - 1]):
            start -= 1
        j = i
        while j + 1 < len(lines) and _LABEL_LINE.match(lines[j + 1]):
            j += 1
        run = lines[start:j + 1]
        k = j + 1
        vals = []
        while k < len(lines) and not _LABEL_LINE.match(lines[k]) and not _SECTION_LINE.match(lines[k]):
            vals.append(lines[k])
            k += 1
        if len(run) == 1:
            values.append(vals[0] if vals else "")
        elif len(vals) >= len(run) and all(len(v) <= 12 for v in vals[:len(run)]):
            # A run of short codes ('96', '1'): paired in order
            values.append(vals[run.index(ln)])
        else:
            values.append("")
    return values


def _grid(pages_words, text: str, label: str) -> List[str]:
    return [v for v in (_grid_from_words(pages_words, label) or _grid_from_text(text, label))]


def _equipment(types: List[str], sizes: List[str], heights: List[str], volumes: List[str]):
    """'SD' / '40' / '96' / '1' per container block -> ("40'HC", '1'); several blocks are combined."""
    items = []
    for kind, size, height, qty in zip(types, sizes, heights, volumes):
        if not size or not qty.isdigit():
            continue
        code = _KINDS.get(kind.upper(), kind.upper() or "GP")
        if height == "96":
            code = {"GP": "HC", "RF": "RH"}.get(code, code)
        items.append((f"{size}'{code}", qty))
    if not items:
        return "", ""
    if len(items) == 1:
        return items[0]
    return " + ".join(f"{q} X {t}" for t, q in items), str(sum(int(q) for _, q in items))


def parse(text: str, pages_words: Optional[Sequence[List[Dict]]] = None) -> Dict[str, str]:
    text = _undouble_text(text)
    out: Dict[str, str] = {"Carrier": "INTERASIA"}

    def first(label: str) -> str:
        return next((v for v in _grid(pages_words, text, label) if v), "")

    out["Booking No"] = first("Book No")
    vessel = " ".join(v for v in (first("Vessel Name"), first("Voyage")) if v)
    etd = _value(text, r"ETD")
    out["Vessel"], out["ETD"] = vessel, etd
    out["Trunk Vessel"], out["ETD_Trunk"] = vessel, etd
    out["T/S Port"] = first("TS Port")

    out["Port of Discharging"] = _value(text, r"POD")
    out["Place of Delivery"] = _value(text, r"PLD")

    out["Equipment Type"], out["Q'ty"] = _equipment(
        _grid(pages_words, text, "Container Type"), _grid(pages_words, text, "Container Size"),
        _grid(pages_words, text, "Container Height"), _grid(pages_words, text, "Container Volume"))

    out["Empty Pick Up CY"] = first("Out Depot")
    out["Full return CY"] = first("In Depot")
    out["Port Cargo Cut-off"] = _value(text, r"Close\s+Date")

    return {k: v for k, v in out.items() if v}
