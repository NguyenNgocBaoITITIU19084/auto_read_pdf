"""
Layout-specific booking parsers for carriers whose PDFs do not use the generic
'Booking No : / Pre Carrier : / Trunk Vessel :' labels handled by extractor.extract_booking_from_text.

Each parser module exposes:
    matches(text) -> bool
    parse(text, pages_words=None) -> dict of BOOKING_KEYS fields (raw dates; missing fields omitted)
`pages_words` is one `pdfplumber page.extract_words()` list per page; it is None for OCR text,
in which case parsers fall back to what the text alone can give.
"""
from typing import Optional

from . import cargosmart, hapag

# Checked in order; the first matching layout wins
PARSERS = (hapag, cargosmart)


def find_parser(text: str) -> Optional[object]:
    for parser in PARSERS:
        if parser.matches(text):
            return parser
    return None
