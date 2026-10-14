from backend.app.services.carrier_parsers import find_parser, sinokor
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
    assert find_parser(SINOKOR_TEXT) is sinokor
    assert find_parser(SINOKOR_OCR) is sinokor


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
