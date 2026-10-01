import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import app
from backend.app.services import container_image_extractor as cx
from backend.app.services.image_extractor import GeminiError

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


@pytest.mark.parametrize("first10,digit", [("HPCU533004", 2), ("CSQU305438", 3), ("MSKU907032", 3)])
def test_iso6346_check_digit(first10, digit):
    assert cx.iso6346_check_digit(first10) == digit


def test_container_no_warnings():
    assert cx.container_no_warnings("HPCU5330042") == []
    assert "sai chữ số kiểm tra" in cx.container_no_warnings("HPCU5330043")[0]
    assert "không đúng dạng" in cx.container_no_warnings("HPCU53300")[0]
    assert "Không tìm thấy" in cx.container_no_warnings("")[0]


def test_parse_text_joins_split_number_and_reads_kg_not_lb():
    text = "HPCU 533004 2\n45G1\nMAX GROSS 32 500 kg 71 650 lb\nTARE 3 700 kg 8 160 lb\nPAYLOAD 28 800 kg"
    assert cx.parse_container_text(text) == {
        "container_no": "HPCU5330042", "tare_kg": 3700, "max_gross_kg": 32500, "check_digit_ok": True}


def test_parse_text_with_nothing_readable():
    res = cx.parse_container_text("hello world")
    assert res["container_no"] == "" and res["tare_kg"] is None and res["check_digit_ok"] is None


@pytest.mark.parametrize("raw,expected", [("3 700", 3700), ("3,700", 3700), (3700.0, 3700), ("3700.0", 3700), (None, None), ("12", None), ("abc", None)])
def test_weight_parsing(raw, expected):
    assert cx._weight(raw) == expected


def _detailed(monkeypatch, gemini=None, key="k", ocr_text=""):
    monkeypatch.setattr(cx, "get_system_setting", lambda name, default="": key if name == "gemini_api_key" else default)
    if isinstance(gemini, Exception):
        def boom(*a, **k):
            raise gemini
        monkeypatch.setattr(cx, "extract_container_from_image_ai", boom)
    elif gemini is not None:
        monkeypatch.setattr(cx, "extract_container_from_image_ai", lambda *a, **k: gemini)
    monkeypatch.setattr(cx, "run_local_ocr", lambda *a, **k: (ocr_text, ["stub"]))
    return cx.extract_container_from_image_detailed(b"img")


def test_gemini_success_has_no_warnings_for_a_valid_number(monkeypatch):
    res = _detailed(monkeypatch, gemini=cx._build_result("HPCU 533004 2", "3700", 32500.0))
    assert res["engine_used"] == "gemini" and res["gemini_error_kind"] is None and res["warnings"] == []
    assert res["data"] == {"container_no": "HPCU5330042", "tare_kg": 3700, "max_gross_kg": 32500, "check_digit_ok": True}


def test_gemini_misread_digit_is_flagged(monkeypatch):
    res = _detailed(monkeypatch, gemini=cx._build_result("HPCU5330043", 3700, 32500))
    assert res["data"]["check_digit_ok"] is False and "sai chữ số kiểm tra" in res["warnings"][0]


@pytest.mark.parametrize("kind", ["quota", "invalid_key", "unavailable"])
def test_gemini_failures_are_machine_readable_and_fall_back_to_ocr(monkeypatch, kind):
    res = _detailed(monkeypatch, gemini=GeminiError(kind, "x", 429), ocr_text="HPCU 533004 2 TARE 3700 KGS MAX GROSS 32500 KGS")
    assert res["gemini_error_kind"] == kind and res["engine_used"] == "ocr" and res["data"]["container_no"] == "HPCU5330042"


def test_no_key_is_reported(monkeypatch):
    res = _detailed(monkeypatch, key="", ocr_text="")
    assert res["gemini_error_kind"] == "no_key" and res["engine_used"] == "none"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), "white").save(buf, format="PNG")
    return buf.getvalue()


def test_endpoint_returns_the_detailed_envelope(client, monkeypatch):
    import backend.app.api.containers as api
    seen = {}

    def fake(image_bytes, api_key=None):
        seen["key"] = api_key
        return {"data": {"container_no": "HPCU5330042"}, "engine_used": "gemini", "warnings": [], "model_used": "m", "gemini_error_kind": None}

    monkeypatch.setattr(api, "extract_container_from_image_detailed", fake)
    res = client.post(f"{API}/containers/extract-image", files={"file": ("a.png", _png(), "image/png")}, data={"api_key": "abc"})
    assert res.status_code == 200
    assert res.json()["data"]["container_no"] == "HPCU5330042" and res.json()["model_used"] == "m" and seen["key"] == "abc"


def test_endpoint_rejects_non_images_and_empty_files(client):
    assert client.post(f"{API}/containers/extract-image", files={"file": ("a.pdf", b"x", "application/pdf")}).status_code == 400
    assert client.post(f"{API}/containers/extract-image", files={"file": ("a.png", b"", "image/png")}).status_code == 400
