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
        "container_no": "HPCU5330042", "tare_kg": 3700, "max_gross_kg": 32500, "check_digit_ok": True, "seal_no": "", "seal_brand": ""}


def test_parse_text_with_nothing_readable():
    res = cx.parse_container_text("hello world")
    assert res["container_no"] == "" and res["tare_kg"] is None and res["check_digit_ok"] is None


@pytest.mark.parametrize("text", [
    "HPCU 5330O4 2",                      # O read for 0 in the serial
    "HPCV 533004 2",                      # V read for U
    "HPCU S33004 2",                      # S read for 5
    "H\nP\nC\nU\n5\n3\n3\n0\n0\n4\n2",  # vertical marking, one character per OCR line
    "CONTAINER HPCU 533004 [2] 45G1",
])
def test_ocr_misreads_are_corrected_when_the_check_digit_confirms_them(text):
    res = cx.parse_container_text(text)
    assert res["container_no"] == "HPCU5330042" and res["check_digit_ok"] is True


def test_a_correction_never_replaces_an_unconfirmed_exact_reading():
    # nothing passes the check digit: keep what was printed so the UI shows the check-digit warning
    res = cx.parse_container_text("HPCU 533004 3")
    assert res["container_no"] == "HPCU5330043" and res["check_digit_ok"] is False


def test_a_number_passing_the_check_digit_beats_an_earlier_one_that_does_not():
    assert cx.find_container_no("HPCU5330043 CSQU3054383") == "CSQU3054383"


@pytest.mark.parametrize("weight", range(20000, 35000, 37))
def test_door_text_around_a_misread_check_digit_never_becomes_a_number(weight):
    # "GROSS 2xxxx" once looked like owner "OSSZ" + serial when 2 could be corrected to Z
    text = f"HPCU 533004 7\n45G1\nMAX GROSS {weight} 52910 LB\nTARE 3700 KG"
    assert cx.find_container_no(text) == "HPCU5330047"


@pytest.mark.parametrize("text,tare,gross", [
    ("TARE 3 7OO KG MAX GROSS 32 5OO KG", 3700, 32500),
    ("TARE WT: 2,200 KGS\nM.G.W. 30,480 KGS", 2200, 30480),
    ("TARE\n3.700 K6\nMAX.GROSS\n32.500 KG", 3700, 32500),
])
def test_ocr_weights_tolerate_common_misreads(text, tare, gross):
    res = cx.parse_container_text(text)
    assert (res["tare_kg"], res["max_gross_kg"]) == (tare, gross)


def test_ocr_retries_on_a_rotated_photo_and_keeps_weights_from_the_first_pass(monkeypatch):
    calls = []

    def fake_ocr(image_bytes, total_timeout=15):
        calls.append(Image.open(io.BytesIO(image_bytes)).size)
        return ("TARE 3700 KG" if len(calls) == 1 else "HPCU 533004 2"), ["stub"]

    monkeypatch.setattr(cx, "run_local_ocr", fake_ocr)
    buf = io.BytesIO()
    Image.new("RGB", (40, 10), "white").save(buf, format="PNG")
    text, data, tried = cx._ocr_container(buf.getvalue())
    assert calls == [(40, 10), (10, 40)]
    assert data["container_no"] == "HPCU5330042" and data["tare_kg"] == 3700 and tried == ["stub"]


def test_ocr_does_not_rotate_when_the_first_pass_is_valid(monkeypatch):
    calls = []
    monkeypatch.setattr(cx, "run_local_ocr", lambda b, total_timeout=15: (calls.append(1), ("HPCU5330042", ["stub"]))[1])
    cx._ocr_container(b"img")
    assert calls == [1]


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
    assert res["data"] == {"container_no": "HPCU5330042", "tare_kg": 3700, "max_gross_kg": 32500, "check_digit_ok": True,
                           "seal_no": "", "seal_brand": ""}


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


@pytest.mark.parametrize("raw,expected", [("WHA4453729", "WHA4453729"), ("A4 26 0194118", "A4260194118"), ("NS 3693307", "NS3693307"),
                                           ("emcdjs-8885", "EMCDJS8885"), (None, "")])
def test_seal_numbers_are_normalized(raw, expected):
    assert cx._build_result(None, None, None, raw)["seal_no"] == expected


def test_seal_only_photo_is_a_valid_result_without_container_warnings(monkeypatch):
    res = _detailed(monkeypatch, gemini=cx._build_result(None, None, None, "WHA 4453729", "wan  hai"))
    assert res["engine_used"] == "gemini" and res["warnings"] == []
    assert res["data"]["container_no"] == "" and res["data"]["seal_no"] == "WHA4453729" and res["data"]["seal_brand"] == "WAN HAI"


def test_photo_without_container_or_seal_still_warns(monkeypatch):
    res = _detailed(monkeypatch, gemini=cx._build_result(None, None, None))
    assert "Không tìm thấy số container" in res["warnings"][0]


def test_seal_brand_null_text_is_dropped():
    assert cx._build_result("HPCU5330042", 3700, 32500, "X1", "null")["seal_brand"] == ""


def _photo_with_barcodes(*codes, rotate=0) -> bytes:
    """A white 'photo' with Code 128 barcodes stacked on it, optionally turned like a vertical seal label."""
    import zxingcpp
    bars = []
    for code in codes:
        view = memoryview(zxingcpp.write_barcode_to_image(zxingcpp.create_barcode(code, zxingcpp.BarcodeFormat.Code128), scale=3))
        bars.append(Image.frombytes("L", (view.shape[1], view.shape[0]), view.tobytes()))
    photo = Image.new("RGB", (max(b.width for b in bars) + 200, sum(b.height + 100 for b in bars) + 100), "white")
    y = 100
    for bar in bars:
        photo.paste(bar, (100, y))
        y += bar.height + 100
    buf = io.BytesIO()
    photo.rotate(rotate, expand=True, fillcolor="white").save(buf, format="PNG")
    return buf.getvalue()


def test_read_barcodes_finds_a_vertical_seal_barcode():
    assert cx.read_barcodes(_photo_with_barcodes("WHA4453729", rotate=90)) == ["WHA4453729"]


def test_read_barcodes_on_garbage_returns_nothing():
    assert cx.read_barcodes(b"not an image") == [] and cx.read_barcodes(_png()) == []


def test_classify_barcodes():
    assert cx.classify_barcodes(["hpcu5330042", "WHA 4453729", "https://example.com/x"]) == {
        "container_no": "HPCU5330042", "seal_no": "WHA4453729"}
    # a number failing the check digit is not trusted as a container: it is just another code
    assert cx.classify_barcodes(["HPCU5330043"])["container_no"] == ""


def test_barcode_seal_replaces_a_misread_printed_seal_with_a_warning():
    data = cx._build_result("HPCU5330042", 3700, 32500, "WHA4458729")
    warnings = cx.apply_barcodes(data, {"container_no": "", "seal_no": "WHA4453729"})
    assert data["seal_no"] == "WHA4453729" and "WHA4458729" in warnings[0]


@pytest.mark.parametrize("printed,barcode", [("WHA4453729", "4453729"), ("4453729", "WHA4453729"), ("WHA4453729", "WHA4453729")])
def test_printed_seal_is_kept_when_it_only_differs_by_a_prefix(printed, barcode):
    data = cx._build_result(None, None, None, printed)
    assert cx.apply_barcodes(data, {"container_no": "", "seal_no": barcode}) == [] and data["seal_no"] == printed


def test_barcode_container_fixes_a_misread_number():
    data = cx._build_result("HPCU5330043", None, None)
    warnings = cx.apply_barcodes(data, {"container_no": "HPCU5330042", "seal_no": ""})
    assert data["container_no"] == "HPCU5330042" and data["check_digit_ok"] is True and "HPCU5330043" in warnings[0]


def test_detailed_merges_the_barcode_seal_into_the_gemini_result(monkeypatch):
    monkeypatch.setattr(cx, "get_system_setting", lambda name, default="": "k" if name == "gemini_api_key" else default)
    monkeypatch.setattr(cx, "extract_container_from_image_ai", lambda *a, **k: cx._build_result("HPCU5330042", 3700, 32500))
    res = cx.extract_container_from_image_detailed(_photo_with_barcodes("WHA4453729"))
    assert res["engine_used"] == "gemini" and res["warnings"] == [] and res["data"]["seal_no"] == "WHA4453729"


def test_offline_barcode_container_skips_rotated_ocr_retries(monkeypatch):
    monkeypatch.setattr(cx, "get_system_setting", lambda name, default="": "")
    calls = []
    monkeypatch.setattr(cx, "run_local_ocr", lambda b, total_timeout=15: (calls.append(1), ("TARE 3700 KG", ["stub"]))[1])
    res = cx.extract_container_from_image_detailed(_photo_with_barcodes("HPCU5330042"))
    assert calls == [1] and res["engine_used"] == "ocr"
    assert res["data"]["container_no"] == "HPCU5330042" and res["data"]["tare_kg"] == 3700


# OCR text exactly as macOS Vision returned it for real photos (user samples, Oct 2026)
REAL_DOOR_OCR = ("HPCU\n533004\n45G1\n2\nMAX GROSS\nTARE\nPAYLOAD\nCU. CAP.\n32 500 kg\n71 650\nIb\n3 700 kg\n8 160 lb\n"
                 "28 800 kg\n63 490 lb\n76.4 cu.m.\n2698 cu.ft\n10M. 056.30")


def test_real_door_ocr_with_detached_check_digit_and_column_weights():
    assert cx.parse_container_text(REAL_DOOR_OCR) == {
        "container_no": "HPCU5330042", "tare_kg": 3700, "max_gross_kg": 32500, "check_digit_ok": True, "seal_no": "", "seal_brand": ""}


@pytest.mark.parametrize("text,seal,brand", [
    ("(Remark):\nt hành (Issuer).Phan Thị Mơ\nWHA4453729\n6ZLSSPPVHM\nMH NVM•", "WHA4453729", ""),
    ("EVERGREEN\nEMCDJS8885", "EMCDJS8885", "EVERGREEN"),
    ("TSF0763639", "TSF0763639", ""),
    ("NS 3693307", "NS3693307", ""),
    ("WAN HAI\nA4 260194118", "A4260194118", "WAN HAI"),
])
def test_real_seal_ocr(text, seal, brand):
    res = cx.parse_container_text(text)
    assert (res["container_no"], res["seal_no"], res["seal_brand"]) == ("", seal, brand)
    assert cx.result_warnings(res) == []


def test_door_text_is_not_mistaken_for_a_seal():
    assert cx.parse_container_text(REAL_DOOR_OCR + "\nHPCU 533004")["seal_no"] == ""


def test_seal_photo_is_not_rotated_and_read_again(monkeypatch):
    calls = []
    monkeypatch.setattr(cx, "run_local_ocr", lambda b, total_timeout=15: (calls.append(1), ("TSF0763639", ["stub"]))[1])
    cx._ocr_container(b"img")
    assert calls == [1]


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
