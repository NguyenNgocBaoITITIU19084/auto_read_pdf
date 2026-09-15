"""Booking PDF extraction tests (ported from legacy src.extractor to backend.app.services.extractor)."""
import pytest
from unittest.mock import patch

from backend.app.services.extractor import extract_booking_data

READ_PDF_TEXT = "backend.app.services.extractor.read_pdf_text"
PATH_EXISTS = "backend.app.services.extractor.os.path.exists"


def _run(text: str, filename: str) -> dict:
    with patch(PATH_EXISTS, return_value=True), patch(READ_PDF_TEXT, return_value=text):
        return extract_booking_data(filename)


def test_extract_booking_data_missing_file():
    with pytest.raises(FileNotFoundError):
        extract_booking_data("non_existent.pdf")


def test_extract_booking_data_pdf_read_error_returns_nulls():
    with patch(PATH_EXISTS, return_value=True), patch(READ_PDF_TEXT, side_effect=RuntimeError("broken pdf")):
        result = extract_booking_data("broken.pdf")
    assert result["Tên file PDF"] == "broken.pdf"
    assert result["Booking No"] == "null"
    assert result["Carrier"] == "null"


def test_extract_booking_data_empty_text_returns_nulls():
    result = _run("", "scan.pdf")
    assert all(v == "null" for k, v in result.items() if k not in ("STT", "Tên file PDF"))


def test_extract_dongjin_carrier():
    text = (
        "DONGJIN SHIPPING CO., LTD.  Booking Receipt Notice\n"
        "Booking No : DJSCSGN260002307   Booking Ref. No. : R2604080341400  Booking Date : 2026-04-08\n"
        "Pre Carrier :               ETA/ETD :\n"
        "Trunk Vessel : DONGJIN CONFIDENT 0145N  ETA/ETD : 2026-05-03/2026-05-04\n"
        "Place of Receipt : HOCHIMINH   Port of Loading : HOCHIMINH\n"
        "Port of Discharging : INCHEON  ETA : 2026-05-09\n"
        "Terminal : SNCT (SUN-KWANG NEW CNTR TMNL)\n"
        "Place of Delivery : INCHEON    ETA : 2026-05-09\n"
        "Ocean Route Type : Direct\n"
        "Receiving Term : CY    Delivery Term : CY\n"
        "Equipment Type/Q'ty : 20'DRY ST.-1\n"
        "Commodity : NUTS, DRIED; NOS   Estimated Weight : 15,000 KGS\n"
        "Empty Pick UP CY :             Empty Pick Up Date :\n"
        "Full Return CY : CAT LAI TERMINAL  Full Return Date :\n"
        "Doc Cut-off : 2026-05-02 10:00  Customs Cut-off :\n"
        "Port Cargo Cut-off : 2026-05-03 13:00  Rail Receiving Date : ~\n"
        "VGM Cut-off : 2026-05-02 10:00"
    )
    result = _run(text, "dongjin_sample.pdf")
    assert result["Booking No"] == "DJSCSGN260002307"
    assert result["Carrier"] == "DONGJIN"
    assert result["Vessel"] == "DONGJIN CONFIDENT 0145N"
    assert result["Trunk Vessel"] == "DONGJIN CONFIDENT 0145N"
    assert result["Pre Carrier"] == "null"
    assert result["Port of Discharging"] == "INCHEON"
    assert result["Place of Delivery"] == "INCHEON"
    assert result["T/S Port"] == "null"
    assert result["Block"] == "null"
    assert result["Equipment Type"] == "20'DRY ST"
    assert result["Q'ty"] == "1"
    assert result["Empty Pick Up CY"] == "null"
    assert result["Full return CY"] == "CAT LAI TERMINAL"
    # Dates normalized to DD/MM/YYYY[ HH:MM]
    assert result["ETD"] == "04/05/2026"
    assert result["ETD_Trunk"] == "04/05/2026"
    assert result["Port Cargo Cut-off"] == "03/05/2026 13:00"


def test_extract_pil_carrier():
    text = (
        "PIL  Booking Confirmation  08 JUL 26 09:47 Page : 1/3\n"
        "Booking No : SGN601175800  Booking Ref. No. : VNBDU2607010839\n"
        "Pre Carrier : KOTA NEKAD 0272S   ETA/ETD : 13Jul26/14Jul26\n"
        "Trunk Vessel : KOTA JAYA 2612E   ETA/ETD : 24Jul26/24Jul26\n"
        "Place of Receipt : HO CHI MINH (CAT LAI)  Port of Loading : HO CHI MINH (CAT LAI)\n"
        "Port of Discharging : KOTA KINABALU  ETA : 01Aug26\n"
        "Terminal : SEPANGAR BAY CONTAINER PORT\n"
        "Place of Delivery : KOTA KINABALU  ETA : 01Aug26\n"
        "Ocean Route Type : Non-direct(T/S Port : SINGAPORE)\n"
        "Receiving Term : CY    Delivery Term : CY\n"
        "Equipment Type/Q'ty : 40HC-2\n"
        "Commodity : FOOD PREPARATIONS  Estimated Weight : 30,000.000 KGS\n"
        "Empty Pick UP CY : TAN CANG HIEP LUC JONT STOCK COMPANY\n"
        "Empty Pick Up Date :\n"
        "Address : 938A13 Nguyen Thi Dinh\n"
        "Full Return CY : CATLAI TERMINAL  Full Return Date : 13Jul26 02:00\n"
        "Doc Cut-off : 10Jul26 14:00  Customs Cut-off :\n"
        "Port Cargo Cut-off : 13Jul26 02:00  VGM Cut-off : 10Jul26 14:00"
    )
    result = _run(text, "pil_sample.pdf")
    assert result["Booking No"] == "SGN601175800"
    assert result["Carrier"] == "PIL"
    assert result["Vessel"] == "KOTA NEKAD 0272S"
    assert result["Pre Carrier"] == "KOTA NEKAD 0272S"
    assert result["Port of Discharging"] == "KOTA KINABALU"
    assert result["Place of Delivery"] == "KOTA KINABALU"
    assert result["T/S Port"] == "SINGAPORE"
    assert result["Equipment Type"] == "40HC"
    assert result["Q'ty"] == "2"
    assert result["Empty Pick Up CY"] == "TAN CANG HIEP LUC JONT STOCK COMPANY"
    assert result["Full return CY"] == "CATLAI TERMINAL"
    assert result["ETD"] == "14/07/2026"
    assert result["Port Cargo Cut-off"] == "13/07/2026 02:00"


def test_extract_pil_example_2():
    text = (
        "Booking No : SGN601021000\n"
        "Pre Carrier : KOTA AZAM 2505S  ETA/ETD : 20Jun26/21Jun26\n"
        "Ocean Route Type : Non-direct(T/S Port : SINGAPORE)\n"
        "Port of Discharging : DURBAN\n"
        "Place of Delivery : DURBAN\n"
        "Equipment Type/Q'ty : 20'GP.-1\n"
        "Empty Pick UP CY : TAN CANG SUOI TIEN DEPOT\n"
        "Full Return CY : CATLAI TERMINAL\n"
        "Port Cargo Cut-off : 21Jun26 02:00\n"
    )
    result = _run(text, "pil_2.pdf")
    assert result["Booking No"] == "SGN601021000"
    assert result["Carrier"] == "PIL"
    assert result["Vessel"] == "KOTA AZAM 2505S"
    assert result["T/S Port"] == "SINGAPORE"
    assert result["Port of Discharging"] == "DURBAN"
    assert result["Equipment Type"] == "20'GP"
    assert result["Q'ty"] == "1"
    assert result["Empty Pick Up CY"] == "TAN CANG SUOI TIEN DEPOT"
    assert result["Full return CY"] == "CATLAI TERMINAL"
    assert result["ETD"] == "21/06/2026"
    assert result["Port Cargo Cut-off"] == "21/06/2026 02:00"


def test_extract_culines_carrier():
    text = (
        "CU LINES (VIETNAM) COMPANY LIMITED / Hailey Le(TEL:)\n"
        "Booking Receipt Notice\n"
        "2026-08-19 15:56 Page : 1/2\n"
        "Booking No : CULVSGN2601792 Booking Ref. No. : R2608140873076 Booking Date : 2026-08-19\n"
        "Booking Staff : Hailey Le Export Ref.NO :\n"
        "Sales Rep : Lena Pham B/L No. : CULVSGN2601792\n"
        "Shipper : ATLAS INTER-LOGS GROUP COMPANY L Shipping Order No :\n"
        "Forwader : ATLAS INTER-LOGS GROUP COMPANY L Rate Agreement No :\n"
        "Pre Carrier : MTT SENARI 043S ETA/ETD : 2026-08-27/2026-08-28\n"
        "Trunk Vessel : CHANG SHENG JI 7 2633W ETA/ETD : 2026-09-04/2026-09-05\n"
        "Place of Receipt : HO CHI MINH CITY Port of Loading : HO CHI MINH CITY\n"
        "Port of Discharging : JEDDAH ETA : 2026-09-25\n"
        "Place of Delivery : JEDDAH ETA : 2026-09-25\n"
        "Ocean Route Type : Non-direct(T/S Port : PORT KLANG)\n"
        "Receiving Term : CY Delivery Term : CY\n"
        "Equipment Type/Q’ty : 40'DRY HQ.-2\n"
        "Empty Pick UP CY : GREATING FORTUNE LOGISTICS CORP. Empty Pick Up Date : 2026-08-21 00:00\n"
        "Full Return CY : Cat Lai Terminal (Saigon Newport) Full Return Date : 2026-08-25 00:00\n"
        "Port Cargo Cut-off : 2026-08-27 19:00 Rail Receiving Date : ~ VGM Cut-off : 2026-08-26 10:00\n"
    )
    result = _run(text, "culines_sample.pdf")
    assert result["Booking No"] == "CULVSGN2601792"
    assert result["Carrier"] == "CULINES"
    assert result["Vessel"] == "MTT SENARI 043S"
    assert result["Pre Carrier"] == "MTT SENARI 043S"
    assert result["T/S Port"] == "PORT KLANG"
    assert result["Port of Discharging"] == "JEDDAH"
    assert result["Place of Delivery"] == "JEDDAH"
    # 40'DRY HQ -> 40'HC normalization
    assert result["Equipment Type"] == "40'HC"
    assert result["Q'ty"] == "2"
    assert result["Empty Pick Up CY"] == "GREATING FORTUNE LOGISTICS CORP"
    assert result["Full return CY"] == "Cat Lai Terminal (Saigon Newport)"
    assert result["ETD"] == "28/08/2026"
    assert result["Port Cargo Cut-off"] == "27/08/2026 19:00"


def test_fallback_patterns_for_ocr_like_text():
    text = (
        "BKG # ABCD123456\n"
        "POD: HAIPHONG\n"
        "Container Type: 20GP-3\n"
        "CY Cut-off : 14Jul26 02:00\n"
    )
    result = _run(text, "ocr.pdf")
    assert result["Booking No"] == "ABCD123456"
    assert result["Port of Discharging"] == "HAIPHONG"
    assert result["Equipment Type"] == "20GP"
    assert result["Q'ty"] == "3"
    assert result["Port Cargo Cut-off"] == "14/07/2026 02:00"


@pytest.mark.parametrize("raw", ["2026-02-30", "30/02/2026", "31Apr26", "2026-13-01", "15/09/2026 25:00", "00/09/2026"])
def test_parse_date_str_keeps_invalid_dates_unchanged(raw):
    from backend.app.services.extractor import parse_date_str
    assert parse_date_str(f"  {raw} ") == raw


@pytest.mark.parametrize("raw,expected", [
    ("29Feb28", "29/02/2028"),
    ("2026-09-15 23:59", "15/09/2026 23:59"),
    ("1/9/2026", "01/09/2026"),
])
def test_parse_date_str_valid_dates_still_normalized(raw, expected):
    from backend.app.services.extractor import parse_date_str
    assert parse_date_str(raw) == expected


def test_parse_etd_with_invalid_etd_keeps_raw():
    from backend.app.services.extractor import parse_etd
    assert parse_etd("13Jul26/31Jun26") == "31Jun26"

