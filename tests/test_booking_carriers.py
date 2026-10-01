"""
COSCO / OOCL (CargoSmart layout) and Hapag-Lloyd bookings.

Text snippets are the relevant pdfplumber lines of real booking PDFs (party names/e-mails removed):
- cosco.pdf  (COSCO Booking Confirmation, T/S Singapore, stacked depot labels)
- OOCL 1.pdf (OOCL, YM vessel, direct, side-by-side depot columns, empty BLOCK NUMBER)
- OOCL 2.pdf (OOCL carrying a COSCO SHIPPING vessel, block code USLGB)
- HPL 1.pdf  (Hapag-Lloyd, inland waterway leg + 3 vessel legs)
Word boxes for the column layouts are in tests/fixtures/booking_layouts/ (cropped to those regions).
"""
import json
from pathlib import Path

import pytest

from backend.app.services.extractor import detect_carrier, extract_booking_from_text, parse_date_str

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"


def words(name):
    return [json.loads((FIXTURES / f"{name}_words.json").read_text())]


COSCO_TEXT = """6469390440 PILLLIPAOCHHJAPILLLIP
OCKKKCOAKFHFPAOCKKKCO
MBDLOMKOLOLBMIHCNEIMK DATE: 28 Sep 2026 17:42(ICT)
Booking Confirmation DCCKCCLIPFKFHPOOJBPPI
FROM: COSCO SHIPPINGS LINES VIETNAM COMPANY
VESSEL: COSCO SHIPPING ALPS 049W
BOOKING NUMBER: 6469390440
ROUTE INFORMATION
TOTAL BOOKING CONTAINER 2 X 40' Hi-Cube Container
QTY SIZE/TYPE:
PLACE OF RECEIPT: Ho Chi Minh,Ho Chi Minh, Vietnam LTD: 30 Sep 2026 01:00
PORT OF LOADING: Ba Ria-Vung Tau(CM-TV) / Tan ETA: 03 Oct 2026 06:00(ICT)
Cang-Cai Mep Thi Vai Tml (TCTT)
INTENDED VESSEL/VOYAGE: COSCO SHIPPING ALPS 049W ETD: 03 Oct 2026 14:00(ICT)
SERVICE CODE: AEU7 VESSEL FLAG: Hong Kong
TRANSHIPMENT PORT: Singapore / Pasir Panjang Terminal ETA: 12 Oct 2026 22:00(SGT)
T/S INTENDED VESSEL VOYAGE: CSCL VENUS 090W ETD: 13 Oct 2026 22:00(SGT)
PORT OF DISCHARGE: Istanbul / Kumport Liman ETA: 31 Oct 2026 12:00(EET)
Hizmetleri AS
FINAL DESTINATION: Kumport,Istanbul, Turkey ETA: 31 Oct 2026 12:00(EET)
INTENDED VGM CUT-OFF: 01 Oct 2026 09:00(ICT) INTENDED FCL CY CUT-OFF: 01 Oct 2026 23:59(ICT)
CARGO INFORMATION
BOOKING QTY SIZE/TYPE: 2 X 40' Hi-Cube Container
SOC INDICATOR: N
FULL RETURN LOCATION: Icd Phuoc Long 3
EMPTY PICKUP LOCATION:
REQUIRED DOCUMENT INFORMATION
"""

OOCL1_TEXT = """By OOCL App
2338872150 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA DATE: 25 Sep 2026 08:31
Booking Acknowledgement A A A AA A A AA A A AA A A AA A A AA A A AA A A AO H P JO H P JA H P J
FROM: OOCL (Vietnam) Co., Ltd
BOOKING NUMBER: 2338872150
BOOKING STATUS: Confirmed
TOTAL BOOKING CONTAINER QTY 2 X 20GP
SIZE/TYPE:
PORT OF LOADING: Ho Chi Minh (Cat Lai) / Cat Lai Terminal ETA: 01 Oct 2026
INTENDED VESSEL/VOYAGE: YM CELEBRITY 107A ETD: 02 Oct 2026
SERVICE CODE: THX VESSEL FLAG: Singapore
PORT OF DISCHARGE: Keelung / China Container Terminal Corp. Keelung ETA: 07 Oct 2026
Port West Coast Container Terminal
FINAL DESTINATION: Wutu,New Taipei City, Taiwan ETA: 09 Oct 2026
BLOCK NUMBER:
ESTIMATED CARGO AVAILABILITY AT DESTINATION HUB: 09 Oct 2026 01:00
INTENDED CY CUT-OFF: 30 Sep 2026 14:00
INTENDED SI/eSI CUT-OFF: 01 Oct 2026 10:00
INTENDED VGM CUT-OFF: 30 Sep 2026 10:00
BOOKING QTY SIZE/TYPE: 2 X 20' General Purpose Container
CARGO WEIGHT: 20000 KG
EMPTY PICKUP LOCATION: FULL RETURN LOCATION:
SINOVNL TAN VAN Cat Lai Terminal
My Phuoc-Tan Van Street Inter-Provincial Road
"""

OOCL2_TEXT = """By OOCL App
2172687506 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA DATE: 03 Aug 2026 08:22
FROM: OOCL (Vietnam) Co., Ltd
BOOKING NUMBER: 2172687506
TOTAL BOOKING CONTAINER QTY 1 X 40HQ
SIZE/TYPE:
PORT OF LOADING: Cai Mep / Tan Cang - Cai Mep Thi Vai Terminal ETA: 27 Aug 2026
INTENDED VESSEL/VOYAGE: COSCO SHIPPING PANAMA 006E ETD: 28 Aug 2026
SERVICE CODE: PVCS VESSEL FLAG: Hong Kong, China
PORT OF DISCHARGE: Long Beach / Long Beach Container Terminal (Pier ETA: 18 Sep 2026
E)
FINAL DESTINATION: Long Beach,Los Angeles, California, United States ETA: 23 Sep 2026
BLOCK NUMBER: USLGB
INTENDED CY CUT-OFF: 25 Aug 2026 18:00
INTENDED VGM CUT-OFF: 25 Aug 2026 14:00
BOOKING QTY SIZE/TYPE: 1 X 40' Hi-Cube Container
"""

HAPAG_TEXT = """Page 1 of 4
BT060-1020CBOB
HAPAG-LLOYD (VIETNAM) LTD
Our Reference: 29297449
Booking Confirmation - 6TH UPDATE
Our Reference: 29297449 Booking Date: 25-Sep-2026
BL/SWB No(s).: HLCUSGN2609CWPF5
Summary: 1x45GP DG Temp. OOG SOW
Export empty pick up depot(s) Export terminal delivery address
ICD TANAMEXCO
ANSON ICD
From To By ETD ETA
HO CHI MINH CITY VUNG TAU Inland Waterway
VUNG TAU TANJUNG PELEPAS Vessel 02-Oct-2026 04-Oct-2026
CMIT CAI MEP VUNGTAU PTP/PELABUHAN TG.PEL ULSAN EXPRESS 15:00 22:00
Voy. No: 639E
TANJUNG PELEPAS WILHELMSHAVEN Vessel 10-Oct-2026 03-Nov-2026
PTP/PELABUHAN TG.PEL EUROGATE WILHELMSH. MANILA MAERSK 14:00 22:00
WILHELMSHAVEN GDYNIA Vessel 06-Nov-2026 09-Nov-2026
No. Type Container no. SOW Empty pick up date/time Empty pick up depot Add. Info
1 45GP N 26-Sep-2026 ANSON ICD
Container Type 40' X 8' X 9'6" HIGH CUBE CONT.
VGM cut-off VUNG TAU 30-Sep-2026 Provide verified container gross weight
"""


def test_cosco_booking():
    res = extract_booking_from_text(COSCO_TEXT, "cosco.pdf", words("cosco"))
    assert res["Booking No"] == "6469390440"
    assert res["Carrier"] == "COSCO"
    assert res["Vessel"] == "COSCO SHIPPING ALPS 049W"
    assert res["ETD"] == "03/10/2026 14:00"
    assert res["T/S Port"] == "SINGAPORE"
    assert res["Pre Carrier"] == "COSCO SHIPPING ALPS 049W"
    assert res["ETD_Pre"] == "03/10/2026 14:00"
    assert res["Trunk Vessel"] == "CSCL VENUS 090W"
    assert res["ETD_Trunk"] == "13/10/2026 22:00"
    assert res["Port of Discharging"] == "ISTANBUL"
    assert res["Place of Delivery"] == "KUMPORT,ISTANBUL, TURKEY"
    assert res["Block"] == "null"
    assert res["Equipment Type"] == "40' HI-CUBE CONTAINER"
    assert res["Q'ty"] == "2"
    assert res["Empty Pick Up CY"] == "null"
    assert res["Full return CY"] == "ICD PHUOC LONG 3"
    assert res["Port Cargo Cut-off"] == "01/10/2026 23:59"


@pytest.mark.parametrize("pages_words", [None, "fixture"])
def test_cosco_stacked_depots_without_word_boxes(pages_words):
    pw = words("cosco") if pages_words else None
    res = extract_booking_from_text(COSCO_TEXT, "cosco.pdf", pw)
    assert res["Full return CY"] == "ICD PHUOC LONG 3"
    assert res["Empty Pick Up CY"] == "null"


def test_oocl_direct_booking_side_by_side_depots():
    res = extract_booking_from_text(OOCL1_TEXT, "OOCL 1.pdf", words("oocl1"))
    assert res["Booking No"] == "2338872150"
    assert res["Carrier"] == "OOCL"
    assert res["Vessel"] == "YM CELEBRITY 107A"
    assert res["ETD"] == "02/10/2026"
    assert res["Trunk Vessel"] == "YM CELEBRITY 107A"
    assert res["Pre Carrier"] == "null"
    assert res["T/S Port"] == "null"
    assert res["Port of Discharging"] == "KEELUNG"
    assert res["Place of Delivery"] == "WUTU,NEW TAIPEI CITY, TAIWAN"
    assert res["Block"] == "null"  # empty label must not swallow the next line
    assert res["Equipment Type"] == "20' GENERAL PURPOSE CONTAINER"
    assert res["Q'ty"] == "2"
    assert res["Empty Pick Up CY"] == "SINOVNL TAN VAN"
    assert res["Full return CY"] == "CAT LAI TERMINAL"
    assert res["Port Cargo Cut-off"] == "30/09/2026 14:00"


def test_oocl_side_by_side_depots_need_word_boxes():
    # OCR / text-only: the merged 'SINOVNL TAN VAN Cat Lai Terminal' line can't be split -> left empty
    res = extract_booking_from_text(OOCL1_TEXT, "OOCL 1.pdf")
    assert res["Empty Pick Up CY"] == "null"
    assert res["Full return CY"] == "null"
    assert res["Booking No"] == "2338872150"
    assert res["Vessel"] == "YM CELEBRITY 107A"


def test_oocl_with_cosco_vessel_is_still_oocl():
    res = extract_booking_from_text(OOCL2_TEXT, "OOCL 2.pdf", words("oocl2"))
    assert res["Carrier"] == "OOCL"
    assert res["Booking No"] == "2172687506"
    assert res["Vessel"] == "COSCO SHIPPING PANAMA 006E"
    assert res["ETD"] == "28/08/2026"
    assert res["T/S Port"] == "null"
    assert res["Port of Discharging"] == "LONG BEACH"
    assert res["Place of Delivery"] == "LONG BEACH,LOS ANGELES, CALIFORNIA, UNITED STATES"
    assert res["Block"] == "USLGB"
    assert res["Equipment Type"] == "40' HI-CUBE CONTAINER"
    assert res["Q'ty"] == "1"
    assert res["Empty Pick Up CY"] == "G-FORTUNE DONG AN DEPOT"
    assert res["Full return CY"] == "DONG NAI PORT"
    assert res["Port Cargo Cut-off"] == "25/08/2026 18:00"


def test_cargosmart_several_container_types():
    text = OOCL2_TEXT.replace(
        "BOOKING QTY SIZE/TYPE: 1 X 40' Hi-Cube Container",
        "BOOKING QTY SIZE/TYPE: 2 X 20' General Purpose Container\n1 X 40' Hi-Cube Container",
    )
    res = extract_booking_from_text(text, "OOCL 2.pdf")
    assert res["Equipment Type"] == "2 X 20' GENERAL PURPOSE CONTAINER + 1 X 40' HI-CUBE CONTAINER"
    assert res["Q'ty"] == "3"


def test_hapag_booking():
    res = extract_booking_from_text(HAPAG_TEXT, "HPL 1.pdf", words("hapag"))
    assert res["Carrier"] == "HAPAG-LLOYD"
    assert res["Booking No"] == "29297449"  # 'Our Reference', not the HLCU BL number
    # Inland waterway leg skipped; first vessel leg
    assert res["Vessel"] == "ULSAN EXPRESS 639E"
    assert res["ETD"] == "02/10/2026 15:00"
    assert res["T/S Port"] == "TANJUNG PELEPAS"
    assert res["Pre Carrier"] == "ULSAN EXPRESS 639E"
    assert res["Trunk Vessel"] == "MANILA MAERSK 638W"
    assert res["ETD_Trunk"] == "10/10/2026 14:00"
    # Last vessel leg
    assert res["Port of Discharging"] == "GDYNIA"
    assert res["Place of Delivery"] == "GDYNIA"
    assert res["Equipment Type"] == "45GP"
    assert res["Q'ty"] == "1"
    assert res["Empty Pick Up CY"] == "ANSON ICD"
    assert res["Full return CY"] == "ICD TANAMEXCO"
    assert res["Port Cargo Cut-off"] == "null"  # Hapag has no CY cut-off; VGM is not used
    assert res["Block"] == "null"


def test_hapag_text_only_fallback():
    res = extract_booking_from_text(HAPAG_TEXT, "HPL 1.jpg")
    assert res["Carrier"] == "HAPAG-LLOYD"
    assert res["Booking No"] == "29297449"
    assert res["Equipment Type"] == "45GP"
    assert res["Q'ty"] == "1"
    assert res["Empty Pick Up CY"] == "ANSON ICD"  # from the container table row
    assert res["Vessel"] == "null"


@pytest.mark.parametrize("text, expected", [
    ("FROM: OOCL (Vietnam) Co., Ltd\nINTENDED VESSEL/VOYAGE: COSCO SHIPPING PANAMA 006E", "OOCL"),
    ("Page 1 of 4\nHAPAG-LLOYD (VIETNAM) LTD\nMANILA MAERSK 14:00", "HAPAG-LLOYD"),
    ("6469390440 PILLLIPAOCHHJAPILLLIP\nFROM: COSCO SHIPPINGS LINES VIETNAM COMPANY", "COSCO"),
])
def test_detect_carrier_prefers_issuer_over_vessel_name(text, expected):
    assert detect_carrier(text) == expected


def test_barcode_noise_is_not_a_carrier():
    assert detect_carrier("6469390440 PILLLIPAOCHHJAPILLLIP\nBooking Confirmation") == "Khác"


@pytest.mark.parametrize("raw, expected", [
    ("02-Oct-2026 15:00", "02/10/2026 15:00"),
    ("02-Oct-2026", "02/10/2026"),
    ("01 Oct 2026 23:59(ICT)", "01/10/2026 23:59"),
    ("13 Oct 2026 22:00(SGT)", "13/10/2026 22:00"),
    ("03 Oct 2026", "03/10/2026"),
])
def test_parse_date_new_formats(raw, expected):
    assert parse_date_str(raw) == expected


def test_generic_booking_no_fallback_requires_digit():
    res = extract_booking_from_text("Booking Confirmation\nPort of Discharging : JEDDAH\n", "x.pdf")
    assert res["Booking No"] == "null"
