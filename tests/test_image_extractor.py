import io
import json
import pytest
from types import SimpleNamespace
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
    # 5xx is Google-side and temporary: reported as overload so the reading queue pauses and retries
    (500, {"error": {"message": "Internal"}}, "Gemini đang quá tải"),
])
def test_detailed_gemini_errors_then_no_ocr(monkeypatch, no_ocr, status, body, expected_fragment):
    monkeypatch.setattr(ie.requests, "post", lambda *a, **k: _resp(status, body))
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model="gemini-2.5-flash")
    assert out["engine_used"] == "none"
    assert any(expected_fragment in w for w in out["warnings"]), out["warnings"]
    assert ie.no_ocr_warning() in out["warnings"]
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


def _on_windows(monkeypatch, major=10):
    monkeypatch.setattr(ie.sys, "platform", "win32")
    monkeypatch.setattr(ie.sys, "getwindowsversion", lambda: SimpleNamespace(major=major), raising=False)
    monkeypatch.setattr(ie, "_windows_powershell", lambda: r"C:\\Windows\\powershell.exe")


def test_available_ocr_engines_uses_the_built_in_windows_ocr(monkeypatch):
    _on_windows(monkeypatch)
    assert "windows" in ie.available_ocr_engines()
    _on_windows(monkeypatch, major=6)   # Windows 7/8 have no Windows.Media.Ocr
    assert "windows" not in ie.available_ocr_engines()


def test_windows_ocr_passes_the_image_through_env_and_hides_the_console(monkeypatch):
    _on_windows(monkeypatch)
    seen = {}

    def fake_run(cmd, **kwargs):
        path = kwargs["env"]["AUTO_READ_OCR_IMAGE"]
        seen.update(cmd=cmd, size=Image.open(path).size, mode=Image.open(path).mode, kwargs=kwargs)
        return SimpleNamespace(returncode=0, stdout="\ufeffHPCU 533004 2\r\nTARE 3700 KG\r\n".encode("utf-8"), stderr=b"")

    monkeypatch.setattr(ie.subprocess, "run", fake_run)
    big = io.BytesIO()
    Image.new("RGB", (5200, 1000), "white").save(big, format="PNG")
    text = ie._ocr_windows(big.getvalue(), 10)
    assert text == "HPCU 533004 2\r\nTARE 3700 KG"
    assert "-EncodedCommand" in seen["cmd"] and "-NoProfile" in seen["cmd"]
    assert seen["size"] == (2600, 500) and seen["mode"] == "L"
    assert "creationflags" in seen["kwargs"]


def test_windows_without_an_ocr_language_reports_no_engine_with_the_fix(monkeypatch):
    _on_windows(monkeypatch)
    monkeypatch.setattr(ie, "available_ocr_engines", lambda: ["windows"])
    monkeypatch.setattr(ie.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=3, stdout=b"", stderr=b"NO_OCR_LANGUAGE"))
    assert ie.run_local_ocr(create_sample_image_bytes()) == ("", [])
    assert "English" in ie.no_ocr_warning()


def test_windows_ocr_failure_returns_no_text(monkeypatch):
    _on_windows(monkeypatch)
    monkeypatch.setattr(ie.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1, stdout=b"", stderr=b"boom"))
    assert ie._ocr_windows(create_sample_image_bytes(), 10) == ""


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


@pytest.mark.skipif(ie.sys.platform != "win32", reason="runs the real Windows.Media.Ocr (Windows CI job)")
def test_real_windows_ocr_reads_a_container_number():
    from PIL import ImageDraw, ImageFont
    image = Image.new("RGB", (1400, 260), "white")
    font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 120)
    ImageDraw.Draw(image).text((40, 60), "HPCU 533004 2", fill="black", font=font)
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    try:
        text = ie._ocr_windows(buf.getvalue(), 60)
    except ie.OcrLanguageMissing:
        pytest.skip("this Windows image has no OCR recognizer language installed")
    assert "533004" in text.replace(" ", ""), text


LIVE = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash-lite",
        "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.1-flash-image"]


def test_busy_fallbacks_prefer_newest_stable_flash_then_lite():
    assert ie.busy_fallback_models(LIVE, ["gemini-3.8-flash"]) == [
        "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]


def _runner(monkeypatch, behaviour):
    """behaviour: model -> exception to raise, or a value to return. Records (model, timeout) calls."""
    monkeypatch.setattr(ie, "list_gemini_models", lambda key, timeout=10: (LIVE, True))
    calls = []

    def call(model, timeout):
        calls.append((model, timeout))
        result = behaviour.get(model, "ok:" + model)
        if isinstance(result, Exception):
            raise result
        return result
    return calls, call


def test_overloaded_model_falls_back_and_says_so(monkeypatch):
    calls, call = _runner(monkeypatch, {"gemini-3.8-flash": ie.GeminiError("unavailable", "high demand", 503)})
    out = ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    assert out["data"] == "ok:gemini-3.6-flash" and out["model_used"] == "gemini-3.6-flash" and out["error_kind"] is None
    assert out["warnings"] == [ie.W_MODEL_BUSY_REPLACED.format(model="gemini-3.8-flash", fallback="gemini-3.6-flash")]
    assert [m for m, _ in calls] == ["gemini-3.8-flash", "gemini-3.6-flash"]


def test_a_hung_model_counts_as_overloaded_and_each_call_is_capped(monkeypatch):
    calls, call = _runner(monkeypatch, {"gemini-3.8-flash": ie.GeminiError("network", "Read timed out. (read timeout=25)")})
    out = ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    assert out["model_used"] == "gemini-3.6-flash"
    assert all(timeout <= ie.GEMINI_ATTEMPT_TIMEOUT_S for _, timeout in calls)


def test_an_overloaded_model_is_skipped_for_the_next_images(monkeypatch):
    calls, call = _runner(monkeypatch, {"gemini-3.8-flash": ie.GeminiError("unavailable", "high demand", 503)})
    ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    calls.clear()
    out = ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    assert [m for m, _ in calls] == ["gemini-3.6-flash"] and "quá tải" in out["warnings"][0]


def test_every_model_overloaded_still_pauses_with_the_overload_kind(monkeypatch):
    busy = ie.GeminiError("unavailable", "high demand", 503)
    calls, call = _runner(monkeypatch, {m: busy for m in LIVE})
    out = ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    assert out["data"] is None and out["error_kind"] == "unavailable" and ie.W_UNAVAILABLE in out["warnings"]
    assert len(calls) == 1 + ie.MAX_BUSY_FALLBACKS


@pytest.mark.parametrize("kind", ["invalid_key", "quota"])
def test_key_problems_do_not_try_other_models(monkeypatch, kind):
    calls, call = _runner(monkeypatch, {"gemini-3.8-flash": ie.GeminiError(kind, "x", 400)})
    out = ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    assert len(calls) == 1 and out["error_kind"] == kind


def test_a_real_network_outage_does_not_try_other_models(monkeypatch):
    calls, call = _runner(monkeypatch, {"gemini-3.8-flash": ie.GeminiError("network", "Failed to resolve host")})
    out = ie.run_gemini_with_fallback("k", "gemini-3.8-flash", call)
    assert len(calls) == 1 and out["error_kind"] == "network"


def test_booking_reader_uses_the_busy_fallback(monkeypatch, no_ocr):
    monkeypatch.setattr(ie, "list_gemini_models", lambda key, timeout=10: (LIVE, True))

    def fake_post(url, **kwargs):
        if "gemini-3.8-flash" in url:
            return _resp(503, {"error": {"message": "This model is currently experiencing high demand."}})
        return _resp(200, GOOD_AI_BODY)

    monkeypatch.setattr(ie.requests, "post", fake_post)
    out = ie.extract_booking_from_image_detailed(create_sample_image_bytes(), "a.jpg", api_key="k", model="gemini-3.8-flash")
    assert out["engine_used"] == "gemini" and out["model_used"] == "gemini-3.6-flash" and out["gemini_error_kind"] is None
    assert any("quá tải" in w for w in out["warnings"])
