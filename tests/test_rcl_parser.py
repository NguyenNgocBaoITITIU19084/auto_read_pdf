import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, rcl
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of 'RCL 2.pdf' (pages 1-2, addresses / terms trimmed)
RCL_TEXT = """Regional Container Lines
RCL (VIETNAM) CO., LTD
BOOKING CONFIRMATION
Print Date: 23/06/2026, 17:24 (UTC+8)
To: NESTLE SINGAPORE (PTE) LTD / Yya?+Cianelle Managaoang RCL BOOKING NUMBER: BSGNC26019930
From: HO CHI MINH / Tran Le Khanh Tuyen
Booking Date: 23/06/2026 16:09 RCL BOOKING NUMBER: BSGNC26019930
Booking Status: CONFIRMED
Quotation Number:R112387 Term: CYCD Transshipment : NO
Place of Receipt: HO CHI MINH CITY, VIETNAM Point Name: CAT LAI PORT
Port of Loading: HO CHI MINH CITY, VIETNAM Terminal Name: CAT LAI PORT
Port of Discharge:LAEM CHABANG, THAILAND Terminal Name: KERRY SIAM SEAPORT LTD.
Place of Delivery: LAT KRABANG, THAILAND Terminal or ICD Name:NH PROSPERITY CO LTD
Intended Transportation Plan:
Seq From To Mode Service Vessel / Voyage ETD ETA
1 HO CHI MINH CITY, LAEM CHABANG, VESSEL RNV2 SKY SUNSHINE / 2609S 22/07/2026 24/07/2026
VIETNAM THAILAND
2 LAEM CHABANG, LAT KRABANG, TRUCK 25/07/2026 26/07/2026
THAILAND THAILAND
Full / Empty: FULL No. of Containers: 1 x 40' HC EQ GRADE:
Est. Total Container Weight (KGM): 15,000.00
MT Container Pickup Depot / CFS: SOTRANS INLAND CLEARANCE DEPOT - SOTRANS ICD Date:08/07/2026
Address: KM 09, HA NOI HIGHWAY, TRUONG THO WARD,
Return Location: HO CHI MINH CITY, CAT LAI PORT Date:22/07/2026
Address: 1295B NGUYEN THI DINH STREET
BKG118 Booking Confirmation Report V.3.0
Regional Container Lines
BOOKING CONFIRMATION
RCL BOOKING NUMBER: BSGNC26019930
Closing Time:
Cargo VGM - Closing Time ICD Closing Time Terminal Closing Time SI and eSI Closing Time
NORMAL 21/07/2026 01:00 N/A 22/07/2026 13:00 21/07/2026 01:00
REEFER 21/07/2026 01:00 N/A 23/07/2026 08:00 21/07/2026 01:00
DG 21/07/2026 01:00 N/A 22/07/2026 13:00 21/07/2026 01:00
OOG 21/07/2026 01:00 N/A 22/07/2026 13:00 21/07/2026 01:00
REMARKS
- Stuffing place:Customer warehouse; Laden drop-off: CAT LAI
"""

# Offline OCR (Apple Vision) of pages 1-2 (addresses / terms trimmed): one table cell per line
RCL_OCR = """CRCL
Regional Container Lines
BOOKING CONFIRMATION
To:
NESTLE SINGAPORE (PTE) LTD / Yya? +Cianelle Managaoang
From: HO CHIMINH / Tran Le Khanh Tuyen
RCL BOOKING NUMBER: BSGNC26019930
Transshipment: NO
Place of Receipt: HO CHI MINH CITY, VIETNAM
Point Name: CAT LAI PORT
Port of Loading:
HO CHI MINH CITY, VIETNAM
Port of Discharge: LAEM CHABANG, THAILAND
Place of Delivery: LAT KRABANG, THAILAND
Terminal Name: CAT LAI PORT
Terminal Name: KERRY SIAM SEAPORT LTD.
Terminal or ICD Name: NH PROSPERITY CO LTD
Intended Transportation Plan:
Seq
1
From
HO CHI MINH CITY,
VIETNAM
To
LAEM CHABANG,
THAILAND
Mode
VESSEL
Service
RNV2
Vessel / Voyage
SKY SUNSHINE / 2609S
ETD
22/07/2026
ETA
24/07/2026
2
LAEM CHABANG,
THAILAND
LAT KRABANG,
THAILAND
TRUCK
25/07/2026
26/07/2026
Full / Empty: FULL
No. of Containers: 1 x 40' HC
EQ GRADE:
MT Container Pickup Depot / CFS: SOTRANS INLAND CLEARANCE DEPOT - SOTRANS ICD
Address:
Contact Person:
Date: 08/07/2026
Return Location: HO CHI MINH CITY, CAT LAI PORT
Address:
1295B NGUYEN THI DINH STREET
Date: 22/07/2026
BKG118 Booking Confirmation Report V.3.0
RCL
Regional Container Lines
BOOKING CONFIRMATION
RCL BOOKING NUMBER: BSGNC26019930
Closing Time:
Cargo
NORMAL
REEFER
DG
0OG
VGM - Closing Time
21/07/2026 01:00
21/07/2026 01:00
21/07/2026 01:00
21/07/2026 01:00
ICD Closing Time
N/A
N/A
N/A
N/A
Terminal Closing Time
22/07/2026 13:00
22107/2026 13:00
22/07/2026 13:00
22/07/2026 13:00
"""

# A plan with a barge leg first and a transshipment (made up from the sample's layout)
RCL_TS_PLAN = """1 CAN THO, HO CHI MINH CITY, BARGE CTB1 MEKONG 01 / 001S 18/07/2026 20/07/2026
VIETNAM VIETNAM
2 HO CHI MINH CITY, SINGAPORE, VESSEL RVS1 SKY SUNSHINE / 2609S 22/07/2026 24/07/2026
VIETNAM SINGAPORE
3 SINGAPORE, LAEM CHABANG, VESSEL RSL3 KOTA RAJIN / 0123N 27/07/2026 30/07/2026
SINGAPORE THAILAND
4 LAEM CHABANG, LAT KRABANG, TRUCK 31/07/2026 01/08/2026
"""


def _words():
    return [json.loads((FIXTURES / "rcl_words.json").read_text(encoding="utf-8"))]


def _assert_booking(r):
    assert r["Booking No"] == "BSGNC26019930"
    assert r["Carrier"] == "RCL"
    assert r["Vessel"] == r["Trunk Vessel"] == "SKY SUNSHINE 2609S"
    assert r["ETD"] == r["ETD_Trunk"] == "22/07/2026"
    assert r["Pre Carrier"] == r["T/S Port"] == r["Block"] == "null"  # the vessel reaches the POD
    assert r["Port of Discharging"] == "LAEM CHABANG, THAILAND"
    assert r["Place of Delivery"] == "LAT KRABANG, THAILAND"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "SOTRANS INLAND CLEARANCE DEPOT - SOTRANS ICD"
    assert r["Full return CY"] == "CAT LAI PORT"
    assert r["Port Cargo Cut-off"] == "22/07/2026 13:00"  # Terminal Closing Time, NORMAL cargo


def test_rcl_layout_is_detected():
    assert find_parser(RCL_TEXT) is rcl
    assert find_parser(RCL_OCR) is rcl


def test_rcl_plan_from_word_boxes():
    _assert_booking(extract_booking_from_text(RCL_TEXT, "RCL 2.pdf", _words()))


def test_rcl_text_only():
    _assert_booking(extract_booking_from_text(RCL_TEXT, "rcl.pdf"))


def test_rcl_offline_ocr():
    _assert_booking(extract_booking_from_text(RCL_OCR, "rcl.jpg"))


def test_rcl_first_sea_leg_from_vietnam_and_transshipment():
    legs = RCL_TEXT[RCL_TEXT.index("1 HO CHI MINH"):RCL_TEXT.index("Full / Empty")]
    r = extract_booking_from_text(RCL_TEXT.replace(legs, RCL_TS_PLAN), "rcl.pdf")
    assert r["Vessel"] == r["Pre Carrier"] == "SKY SUNSHINE 2609S"  # not the barge
    assert r["ETD"] == r["ETD_Pre"] == "22/07/2026"
    assert r["T/S Port"] == "SINGAPORE, SINGAPORE"
    assert r["Trunk Vessel"] == "KOTA RAJIN 0123N"
    assert r["ETD_Trunk"] == "27/07/2026"


def test_rcl_reefer_takes_the_reefer_closing_time():
    text = RCL_TEXT.replace("1 x 40' HC", "1 x 40' RH")
    r = extract_booking_from_text(text, "rcl.pdf")
    assert r["Equipment Type"] == "40'RH"
    assert r["Port Cargo Cut-off"] == "23/07/2026 08:00"


def test_rcl_equipment_and_carrier():
    assert rcl._equipment("2 x 20' GP, 1 x 40' HC") == ("2 X 20'GP + 1 X 40'HC", "3")
    assert detect_carrier("Regional Container Lines\nRCL (VIETNAM) CO., LTD") == "RCL"
