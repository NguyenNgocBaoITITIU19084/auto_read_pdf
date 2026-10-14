import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, zim
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of 'Booking Confirmation .pdf' (ZIM; clauses trimmed, one kept: it cites 'MSC.1/CIRC.1474')
ZIM_TEXT = """ZIM INTEGRATED SHIPPING SERVICES (VIETNAM) LLC
Page 1 of 4
Hot line: 1800 400284/1800 400248
BOOKING CONFIRMATION : ZIMUHCM80682914
Client / Forwarder: DACHSER VIETNAM CO., LTD
Reference:
Status: CONFIRMED
We thank you for following booking:
Vessel/Voyage: SHENZHEN 16/W
Port of Loading: CAI MEP
Depot Name: CMIT (CAI MEP INTERNATIONAL TERMINAL CO
Port of Discharge: BARCELONA
Transit Port:
Sailing Date: 05/09/2026
Closing Date: 03/09/2026 22:00 Closing date at Place Acceptance:
Place Acceptance: HO CHI MINH CITY - ICD PHUOC LONG
Place Delivery:
SI Closing Time: 03/09/2026 16:00 Sevice Contract:
VGM closing date: 03/09/2026 Named Account:
VGM closing time: 16:00
Payment Terms: Prepaid
Booking details:
1 X HC40
Weight: 29,010.000
Commodity: FILM FACED PLYWOOD HS CODE 44123400
Order Reference: Quantity: PickUp at : Return to :
ROHCM1615048 1 TCS - ZIM DEPOT;HO CHI MINH CITY ICD PHUOC LONG;HO CHI MINH
CITY - ICD PHUOC LONG
Booking Clauses:
834 BY STUFFING THE CONTAINER AND ARRANGING ITS DELIVERY TO THE CARRIER FOR TRANSPORT,
881 WARRANTED SHIPPER MUST FULFILL THE REQUIREMENTS OF SOLAS REGULATIONS AND THE IMO GUIDELINES
REGARDING THE VERIFIED GROSS MASS (VGM) OF CONTAINER CARRYING CARGO (MSC.1/CIRC.1474, 9 JUNE 2014) - SEE
"""

# Offline OCR (Apple Vision) of page 1 (clauses trimmed): values on the next line, depots run together
ZIM_OCR = """ZIM
ZIM INTEGRATED SHIPPING SERVICES (VIETNAM) LLC
BOOKING CONFIRMATION: ZIMUHCM80682914
Client / Forwarder: DACHSER VIETNAM CO., LTD
Status:
CONFIRMED
Vessel/Voyage:
SHENZHEN 16/W
Port of Loading:
CAI MEP
Port of Discharge: BARCELONA
Transit Port:
Sailing Date:
05/09/2026
Closing Date:
03/09/2026 22:00
Place Acceptance:
HO CHI MINH CITY - ICD PHUOC LONG
Place Delivery:
SI Closing Time:
03/09/2026 16:00
Closing date at Place Acceptance:
Booking details:
1 X HC40
Weight:
29,010.000
Order Reference:
ROHCM1615048
Quantity:
1
PickUp at
Return to :
TCS - ZIM DEPOT;HO CHI MINH CITY ICD PHUOC LONG; HO CHI MINH
CITY - ICD PHUOC LONG
Booking Clauses:
"""


def _words():
    return [json.loads((FIXTURES / "zim_words.json").read_text(encoding="utf-8"))]


def _assert_booking(r):
    assert r["Booking No"] == "ZIMUHCM80682914"
    assert r["Carrier"] == "ZIM"  # not MSC from 'MSC.1/CIRC.1474' in the clauses
    assert r["Vessel"] == r["Trunk Vessel"] == "SHENZHEN 16/W"
    assert r["ETD"] == r["ETD_Trunk"] == "05/09/2026"
    assert r["T/S Port"] == r["Block"] == r["Pre Carrier"] == "null"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "BARCELONA"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "TCS - ZIM DEPOT; HO CHI MINH CITY"
    assert r["Full return CY"] == "ICD PHUOC LONG; HO CHI MINH CITY - ICD PHUOC LONG"
    assert r["Port Cargo Cut-off"] == "03/09/2026 22:00"  # Closing Date, not SI / VGM


def test_zim_layout_is_detected():
    assert find_parser(ZIM_TEXT) is zim
    assert find_parser(ZIM_OCR) is zim


def test_zim_depot_columns_from_word_boxes():
    _assert_booking(extract_booking_from_text(ZIM_TEXT, "Booking Confirmation .pdf", _words()))


def test_zim_text_only():
    _assert_booking(extract_booking_from_text(ZIM_TEXT, "zim.pdf"))


def test_zim_offline_ocr():
    _assert_booking(extract_booking_from_text(ZIM_OCR, "zim.jpg"))


def test_zim_equipment_and_carrier():
    assert zim._equipment("1 X HC40") == ("40'HC", "1")
    assert zim._equipment("2 X GP20, 1 X 40HC") == ("2 X 20'GP + 1 X 40'HC", "3")
    assert detect_carrier(ZIM_TEXT) == "ZIM"
    assert detect_carrier(booking_no="ZIMUHCM80682914") == "ZIM"
