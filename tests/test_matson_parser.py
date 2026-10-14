import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, matson
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of MATS3264527000_MUX135E_SGN261015091.pdf (form rows of page 1 and the schedule of page 2)
MATSON_TEXT = """BOOKING CONFIRMATION PAGE 1 of 2
INITIAL CARRIAGE PLACE OF RECEIPT
MILD SYMPHONY V. 2640 N
VESSEL VOYAGE PORT OF LOADING B/L TYPE & NUMBER OF COPIES
MATSON OAHU 135 E HO CHI MINH
PORT OF DISCHARGE PLACE OF DELIVERY OBL___ SW___ No of Copies____
LONG BEACH, CA LONG BEACH, CA
PARTICULARS FURNISHED BY SHIPPER
MKS & NOS / CONTAINER NOS. NO. OF PKGS DESCRIPTION OF PACKAGES AND GOODS GROSS WEIGHT MEASUREMENT
N/M SHIPPER'S LOAD, COUNT & SEAL SAID TO CONTAIN
10 x D40H
0 16500.000 KGS 20.000 M3
WOODEN FURNITURE: CHAIR
H.S CODE: 940161
THIS SHIPMENT CONTAINS NO SOLID WOOD PACKING
MATERIAL
B/L NO.
MATS3264527-000
Matson Shipping(Shanghai) Co., Ltd. -S5 Asia LTD as agent
TAN CANG HIEP PHUOC PORT
Place of Laden Return (Port: VNTCH Đích bảo thuế: 02CVS09)
& Customs Clearance
Transit Port /
ETD HCM Thursday 15-10-2026 SHANGHAI ETD SHA 22-Oct-2026 ETA LGB Monday 02-11-2026
Last Foreign Port
SI / VGM Cutoff Time 1200hr - Tuesday CDS Cutoff Time
BL confirmation 1500hr - Wednesday, all amendments after
CY Cutoff Time 1800hr - Wednesday
"""

# Offline OCR (Apple Vision) of both pages (notes trimmed): labels and values come out apart
MATSON_OCR = """Matson.
SHIPPER
KUEHNE+NAGEL CO., LTD
VINCOM CENTER - 72 LE THANH TON BEN NGHE WARD
DISTRICT 1, HO CHI MINH CITY, VIETNAM
Forwarder Reference: SGN261015091
BOOKING CONFIRMATION
PAGE 1 of 2
TARIFF
26012
EXPORT REFERENCES
LOAD/DISCHARGE
BOOKING NUMBER
CY-CY
3264527
CONSIGNEE
KUEHNE + NAGEL LTD
20000 S WESTERN AVE
TORRANCE CA 90501-1305
UNITED STATES
NOTIFY PARTY
SAME AS CNEE
FORWARDING AGENT / THIRD PARTY
POINT AND COUNTRY OF ORIGIN
ALSO NOTIFY PARTY
INITIAL CARRIAGE
MILD SYMPHONY V. 2640 N
VESSEL
MATSON OAHU
PORT OF DISCHARGE
LONG BEACH, CA
PLACE OF RECEIPT
MK * NOS, CONTAINER NOSI
N/M
VOYAGE
PORT OF LOADING
B/L TYPE & NUMBER OF COPIES
135 E HO CHI MINH
PLACE OF DELIVERY
OBL_ SW_
_ No of Copies_
LONG BEACH, CA
PARTICULARS FURNISHED BY SHIPPER
NO. OF PKGS
DESCRIPTION OF PACKAGES AND GOODS
SHIPPER'S LOAD, COUNT & SEAL SAID TO CONTAIN
10 x D40H
0
WOODEN FURNITURE: CHAIR
H.S CODE: 940161
THIS SHIPMENT CONTAINS NO SOLID WOOD PACKING
MATERIAL
FREIGHT PREPAID
TYPE
TEMP CTR NUMBER
SEAL NUMBER
QUANTITY/TYPE
GROSS WEIGHT
16500.000 KGS
MEASUREMENT
20.000 M3
WGT
MEASURE
TARIFF ITEM
A1
DESCRIPTION OF CHARGES
RB
QUANTITY
RATE
PREPAID
COLLECT
B/L NO.
MATS3264527-000
Matson.
DANGEROUS
REEFER
OUT OF GAGE
NON
NON
NON
unacceptable-vs-acceptable-cargo-descriptions.
Matson Shipping(Shanghai) Co., Ltd. -S5 Asia LTD as agent
Room 502 - 503, 5/F Citilight Tower, 45 Vo Thi Sau St.,
Tan Dinh Ward, Ho Chi Minh City, Vietnam
BOOKING CONFIRMATION
COMMODITY
GROSS WEIGHT
SHIPPERS OWN UNIT
Page 2 of 2
WOODEN FURNITURE: Chair
16500.00 kgs
NON
NO VGM, NO LOAD
Empty Container
Pickup Place
(HO CHI MINH,
VIETNAM and
PHNOM PENH,
CAMBODIA)
Place of Laden Return
& Customs Clearance
ETD HCM
SI / VGM Cutoff Time
CY Cutoff Time
NOTES
Original VGM be submitted to CY/terminal, the scanned copy submitted to carrier via email
1. GREATING FORTUNE LOGISTICS CORPORATION-Song Than Depot
2. NAM KHANH (VIETNAM) LOGISTICIS COMPANY LIMITED
3. PHUOC LONG PORT COMPANY LIMITED
4. CIMC LOGISTICS (VIETNAM) CO., LTD - CIMC BIEN HOA DEPOT
5. Southern Waterborne Transport Corporation (SOWATCO) - ICD SOTRANS
6. Retop container service(CAMBODIA) Co.. Ltd
TAN CANG HIEP PHUOC PORT
(Port: VNTCH Đích bảo thuế: 02CVS09)
Thursday 15-10-2026
Transit Port /
Last Foreign Port
SHANGHAI
ETD SHA
22-Oct-2026
ETA LGB
Monday 02-11-2026
1200hr - Tuesday
CDS Cutoff Time
BL confirmation
1500hr - Wednesday, all amendments after
1800hr - Wednesday
amendment cutoff time
closing time will be against AMS LOI
Qúý khách vui lòng chọn đúng code Đại lý/ Hãng tàu "MAT"
"""


def _words():
    return [json.loads((FIXTURES / "matson_words.json").read_text())]


def _assert_booking(r, cut_off="14/10/2026 18:00"):
    assert r["Booking No"] == "MATS3264527000"  # without the dash, as Matson asks at the terminal
    assert r["Carrier"] == "MATSON"
    assert r["Vessel"] == r["Pre Carrier"] == "MILD SYMPHONY 2640N"
    assert r["ETD"] == r["ETD_Pre"] == "15/10/2026"
    assert r["Trunk Vessel"] == "MATSON OAHU 135E"
    assert r["ETD_Trunk"] == "22/10/2026"
    assert r["T/S Port"] == "SHANGHAI"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "LONG BEACH, CA"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "10"
    assert r["Empty Pick Up CY"] == "null"
    assert r["Full return CY"] == "TAN CANG HIEP PHUOC PORT"
    assert r["Port Cargo Cut-off"] == cut_off


def test_matson_layout_is_detected():
    assert find_parser(MATSON_TEXT) is matson
    assert find_parser(MATSON_OCR) is matson


def test_matson_columns_from_word_boxes():
    _assert_booking(extract_booking_from_text(MATSON_TEXT, "MATS3264527000_MUX135E_SGN261015091.pdf", _words()))


def test_matson_text_only():
    _assert_booking(extract_booking_from_text(MATSON_TEXT, "matson.pdf"))


def test_matson_offline_ocr_leaves_the_weekday_cut_off_empty():
    # OCR separates 'CY Cutoff Time' from its '1800hr - Wednesday': not guessed
    _assert_booking(extract_booking_from_text(MATSON_OCR, "matson.jpg"), cut_off="null")


def test_matson_cut_off_is_the_last_such_weekday_before_etd():
    assert matson._cy_cut_off("CY Cutoff Time 1800hr - Wednesday", "15/10/2026") == "14/10/2026 18:00"
    assert matson._cy_cut_off("CY Cutoff Time 1800hr - Wednesday", "14/10/2026") == "07/10/2026 18:00"
    assert matson._cy_cut_off("CY Cutoff Time 0900hr - Monday", "15/10/2026") == "12/10/2026 09:00"
    assert matson._cy_cut_off("CY Cutoff Time 1800hr - Wednesday", "") == ""


def test_matson_equipment_codes_and_carrier():
    assert matson._equipment("10 x D40H") == ("40'HC", "10")
    assert matson._equipment("2 x D20, 1 x R40H") == ("2 X 20'GP + 1 X 40'RH", "3")
    assert detect_carrier("Matson Shipping(Shanghai) Co., Ltd.") == "MATSON"
    assert detect_carrier(booking_no="MATS3264527000") == "MATSON"
