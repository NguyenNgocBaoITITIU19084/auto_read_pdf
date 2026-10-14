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
    assert body["engine_used"] == "pdf"
    assert body["warnings"] == []
    assert body["data"]["Carrier"] == "CULINES"
    assert body["data"]["ETD"] == "28/08/2026"


def test_extract_image_pdf_does_not_save(monkeypatch, col_id):
    monkeypatch.setattr(
        "backend.app.services.extractor.read_pdf_text",
        lambda p: "Booking No : CULVSGN2601792\nPre Carrier : MTT SENARI 043S ETA/ETD : 2026-08-27/2026-08-28\n",
    )
    files = {"file": ("CUL.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")}
    assert client.post("/api/v1/bookings/extract-image", files=files).status_code == 200
    assert get_bookings(col_id) == []


def _blank_pdf(pages: int) -> bytes:
    import pypdfium2

    doc = pypdfium2.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(595, 842)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_pdf_preview_renders_pages():
    files = {"file": ("bk.pdf", io.BytesIO(_blank_pdf(2)), "application/pdf")}
    body = client.post("/api/v1/bookings/pdf-preview", files=files).json()
    assert body["page_count"] == 2
    assert body["truncated"] is False
    assert len(body["pages"]) == 2
    assert all(p.startswith("data:image/jpeg;base64,") for p in body["pages"])


def test_pdf_preview_caps_page_count():
    from backend.app.services import pdf_preview

    body = pdf_preview.render_pdf_pages(_blank_pdf(3), max_pages=2)
    assert body["page_count"] == 3 and body["truncated"] is True and len(body["pages"]) == 2


def test_pdf_preview_rejects_non_pdf_and_broken_files():
    files = {"file": ("a.png", io.BytesIO(b"x"), "image/png")}
    assert client.post("/api/v1/bookings/pdf-preview", files=files).status_code == 400
    files = {"file": ("a.pdf", io.BytesIO(b"not a pdf"), "application/pdf")}
    assert client.post("/api/v1/bookings/pdf-preview", files=files).status_code == 422


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


def _image_bytes(fmt: str) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(buf, format=fmt)
    return buf.getvalue()


def _fake_ocr(seen: list):
    def fake(image_bytes, filename="", api_key=None, model=None, return_details=False):
        seen.append(image_bytes)
        return {"data": dict(SAMPLE), "engine_used": "ocr", "warnings": []}
    return fake


def test_file_kind_is_told_from_content():
    from backend.app.services.file_kind import IMAGE, PDF, detect_file_kind

    assert detect_file_kind(_blank_pdf(1), "scan.png") == PDF
    assert detect_file_kind(_image_bytes("PNG"), "booking.pdf") == IMAGE
    assert detect_file_kind(_image_bytes("GIF"), "") == IMAGE
    assert detect_file_kind(_image_bytes("TIFF"), "x.tif") == IMAGE
    assert detect_file_kind(b"hello", "notes.txt") is None


@pytest.mark.parametrize("name,fmt,mime", [
    ("booking.pdf", "PNG", "application/pdf"),   # a photo saved under a .pdf name
    ("chup-man-hinh", "JPEG", "application/octet-stream"),  # no extension
    ("anim.gif", "GIF", "image/gif"),
    ("fax.tiff", "TIFF", "image/tiff"),
])
def test_dropped_images_are_read_with_ocr_whatever_their_name(monkeypatch, name, fmt, mime):
    seen = []
    monkeypatch.setattr(bookings_api, "extract_booking_from_image", _fake_ocr(seen))
    res = client.post("/api/v1/bookings/extract-image", files={"file": (name, io.BytesIO(_image_bytes(fmt)), mime)})
    assert res.status_code == 200
    assert res.json()["engine_used"] == "ocr" and res.json()["data"]["Booking No"] == SAMPLE["Booking No"]
    assert seen and seen[0][:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xdb")  # GIF / TIFF sent as PNG


def test_scanned_pdf_is_read_with_ocr(monkeypatch):
    monkeypatch.setattr("backend.app.services.extractor.read_pdf_text", lambda p: "")
    seen = []
    monkeypatch.setattr(bookings_api, "extract_booking_from_image", _fake_ocr(seen))
    files = {"file": ("scan.pdf", io.BytesIO(_blank_pdf(3)), "application/pdf")}
    body = client.post("/api/v1/bookings/extract-image", files=files).json()
    assert body["engine_used"] == "ocr"
    assert body["warnings"] == [bookings_api.W_PDF_SCANNED]
    assert body["data"]["Vessel"] == "KOTA NEKAD 0272S" and body["data"]["Tên file PDF"] == "scan.pdf"
    assert len(seen) == 1 and seen[0].startswith(b"\xff\xd8\xff")  # the first pages, in one OCR call


def test_upload_reads_misnamed_images(monkeypatch, col_id):
    monkeypatch.setattr(bookings_api, "extract_booking_from_image", _fake_ocr([]))
    files = [("files", ("photo.pdf", _image_bytes("PNG"), "application/pdf")),
             ("files", ("notes.txt", b"hello", "text/plain"))]
    body = client.post("/api/v1/bookings/upload", data={"collection_id": str(col_id)}, files=files).json()
    assert body["count"] == 1
    assert [b["Booking No"] for b in get_bookings(col_id)] == [SAMPLE["Booking No"]]


def test_pdf_preview_shows_a_misnamed_photo():
    files = {"file": ("photo.pdf", io.BytesIO(_image_bytes("PNG")), "application/pdf")}
    body = client.post("/api/v1/bookings/pdf-preview", files=files).json()
    assert body["page_count"] == 1 and body["pages"][0].startswith("data:image/png;base64,")
