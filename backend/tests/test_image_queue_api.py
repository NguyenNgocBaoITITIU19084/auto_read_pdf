import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services import image_extractor as ie
import backend.app.api.bookings as bookings_api

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def _detailed(monkeypatch, key="k", gemini=None, ocr_text=""):
    """Run the real extract_booking_from_image_detailed with a stubbed Gemini call / OCR."""
    monkeypatch.setattr(ie, "get_system_setting", lambda name, default="": key if name == "gemini_api_key" else default)
    if isinstance(gemini, Exception):
        def boom(*a, **k):
            raise gemini
        monkeypatch.setattr(ie, "extract_booking_from_image_ai", boom)
    elif gemini is not None:
        monkeypatch.setattr(ie, "extract_booking_from_image_ai", lambda *a, **k: gemini)
    monkeypatch.setattr(ie, "run_local_ocr", lambda *a, **k: (ocr_text, ["stub"] if ocr_text is not None else []))
    return ie.extract_booking_from_image_detailed(b"img", "a.png")


def test_gemini_success_reports_model_and_no_error_kind(monkeypatch):
    res = _detailed(monkeypatch, gemini={"Booking No": "SGN1", "Vessel": "HMM HOPE 062E"})
    assert res["engine_used"] == "gemini"
    assert res["model_used"] and res["gemini_error_kind"] is None


@pytest.mark.parametrize("err_kind", ["quota", "invalid_key", "network"])
def test_gemini_failures_are_machine_readable(monkeypatch, err_kind):
    res = _detailed(monkeypatch, gemini=ie.GeminiError(err_kind, "x", 429), ocr_text="")
    assert res["gemini_error_kind"] == err_kind
    assert res["model_used"] is None


def test_missing_key_is_reported_as_no_key(monkeypatch):
    res = _detailed(monkeypatch, key="", ocr_text="")
    assert res["gemini_error_kind"] == "no_key"


def test_extract_image_endpoint_passes_the_fields_through(client, monkeypatch):
    monkeypatch.setattr(bookings_api, "extract_booking_from_image", lambda *a, **k: {
        "data": {"Booking No": "SGN1"}, "engine_used": "gemini", "warnings": [],
        "model_used": "gemini-2.5-flash", "gemini_error_kind": None})
    res = client.post(f"{API}/bookings/extract-image", files={"file": ("a.png", b"\x89PNG data", "image/png")})
    assert res.status_code == 200
    body = res.json()
    assert body["engine_used"] == "gemini" and body["model_used"] == "gemini-2.5-flash" and body["gemini_error_kind"] is None


def test_check_duplicates_is_case_and_space_insensitive(client):
    col = db.create_collection("dups")
    db.insert_booking(col, {"Booking No": "SGN601175800", "Vessel": "KOTA NEKAD 0272S"})
    res = client.post(f"{API}/bookings/check-duplicates", json={
        "collection_id": col, "booking_nos": [" sgn601175800 ", "SGN999", "", "sgn601175800"]})
    assert res.status_code == 200
    assert res.json() == {"existing": ["sgn601175800"]}
    other = db.create_collection("other")
    assert client.post(f"{API}/bookings/check-duplicates", json={
        "collection_id": other, "booking_nos": ["SGN601175800"]}).json() == {"existing": []}


@pytest.mark.parametrize("status, message, kind", [
    (503, "This model is currently experiencing high demand.", "unavailable"),
    (500, "Internal error", "unavailable"),
    (200, "The model is overloaded. Please try again later.", "unavailable"),
    (429, "Resource has been exhausted (quota)", "quota"),
    (403, "API key not valid", "invalid_key"),
    (404, "models/x is not found", "model_not_found"),
    (400, "Bad request", "unknown"),
])
def test_gemini_http_errors_are_classified(status, message, kind):
    assert ie.classify_gemini_http_error(status, message) == kind


def test_overload_is_reported_with_its_own_kind(monkeypatch):
    res = _detailed(monkeypatch, gemini=ie.GeminiError("unavailable", "high demand", 503), ocr_text="")
    assert res["gemini_error_kind"] == "unavailable"
    assert ie.W_UNAVAILABLE in res["warnings"]
