import json
from pathlib import Path

import pytest

from backend.app.services.carrier_parsers import find_parser, topaz
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of FBC26100069-YUSEN.pdf (notes trimmed; the CMA-CGM clause is kept: not the carrier)
TOPAZ_TEXT = """BOOKING CONFIRMATION
No.: FBC26100069 Date: 14 Oct, 2026
To: Yusen Logistics (Vietnam) Co., Ltd. - HO CHI From
MINH BRANCH
TOPAZ MARINE CO., LTD
Shipper:
POL POD
Mother Vessel:
Vessel Name: INCEDA Voyage:
Voyage: 056S Port of Transit:
ETD: 21-Oct-26 ETA: 23-Oct-26
Place of Receipt: HOCHIMINH CITY Port of Discharge: SINGAPORE
Port of Loading: HOCHIMINH CITY Terminal: SINGAPORE
Terminal: Place of Delivery:
Commodity: BUSBAR TRUNKING SYSTEMS
Quantity: Est. Weight (Kgs) 25,000.00 Est. Measmt(Cbm): 50.00
EQUIPMENT PICKUP AND RETURN
CTNR Owner : SOC Empty Pickup CY: SUOI TIEN
CTNR 20: Pickup Date: 16-Oct-26
CTNR 40: 1 CY Contact:
CTNR Type and Quantity Description: Full Return CY: CAT LAI
01X40HC DONG KHO Return Date: 18-Oct-26
CYContact:
DocCutOff: Oct 19 2026 10:00AM VGMCutOff: Oct 19 2026 10:00AM Special Cargo Info:
CustomsCutOff: Port CutOff: Oct 20 2026 6:00PM
REMARK:
CAP CONT SACH TOT
11. Container của khách hàng KHÔNG chứa logo/hình ảnh liên quan đến CMA-CGM; APL; ANL; CNC khi sử dụng tàu CMA-CGM.
"""

# Offline OCR (Apple Vision) of the same page, trimmed: left column, then right column
TOPAZ_OCR = """TOPAZ MARINE COMPANY LIMITED
TOPAZ MARINE
BOOKING CONFIRMATION
No.: FBC26100069
Date: 14 Oct, 2026
From
TOPAZ MARINE CO., LTD
Shipper:
POL
POD
Mother Vessel:
Vessel Name:
INCEDA
Voyage:
056S
ETD:
21-Oct-26
Place of Receipt: HOCHIMINH CITY
Port of Loading: HOCHIMINH CITY
Terminal:
Voyage:
Port of Transit:
ETA:
23-Oct-26
Port of Discharge:
SINGAPORE
Terminal:
SINGAPORE
Place of Delivery:
Commodity:
Quantity:
BUSBAR TRUNKING SYSTEMS
CTNR Owner :
SOC
Empty Pickup CY: SUOI TIEN
CTNR 20:
CTNR 40: 1
Pickup Date:
CY Contact:
16-0ct-26
CTNR Type and Quantity Description:
01X40HC DONG KHO
Full Return CY:
CAT LAI
Return Date:
CYContact:
18-0ct-26
DocCutOff:
Oct 19 2026 10:00AM
VGMCutOff: Oct 19 2026 10:00AM
Special Cargo Info:
CustomsCutOff:
Port CutOff:
Oct 20 2026 6:00PM
REMARK:
CAP CONT SACH TOT
"""

EXPECTED = {
    "Booking No": "FBC26100069",
    "Carrier": "TOPAZ MARINE",
    "Port of Discharging": "SINGAPORE",
    "Place of Delivery": "SINGAPORE",
    "Block": "null",
    "T/S Port": "null",
    "Equipment Type": "40'HC",
    "Q'ty": "1",
    "Empty Pick Up CY": "SUOI TIEN",
    "Full return CY": "CAT LAI",
    "Port Cargo Cut-off": "20/10/2026 18:00",
    "Pre Carrier": "null",
    "Trunk Vessel": "INCEDA 056S",
    "ETD_Trunk": "21/10/2026",
    "Vessel": "INCEDA 056S",
    "ETD": "21/10/2026",
}


@pytest.fixture
def pages_words():
    return [json.loads((FIXTURES / "topaz_words.json").read_text(encoding="utf-8"))]


def _check(text, pages_words=None):
    result = extract_booking_from_text(text, "FBC26100069-YUSEN.pdf", pages_words)
    assert {k: result[k] for k in EXPECTED} == EXPECTED


def test_topaz_layout_is_detected():
    assert find_parser(TOPAZ_TEXT) is topaz
    assert find_parser(TOPAZ_OCR) is topaz


def test_topaz_word_boxes(pages_words):
    _check(TOPAZ_TEXT, pages_words)


def test_topaz_offline_ocr():
    _check(TOPAZ_OCR)


def test_topaz_mother_vessel_and_transit(pages_words):
    words = pages_words[0] + [
        {"text": "EVER", "x0": 390.0, "x1": 410.0, "top": 238.0},
        {"text": "GIVEN", "x0": 413.0, "x1": 440.0, "top": 238.0},
        {"text": "0123E", "x0": 390.0, "x1": 415.0, "top": 253.0},
        {"text": "TANJUNG", "x0": 390.0, "x1": 425.0, "top": 270.0},
        {"text": "PELEPAS", "x0": 428.0, "x1": 460.0, "top": 270.0},
    ]
    result = topaz.parse(TOPAZ_TEXT, [words])
    assert result["Pre Carrier"] == "INCEDA 056S" and result["ETD_Pre"] == "21-Oct-26"
    assert result["Trunk Vessel"] == "EVER GIVEN 0123E"
    assert result["Vessel"] == "INCEDA 056S"
    assert result["T/S Port"] == "TANJUNG PELEPAS"


def test_topaz_is_not_cma_cgm():
    assert detect_carrier(TOPAZ_TEXT) == "TOPAZ MARINE"
