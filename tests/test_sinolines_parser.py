import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, sinolines
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of SNLGHMCL012371.pdf (remarks trimmed): a three-column grid, values on the row below the labels
SNL_TEXT = """SINOLINES BOOKING INFORMATION
SINOTRANS CONTAINER LINES (VIETNAM) CO., LTD
Addr: Room 701,7th Floor,CJ Building, 06 Le Thanh Ton Str.,
Saigon ward,Hochiminh City,Vietnam
Tel:(84) 28 3535 5616 Ext 107 Email:expcs-hcm@cmhk.com
Booking / Bill No. SNLGHMCL012371 Date of issue 2026-10-13
Intended Vessel/Voy No. HONG AN 2626N
Customer Order No.: Delivery Status: Booking Party:
TOPASIA LOGISTICS LIMITED
ANNA-SHA7NOV CY/CY
COMPANY
Port of Loading: Port of Discharge: Port of Delivery:
HOCHIMINH SHANGHAI SHANGHAI
Container Information: Payment: ETD:
20 GP × 1
FREIGHT PREPAID 2026-11-07
Cut off CDS/CY: Cut off SI,VGM: Deadline of Amendment:
2026-11-06 08:00 2026-11-05 10:00 2026-11-06 15:00
Cargo Information:
NM 100 PK INSTANT NOODLE 8650.000 KGS 25.000 CBM
Remark:
- Carrier Operation Code for e-port declaration: SNL
- Please carefully check all details contained within this Booking Notice. Any mistake or amendment request should
- Container Drop-Off time: Please follow the Eport directly.
"""

# Offline OCR prints each label with its value after it or on the next line
SNL_OCR = """SINOLINES BOOKING INFORMATION
SINOTRANS CONTAINER LINES (VIETNAM) CO., LTD
Booking / Bill No. SNLGHMCL012371
Date of issue 2026-10-13
Intended Vessel/Voy No. HONG AN 2626N
Port of Loading:
HOCHIMINH
Port of Discharge:
SHANGHAI
Port of Delivery:
SHANGHAI
Container Information:
20 GP × 1
Payment:
FREIGHT PREPAID
ETD:
2026-11-07
Cut off CDS/CY:
2026-11-06 08:00
Cut off SI,VGM:
2026-11-05 10:00
"""

EXPECTED = {
    "Booking No": "SNLGHMCL012371",
    "Carrier": "SINOLINES",
    "Port of Discharging": "SHANGHAI",
    "Place of Delivery": "SHANGHAI",
    "Block": "null",
    "T/S Port": "null",
    "Equipment Type": "20'GP",
    "Q'ty": "1",
    "Empty Pick Up CY": "null",
    "Full return CY": "null",
    "Port Cargo Cut-off": "06/11/2026 08:00",
    "Pre Carrier": "null",
    "Trunk Vessel": "HONG AN 2626N",
    "ETD_Trunk": "07/11/2026",
    "Vessel": "HONG AN 2626N",
    "ETD": "07/11/2026",
}


def _words():
    return json.loads((FIXTURES / "sinolines_words.json").read_text(encoding="utf-8"))


def _check(result):
    assert {k: result[k] for k in EXPECTED} == EXPECTED


def test_sinolines_layout_is_detected():
    assert find_parser(SNL_TEXT) is sinolines
    assert find_parser(SNL_OCR) is sinolines


def test_sinolines_grid_from_word_boxes():
    _check(extract_booking_from_text(SNL_TEXT, "SNLGHMCL012371.pdf", _words()))


def test_sinolines_text_layer_alone():
    _check(extract_booking_from_text(SNL_TEXT, "SNLGHMCL012371.pdf"))


def test_sinolines_offline_ocr():
    _check(extract_booking_from_text(SNL_OCR, "sinolines.jpg"))


def test_sinolines_long_port_names_stay_in_their_column():
    # Multi-word ports only split cleanly by the label columns
    words = _words()
    for w in words[0]:
        if w["text"] == "SHANGHAI" and w["x0"] < 300:
            w["text"] = "NINGBO"
    extra = [dict(w, text="ZHOUSHAN", x0=w["x0"] + 45, x1=w["x1"] + 45) for w in words[0]
             if w["text"] == "NINGBO"]
    words[0].extend(extra)
    result = sinolines.parse(SNL_TEXT, words)
    assert result["Port of Discharging"] == "NINGBO ZHOUSHAN"
    assert result["Place of Delivery"] == "SHANGHAI"


def test_sinolines_several_container_types():
    assert sinolines._equipment("20 GP × 2\n40 HQ × 1") == ("2 X 20'GP + 1 X 40'HC", "3")


def test_sinolines_carrier_detection():
    assert detect_carrier(booking_no="SNLGHMCL012371") == "SINOLINES"
    assert detect_carrier("SINOTRANS CONTAINER LINES (VIETNAM) CO., LTD") == "SINOLINES"
    # A Sinotrans forwarder booking with another line is not Sinolines
    assert detect_carrier("SHIPPER: SINOTRANS LOGISTICS VIETNAM\nWAN HAI LINES") == "WAN HAI"
