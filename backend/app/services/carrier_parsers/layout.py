"""
Helpers for reading pdfplumber word boxes (`page.extract_words()`), for booking layouts whose
fields sit in side-by-side columns that the plain text layer merges into one line.

A page is a list of word dicts with at least 'text', 'x0', 'x1', 'top'.
"""
from typing import Dict, List, Optional, Sequence

Word = Dict
Row = List[Word]

ROW_TOLERANCE = 3.0


def group_rows(words: Sequence[Word], tol: float = ROW_TOLERANCE) -> List[Row]:
    """Groups words into visual rows (sorted top→bottom, each row left→right)."""
    rows: List[Row] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w["x0"]) for r in rows]


def row_text(row: Row) -> str:
    return " ".join(w["text"] for w in row)


def row_top(row: Row) -> float:
    return min(w["top"] for w in row)


def in_columns(row: Row, x_from: float, x_to: float = float("inf")) -> Row:
    """Words of `row` whose left edge lies in [x_from, x_to)."""
    return [w for w in row if x_from <= w["x0"] < x_to]


def find_phrase(rows: Sequence[Row], phrase: str) -> Optional[Word]:
    """
    First word that starts `phrase` (space-separated tokens, case-insensitive) inside one row.
    Returns that word (its x0/top locate the phrase) or None.
    """
    tokens = phrase.upper().split()
    for row in rows:
        texts = [w["text"].upper() for w in row]
        for i in range(len(texts) - len(tokens) + 1):
            if texts[i:i + len(tokens)] == tokens:
                return row[i]
    return None


def first_line_below(rows: Sequence[Row], top: float, x_from: float, x_to: float = float("inf"),
                     max_gap: float = 25.0) -> str:
    """Text of the first row below `top` that has words in [x_from, x_to), within `max_gap`."""
    for row in rows:
        t = row_top(row)
        if t <= top + 1:
            continue
        if t > top + max_gap:
            break
        cell = in_columns(row, x_from, x_to)
        if cell:
            return row_text(cell)
    return ""
