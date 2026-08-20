import pytest
from unittest.mock import patch, MagicMock
from src.extractor import extract_booking_data

def test_extract_booking_data_missing_file():
    with pytest.raises(FileNotFoundError):
        extract_booking_data("non_existent.pdf")

@patch("src.extractor.os.path.exists")
@patch("src.extractor.pdfplumber.open")
def test_extract_dongjin_carrier(mock_pdf_open, mock_exists):
    mock_exists.return_value = True
    
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    mock_page.extract_text.return_value = (
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
    mock_pdf.pages = [mock_page]
    mock_pdf_open.return_value.__enter__.return_value = mock_pdf
    
    result = extract_booking_data("dongjin_sample.pdf")
    assert result["Booking No"] == "DJSCSGN260002307"
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
    assert result["ETD"] == "2026-05-04"
    assert result["Port Cargo Cut-off"] == "2026-05-03 13:00"

@patch("src.extractor.os.path.exists")
@patch("src.extractor.pdfplumber.open")
def test_extract_pil_carrier(mock_pdf_open, mock_exists):
    mock_exists.return_value = True
    
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    mock_page.extract_text.return_value = (
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
    mock_pdf.pages = [mock_page]
    mock_pdf_open.return_value.__enter__.return_value = mock_pdf
    
    result = extract_booking_data("pil_sample.pdf")
    assert result["Booking No"] == "SGN601175800"
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

@patch("src.extractor.os.path.exists")
@patch("src.extractor.pdfplumber.open")
def test_extract_pil_example_2(mock_pdf_open, mock_exists):
    mock_exists.return_value = True
    
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    mock_page.extract_text.return_value = (
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
    mock_pdf.pages = [mock_page]
    mock_pdf_open.return_value.__enter__.return_value = mock_pdf
    
    result = extract_booking_data("pil_2.pdf")
    assert result["Booking No"] == "SGN601021000"
    assert result["Vessel"] == "KOTA AZAM 2505S"
    assert result["T/S Port"] == "SINGAPORE"
    assert result["Port of Discharging"] == "DURBAN"
    assert result["Equipment Type"] == "20'GP"
    assert result["Q'ty"] == "1"
    assert result["Empty Pick Up CY"] == "TAN CANG SUOI TIEN DEPOT"
    assert result["Full return CY"] == "CATLAI TERMINAL"
    assert result["ETD"] == "21/06/2026"
    assert result["Port Cargo Cut-off"] == "21/06/2026 02:00"
