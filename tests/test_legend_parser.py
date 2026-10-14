import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, legend
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of 'BOOKING LGVN26080201_REF P26SGN0662327.pdf' (terms trimmed); the columns run together
LEGEND_TEXT = """LEGEND SHIPPING GROUP JSC
260 Chu Van An Street, Binh Thanh Ward, Ho Chi Minh City, Vietnam
Tel: 8428 35533596 (24lines)
E-mail: info@legend-shipping.com Website: www.legend-shipping.com
BOOKING CONFIRMATION
Date:
Vessel/ Voy ETD ETA Place of Receipt Port of Loading
INCEDA / 052S Aug 02, 2026 Aug 04, 2026 CAT LAI, VN (VNCLI) CAT LAI, VN (VNCLI)
Date of Pick up Place of Pick up Port of Discharge Place of Delivery
SINGAPORE, SG (SGSIN) SINGAPORE, SG (SGSIN)
Place of Drop off Closing Time SI Cut off Contact
CAT LAI PORT Aug 01, 2026 09:00:00 Jul 30, 2026 09:00:00
VGM Cut off
Jul 30, 2026 09:00:00
Commodity Volume Gross Weight Measurement Transit Port
General cargo, NOS or mixed 1x20'DC (KGS) (CBM)
consignment
Special Remark Mother vessel Mother voyage
CODE HẠ BÃI DƯỚI CẢNG CAT INCEDA 052S
LAI: LSG / LGS
PIC: RUBY LEGENDGROUP, Email: cus1@legend-shipping.com
Terms and Conditions:
4- Failure to inform container number per booking to LEGEND SHIPPING Customer.
Jul 20, 2026
Booking No.: LGVN26080201
To:
REF: P26SGN0662327
"""

# Offline OCR (Apple Vision) of the same page (terms trimmed): one label per line, its value below
LEGEND_OCR = """LEGEND SHIPPING GROUP JSC
LEGEND SHIPPING
Global logistics solutions
BOOKING CONFIRMATION
REF: P26SGN0662327
Date: Jul 20, 2026
Booking No.: LGVN26080201
To: Customer
Vessel/ Voy
INCEDA / 052S
ETD
Aug 02, 2026
ETA
Aug 04, 2026
Place of Receipt
CAT LAI, VN (VNCLI)
Port of Loading
CAT LAI, VN (VNCLI)
Date of Pick up
Place of Pick up
Port of Discharge
SINGAPORE, SG (SGSIN)
Place of Delivery
SINGAPORE, SG (SGSIN)
Place of Drop off
CAT LAI PORT
Closing Time
Aug 01, 2026 09:00:00
Commodity
General cargo, NOS or mixed
consignment
Special Remark
CODE HẠ BÃI DƯỚI CẢNG CAT
LAI: LSG / LGS
Volume
1x20'DC
SI Cut off
Jul 30, 2026 09:00:00
VGM Cut off
Jul 30, 2026 09:00:00
Gross Weight
Measurement
(KGS)
(CBM)
Contact
Transit Port
Mother vessel
INCEDA
Mother voyage
052S
PIC: RUBY LEGENDGROUP, Email: cus1@legend-shipping.com
"""


def _words():
    return [json.loads((FIXTURES / "legend_words.json").read_text(encoding="utf-8"))]


def _assert_booking(r):
    assert r["Booking No"] == "LGVN26080201"
    assert r["Carrier"] == "LEGEND SHIPPING"
    assert r["Vessel"] == r["Trunk Vessel"] == "INCEDA 052S"
    assert r["ETD"] == r["ETD_Trunk"] == "02/08/2026"
    assert r["Pre Carrier"] == r["T/S Port"] == r["Block"] == "null"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "SINGAPORE, SG (SGSIN)"
    assert r["Equipment Type"] == "20'GP"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "null"
    assert r["Full return CY"] == "CAT LAI PORT"
    assert r["Port Cargo Cut-off"] == "01/08/2026 09:00"  # Closing Time, not the SI / VGM cut-off


def test_legend_layout_is_detected():
    assert find_parser(LEGEND_TEXT) is legend
    assert find_parser(LEGEND_OCR) is legend


def test_legend_columns_from_word_boxes():
    _assert_booking(extract_booking_from_text(LEGEND_TEXT, "BOOKING LGVN26080201_REF P26SGN0662327.pdf", _words()))


def test_legend_text_only():
    _assert_booking(extract_booking_from_text(LEGEND_TEXT, "legend.pdf"))


def test_legend_offline_ocr():
    _assert_booking(extract_booking_from_text(LEGEND_OCR, "legend.jpg"))


def test_legend_mother_vessel_makes_a_transshipment():
    ocr = (LEGEND_OCR.replace("Transit Port\nMother vessel\nINCEDA\nMother voyage\n052S",
                              "Transit Port\nPORT KLANG\nMother vessel\nWAN HAI 286\nMother voyage\nS115")
           .replace("Place of Pick up\nPort", "Place of Pick up\nPHUOC LONG DEPOT\nPort"))
    r = extract_booking_from_text(ocr, "legend.jpg")
    assert r["Vessel"] == r["Pre Carrier"] == "INCEDA 052S"
    assert r["ETD_Pre"] == "02/08/2026"
    assert r["Trunk Vessel"] == "WAN HAI 286 S115"
    assert r["T/S Port"] == "PORT KLANG"
    assert r["Empty Pick Up CY"] == "PHUOC LONG DEPOT"


def test_legend_dates_and_carrier():
    assert legend._date("Aug 02, 2026") == "02/08/2026"
    assert legend._date("Aug 01, 2026 09:00:00") == "01/08/2026 09:00"
    assert legend._equipment("1x20'DC, 2x40'HC") == ("1 X 20'GP + 2 X 40'HC", "3")
    assert detect_carrier("LEGEND SHIPPING GROUP JSC") == "LEGEND SHIPPING"
    assert detect_carrier(booking_no="LGVN26080201") == "LEGEND SHIPPING"
