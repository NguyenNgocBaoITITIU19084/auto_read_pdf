import pytest
from unittest.mock import patch, MagicMock
from src.extractor import extract_booking_data

def test_extract_booking_data_missing_file():
    with pytest.raises(FileNotFoundError):
        extract_booking_data("non_existent.pdf")

@patch("src.extractor.os.path.exists")
@patch("src.extractor.pdfplumber.open")
def test_extract_booking_data_fallback_logic(mock_pdf_open, mock_exists):
    mock_exists.return_value = True
    
    # Mock PDF with both Pre Carrier and Trunk Vessel
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    mock_page.extract_text.return_value = (
        "Port of Discharging : NEW YORK, NY (Block: 2)\n"
        "Equipment Type/Q’ty : 40'DRY HC.-1\n"
        "Pre Carrier : Ship A Latest ETA/ETD : 09Jul26/2026-07-10\n"
        "Trunk Vessel : Ship B Latest ETA/ETD : 14Jul26/2026-07-15"
    )
    mock_pdf.pages = [mock_page]
    mock_pdf_open.return_value.__enter__.return_value = mock_pdf
    
    result = extract_booking_data("test.pdf")
    assert result["Pre Carrier"] == "Ship A"
    assert result["ETD_Pre"] == "2026-07-10"
    assert result["Trunk Vessel"] == "null"
    assert result["ETD_Trunk"] == "null"
    assert result["Block"] == "2"
    assert result["Equipment Type"] == "40'DRY HC"
    assert result["Q'ty"] == "1"
    
    # Mock PDF with only Trunk Vessel
    mock_page.extract_text.return_value = (
        "Equipment Type/Q'ty : 20'DRY-3\n"
        "Pre Carrier : Latest ETA/ETD :\n"
        "Trunk Vessel : Ship C Latest ETA/ETD : 19Jul26/2026-07-20"
    )
    result_trunk = extract_booking_data("test.pdf")
    assert result_trunk["Pre Carrier"] == "null"
    assert result_trunk["ETD_Pre"] == "null"
    assert result_trunk["Trunk Vessel"] == "Ship C"
    assert result_trunk["ETD_Trunk"] == "2026-07-20"
    assert result_trunk["Block"] == "null"
    assert result_trunk["Equipment Type"] == "20'DRY"
    assert result_trunk["Q'ty"] == "3"

@patch("src.extractor.os.path.exists")
@patch("src.extractor.pdfplumber.open")
def test_extract_booking_data_none_text(mock_pdf_open, mock_exists):
    mock_exists.return_value = True
    mock_pdf = MagicMock()
    mock_page = MagicMock()
    # Test that None doesn't crash the code
    mock_page.extract_text.return_value = None
    mock_pdf.pages = [mock_page]
    mock_pdf_open.return_value.__enter__.return_value = mock_pdf
    
    result = extract_booking_data("test.pdf")
    assert result["Pre Carrier"] == "null"
    assert result["Trunk Vessel"] == "null"
