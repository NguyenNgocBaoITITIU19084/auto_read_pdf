from backend.app.services.carrier_parsers import find_parser, yangming
from backend.app.services.extractor import extract_booking_from_text

# Text layer of YMJAE490413860.pdf (schedule table and notes trimmed); the header is a logo
YM_TEXT = """BOOKING NOTE
Cấp cho booking số : YMJAE490413860 Người đại diện : P HANG1@UPS.COM
Tên tàu : ZEPHYR LUMOS 019E
Ngày tàu chạy : 30/08/2026
Số lượng container : 1X40HQ
BLOCK CODE USNY2
(VUI LÒNG CẤP CONTAINER SẠCH TỐT)
Cảng L/D : CAI MEP , TCIT Loại hàng hoá : General cargo, NOS or mixed consignment
Cảng T/S : Cảng đích : NEW YORK, NY
Cảng D/C : NEW YORK, NY Load Mode/Discharge Mode : CY/CY
Nơi cấp container: Suoi Tien Long Thanh My Depot
Nơi hạ bãi : BINH DUONG PORT
Closing time : TRƯỚC 18:00 GIỜ NGÀY 26/08/2026
ETD DISCHARGE PORT SI CUT OFF
THU (EC2) SAVANNAH / NEWYORK Before 10:00 TUE
2) Trọng lượng hàng hóa: 15.3 tấn/20'; 18.9 tấn/40’ (hàng vào inland US),
Mail tuyến Mỹ/Canada : ymvn.ct@vn.yangming.com
CÁM ƠN QUÝ KHÁCH HÀNG ĐÃ SỬ DỤNG DỊCH VỤ CỦA YANGMING
Date : 24/08/2026
"""

# Offline OCR (Apple Vision), trimmed: 'Tên àu', empty T/S port, values on the next line
YM_OCR = """YANG MING
Yang Ming Shipping (Viet Nam) Co., Itd
BOOKING NOTE
Cấp cho booking số: YMJAE490413860
Tên àu : ZEPHYR LUMOS 019E
Ngày tàu chạy : 30/08/2026
Số lượng container : 1X40HQ
BLOCK CODE USNY2
(VUI LÒNG CẤP CONTAINER SACH TỐT)
Người đại diện :
PHANG1@UPS.COM
Cảng L/D: CAI MEP, TCIT
Cảng T/S :
Cảng D/C: NEW YORK, NY
Nơi cấp container:
Suoi Tien Long Thanh My Depot
Nơi hạ bãi : BINH DUONG PORT
Closing time : TRƯỚC 18:00 GIỜ NGÀY 26/08/2026
ETD
DISCHARGE PORT
THU (EC2)
SAVANNAH / NEWYORK
Loại hàng hóa : General cargo, NOS or mixed consignment
Cảng đích : NEW YORK, NY
Load Mode/Discharge Mode :
CY/CY
"""


def _assert_booking(r):
    assert r["Booking No"] == "YMJAE490413860"
    assert r["Carrier"] == "YANG MING"
    assert r["Vessel"] == r["Trunk Vessel"] == "ZEPHYR LUMOS 019E"
    assert r["ETD"] == r["ETD_Trunk"] == "30/08/2026"
    assert r["T/S Port"] == r["Pre Carrier"] == "null"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "NEW YORK, NY"
    assert r["Block"] == "USNY2"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "SUOI TIEN LONG THANH MY DEPOT"
    assert r["Full return CY"] == "BINH DUONG PORT"
    assert r["Port Cargo Cut-off"] == "26/08/2026 18:00"


def test_yang_ming_layout_is_detected():
    assert find_parser(YM_TEXT) is yangming
    assert find_parser(YM_OCR) is yangming


def test_yang_ming_text_layer():
    _assert_booking(extract_booking_from_text(YM_TEXT, "YMJAE490413860.pdf"))


def test_yang_ming_offline_ocr():
    _assert_booking(extract_booking_from_text(YM_OCR, "YMJAE490413860.jpg"))


def test_yang_ming_transshipment_port_and_equipment():
    text = YM_TEXT.replace("Cảng T/S : Cảng đích", "Cảng T/S : KAOHSIUNG Cảng đích")
    assert extract_booking_from_text(text, "ym.pdf")["T/S Port"] == "KAOHSIUNG"
    assert yangming._equipment("2X20GP, 1X40HQ") == ("2 X 20'GP + 1 X 40'HC", "3")
