from backend.app.services.carrier_parsers import find_parser, wanhai
from backend.app.services.extractor import extract_booking_from_text, parse_date_str

# Text layer of the Wan Hai booking confirmation for 039GY05862 (page 1, notes trimmed)
WANHAI_TEXT = """FAX NO:(84--,)
WAN HAI (VIETNAM) LTD
Mezz & 9th Fl., MB Sunny Tower, 259 Tran Hung Dao, Cau Ong Lanh Ward, HCMC, S.R. VIETNAM
To:GLOBAL LOGISTICS & TRANSPORT CO., LTD- HO CHI MINH OFFICE
From:TALIA
Date:2026/10/07 12:40:16
BOOKING CONFIRMATION
WE HEREBY CONFIRM YOUR BOOKING AS THE FOLLOWING DETAILS :
Booking Number : 039GY05862
Mother Vessel : WAN HAI 286 Voy : S115 SCN :
Place of Receipt : CAT LAI PORT HOCHIMINH
Port of Loading : CAT LAI PORT HOCHIMINH ETD : 20261017
Port of Transship : PORT KLANG NORTH PORT ETA : 20261020
Port of Discharge : IZMIT ETA : 20261127
Place of Delivery : IZMIT
S/I cut off time : 20261015 09:00
VGM cut off time 2:0261016 12:00
Close Date : 20261015 21:00
Final Destination :
StuffTerm:WAREHOUSE Stuff Place :
Seal :
Ctnr Type Size HeightQty Temp Humi. Vent PU Date Status
COC General Purpose 20' 86 1 FCL TO FCL
Commodity : ALUMINIUM FOIL
Releasing Empty Container : PHUC XUAN TAN VAN TEL: 0274 6562618 Address: D3, KP. Ngãi Thắng, P. Bình Thắng, Tp. Dĩ
An, Bình Dương
Laden Place Of Receipt :
Release Ctnr Range :
"""


def test_wanhai_layout_is_detected():
    assert find_parser(WANHAI_TEXT) is wanhai


def test_wanhai_booking_confirmation_fields():
    r = extract_booking_from_text(WANHAI_TEXT, "wdbkg510_07-VN01000359.pdf")
    assert r["Booking No"] == "039GY05862"
    assert r["Carrier"] == "WAN HAI"
    assert r["Vessel"] == r["Trunk Vessel"] == "WAN HAI 286 S115"
    assert r["ETD"] == r["ETD_Trunk"] == "17/10/2026"
    assert r["Pre Carrier"] == "null"
    assert r["T/S Port"] == "PORT KLANG NORTH PORT"
    assert r["Port of Discharging"] == "IZMIT"
    assert r["Place of Delivery"] == "IZMIT"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "20'GP"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "PHUC XUAN TAN VAN"
    assert r["Full return CY"] == "CAT LAI PORT HOCHIMINH"
    assert r["Port Cargo Cut-off"] == "15/10/2026 21:00"


def test_wanhai_laden_place_mixed_equipment_and_direct_route():
    text = (WANHAI_TEXT
            .replace("Laden Place Of Receipt :", "Laden Place Of Receipt : TAN CANG HIEP PHUOC")
            .replace("Port of Transship : PORT KLANG NORTH PORT ETA : 20261020\n", "")
            .replace("COC General Purpose 20' 86 1 FCL TO FCL",
                     "COC General Purpose 40' 96 2 FCL TO FCL\nCOC Reefer 20' 86 1 FCL TO FCL"))
    r = extract_booking_from_text(text, "wh.pdf")
    assert r["Full return CY"] == "TAN CANG HIEP PHUOC"
    assert r["T/S Port"] == "null"
    assert r["Equipment Type"] == "2 X 40'HC + 1 X 20'RF"
    assert r["Q'ty"] == "3"


def test_wanhai_offline_ocr_lines():
    # Offline OCR splits 'Voy' and 'ETD' onto their own lines
    text = (WANHAI_TEXT
            .replace("WAN HAI 286 Voy : S115 SCN :", "WAN HAI 286\nVoy : S115\nSCN :")
            .replace("HOCHIMINH ETD : 20261017", "HOCHIMINH\nETD : 20261017"))
    r = extract_booking_from_text(text, "wh.jpg")
    assert r["Vessel"] == "WAN HAI 286 S115"
    assert r["ETD"] == "17/10/2026"
    assert r["Full return CY"] == "CAT LAI PORT HOCHIMINH"


def test_compact_year_first_date():
    assert parse_date_str("20261015 21:00") == "15/10/2026 21:00"
    assert parse_date_str("20261017") == "17/10/2026"
