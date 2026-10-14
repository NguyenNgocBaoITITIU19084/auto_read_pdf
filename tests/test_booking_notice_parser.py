from backend.app.services.carrier_parsers import booking_notice, find_parser
from backend.app.services.extractor import extract_booking_from_text

# Text layer of 'BOOKING SNKO101261000599 5X40'HQ.pdf' (contacts and footer trimmed)
SINOKOR_TEXT = """SINOKOR MERCHANT MARINE CO.,LTD
2A - 4A Ton Duc Thang streetBen Nghe ward,Ho Chi Minh city, Viet Nam
Booking Notice Date : 2026-10-07
Time : 13:33:12
BOOKING NO. SNKO101261000599
Shipper : GO GLOBAL INC COMPANY LIMITED P.I.C : Go Global
Forwarder : Booking Date : 2026-10-07
Schedule & Cargo Information
VSL / VYG : PANCON CHAMPION // 2610N
Loading : HOCHIMINH, VIETNAM Discharging : MANZANILLO, MEXICO
L-Terminal : CAT LAI D-Terminal : OCUPA terminal (MANZANILLO PORT)
E.T.D : 2026-10-14 E.T.A : 2026-11-23
Delivery : MANZANILLO, MEXICO Delivery Type :
D.O.C Cut-off : 2026-10-12 17:00 CY Cut-off : 2026-10-13 19:00
Commodity : BUSBAR TRUNKING SYSTEMS - NO BATTER,OIL, FUEL..
CNTR Q'ty : 40Hx5 WGT / MSR : 90,000.00KGS 0.00CBM
Pickup Area :
Pickup Date : 2026-10-07 Factory : DONG KHO
T/S Info. : Port : BUSAN, KOREA
VSL/VYG : HONG DA XIN TIAN JIN /
02644E (Fixed)
P.I.C Information
Remark
CAP CONT SACH TOT
"""

# Offline OCR (Apple Vision) of the same notice: labels and ': value' on separate lines
SINOKOR_OCR = """SINOKOR MERCHANT MARINE CO.,LTD
Booking Notice
Date: 2026-10-07
BOOKING NO.
Shipper
Forwarder
SNKO101261000599
: GO GLOBAL INC COMPANY LIMITED
P.I.C
: Go Global
Booking Date : 2026-10-07
Schedule & Cargo Information
VSL / VYG
: PANCON CHAMPION // 2610N
Loading
: HOCHIMINH, VIETNAM
Discharging : MANZANILLO, MEXICO
L-Terminal
: CAT LAI
D-Terminal
:OCUPA terminal (MANZANILLO PORT)
E.T.D
: 2026-10-14
E.T.A
: 2026-11-23
Delivery
: MANZANILLO, MEXICO
Delivery Type :
D.O.C Cut-off : 2026-10-12 17:00
CY Cut-off
: 2026-10-13 19:00
CNTR Q'ty
: 40Hx5
WGT / MSR :
90,000.00 KGS
Pickup Area
Pickup Date
Factory
: DONG KHO
T/S Info.
: 2026-10-07
: Port : BUSAN, KOREA
VSL/VYG : HONG DA XIN TIAN JIN /
02644E (Fixed)
P.I.C Information
"""


def _assert_notice(r):
    assert r["Booking No"] == "SNKO101261000599"
    assert r["Carrier"] == "SINOKOR LINE"
    assert r["Vessel"] == r["Pre Carrier"] == "PANCON CHAMPION 2610N"
    assert r["ETD"] == r["ETD_Pre"] == "14/10/2026"
    assert r["Trunk Vessel"] == "HONG DA XIN TIAN JIN 02644E"
    assert r["T/S Port"] == "BUSAN, KOREA"
    assert r["Port of Discharging"] == "MANZANILLO, MEXICO"
    assert r["Place of Delivery"] == "MANZANILLO, MEXICO"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "5"
    assert r["Empty Pick Up CY"] == "null"
    assert r["Full return CY"] == "CAT LAI"
    assert r["Port Cargo Cut-off"] == "13/10/2026 19:00"


def test_sinokor_layout_is_detected():
    assert find_parser(SINOKOR_TEXT) is booking_notice
    assert find_parser(SINOKOR_OCR) is booking_notice


def test_sinokor_booking_notice_fields():
    _assert_notice(extract_booking_from_text(SINOKOR_TEXT, "BOOKING SNKO101261000599 5X40'HQ.pdf"))


def test_sinokor_offline_ocr_lines():
    _assert_notice(extract_booking_from_text(SINOKOR_OCR, "sinokor.jpg"))


def test_sinokor_direct_route_pick_up_area_and_mixed_equipment():
    text = (SINOKOR_TEXT
            .replace("T/S Info. : Port : BUSAN, KOREA\nVSL/VYG : HONG DA XIN TIAN JIN /\n02644E (Fixed)\n", "")
            .replace("Pickup Area :", "Pickup Area : TAN CANG HIEP PHUOC")
            .replace("40Hx5", "40Hx2, 20Gx1"))
    r = extract_booking_from_text(text, "sinokor.pdf")
    assert r["T/S Port"] == "null"
    assert r["Pre Carrier"] == "null"
    assert r["Vessel"] == r["Trunk Vessel"] == "PANCON CHAMPION 2610N"
    assert r["ETD_Trunk"] == "14/10/2026"
    assert r["Empty Pick Up CY"] == "TAN CANG HIEP PHUOC"
    assert r["Equipment Type"] == "2 X 40'HC + 1 X 20'GP"
    assert r["Q'ty"] == "3"


# Heung A Line prints the same 'Booking Notice' (direct route, pick-up area filled)
HEUNG_A_TEXT = """HEUNG A LINE CO., LTD.
Saigon Riverside Office Center Bdlg, Room.501 &5022A-4A Ton Duc Thang, Saigon Ward, HCMCVIETNAM
Booking Notice Date : 2026-09-25
Time : 18:26:12
BOOKING NO. HASLS21260902143
Shipper : CARGOES LINKS TRANSPORTATION CO LTPD.I.C : ELLA
Forwarder : Booking Date : 26/09/25
Schedule & Cargo Information
VSL / VYG : SHANGHAI VOYAGER // 2608N
Loading : HOCHIMINH, VIETNAM Discharging : SHANGHAI, CHINA
L-Terminal : CAT LAI D-Terminal : SHANGHAI PUDONG INTL CONTAINER TERMINAL (WGQ1)
E.T.D : 2026-10-12 E.T.A : 2026-10-18
Delivery : SHANGHAI, CHINA Delivery Type :
D.O.C Cut-off : 2026-10-10 12:00 CY Cut-off : 2026-10-11 00:00
Commodity : FREEZE DRIED INSTANT COFFEE
CNTR Q'ty : 40Hx1 WGT / MSR : 25,000.00KGS 0.00CBM
Pickup Area : TAN CANG MY THUY 2
Pickup Date : 2026-09-25 Factory : WH
P.I.C Information
"""

# Offline OCR (Apple Vision) of the same notice
HEUNG_A_OCR = """HEUNG A LINE CO., LTD.
Booking Notice
BOOKING NO.
Shipper
Forwarder
HASLS21260902143
: CARGOES LINKS TRANSPORTATION CO P.I.C
: ELLA
Booking Date : 26/09/25
Schedule & Cargo Information
VSL / VYG
: SHANGHAI VOYAGER // 2608N
Loading
: HOCHIMINH, VIETNAM
Discharging : SHANGHAI, CHINA
L-Terminal
: CAT LAI
D-Terminal
SHANGHAI PUDONG INTL CONTAINER *
E.T.D
: 2026-10-12
E.T.A
: 2026-10-18
Delivery
: SHANGHAI, CHINA
Delivery Type :
D.O.C Cut-off : 2026-10-10 12:00
CY Cut-off
: 2026-10-11 00:00
Commodity
: FREEZE DRIED INSTANT COFFEE
CNTR Q'ty
: 40Hx1
WGT / MSR :
25,000.00 KGS
0.00 CBM
Pickup Area
: TAN CANG MY THUY 2
Pickup Date
: 2026-09-25
Factory
: WH
P.I.C Information
"""


def _assert_heung_a(r):
    assert r["Booking No"] == "HASLS21260902143"
    assert r["Carrier"] == "HEUNG A LINE"
    assert r["Vessel"] == r["Trunk Vessel"] == "SHANGHAI VOYAGER 2608N"
    assert r["ETD"] == r["ETD_Trunk"] == "12/10/2026"
    assert r["Pre Carrier"] == "null"
    assert r["T/S Port"] == "null"
    assert r["Port of Discharging"] == "SHANGHAI, CHINA"
    assert r["Place of Delivery"] == "SHANGHAI, CHINA"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "TAN CANG MY THUY 2"
    assert r["Full return CY"] == "CAT LAI"
    assert r["Port Cargo Cut-off"] == "11/10/2026 00:00"


def test_heung_a_booking_notice_fields():
    assert find_parser(HEUNG_A_TEXT) is booking_notice
    _assert_heung_a(extract_booking_from_text(HEUNG_A_TEXT, "HASLS21260902143 - BOOKING.pdf"))


def test_heung_a_offline_ocr_lines():
    _assert_heung_a(extract_booking_from_text(HEUNG_A_OCR, "heunga.jpg"))
