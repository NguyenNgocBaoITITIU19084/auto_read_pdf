from backend.app.services.carrier_parsers import find_parser, jinjiang
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

# Text layer of JJMSGZHY600023_VIET_UNI_Logistics_Joint_Stock_Company_INFINITY_2640N.pdf (notes trimmed)
JJ_TEXT = """JINJIANG SHIPPING (VIETNAM) CO., LTD
Address: CJ Building, No. 2Bis-4-6 Le Thanh Ton, Ben Nghe Ward, District 1, Ho Chi
Minh City
Tel. (84-28) 35 202 122 - Fax. (84-28) 35 202 122
CONTAINER ORDER
BookingNo : JJMSGZHY600023
VIET UNI Logistics
BOOKING PARTY :
Joint Stock Company
ADDRESS : PIC : VIET UNI Logistics Joint Stock Company
CARRIER: JJ SHIPING Tel : (+84) 02432016970
QUANTITY & SIZE TYPE COMMODITY WEIGHT TEMP/VENT REMARK
1 X 40HC ALUMINIUM FOIL 21487.00 /
VESSEL & VOY NO : INFINITY 2640N - ETD 21/10/2026 05:00 AM
PORT OF LOADING : VNSGN - HO CHI MINH CITY EMPTY PICKUP DATE : 13/10/2026
PORT OF TRANSIT : CNSHA - SHANGHAI BOOKING VALIDITY : 21/10/2026
FINAL DESTINATION : CNZHE - ZHENJIANG EMPTY PICKUP LOCATION :
FULL RETURN DATE : 15/10/2026
SI/VGM CUT OFF : 10H 19/10/2026 FULL RETURN LOCATION : VNCLI
CY CUTOFF: 13H 20/10/2026
CDS CUTOFF: 10H 20/10/2026
REMARK : PLEASE SEND ME BOOKING VIA EMAIL: SUNNY@VIETUNI.COM.VN
* Hàng xuất đi Shanghai (Transit Shanghai): VGM không quá 30.4 tấn.
7. Vui lòng kiểm tra Eport thời gian cho phép hạ và CY Cut Off trước khi hạ container tại Cát Lái thông qua website:
"""

# Offline OCR (Apple Vision) of the same page, trimmed: values after their label or on the next line
JJ_OCR = """JJ SHIPPING
JINJIANG SHIPPING (VIETNAM) CO., LTD
CONTAINER ORDER
BookingNo: JJMSGZHY600023
BOOKING PARTY :
ADDRESS:
CARRIER:
JJ SHIPING
, QUANTITY & SIZE TYPE
, 1 X 40HC
VIET UNI Logistics
Joint Stock Company
COMMODITY
ALUMINIUM FOIL
VESSEL & VOY NO :
INFINITY 2640N - ETD 21/10/2026 05:00 AM
PORT OF LOADING:
VNSGN - HO CHI MINH CITY
EMPTY PICKUP DATE: 13/10/2026
PORT OF TRANSIT :
CNSHA - SHANGHAI
BOOKING VALIDITY : 21/10/2026
FINAL DESTINATION: CNZHE - ZHENJIANG
EMPTY PICKUP LOCATION :
FULL RETURN DATE :
15/10/2026
SI/VGM CUT OFF: 10H 19/10/2026
FULL RETURN LOCATION: VNCLI
CY CUTOFF:
13H 20/10/2026
CDS CUTOFF: 10H 20/10/2026
"""

EXPECTED = {
    "Booking No": "JJMSGZHY600023",
    "Carrier": "JINJIANG",
    "Port of Discharging": "CNZHE - ZHENJIANG",
    "Place of Delivery": "CNZHE - ZHENJIANG",
    "Block": "null",
    "T/S Port": "CNSHA - SHANGHAI",
    "Equipment Type": "40'HC",
    "Q'ty": "1",
    "Empty Pick Up CY": "null",
    "Full return CY": "VNCLI - CAT LAI",
    "Port Cargo Cut-off": "20/10/2026 13:00",
    "Pre Carrier": "null",
    "Trunk Vessel": "INFINITY 2640N",
    "ETD_Trunk": "21/10/2026 05:00",
    "Vessel": "INFINITY 2640N",
    "ETD": "21/10/2026 05:00",
}


def _check(text):
    result = extract_booking_from_text(text, "JJMSGZHY600023.pdf")
    assert {k: result[k] for k in EXPECTED} == EXPECTED


def test_jinjiang_layout_is_detected():
    assert find_parser(JJ_TEXT) is jinjiang
    assert find_parser(JJ_OCR) is jinjiang


def test_jinjiang_text_layer():
    _check(JJ_TEXT)


def test_jinjiang_offline_ocr():
    _check(JJ_OCR)


def test_jinjiang_pickup_depot_and_pm_etd():
    text = (JJ_TEXT
            .replace("EMPTY PICKUP LOCATION :", "EMPTY PICKUP LOCATION : TAN CANG PHU HUU DEPOT")
            .replace("05:00 AM", "05:30 PM")
            .replace("FULL RETURN LOCATION : VNCLI", "FULL RETURN LOCATION : VNCMT"))
    result = jinjiang.parse(text)
    assert result["Empty Pick Up CY"] == "TAN CANG PHU HUU DEPOT"
    assert result["ETD"] == "21/10/2026 17:30"
    assert result["Full return CY"] == "VNCMT"


def test_jinjiang_carrier_from_booking_prefix():
    assert detect_carrier(booking_no="JJMSGZHY600023") == "JINJIANG"
    assert detect_carrier("JJ SHIPPING") == "JINJIANG"
