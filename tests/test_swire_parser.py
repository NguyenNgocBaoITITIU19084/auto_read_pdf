import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, swire
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of 'VN00525400_1 (002).pdf' (page 1 up to the special notes): the grid's columns run together
SWIRE_TEXT = """AS AGENT ONLY
MARINE CONNECTIONS VIETNAM CO., LTD.
C/O BEN LINE AGENCIES
26TH & 27TH FLOOR, ETOWN CENTRAL BUILDING,
NO. 11 DOAN VAN BO STREET, XOM CHIEU WARD,
HO CHI MINH CITY, VIETNAM
Tel: +84-28-38256148 - Fax: +84-28-38256150
Email: swire.cs.hcm@benline.com BOOKING CONFIRMATION
BKG NO.: VN00525400
KHÁCH HÀNG (SHIPPER): SỐ LƯỢNG, LOẠI CONT (CONTAINER TYPE / QUANTITY): CONT CỦA HÃNG TÀU
(CONTAINER OWNER):
NESTLE VIETNAM LIMITED 1 X 40'HC (F )
SWIRE SHIPPING
PIC : YÊU CẦU ĐẶC BIỆT VỀ CONTAINER (SPECIAL CONTAINER REQUIREMENT):
C202608130020
AGREEMENT PARTY (BÊN LÀM GIÁ CƯỚC):
NESTLE (PNG) PTY LTD
CONTRACT NO. (SỐ HỢP ĐỒNG): MẶT HÀNG (COMMODITY): TRỌNG LƯỢNG (CARGO GW/ CONT):
FAK - SOLUBLE COFFEE/ NESCAFE 0.0000 KGS
BÃI CẤP CONT RỖNG (EMPTY CONT. DEPOT): NƠI ĐÓNG HÀNG (STUFFING PLACE): NGÀY CẤP CONT (PICK-UP DATE):
WARE HOUSE (KHO) 11.09.2026
NƠI HẠ BÃI (GATE-IN TERMINAL): NGÀY BẮT ĐẦU HẠ BÃI (START DATE FOR LADEN GATE CY CUT-OFF (GIỜ CUT-OFF BÃI):
-IN):
CAT LAI TERMINAL 14.09.2026 16.09.2026 10:00
TÊN TÀU (FEEDER VESSEL NAME): CHUYẾN (VOY. NO.): S/I CUT-OFF/VGM CUT-OFF: NGÀY TÀU CHẠY (ETD):
SAN PEDRO 114S 24 HRS BEFORE CY CUT 17.09.2026
-OFF
TÀU NỐI DỰ KIẾN (INTENDED M/V): CHUYẾN (VOY. NO.): ETA T/S PORT: ETA POD:
CARPENTERS ORION 2643S 28.09.2026 15.10.2026
NƠI NHẬN HÀNG (POR): CẢNG XẾP HÀNG (POL): CẢNG CHUYỂN TẢI CẢNG DỠ KẾ TIẾP (NEXT NƠI GIAO HÀNG (PLD):
(POT): POD):
HOCHIMINH CITY HOCHIMINH CITY PORT KLANG, LAE LAE
MALAYSIA
CƯỚC (FREIGHT PAYABLE): FREIGHT COLLECT NGÀY GỬI BOOKING (BOOKING DATE):
GHI CHÚ 18.08.2026
(REMARKS): (1) KHÁCH HÀNG TỰ KIỂM TRA ĐỂ LẤY ĐÚNG VÀ ĐỦ SÔ
LƯỢNG / LOẠI CONT RỖNG GHI TRÊN BOOKING NÀY NGƯỜI LÀM BOOKING (BOOKING RELEASED BY):
(2) NGÀY BẮT ĐẦU HẠ BÃI, GIỜ CUT-OFF BÃI GHI TRÊN
BOOKING CÓ THỂ THAY ĐỔI MÀ KHÔNG BÁO TRƯỚC. NHUNG VU / Tel: +84-28-38256148/ EXT. 16031
KH CẦN KIỂM TRA CẬP NHẬT THÔNG TIN NÀY TRÊN HỆ swire.cs.hcm@benline.com
THỐNG HOẶC WEBSITE CỦA CẢNG TRƯỚC KHI HẠ
CONT VỀ BÃI ĐỂ TRÁNH BỊ PHÁT SINH CHI PHÍ MARINE CONNECTIONS VIETNAM CO., LTD.
As Agent for SWIRE SHIPPING PTE LTD.
"""

# Offline OCR (Apple Vision) of the same page: each label with its value below, Vietnamese diacritics garbled
SWIRE_OCR = """AS AGENT ONLY
MARINE CONNECTIONS VIETNAM CO., LTD.
C/O BEN LINE AGENCIES
26TH & 27TH FLOOR, ETOWN CENTRAL BUILDING,
NO. 11 DOAN VAN BO STREET, XOM CHIEU WARD,
HO CHI MINH CITY, VIETNAM
Tel: +84-28-38256148 - Fax: +84-28-38256150
Email: swire.cs.hcm@benline.com
BKG NO.: VN00525400
KHÁCH HÀNG (SHIPPER):
NESTLE VIETNAM LIMITED
PIC :
AGREEMENT PARTY (BÊN LÀM GIÁ CƯỚC):
NESTLE (PNG) PTY LTD
CONTRACT NO. (SỐ HỢP ĐỒNG):
ERITRE L SWIRE SHIPPING
CONNECTIONS
BOOKING CONFIRMATION
SO LƯỢNG, LOẠI CONT (CONTAINER TYPE / QUANTITY):
1 X 40'HC (F)
CONT CỦA HÃNG TÀU
(CONTAINER OWNER):
SWIRE SHIPPING
YÊU CẦU ĐẶC BIỆT VỀ CONTAINER (SPECIAL CONTAINER REQUIREMENT):
C202608130020
MẶT HÀNG (COMMODITY):
FAK - SOLUBLE COFFEE/ NESCAFE
TRỌNG LƯỢNG (CARGO GW/ CONT):
0.0000 KGS
BÃI CẤP CONT RỐNG (EMPTY CONT. DEPOT):
NƠI ĐÓNG HÀNG (STUFFING PLACE):
WARE HOUSE (KHO)
NGÀY CÁP CONT (PICK-UP DATE):
11.09.2026
NƠI HẠ BÃI (GATE-IN TERMINAL):
CAT LAI TERMINAL
NGÀY BẮT ĐẦU HẠ BÃI (START DATE FOR LADEN GATE
CY CUT-OFF (GIỜ CUT-OFF BÃI):
-IN):
14.09.2026
16.09.2026 10:00
TÊN TAU (FEEDER VESSEL NAME):
SAN PEDRO
CHUYẾN (VOY. NO.):
114S
TÀU NỔI DỰ KIẾN (INTENDED M/V):
CARPENTERS ORION
CHUYẾN (VOY. NO.):
2643S
S/l CUT-OFF/NGM CUT-OFF:
24 HRS BEFORE CY CUT
-OFF
ETA T/S PORT:
28.09.2026
NGÀY TÀU CHẠY (ETD):
17.09.2026
ETA POD:
15.10.2026
NƠI NHẬN HÀNG (POR):
CẰNG XẾP HÀNG (POL):
HOCHIMINH CITY
HOCHIMINH CITY
CĂNG CHUYỂN TÀI
(POT):
PORT KLANG,
MALAYSIA
CĂNG DỠ KẾ TIẾP (NEXT
POD):
LAE
NƠI GIAO HÀNG (PLD):
LAE
CƯỚC (FREIGHT PAYABLE):
FREIGHT COLLECT
NGÀY GỬI BOOKING (BOOKING DATE):
18.08.2026
(REMARKS): (1) KHÁCH HÀNG TỰ KIỂM TRA ĐỂ LẤY ĐÚNG VÀ ĐỦ SÔ
LƯỢNG / LOẠI CONT RÔNG GHI TRÊN BOOKING NÀY
NGƯƠI LAM BOOKING (BOOKING RELEASED BY):
(2) NGÀY BẮT ĐẦU HẠ BÃI, GIỜ CUT-OFF BÃI GHI TRÊN
BOOKING CÓ THỂ THAY ĐỔI MÀ KHÔNG BÁO TRƯỚC.
KH CÀN KIỂM TRA CẬP NHẬT THÔNG TIN NÀY TRÊN HỆ
NHUNG VU / Tel: +84-28-38256148/ EXT. 16031
swire.cs.hcm@benline.com
THÔNG HOẶC WEBSITE CUA CÁNG TRƯỚC KHI HẠ
CONT VỀ BÃI ĐỂ TRÁNH BỊ PHÁT SINH CHI PHÍ
MARINE CONNECTIONS VIETNAM CO., LTD.
As Agent for SWIRE SHIPPING PTE LTD.
"""


def _words():
    return [json.loads((FIXTURES / "swire_words.json").read_text(encoding="utf-8"))]


def _assert_booking(r):
    assert r["Booking No"] == "VN00525400"
    assert r["Carrier"] == "SWIRE SHIPPING"
    assert r["Vessel"] == r["Pre Carrier"] == "SAN PEDRO 114S"
    assert r["ETD"] == r["ETD_Pre"] == "17/09/2026"
    assert r["Trunk Vessel"] == "CARPENTERS ORION 2643S"
    assert r["T/S Port"] == "PORT KLANG, MALAYSIA"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "LAE"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "null"  # blank: not the stuffing place printed next to it
    assert r["Full return CY"] == "CAT LAI TERMINAL"
    assert r["Port Cargo Cut-off"] == "16/09/2026 10:00"  # not the 14.09 start date for laden gate-in


def test_swire_layout_is_detected():
    assert find_parser(SWIRE_TEXT) is swire
    assert find_parser(SWIRE_OCR) is swire


def test_swire_grid_from_word_boxes():
    _assert_booking(extract_booking_from_text(SWIRE_TEXT, "VN00525400_1 (002).pdf", _words()))


def test_swire_offline_ocr():
    _assert_booking(extract_booking_from_text(SWIRE_OCR, "swire.jpg"))


def test_swire_grid_cells_follow_their_columns():
    cells = {c["label"]: c["value"] for c in swire._cells(_words())}
    assert cells["SỐ LƯỢNG, LOẠI CONT (CONTAINER TYPE / QUANTITY):"] == "1 X 40'HC (F )"
    assert cells["S/I CUT-OFF/VGM CUT-OFF:"] == "24 HRS BEFORE CY CUT -OFF"
    assert cells["NGÀY BẮT ĐẦU HẠ BÃI (START DATE FOR LADEN GATE"] == "14.09.2026"


def test_swire_carrier_detection():
    assert detect_carrier("As Agent for SWIRE SHIPPING PTE LTD.") == "SWIRE SHIPPING"
