import json
from pathlib import Path
from unittest.mock import MagicMock

from backend.app.services.carrier_parsers import find_parser, namsung
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of SGN26I02861.pdf (page 1, contact lines and carrier notes trimmed)
NAMSUNG_TEXT = """BOOKING RECEIPT NOTICE
CUSTOMER DETAILS SGN26I02861
QUANTERM LOGISTICS P.I.C MS. NHUNG
TEL E-MAIL VNSGNOUT@NAMSUNG.CO.KR
BOOKING DETAILS
BOOKING NO. SGN26I02861 VESSEL VOYAGE YEOSU VOYAGER 2608S
2ND VESSEL VOYAGE (IF
REF. BKG NO. JPN
ANY)
PLACE OF RECEIPT HOCHIMINH PORT OF DISCHARGE JAKARTA
PORT OF LOADING HOCHIMINH PLACE OF DELIVERY JAKARTA
ESTIMATED DEPARTURE DATE 2026-10-19 ESTIMATED ARRIVAL DATE 2026-10-25
DOOR INFORMATION
SERVICE TERM CY / CY KIND OF HAULAGE SELF
PICK UP DATE 2026-10-10 TRUCKER NAME
PICK UP PLACE FULL RETURN PLACE CATLAI TERMINAL
CARGO DETAILS
CNTR TYPE / QTY 4HDC x 1 NO. OF PACKAGES
COMMODITY PET FOOD
PACKAGES UNIT GROSS WEIGHT 20,000 KGS TOTAL MEASURE
SPECIAL INFORMATION CLOSING TIME & REMARK
REEFER DOCUMENT CLOSING 2026-10-16 (13:00)
TEMPERATURE
CARGO CLOSING 2026-10-17 (13:00)
VENTILATION
REMARK
OOG CAP CONT MOI SACH TOTPHILIP
BOOKING2225B
DG
1.Quy khach vui long kiem tra chi tiet booking truoc khi duyet lenh.
"""


def _words():
    return [json.loads((FIXTURES / "namsung_words.json").read_text())]


def test_namsung_layout_is_detected():
    assert find_parser(NAMSUNG_TEXT) is namsung


def test_namsung_booking_receipt_fields():
    r = extract_booking_from_text(NAMSUNG_TEXT, "SGN26I02861.pdf", _words())
    assert r["Booking No"] == "SGN26I02861"
    assert r["Carrier"] == "NAMSUNG LINE"
    assert r["Vessel"] == r["Trunk Vessel"] == "YEOSU VOYAGER 2608S"
    assert r["ETD"] == r["ETD_Trunk"] == "19/10/2026"
    assert r["Pre Carrier"] == "null"
    assert r["T/S Port"] == "null"
    assert r["Port of Discharging"] == "JAKARTA"
    assert r["Place of Delivery"] == "JAKARTA"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "null"
    assert r["Full return CY"] == "CATLAI TERMINAL"
    assert r["Port Cargo Cut-off"] == "17/10/2026 13:00"


def test_namsung_without_word_boxes_matches_text_only_reading():
    r = extract_booking_from_text(NAMSUNG_TEXT, "ocr.jpg")
    assert r["Trunk Vessel"] == "YEOSU VOYAGER 2608S"
    assert r["Pre Carrier"] == "null"
    assert r["Equipment Type"] == "40'HC"


def test_namsung_second_vessel_and_transshipment_from_remark():
    words = _words()
    label = next(w for w in words[0] if w["text"] == "(IF")
    words[0] += [{"text": t, "x0": x, "x1": x + 40, "top": label["top"] + 6}
                 for t, x in (("SINAR", 417.0), ("BUTON", 460.0), ("0012S", 503.0))]
    text = (NAMSUNG_TEXT
            .replace("OOG CAP CONT MOI SACH TOTPHILIP", "OOG CAP CONT MOI SACH T/S PORT: SINGAPORE")
            .replace("4HDC x 1", "4HDC x 2, 2DC x 1"))
    r = extract_booking_from_text(text, "SGN26I02861.pdf", words)
    assert r["Pre Carrier"] == "YEOSU VOYAGER 2608S"
    assert r["ETD_Pre"] == "19/10/2026"
    assert r["Trunk Vessel"] == "SINAR BUTON 0012S"
    assert r["T/S Port"] == "SINGAPORE"
    assert r["Equipment Type"] == "2 X 40'HC + 1 X 20'GP"
    assert r["Q'ty"] == "3"


def test_namsung_equipment_codes():
    assert namsung._equipment("2DC x 1") == ("20'GP", "1")
    assert namsung._equipment("4DC X 3") == ("40'GP", "3")
    assert namsung._equipment("4HRF x 1") == ("40'RH", "1")


def test_namsung_carrier_detected_from_text():
    assert detect_carrier("E-MAIL VNSGNOUT@NAMSUNG.CO.KR") == "NAMSUNG LINE"
    assert detect_carrier("NAMSUNG SHIPPING CO., LTD.") == "NAMSUNG LINE"


# Offline OCR (Apple Vision) of the same notice: each column is a run of labels, then its values
NAMSUNG_OCR = """BOOKING RECEIPT NOTICE
BOOKING DETAILS
BOOKING NO.
SGN26I02861
REF. BKG NO. JPN
PLACE OF RECEIPT
PORT OF LOADING
HOCHIMINH
HOCHIMINH
ESTIMATED DEPARTURE DATE 2026-10-19
DOOR INFORMATION
SERVICE TERM
PICK UP DATE
PICK UP PLACE
CY /CY
2026-10-10
CARGO DETAILS
CNTR TYPE / QTY
COMMODITY
PACKAGES UNIT
4HDC x 1
PET FOOD
GROSS WEIGHT
SPECIAL INFORMATION
00G
DG
NAMSUNG SHIPPING CO., LTD.
VNSGNOUT@NAMSUNG.CO.KR
VESSEL VOYAGE
2ND VESSEL VOYAGE (IF
ANY)
PORT OF DISCHARGE
PLACE OF DELIVERY
YEOSU VOYAGER 2608S
JAKARTA
JAKARTA
ESTIMATED ARRIVAL DATE
• 2026-10-25
KIND OF HAULAGE
TRUCKER NAME
FULL RETURN PLACE
SELF
CATLAI TERMINAL
NO. OF PACKAGES
20,000 KGS
CLOSING TIME & REMARK
DOCUMENT CLOSING 2026-10-16 (13:00)
CARGO CLOSING
2026-10-17 (13:00)
REMARK
CAP CONT MOI SACH TOTPHILIP
1.Quy khach vui long kiem tra chi tiet booking truoc khi duyet lenh.
"""


def test_namsung_offline_ocr_blocks():
    r = extract_booking_from_text(NAMSUNG_OCR, "nss.jpg")
    assert r["Booking No"] == "SGN26I02861"
    assert r["Carrier"] == "NAMSUNG LINE"
    assert r["Vessel"] == r["Trunk Vessel"] == "YEOSU VOYAGER 2608S"
    assert r["ETD"] == r["ETD_Trunk"] == "19/10/2026"
    assert r["Pre Carrier"] == "null"
    assert r["Port of Discharging"] == "JAKARTA"
    assert r["Place of Delivery"] == "JAKARTA"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "null"
    assert r["Full return CY"] == "CATLAI TERMINAL"
    assert r["Port Cargo Cut-off"] == "17/10/2026 13:00"


def test_namsung_offline_ocr_second_vessel_pick_up_and_trucker():
    text = (NAMSUNG_OCR
            .replace("YEOSU VOYAGER 2608S\n", "YEOSU VOYAGER 2608S\nSINAR BUTON 0012S\n")
            .replace("CY /CY\n2026-10-10\n", "CY /CY\n2026-10-10\nTAN CANG HIEP PHUOC\n")
            .replace("SELF\n", "SELF\nNGUYEN TRANS\n")
            .replace("CAP CONT MOI SACH TOTPHILIP", "T/S PORT: SINGAPORE"))
    r = extract_booking_from_text(text, "nss.jpg")
    assert r["Pre Carrier"] == "YEOSU VOYAGER 2608S"
    assert r["Trunk Vessel"] == "SINAR BUTON 0012S"
    assert r["T/S Port"] == "SINGAPORE"
    assert r["Port of Discharging"] == "JAKARTA"
    assert r["Empty Pick Up CY"] == "TAN CANG HIEP PHUOC"
    assert r["Full return CY"] == "CATLAI TERMINAL"


def test_gemini_namsung_answer_is_normalized(monkeypatch):
    from backend.app.services import image_extractor as ie

    body = {"candidates": [{"content": {"parts": [{"text": json.dumps({
        "Booking No": "SGN26I02861", "Carrier": "NAMSUNG SHIPPING", "Equipment Type": "4HDC", "Q'ty": "1",
        "Trunk Vessel": "YEOSU VOYAGER 2608S", "ETD_Trunk": "2026-10-19",
    })}]}}]}
    resp = MagicMock(status_code=200, text=json.dumps(body))
    resp.json.return_value = body
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: resp)
    r = ie.extract_booking_from_image_ai(b"\xff\xd8\xff", "nss.jpg", api_key="k")
    assert r["Carrier"] == "NAMSUNG LINE"
    assert r["Equipment Type"] == "40'HC"
    assert r["Vessel"] == "YEOSU VOYAGER 2608S"
