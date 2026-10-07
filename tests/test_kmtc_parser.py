from backend.app.services.carrier_parsers import find_parser, kmtc
from backend.app.services.extractor import detect_carrier, extract_booking_from_text, parse_date_str

# Text layer of KMTCVN01168960.pdf (page 1, header lines trimmed)
KMTC_TEXT = """KMTC(VIETNAM) CO.,LTD CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
LỆNH CẤP CONTAINER
BOOKING NOTE NO : VN01168960
Cấp cho chủ hàng (shipper): REAL LOGISTICS CO., LTD
Loại hàng hóa (Commodity): CONFECTIONERY
Số lượng cont (Total volume): 40 HC X 1
Nhiệt độ cài đặt (Setting temperature):
Trọng lượng hàng (Cargo weight): 18.0MTS Thông gió (Vent open):
Trọng lượng hàng tối đa (không tính vỏ cont.): 26MTS/20’GP,20’RF,40’RH; 26.5MTS/40’GP,40’HC
Tên tàu, số chuyến (Vessel/ Voyage): KMTC TAIPEIS 2612S
Ngày tàu chạy (ETD): 09/10/2026
Cảng đích (POD): BANGKOK,THAILAND Cảng chuyển tải (T/S Port) :
Cảng đích (DLY): BANGKOK,THAILAND
Nơi cấp container (Pick-up Place): TAN CANG RACH CHIEC(DEPOT 5A-DUONG B, KCN CAT LAI)
Ngày cấp container (Pick-up Date): 02/10/2026
Nơi hạ bãi (Drop-off Place): Cat Lai Terminal(HCM)
Cảng Xuất (Terminal): Cat Lai Terminal(HCM)
Closing time tại cảng xuất: 2026.10.08 00:00 Closing time tại ICD: 24 tiếng trước closing time tại cảng xuất
Closing time SI/VGM: 2026.10.06 16:00
"""


def test_kmtc_layout_is_detected():
    assert find_parser(KMTC_TEXT) is kmtc


def test_kmtc_booking_note_fields():
    r = extract_booking_from_text(KMTC_TEXT, "KMTCVN01168960.pdf")
    assert r["Booking No"] == "VN01168960"
    assert r["Carrier"] == "KMTC"
    assert r["Vessel"] == r["Trunk Vessel"] == "KMTC TAIPEIS 2612S"
    assert r["ETD"] == r["ETD_Trunk"] == "09/10/2026"
    assert r["Port of Discharging"] == "BANGKOK,THAILAND"
    assert r["Place of Delivery"] == "BANGKOK,THAILAND"
    assert r["T/S Port"] == "null"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40 HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "TAN CANG RACH CHIEC(DEPOT 5A-DUONG B, KCN CAT LAI)"
    assert r["Full return CY"] == "CAT LAI TERMINAL"
    assert r["Port Cargo Cut-off"] == "08/10/2026 00:00"


def test_kmtc_transshipment_port_and_mixed_equipment():
    text = (KMTC_TEXT
            .replace("BANGKOK,THAILAND Cảng chuyển tải (T/S Port) :",
                     "JAKARTA,INDONESIA Cảng chuyển tải (T/S Port) : BUSAN,KOREA")
            .replace("40 HC X 1", "40 HC X 2, 20 GP X 1"))
    r = extract_booking_from_text(text, "kmtc.pdf")
    assert r["Port of Discharging"] == "JAKARTA,INDONESIA"
    assert r["T/S Port"] == "BUSAN,KOREA"
    assert r["Equipment Type"] == "2 X 40 HC + 1 X 20 GP"
    assert r["Q'ty"] == "3"


def test_kmtc_carrier_detected_from_text_and_vessel():
    assert detect_carrier("KMTC(VIETNAM) CO.,LTD") == "KMTC"
    assert detect_carrier(vessel="KMTC TAIPEIS 2612S") == "KMTC"


def test_year_first_dotted_date():
    assert parse_date_str("2026.10.08 00:00") == "08/10/2026 00:00"
    assert parse_date_str("2026/10/08") == "08/10/2026"
