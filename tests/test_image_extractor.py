import io
import json
import pytest
from unittest.mock import patch, MagicMock
from PIL import Image

from backend.app.services.image_extractor import (
    extract_booking_from_image_ai,
    extract_booking_from_image,
    verify_gemini_api_key,
    get_image_mime_type
)
from backend.app.services.extractor import extract_booking_from_text

def create_sample_image_bytes():
    img = Image.new("RGB", (200, 100), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()

def test_image_mime_detection():
    jpeg_bytes = create_sample_image_bytes()
    assert get_image_mime_type(jpeg_bytes) == "image/jpeg"
    
    png_header = b"\x89PNG\r\n\x1a\n\x00\x00"
    assert get_image_mime_type(png_header) == "image/png"

def test_extract_booking_from_text_dongjin():
    raw_text = """
    DONGJIN SHIPPING CO., LTD.  Booking Receipt Notice
    Booking No : DJSCSGN260002307   Booking Ref. No. : R2604080341400
    Trunk Vessel : DONGJIN CONFIDENT 0145N  ETA/ETD : 2026-05-03/2026-05-04
    Port of Discharging : INCHEON
    Place of Delivery : INCHEON
    Ocean Route Type : Direct
    Equipment Type/Q'ty : 20'DRY ST.-1
    Full Return CY : CAT LAI TERMINAL
    Port Cargo Cut-off : 2026-05-03 13:00
    """
    res = extract_booking_from_text(raw_text, "dongjin_photo.jpg")
    assert res["Booking No"] == "DJSCSGN260002307"
    assert res["Carrier"] == "DONGJIN"
    assert res["Vessel"] == "DONGJIN CONFIDENT 0145N"
    assert res["Port of Discharging"] == "INCHEON"
    assert res["Place of Delivery"] == "INCHEON"
    assert res["Equipment Type"] == "20'DRY ST"
    assert res["Q'ty"] == "1"
    assert res["Full return CY"] == "CAT LAI TERMINAL"
    assert res["Port Cargo Cut-off"] == "2026-05-03 13:00"
    assert res["ETD"] == "2026-05-04"

@patch("backend.app.services.image_extractor.requests.post")
def test_extract_booking_from_image_ai(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": json.dumps({
                                "Booking No": "SGN601175800",
                                "Carrier": "PIL",
                                "Port of Discharging": "KOTA KINABALU",
                                "Place of Delivery": "KOTA KINABALU",
                                "Block": "null",
                                "T/S Port": "SINGAPORE",
                                "Equipment Type": "40HC",
                                "Q'ty": "2",
                                "Empty Pick Up CY": "TAN CANG HIEP LUC",
                                "Full return CY": "CATLAI TERMINAL",
                                "Port Cargo Cut-off": "13/07/2026 02:00",
                                "Pre Carrier": "KOTA NEKAD 0272S",
                                "ETD_Pre": "14/07/2026",
                                "Trunk Vessel": "KOTA JAYA 2612E",
                                "ETD_Trunk": "24/07/2026",
                                "Vessel": "KOTA NEKAD 0272S",
                                "ETD": "14/07/2026"
                            })
                        }
                    ]
                }
            }
        ]
    }
    mock_post.return_value = mock_response

    img_bytes = create_sample_image_bytes()
    result = extract_booking_from_image_ai(
        img_bytes,
        filename="pil_photo.jpg",
        api_key="mock_test_key"
    )

    assert result["Booking No"] == "SGN601175800"
    assert result["Carrier"] == "PIL"
    assert result["Vessel"] == "KOTA NEKAD 0272S"
    assert result["Equipment Type"] == "40HC"
    assert result["Q'ty"] == "2"
    assert result["T/S Port"] == "SINGAPORE"
    assert result["Port Cargo Cut-off"] == "13/07/2026 02:00"

@patch("backend.app.services.image_extractor.requests.post")
def test_verify_gemini_api_key_valid(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_post.return_value = mock_response

    res = verify_gemini_api_key("valid_api_key")
    assert res["valid"] is True

@patch("backend.app.services.image_extractor.requests.post")
def test_verify_gemini_api_key_invalid(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.json.return_value = {"error": {"message": "API key not valid"}}
    mock_post.return_value = mock_response

    res = verify_gemini_api_key("invalid_api_key")
    assert res["valid"] is False
    assert "API key not valid" in res["message"]
