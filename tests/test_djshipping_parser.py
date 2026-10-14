from backend.app.services.carrier_parsers import djshipping, find_parser
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

# Text layer of DJLSIN2606050.pdf (terms trimmed; the '25 MTS/20'DC' limit is kept: not the equipment)
DJ_TEXT = """DJ SHIPPING LINES CO.,LTD
Address: 26/24 NGUYEN BINH KHIEM, TAN DINH WARD, HO CHI MINH
CITY, VIETNAM, VIETNAM
Tax code: 0316393075 Hotline: +84 28 73035567
Website: www.djshippinglines.com Email:
SEA BOOKING
Booking number :DJLSIN2606050 Ngày (Date):12/06/2026
To :ALTUS LOGISTICS (VIỆT NAM)
LTD
Vessel/ Voyage: INCRES 074S Closing time SI VGM: 09H00. 18 JUN 2026
Port of Loading: CAT LAI HCMC, VIETNAM Port of Discharge: SINGAPORE, SINGAPORE
Pick up empty: Drop off laden: CAT LAI PORT Fumigation: Yes:
NNoo:: X
ETD: 21/06/2026 ETA: Closing time CY cut off: 02H00
20/06/2026
PIC for stuffing Description of goods G.Weight Quantity Measurement
(KGS) (CBM)
C2 Green Tea Lemon 455ml 15,000 1x20DC 0
Special Request
HẠ HÀNG EPORT CODE ALL
Duyệt lệnh cấp rỗng qua email: ops@djshippingline.com / 090 68 79 236
1. Trọng lượng hàng hóa tối đa: 25 MTS/20'DC, 25.00 MTS/40'HC.
DJ SHIPPING LINES CO.,LTD Page 1/1 12 Jun, 2026 3:43:19PM by DANNY
"""

# Offline OCR (Apple Vision) of the same page (terms trimmed): labels and values come out apart
DJ_OCR = """DJ SHIPPING LINES
You're In good hands
DJ SHIPPING LINES CO., LTD
Address: 26/24 NGUYEN BINH KHIEM, TAN DINH WARD, HO CHI MINH
CITY, VIETNAM, VIETNAM
Tax code: 0316393075
Website: www.djshippinglines.com
Hotline:
Email:
+84 28 73035567
SEA BOOKING
Booking number
:DJLSIN2606050
To
: ALTUS LOGISTICS (VIET NAM)
LTD
Vessel/ Voyage:
Port of Loading:
Pick up empty:
ETD:
PIC for stuffing
INCRES 074S
CAT LAI HCMC, VIETNAM
Drop off laden:
21/06/2026
ETA:
Description of goods
C2 Green Tea Lemon 455ml
Ngày (Date):12/06/2026
Closing time SI VGM:
09H00. 18 JUN 2026
Port of Discharge:
CAT LAI PORT
SINGAPORE, SINGAPORE
Fumigation:
G. Weight
(KGS)
15,000
Yes:
No: X
Closing time CY cut off:
02H00
20/06/2026
Quantity
Measurement
(CBM)
1x20DC
Special Request
HẠ HÀNG EPORT CODE ALL
Duyệt lệnh cấp rỗng qua email: ops@djshippingline.com / 090 68 79 236
1. Trọng lượng hàng hóa tối đa: 25 MTS/20'DC, 25.00 MTS/40'HC.
DJ SHIPPING LINES CO.,LTD
Page 1/1
12 Jun, 2026 3:43:19PM by DANNY
"""


def _assert_booking(r):
    assert r["Booking No"] == "DJLSIN2606050"
    assert r["Carrier"] == "DJ SHIPPING"
    assert r["Vessel"] == r["Trunk Vessel"] == "INCRES 074S"
    assert r["ETD"] == r["ETD_Trunk"] == "21/06/2026"
    assert r["Pre Carrier"] == r["T/S Port"] == r["Block"] == "null"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "SINGAPORE, SINGAPORE"
    assert r["Equipment Type"] == "20'GP"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "null"  # approved by email
    assert r["Full return CY"] == "CAT LAI PORT"
    assert r["Port Cargo Cut-off"] == "20/06/2026 02:00"


def test_dj_shipping_layout_is_detected():
    assert find_parser(DJ_TEXT) is djshipping
    assert find_parser(DJ_OCR) is djshipping


def test_dj_shipping_text_layer():
    _assert_booking(extract_booking_from_text(DJ_TEXT, "DJLSIN2606050.pdf"))


def test_dj_shipping_offline_ocr():
    _assert_booking(extract_booking_from_text(DJ_OCR, "DJLSIN2606050.jpg"))


def test_dj_shipping_pick_up_depot_when_printed():
    text = DJ_TEXT.replace("Pick up empty: Drop off", "Pick up empty: PHUOC LONG DEPOT Drop off")
    assert extract_booking_from_text(text, "dj.pdf")["Empty Pick Up CY"] == "PHUOC LONG DEPOT"


def test_dj_shipping_equipment_codes():
    assert djshipping._equipment("1x20DC") == ("20'GP", "1")
    assert djshipping._equipment("2x40HC, 1 x 20GP") == ("2 X 40'HC + 1 X 20'GP", "3")
    assert djshipping._equipment("25 MTS/20'DC, 25.00 MTS/40'HC") == ("", "")


def test_dj_shipping_is_not_dongjin():
    assert detect_carrier("DJ SHIPPING LINES CO.,LTD") == "DJ SHIPPING"
    assert detect_carrier(booking_no="DJLSIN2606050") == "DJ SHIPPING"
    assert detect_carrier(booking_no="DJSCSGN260002307") == "DONGJIN"
    assert not djshipping.matches("DONGJIN SHIPPING CO., LTD.  Booking Receipt Notice\nBooking No : DJSCSGN260002307")
