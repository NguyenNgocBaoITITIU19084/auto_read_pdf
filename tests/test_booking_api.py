"""API tests for bookings (batch-delete, extract-image diagnostics, non-blocking upload) and AI settings."""
import asyncio
import io
import time
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api import bookings as bookings_api
from backend.app.api import settings as settings_api
from backend.app.core.database import init_db, create_collection, get_bookings, insert_booking, get_system_setting, set_system_setting

app = FastAPI()
app.include_router(bookings_api.router, prefix="/api/v1")
app.include_router(settings_api.router, prefix="/api/v1")


@app.get("/ping")
def ping():
    return {"ok": True}


client = TestClient(app)


@pytest.fixture(autouse=True)
def _db():
    init_db()


@pytest.fixture
def col_id():
    return create_collection(f"booking-api-{time.time_ns()}")


SAMPLE = {"Booking No": "SGN601175800", "Carrier": "PIL", "Pre Carrier": "KOTA NEKAD 0272S", "ETD_Pre": "14/07/2026"}


def test_batch_delete_bookings(col_id):
    ids = [insert_booking(col_id, dict(SAMPLE, **{"Booking No": f"BK{i}"})) for i in range(3)]
    res = client.post("/api/v1/bookings/batch-delete", json={"ids": ids[:2]})
    assert res.status_code == 200
    assert res.json() == {"status": "success", "deleted": 2}
    remaining = get_bookings(col_id)
    assert [r["id"] for r in remaining] == [ids[2]]


def test_batch_delete_empty_ids():
    res = client.post("/api/v1/bookings/batch-delete", json={"ids": []})
    assert res.status_code == 200
    assert res.json()["deleted"] == 0


def test_batch_delete_calls_db_function(monkeypatch):
    seen = {}

    def fake(ids):
        seen["ids"] = ids
        return len(ids)

    monkeypatch.setattr(bookings_api, "delete_bookings_batch", fake)
    res = client.post("/api/v1/bookings/batch-delete", json={"ids": [5, 6]})
    assert res.json() == {"status": "success", "deleted": 2}
    assert seen["ids"] == [5, 6]


def test_extract_image_returns_engine_and_warnings(monkeypatch):
    def fake_extract(image_bytes, filename="", api_key=None, model=None, return_details=False):
        assert return_details is True
        return {
            "data": dict(SAMPLE, **{"Trunk Vessel": "null", "ETD_Trunk": "null"}),
            "engine_used": "ocr",
            "warnings": ["Gemini API key không hợp lệ"],
        }

    monkeypatch.setattr(bookings_api, "extract_booking_from_image", fake_extract)
    files = {"file": ("snap.png", io.BytesIO(b"\x89PNG\r\n\x1a\nfake"), "image/png")}
    res = client.post("/api/v1/bookings/extract-image", files=files)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "success"
    assert body["engine_used"] == "ocr"
    assert body["warnings"] == ["Gemini API key không hợp lệ"]
    assert body["data"]["Vessel"] == "KOTA NEKAD 0272S"
    assert body["data"]["ETD"] == "14/07/2026"
    assert body["data"]["Tên file PDF"] == "snap.png"


def test_extract_image_pdf_without_text_warns(monkeypatch):
    monkeypatch.setattr("backend.app.services.extractor.read_pdf_text", lambda p: "")
    files = {"file": ("scan.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")}
    res = client.post("/api/v1/bookings/extract-image", files=files)
    assert res.status_code == 200
    body = res.json()
    assert body["engine_used"] == "none"
    assert body["warnings"] and "PDF" in body["warnings"][0]


def test_extract_image_pdf_with_text(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.extractor.read_pdf_text",
        lambda p: "Booking No : CULVSGN2601792\nPre Carrier : MTT SENARI 043S ETA/ETD : 2026-08-27/2026-08-28\n",
    )
    files = {"file": ("CUL.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")}
    body = client.post("/api/v1/bookings/extract-image", files=files).json()
    assert body["engine_used"] == "ocr"
    assert body["warnings"] == []
    assert body["data"]["Carrier"] == "CULINES"
    assert body["data"]["ETD"] == "28/08/2026"


def test_extract_image_rejects_unsupported():
    files = {"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}
    assert client.post("/api/v1/bookings/extract-image", files=files).status_code == 400


def test_upload_does_not_block_event_loop(monkeypatch, col_id):
    """A slow extraction must not freeze other requests (runs in a worker thread)."""

    def slow_extract(image_bytes, filename="", **kwargs):
        time.sleep(0.8)
        return dict(SAMPLE)

    monkeypatch.setattr(bookings_api, "extract_booking_from_image", slow_extract)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            t0 = time.monotonic()

            async def upload():
                r = await ac.post(
                    "/api/v1/bookings/upload",
                    data={"collection_id": str(col_id)},
                    files={"files": ("a.jpg", b"\xff\xd8\xffdata", "image/jpeg")},
                )
                return r, time.monotonic() - t0

            async def ping_later():
                await asyncio.sleep(0.1)
                r = await ac.get("/ping")
                return r, time.monotonic() - t0

            return await asyncio.gather(upload(), ping_later())

    (up_res, up_t), (ping_res, ping_t) = asyncio.run(scenario())
    assert up_res.status_code == 200
    assert up_res.json()["count"] == 1
    assert ping_res.status_code == 200
    assert ping_t < up_t
    assert ping_t < 0.6


def test_upload_pdf_and_image(monkeypatch, col_id):
    monkeypatch.setattr(bookings_api, "extract_booking_data", lambda path: dict(SAMPLE, **{"Booking No": "PDF1"}))
    monkeypatch.setattr(bookings_api, "extract_booking_from_image", lambda b, filename="", **k: dict(SAMPLE, **{"Booking No": "IMG1"}))
    files = [
        ("files", ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")),
        ("files", ("y.jpg", io.BytesIO(b"\xff\xd8\xff"), "image/jpeg")),
        ("files", ("z.txt", io.BytesIO(b"no"), "text/plain")),
    ]
    res = client.post("/api/v1/bookings/upload", data={"collection_id": str(col_id)}, files=files)
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 2
    assert {i["Booking No"] for i in body["items"]} == {"PDF1", "IMG1"}
    assert all(i["Vessel"] == "KOTA NEKAD 0272S" for i in body["items"])


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def test_ai_models_endpoint_uses_list(monkeypatch):
    seen = {}

    def fake_list(key, timeout=10):
        seen["key"] = key
        return ["gemini-2.5-flash", "gemini-3-pro"], True

    monkeypatch.setattr(settings_api, "list_gemini_models", fake_list)
    res = client.get("/api/v1/settings/ai/models", params={"api_key": "abc"})
    assert res.status_code == 200
    assert res.json() == {"models": ["gemini-2.5-flash", "gemini-3-pro"]}
    assert seen["key"] == "abc"


def test_ai_models_endpoint_fallback_without_key(monkeypatch):
    monkeypatch.setattr(settings_api, "get_system_setting", lambda k, d="": "")
    res = client.get("/api/v1/settings/ai/models")
    assert res.status_code == 200
    assert res.json() == {"models": ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]}


def test_saving_key_keeps_saved_model():
    set_system_setting("gemini_model", "gemini-2.5-pro")
    res = client.post("/api/v1/settings/ai", json={"gemini_api_key": "AIzaKeepModel"})
    assert res.status_code == 200
    assert get_system_setting("gemini_model") == "gemini-2.5-pro"
    assert client.get("/api/v1/settings/ai").json()["gemini_model"] == "gemini-2.5-pro"


def test_default_model_is_gemini_25_flash(monkeypatch):
    monkeypatch.setattr(settings_api, "get_system_setting", lambda k, d="": d)
    assert client.get("/api/v1/settings/ai").json()["gemini_model"] == "gemini-2.5-flash"


def test_ai_test_endpoint_reports_error_type(monkeypatch):
    monkeypatch.setattr(
        settings_api, "verify_gemini_api_key",
        lambda key, model: {"valid": False, "error_type": "model_not_found", "message": f"Model {model}"},
    )
    res = client.post("/api/v1/settings/ai/test", json={"gemini_api_key": "k", "gemini_model": "gemini-2.0-flash"})
    assert res.json()["error_type"] == "model_not_found"
    assert "gemini-2.0-flash" in res.json()["message"]
