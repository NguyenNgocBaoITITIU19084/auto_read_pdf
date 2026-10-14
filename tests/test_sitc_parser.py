import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, sitc
from backend.app.services.extractor import extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of SITSGMNG531139.pdf (notes trimmed): the wrapped port names interleave with the left column
SITC_TEXT = """New SITC Container Lines Vietnam Co. Ltd
Tel: +84-2836229906 Website: www.sitc.com
LỆNH GIAO CONTAINER RỖNG
B/L No:SITSGMNG531139
Có giá trị đến ngày:28/10/2026
NƠI CẤP RỖNG: TAN VAN SMART DEPOT
Kính gửi(Shipper): NESTLE VIET NAM LTD
MANILA NORTH
Số lượng, loại container(Total
1 X 40HC Cảng đích(DLY):
Volume): HARBOUR
NESCAFE GOLD MANILA NORTH
Mặt hàng(Commodity): Cảng chuyển tải (POD):
ORIGINAL JAR 6X200G PH HARBOUR
Nhiệt độ cài đặt(Setting temp) : Thông gió(Vent):
Đóng hàng tại bãi (Drop-off CY):
Dự kiến xếp lên tàu(Vessel): PADIAN 3 tại kho riêng (Drop-off WH): √
Chuyến(Voy): 2637N Nơi hạ bãi(Drop-off Place): CAT LAI
Ngày tàu chạy (ETD): 25/10/2026 SI & VGM cut off time: 22/10/2026 11:00
Terminal Xuất ( Export Terminal ) : PHUOC AN PORT
Closing time: 2026-10-23 06:00:00
5 Đơn vị nhận được booking này chịu trách nhiệm về số lượng và tình trạng container kể từ khi nhận.
"""

# Offline OCR (Apple Vision) of the page (stamp and notes trimmed): one cell per line
SITC_OCR = """SITC
New SITC Container Lines Vietnam Co. Ltd
LỆNH GIAO CONTAINER RỖNG
B/L No: SITSGMNG531139
Có giá trị đến ngày:28/10/2026
NƠI CẤP RỖNG: TAN VAN SMART DEPOT
NESTLE VIET NAM LTD
Kinh gửi(Shipper):
Số lượng, loại container (Total
1 X 40HC
Volume):
Cảng đích(DLY):
Mặt hàng(Commodity):
NESCAFE GOLD
Cảng chuyển tải (POD):
ORIGINAL JAR 6X200G PH
MANILA NORTH
HARBOUR
MANILA NORTH
HARBOUR
Nhiệt độ cài đặt (Setting temp) :
Thông gió(Vent):
Đóng hàng tại bãi (Drop-off CY):
Dự kiến xếp lên tàu (Vessel):
PADIAN 3
tại kho riêng (Drop-off WH):
Chuyến (Voy):
2637N
Nơi hạ bãi(Drop-off Place):
Ngày tàu chạy (ETD):
25/10/2026
SI & VGM cut off time:
CAT LAI
22/10/2026 11:00
Terminal Xuất (Export Terminal) :
PHUOC AN PORT
Closing time:
2026-10-23 06:00:00
"""


def _words():
    return [json.loads((FIXTURES / "sitc_words.json").read_text(encoding="utf-8"))]


def _assert_booking(r, ports="MANILA NORTH HARBOUR"):
    assert r["Booking No"] == "SITSGMNG531139"
    assert r["Carrier"] == "SITC"
    assert r["Vessel"] == r["Trunk Vessel"] == "PADIAN 3 2637N"
    assert r["ETD"] == r["ETD_Trunk"] == "25/10/2026"
    assert r["T/S Port"] == r["Block"] == "null"
    assert r["Port of Discharging"] == r["Place of Delivery"] == ports
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "TAN VAN SMART DEPOT"
    assert r["Full return CY"] == "CAT LAI"  # drop-off place, not the export terminal
    assert r["Port Cargo Cut-off"] == "23/10/2026 06:00"  # Closing time, not SI & VGM cut off


def test_sitc_layout_is_detected():
    assert find_parser(SITC_TEXT) is sitc
    assert find_parser(SITC_OCR) is sitc


def test_sitc_wrapped_ports_from_word_boxes():
    _assert_booking(extract_booking_from_text(SITC_TEXT, "SITSGMNG531139.pdf", _words()))


def test_sitc_offline_ocr():
    _assert_booking(extract_booking_from_text(SITC_OCR, "SITSGMNG531139.jpg"))


def test_sitc_text_only_leaves_the_interleaved_ports_empty():
    _assert_booking(extract_booking_from_text(SITC_TEXT, "sitc.pdf"), ports="null")


def test_sitc_equipment_codes():
    assert sitc._equipment("1 X 40HC") == ("40'HC", "1")
    assert sitc._equipment("2 X 20GP, 1 X 40HR") == ("2 X 20'GP + 1 X 40'RH", "3")
