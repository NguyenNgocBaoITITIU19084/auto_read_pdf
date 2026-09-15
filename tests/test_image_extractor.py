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
    assert res["Port Cargo Cut-off"] == "03/05/2026 13:00"
    assert res["ETD"] == "04/05/2026"

def test_extract_booking_from_text_culines():
    raw_text = """
    CU LINES (VIETNAM) COMPANY LIMITED / Hailey Le(TEL:)
    Booking Receipt Notice
    2026-08-19 15:56 Page : 1/2
    Booking No : CULVSGN2601792 Booking Ref. No. : R2608140873076 Booking Date : 2026-08-19
    Pre Carrier : MTT SENARI 043S ETA/ETD : 2026-08-27/2026-08-28
    Trunk Vessel : CHANG SHENG JI 7 2633W ETA/ETD : 2026-09-04/2026-09-05
    Port of Discharging : JEDDAH ETA : 2026-09-25
    Place of Delivery : JEDDAH ETA : 2026-09-25
    Ocean Route Type : Non-direct(T/S Port : PORT KLANG)
    Equipment Type/Q’ty : 40'DRY HQ.-2
    Empty Pick UP CY : GREATING FORTUNE LOGISTICS CORP. Empty Pick Up Date : 2026-08-21 00:00
    Full Return CY : Cat Lai Terminal (Saigon Newport) Full Return Date : 2026-08-25 00:00
    Port Cargo Cut-off : 2026-08-27 19:00 Rail Receiving Date : ~ VGM Cut-off : 2026-08-26 10:00
    """
    res = extract_booking_from_text(raw_text, "culines_photo.png")
    assert res["Booking No"] == "CULVSGN2601792"
    assert res["Carrier"] == "CULINES"
    assert res["Vessel"] == "MTT SENARI 043S"
    assert res["Pre Carrier"] == "MTT SENARI 043S"
    assert res["T/S Port"] == "PORT KLANG"
    assert res["Port of Discharging"] == "JEDDAH"
    assert res["Place of Delivery"] == "JEDDAH"
    assert res["Equipment Type"] == "40'HC"
    assert res["Q'ty"] == "2"
    assert res["Empty Pick Up CY"] == "GREATING FORTUNE LOGISTICS CORP"
    assert res["Full return CY"] == "CAT LAI TERMINAL (SAIGON NEWPORT)"
    assert res["Port Cargo Cut-off"] == "27/08/2026 19:00"
    assert res["ETD"] == "28/08/2026"


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


# ---------------------------------------------------------------------------
# Diagnostics: engine_used + Vietnamese warnings
# ---------------------------------------------------------------------------
import requests as _requests
from backend.app.services import image_extractor as ie


def _resp(status, body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body if body is not None else {}
    r.text = json.dumps(body) if body is not None else ""
    return r


GOOD_AI_BODY = {"candidates": [{"content": {"parts": [{"text": json.dumps({
    "Booking No": "SGN601175800", "Carrier": "PIL", "Pre Carrier": "KOTA NEKAD 0272S", "ETD_Pre": "2026-07-14"
})}]}}]}


@pytest.fixture
def no_ocr(monkeypatch):
    monkeypatch.setattr(ie, "available_ocr_engines", lambda: [])


def test_detailed_gemini_success(monkeypatch, no_ocr):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(200, GOOD_AI_BODY))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model="gemini-2.5-flash")
    assert out["engine_used"] == "gemini"
    assert out["warnings"] == []
    assert out["data"]["Booking No"] == "SGN601175800"
    assert out["data"]["Vessel"] == "KOTA NEKAD 0272S"
    assert out["data"]["ETD"] == "14/07/2026"


@pytest.mark.parametrize("status,body,expected_fragment", [
    (400, {"error": {"message": "API key not valid. Please pass a valid API key."}}, "API key không hợp lệ"),
    (403, {"error": {"message": "Permission denied"}}, "API key không hợp lệ"),
    (429, {"error": {"message": "Resource has been exhausted (e.g. check quota)."}}, "hạn mức"),
    (500, {"error": {"message": "Internal"}}, "Gemini trả về lỗi (500)"),
])
def test_detailed_gemini_errors_then_no_ocr(monkeypatch, no_ocr, status, body, expected_fragment):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(status, body))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model="gemini-2.5-flash")
    assert out["engine_used"] == "none"
    assert any(expected_fragment in w for w in out["warnings"]), out["warnings"]
    assert ie.W_NO_OCR in out["warnings"]
    assert out["data"]["Booking No"] == "null"


def test_detailed_model_404_retries_a_live_model_from_the_api(monkeypatch, no_ocr):
    # DEFAULT_MODEL (or any hardcoded name) can itself go stale as Google's catalog moves,
    # so on a 404 the retry must come from a live models.list() call, not a fixed constant.
    calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        if "gemini-2.0-flash" in url:
            return _resp(404, {"error": {"message": "models/gemini-2.0-flash is not found"}})
        return _resp(200, GOOD_AI_BODY)

    monkeypatch.setattr(ie.requests, "post", fake_post)
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: _resp(200, {"models": [
        {"name": "models/gemini-9-flash", "supportedGenerationMethods": ["generateContent"]},
    ]}))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model="gemini-2.0-flash")
    assert out["engine_used"] == "gemini"
    assert len(calls) == 2 and "gemini-9-flash" in calls[1]
    assert any("gemini-2.0-flash" in w and "không khả dụng" in w for w in out["warnings"])


def test_detailed_model_404_with_no_live_fallback_reports_model_unavailable(monkeypatch, no_ocr):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(404, {"error": {"message": "not found"}}))
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: _resp(400, {"error": {"message": "bad key"}}))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model=ie.DEFAULT_MODEL)
    assert out["engine_used"] == "none"
    assert any("không khả dụng" in w for w in out["warnings"])


def test_detailed_network_timeout(monkeypatch, no_ocr):
    def boom(*a, **k):
        raise _requests.exceptions.Timeout("timed out")
    monkeypatch.setattr(ie.requests, "post", boom)
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model=ie.DEFAULT_MODEL)
    assert ie.W_NETWORK in out["warnings"]


def test_detailed_no_key_ocr_no_text(monkeypatch):
    monkeypatch.setattr(ie, "get_system_setting", lambda key, default="": "")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(ie, "run_local_ocr", lambda b, total_timeout=15: ("", ["swift"]))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg")
    assert out["engine_used"] == "none"
    assert ie.W_NO_KEY in out["warnings"]
    assert ie.W_OCR_NO_TEXT in out["warnings"]


def test_detailed_ocr_text_without_booking_fields(monkeypatch):
    monkeypatch.setattr(ie, "get_system_setting", lambda key, default="": "")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(ie, "run_local_ocr", lambda b, total_timeout=15: ("hello world", ["tesseract"]))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg")
    assert out["engine_used"] == "ocr"
    assert ie.W_NO_FIELDS in out["warnings"]


def test_detailed_ocr_success(monkeypatch):
    monkeypatch.setattr(ie, "get_system_setting", lambda key, default="": "")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(ie, "run_local_ocr", lambda b, total_timeout=15: ("Booking No : SGN601021000\nPort of Discharging : DURBAN", ["swift"]))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg")
    assert out["engine_used"] == "ocr"
    assert out["data"]["Booking No"] == "SGN601021000"
    assert out["data"]["Carrier"] == "PIL"
    assert ie.W_NO_FIELDS not in out["warnings"]


def test_extract_booking_from_image_returns_plain_dict_by_default(monkeypatch, no_ocr):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(200, GOOD_AI_BODY))
    data = ie.extract_booking_from_image(create_sample_image_bytes(), "a.jpg", api_key="k", model=ie.DEFAULT_MODEL)
    assert data["Booking No"] == "SGN601175800"
    assert "engine_used" not in data


def test_available_ocr_engines_requires_swift_on_path(monkeypatch):
    monkeypatch.setattr(ie.sys, "platform", "darwin")
    monkeypatch.setattr(ie.shutil, "which", lambda name: None)
    assert "swift" not in ie.available_ocr_engines()
    monkeypatch.setattr(ie.sys, "platform", "win32")
    monkeypatch.setattr(ie.shutil, "which", lambda name: "/usr/bin/" + name)
    assert "swift" not in ie.available_ocr_engines()


def test_run_local_ocr_no_engines(monkeypatch, no_ocr):
    assert ie.run_local_ocr(b"x") == ("", [])


def test_verify_key_distinguishes_404_model(monkeypatch):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(404, {"error": {"message": "models/x is not found"}}))
    res = ie.verify_gemini_api_key("k", "gemini-2.0-flash")
    assert res["valid"] is False
    assert res["error_type"] == "model_not_found"
    assert "gemini-2.0-flash" in res["message"]


def test_verify_key_invalid_key_type(monkeypatch):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(400, {"error": {"message": "API key not valid"}}))
    res = ie.verify_gemini_api_key("k")
    assert res["error_type"] == "invalid_key"


def test_list_gemini_models_filters_generate_content(monkeypatch):
    body = {"models": [
        {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent", "countTokens"]},
        {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/gemini-3-flash", "supportedGenerationMethods": ["generateContent"]},
    ]}
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: _resp(200, body))
    models, from_api = ie.list_gemini_models("k")
    assert from_api is True
    assert models[0] == "gemini-2.5-flash"
    assert set(models) == {"gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash"}


def test_list_gemini_models_fallback(monkeypatch):
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: _resp(400, {"error": {"message": "bad key"}}))
    assert ie.list_gemini_models("k") == (ie.FALLBACK_MODELS, False)
    assert ie.list_gemini_models("") == (ie.FALLBACK_MODELS, False)

    def boom(*a, **k):
        raise _requests.exceptions.ConnectionError("offline")
    monkeypatch.setattr(ie.requests, "get", boom)
    assert ie.list_gemini_models("k") == (ie.FALLBACK_MODELS, False)


# --- Regression: Google's newer "auth key" credentials (prefix "AQ.", issued by AI Studio
# since mid-2026) are rejected by the API when sent as the legacy "?key=" query parameter
# ("Request had invalid authentication credentials..."). They work when sent as the
# x-goog-api-key header instead, which also works for classic "AIza..." keys. So the app
# must always send the key via that header, never via the URL/query string.

@patch("backend.app.services.image_extractor.requests.post")
def test_extract_booking_from_image_ai_sends_key_via_header_not_url(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
    mock_post.return_value = mock_response

    extract_booking_from_image_ai(create_sample_image_bytes(), filename="a.jpg", api_key="AQ.super-secret-token")

    _, kwargs = mock_post.call_args
    call_url = mock_post.call_args.args[0] if mock_post.call_args.args else kwargs.get("url", "")
    assert "AQ.super-secret-token" not in call_url
    assert kwargs["headers"]["x-goog-api-key"] == "AQ.super-secret-token"


@patch("backend.app.services.image_extractor.requests.post")
def test_verify_gemini_api_key_sends_key_via_header_not_url(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_post.return_value = mock_response

    verify_gemini_api_key("AQ.super-secret-token")

    _, kwargs = mock_post.call_args
    call_url = mock_post.call_args.args[0] if mock_post.call_args.args else kwargs.get("url", "")
    assert "AQ.super-secret-token" not in call_url
    assert kwargs["headers"]["x-goog-api-key"] == "AQ.super-secret-token"


def test_list_gemini_models_sends_key_via_header_not_url(monkeypatch):
    import backend.app.services.image_extractor as ie

    captured = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured["params"] = params
        captured["headers"] = headers
        return _resp(200, {"models": []})

    monkeypatch.setattr(ie.requests, "get", fake_get)
    ie.list_gemini_models("AQ.super-secret-token")

    assert "key" not in (captured["params"] or {})
    assert captured["headers"]["x-goog-api-key"] == "AQ.super-secret-token"


def test_detailed_model_404_cascades_through_multiple_stale_live_candidates(monkeypatch, no_ocr):
    # Google's models.list() can list several models that still 404 on generateContent
    # (deprecated but not yet delisted). The retry must cascade past more than one before
    # giving up, instead of stopping after a single (possibly also-stale) live pick.
    calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        if "gemini-9-working" in url:
            return _resp(200, GOOD_AI_BODY)
        return _resp(404, {"error": {"message": "not found"}})

    monkeypatch.setattr(ie.requests, "post", fake_post)
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: _resp(200, {"models": [
        {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/gemini-9-working", "supportedGenerationMethods": ["generateContent"]},
    ]}))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model="gemini-2.0-flash")
    assert out["engine_used"] == "gemini"
    assert len(calls) == 4  # gemini-2.0-flash, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-9-working
    assert "gemini-9-working" in calls[-1]
