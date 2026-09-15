"""
Regression tests using short text snippets taken (via pdfplumber) from real booking PDFs:
- CUL_CULVSGN2601792 - 28.08.pdf (CU LINES Booking Receipt Notice)
- PIL 1.pdf (PIL Booking Confirmation, wrapped "Empty Pick UP CY")
- PIL 2.pdf (PIL Booking Confirmation)
Only the lines relevant to extraction are kept.
"""
import pytest

from backend.app.services.extractor import (
    CARRIERS,
    detect_carrier,
    extract_booking_from_text,
    parse_date_str,
    parse_etd,
)

CUL_SNIPPET = """CULVSGN260179
Booking Receipt Notice
From : CU LINES (VIETNAM) COMPANY LIMITED / Hailey Le(TEL:)
Booking No : CULVSGN2601792 Booking Ref. No. : R2608140873076 Booking Date : 2026-08-19
Pre Carrier : MTT SENARI 043S ETA/ETD : 2026-08-27/2026-08-28
IMO/Flag/Call Sign : 9813876/MALAYSIA/9M2054 NRT : 5040
Trunk Vessel : CHANG SHENG JI 7 2633W ETA/ETD : 2026-09-04/2026-09-05
Place of Receipt : HO CHI MINH CITY Port of Loading : HO CHI MINH CITY
Port of Discharging : JEDDAH ETA : 2026-09-25
Terminal : Red Sea Gateway Terminal (RSGT)
Place of Delivery : JEDDAH ETA : 2026-09-25
Ocean Route Type : Non-direct(T/S Port : PORT KLANG)
Receiving Term : CY Delivery Term : CY
Equipment Type/Q’ty : 40'DRY HQ.-2
Commodity : COOKIES, NOS Estimated Weight : 32,000 KGS
Empty Pick UP CY : GREATING FORTUNE LOGISTICS CORP. Empty Pick Up Date : 2026-08-21 00:00
Address : 58, the 11st map of land administration Dong An neighborhood, Binh Hoa ward, Thuan An town, Viet Nam
TEL : 2743763804 Yard PIC :
Full Return CY : Cat Lai Terminal (Saigon Newport) Full Return Date : 2026-08-25 00:00
Address : 1295B Nguyen Thi Dinh street, ward Cat Lai, district 2 Ho Chi Minh city
Doc Cut-off : 2026-08-26 10:00 Customs Cut-off : 2026-08-27 19:00
Port Cargo Cut-off : 2026-08-27 19:00 Rail Receiving Date : ~
VGM Cut-off : 2026-08-26 10:00
Thank you for choosing CHINA UNITED LINES LTD
"""

PIL1_SNIPPET = """SGN601175800
Booking Confirmation
From : PIL VIETNAM CO., LTD / HELEN CHUNG(TEL:2838212808)
Booking No : SGN601175800 Booking Ref. No. : Booking Date : 06Jul26
Pre Carrier : KOTA NEKAD 0272S ETA/ETD : 13Jul26/14Jul26
IMO/Flag/Call Sign : 9390252/PANAMA/H3HS ETB/NRT : 13Jul26 / 9123
Trunk Vessel : KOTA JAYA 2612E ETA/ETD : 24Jul26/24Jul26
Place of Receipt : HO CHI MINH (CAT LAI) Port of Loading : HO CHI MINH (CAT LAI)
Port of Discharging : KOTA KINABALU ETA : 01Aug26
Terminal SEPANGAR BAY CONTAINER PORT
Place of Delivery : KOTA KINABALU ETA : 01Aug26
Ocean Route Type : Non-direct(T/S Port : SINGAPORE)
Receiving Term : CY Delivery Term : CY
Equipment Type/Q’ty: 40HC-2
Commodity : FOOD PREPARATIONS; BAKERS' Estimated Weight : 30,000.000 KGS
TAN CANG HIEP LUC JONT STOCK Empty Pick Up Date :
Empty Pick UP CY :
COMPANY
Address : 938A13 Nguyen Thi Dinh, Phuong Thanh My Loi, Quan 2, TP Ho Chi Minh
TEL : 38976519 Yard PIC : Thanh Chau (Ms.)
Full Return CY : CATLAI TERMINAL Full Return Date : 13Jul26 02:00
Doc Cut-off : 10Jul26 14:00 Customs Cut-off :
Port Cargo Cut-off : 13Jul26 02:00 VGM Cut-off : 10Jul26 14:00
Thank you for choosing Pacific International Lines
"""

PIL2_SNIPPET = """SGN601021000
Booking Confirmation
From : PIL SHIPPING (THAILAND) LTD / LAKSHMI NARASAMMA YARRAM(TEL:+914069025500)
Booking No : SGN601021000 Booking Ref. No. : Booking Date : 12Jun26
Pre Carrier : KOTA AZAM 2505S ETA/ETD : 20Jun26/21Jun26
Trunk Vessel : EVER UTILE 201W ETA/ETD : 01Jul26/02Jul26
Place of Receipt : HO CHI MINH (CAT LAI) Port of Loading : HO CHI MINH (CAT LAI)
Port of Discharging : DURBAN ETA : 16Jul26
Terminal DURBAN PIER 2
Place of Delivery : DURBAN ETA : 17Jul26
Ocean Route Type : Non-direct(T/S Port : SINGAPORE)
Receiving Term : CY Delivery Term : CY
Equipment Type/Q’ty: 20GP-1
Commodity : OTHER GAMES, OPERATED BY Estimated Weight : 1,500.000 KGS
Empty Pick UP CY : TAN CANG SUOI TIEN DEPOT Empty Pick Up Date :
Address : No 2 Hoang Huu Nam , Long thach My Ward , District 9 TP Ho chi Minh
TEL : 2837331296 Yard PIC :
Full Return CY : CATLAI TERMINAL Full Return Date : 21Jun26 02:00
Doc Cut-off : 19Jun26 14:00 Customs Cut-off :
Port Cargo Cut-off : 21Jun26 02:00 VGM Cut-off : 19Jun26 14:00
Thank you for choosing Pacific International Lines
"""

SAMPLES = [
    (
        CUL_SNIPPET, "CUL_CULVSGN2601792 - 28.08.pdf",
        {
            "Booking No": "CULVSGN2601792", "Carrier": "CULINES",
            "Port of Discharging": "JEDDAH", "Place of Delivery": "JEDDAH", "Block": "null",
            "T/S Port": "PORT KLANG", "Equipment Type": "40'HC", "Q'ty": "2",
            "Empty Pick Up CY": "GREATING FORTUNE LOGISTICS CORP",
            "Full return CY": "CAT LAI TERMINAL (SAIGON NEWPORT)",
            "Port Cargo Cut-off": "27/08/2026 19:00",
            "Pre Carrier": "MTT SENARI 043S", "ETD_Pre": "28/08/2026",
            "Trunk Vessel": "null", "ETD_Trunk": "null",
            "Vessel": "MTT SENARI 043S", "ETD": "28/08/2026",
        },
    ),
    (
        PIL1_SNIPPET, "PIL 1.pdf",
        {
            "Booking No": "SGN601175800", "Carrier": "PIL",
            "Port of Discharging": "KOTA KINABALU", "Place of Delivery": "KOTA KINABALU", "Block": "null",
            "T/S Port": "SINGAPORE", "Equipment Type": "40HC", "Q'ty": "2",
            "Empty Pick Up CY": "TAN CANG HIEP LUC JONT STOCK COMPANY",
            "Full return CY": "CATLAI TERMINAL",
            "Port Cargo Cut-off": "13/07/2026 02:00",
            "Pre Carrier": "KOTA NEKAD 0272S", "ETD_Pre": "14/07/2026",
            "Trunk Vessel": "null", "ETD_Trunk": "null",
            "Vessel": "KOTA NEKAD 0272S", "ETD": "14/07/2026",
        },
    ),
    (
        PIL2_SNIPPET, "PIL 2.pdf",
        {
            "Booking No": "SGN601021000", "Carrier": "PIL",
            "Port of Discharging": "DURBAN", "Place of Delivery": "DURBAN", "Block": "null",
            "T/S Port": "SINGAPORE", "Equipment Type": "20GP", "Q'ty": "1",
            "Empty Pick Up CY": "TAN CANG SUOI TIEN DEPOT",
            "Full return CY": "CATLAI TERMINAL",
            "Port Cargo Cut-off": "21/06/2026 02:00",
            "Pre Carrier": "KOTA AZAM 2505S", "ETD_Pre": "21/06/2026",
            "Trunk Vessel": "null", "ETD_Trunk": "null",
            "Vessel": "KOTA AZAM 2505S", "ETD": "21/06/2026",
        },
    ),
]


@pytest.mark.parametrize("text,filename,expected", SAMPLES, ids=["CUL", "PIL1", "PIL2"])
def test_real_sample_snippets(text, filename, expected):
    result = extract_booking_from_text(text, filename)
    assert result["Tên file PDF"] == filename
    for key, value in expected.items():
        assert result[key] == value, key


def test_pil1_wrapped_empty_pickup_cy_is_not_company_only():
    result = extract_booking_from_text(PIL1_SNIPPET, "PIL 1.pdf")
    assert result["Empty Pick Up CY"] != "COMPANY"


# ---------------------------------------------------------------------------
# Carrier detection
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("text", [
    "PILOT TEST DOCUMENT",
    "COMPILED BY OPERATIONS",
    "PARTICULARS FURNISHED BY SHIPPER",
    "PLEASE CALCULATE THE WEIGHT",
    "SPILL KIT REQUIRED",
    "ONEYEAR CONTRACT",
])
def test_detect_carrier_no_substring_false_positives(text):
    assert detect_carrier(text) == "Khác"


def test_detect_carrier_particulars_does_not_hijack_other_carrier():
    text = "PARTICULARS FURNISHED BY SHIPPER\nThank you for choosing SITC"
    assert detect_carrier(text) == "SITC"


@pytest.mark.parametrize("kwargs,expected", [
    ({"text": "Thank you for choosing Pacific International Lines"}, "PIL"),
    ({"text": "From : PIL VIETNAM CO., LTD"}, "PIL"),
    ({"text": "agree to PIL's Privacy Notice"}, "PIL"),
    ({"booking_no": "SGN601175800"}, "PIL"),
    ({"vessel": "KOTA NEKAD 0272S"}, "PIL"),
    ({"text": "From : CU LINES (VIETNAM) COMPANY LIMITED"}, "CULINES"),
    ({"text": "Thank you for choosing CHINA UNITED LINES LTD"}, "CULINES"),
    ({"booking_no": "CULVSGN2601792"}, "CULINES"),
    ({"pdf_name": "CUL_CULVSGN2601792 - 28.08.pdf"}, "CULINES"),
    ({"text": "DONGJIN SHIPPING CO., LTD."}, "DONGJIN"),
    ({"booking_no": "DJSCSGN260002307"}, "DONGJIN"),
    ({"text": "OCEAN NETWORK EXPRESS"}, "ONE"),
    ({"text": "CMA CGM"}, "CMA CGM"),
    ({"vessel": "EVER UTILE 201W"}, "EVERGREEN"),
    ({"text": "HAPAG-LLOYD AG"}, "HAPAG-LLOYD"),
    ({"text": "WAN HAI LINES"}, "WAN HAI"),
    ({"text": "HEUNG-A LINE"}, "HEUNG-A"),
    ({}, "Khác"),
])
def test_detect_carrier_positive(kwargs, expected):
    assert detect_carrier(**kwargs) == expected


def test_detect_carrier_booking_prefix_beats_text_mentions():
    # A CUL booking whose remarks mention PIL must still be CULINES
    assert detect_carrier("Transship with PIL feeder", booking_no="CULVSGN2601792") == "CULINES"


def test_real_samples_carriers_do_not_cross_match():
    assert detect_carrier(PIL1_SNIPPET) == "PIL"
    assert detect_carrier(PIL2_SNIPPET) == "PIL"
    assert detect_carrier(CUL_SNIPPET) == "CULINES"


def test_carriers_table_canonical_names_used_by_frontend():
    names = [c[0] for c in CARRIERS]
    for n in ("DONGJIN", "PIL", "CULINES", "ONE", "SITC", "COSCO", "MAERSK", "CMA CGM", "EVERGREEN",
              "WAN HAI", "HAPAG-LLOYD", "YANG MING", "HMM", "SINOKOR", "HEUNG-A", "SAMUDERA",
              "TS LINES", "RCL", "OOCL"):
        assert n in names
    assert len(names) == len(set(names))


# ---------------------------------------------------------------------------
# Date normalization (DD/MM/YYYY[ HH:MM] everywhere)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    ("14Jul26", "14/07/2026"),
    ("13Jul26 02:00", "13/07/2026 02:00"),
    ("18Jul2617:00", "18/07/2026 17:00"),
    ("2026-05-04", "04/05/2026"),
    ("2026-05-03 13:00", "03/05/2026 13:00"),
    ("2026-08-27 19:00:00", "27/08/2026 19:00"),
    ("4/5/2026", "04/05/2026"),
    ("14/07/2026 02:00", "14/07/2026 02:00"),
    ("null", "null"),
    ("", ""),
    ("~", "~"),
])
def test_parse_date_str(raw, expected):
    assert parse_date_str(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("13Jul26/14Jul26", "14/07/2026"),
    ("2026-08-27/2026-08-28", "28/08/2026"),
    ("13/07/2026/14/07/2026", "14/07/2026"),
    ("14/07/2026", "14/07/2026"),
    ("", ""),
])
def test_parse_etd(raw, expected):
    assert parse_etd(raw) == expected


@pytest.mark.parametrize("kwargs,expected", [
    ({"pdf_name": "ONEYSGNF12345600.pdf"}, "ONE"),
    ({"text": "BKG COSU6412345678"}, "COSCO"),
    ({"text": "CULTIVATION OF CROPS"}, "Khác"),
])
def test_detect_carrier_glued_booking_codes(kwargs, expected):
    assert detect_carrier(**kwargs) == expected
