"""Reads a photo of a container door: container number, tare and max gross weight.

Gemini Vision first (same key / model settings and error classes as the booking image reader), then the local
OCR text + regex as an offline fallback. The container number is always validated with the ISO 6346 check digit.
Barcodes in the photo (seal labels) are decoded locally and win over what was read from the printed text.
"""
import base64
import io
import json
import os
import re
import time
from typing import Any, Dict, List, Optional

import requests

from backend.app.core.database import get_system_setting
from backend.app.services.image_extractor import (
    DEFAULT_MODEL, GEMINI_API_URL, GEMINI_TIMEOUT_S, OCR_TIMEOUT_S, GeminiError, W_NO_KEY, W_OCR_NO_TEXT,
    _error_message_from_response, classify_gemini_http_error, get_image_mime_type, no_ocr_warning,
    run_gemini_with_fallback, run_local_ocr,
)

PROMPT = """You read photos of shipping containers: container doors / data plates and container seals (bolt seals, cable seals, plastic seals with a printed number and barcode).
Extract these fields and answer with pure JSON only (no markdown):
{
  "container_no": "owner code + serial + check digit, e.g. HPCU5330042. The number is often printed in pieces ('HPCU 533004 2'): join them, no spaces. Letters O/I are never digits in the 6-digit serial: read them as 0/1.",
  "tare_kg": "TARE weight in KG as an integer (the kg value, not the lb value), e.g. 3700",
  "max_gross_kg": "MAX GROSS weight in KG as an integer (the kg value, not the lb value), e.g. 32500",
  "seal_no": "the number printed on a seal, exactly as printed but without spaces, e.g. WHA4453729, TSF0763639, EMCDJS8885, NS3693307, A4260194118. The text may be rotated or vertical, read it along the barcode label.",
  "seal_brand": "the carrier / maker name printed on the seal if any, e.g. WAN HAI, EVERGREEN"
}
A photo may show a container door, a seal, or both. A seal number is NOT a container number: container_no must be 4 letters (the 4th is U, J or Z) + 7 digits; anything else printed on a seal label belongs in seal_no, and container_no stays null when no container number is visible.
Use null for anything you cannot read. Do not guess or calculate values that are not printed."""

W_NO_CONTAINER = "Không tìm thấy số container trong ảnh. Vui lòng kiểm tra lại ảnh hoặc nhập tay."
W_BAD_FORMAT = "Số cont \"{no}\" không đúng dạng chuẩn (4 chữ cái + 7 chữ số). Hãy kiểm tra lại với ảnh."
W_BAD_CHECK_DIGIT = "Số cont \"{no}\" sai chữ số kiểm tra (đúng phải là {expected}). Có thể đọc nhầm ký tự, hãy kiểm tra lại với ảnh."
W_BARCODE_CONTAINER = "Số cont đọc từ chữ là \"{read}\" nhưng mã vạch là \"{barcode}\" — đã dùng số trong mã vạch."
W_BARCODE_SEAL = "Số seal đọc từ chữ là \"{read}\" nhưng mã vạch là \"{barcode}\" — đã dùng số trong mã vạch, hãy kiểm tra lại với seal."

_CONTAINER_RE = re.compile(r"^[A-Z]{3}[UJZ]\d{7}$")


def iso6346_check_digit(first10: str) -> Optional[int]:
    """Check digit for the first 10 characters (4 letters + 6 digits); None when they are not in that shape."""
    first10 = (first10 or "").upper()
    if not re.fullmatch(r"[A-Z]{4}\d{6}", first10):
        return None
    values: Dict[str, int] = {}
    n = 10
    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if n % 11 == 0:      # 11, 22, 33 are skipped
            n += 1
        values[ch] = n
        n += 1
    total = sum((values[c] if c.isalpha() else int(c)) * (2 ** i) for i, c in enumerate(first10))
    return total % 11 % 10


def normalize_container_no(raw: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())


def container_no_warnings(no: str) -> List[str]:
    """Warnings about a container number; an empty list means it looks valid (shape and check digit)."""
    if not no:
        return [W_NO_CONTAINER]
    if not _CONTAINER_RE.match(no):
        return [W_BAD_FORMAT.format(no=no)]
    expected = iso6346_check_digit(no[:10])
    if expected is not None and expected != int(no[10]):
        return [W_BAD_CHECK_DIGIT.format(no=no, expected=expected)]
    return []


def _weight(value: Any) -> Optional[int]:
    """'3 700', '3,700', 3700.0 -> 3700; None for anything that is not a plausible weight in kg."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        n = int(round(value))
    else:
        text = str(value).strip()
        if re.fullmatch(r"\d+\.\d{1,2}", text):          # '3700.0' is a decimal, '3.700' is a thousands separator
            text = text.split(".")[0]
        digits = re.sub(r"\D", "", text)
        if not digits:
            return None
        n = int(digits)
    return n if 100 <= n <= 100000 else None


def normalize_seal_no(raw: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())[:30]


def _build_result(container_no: Any, tare: Any, max_gross: Any, seal_no: Any = None, seal_brand: Any = None) -> Dict[str, Any]:
    no = normalize_container_no(container_no)
    brand = re.sub(r"\s+", " ", str(seal_brand or "")).strip().upper()
    return {
        "container_no": no,
        "tare_kg": _weight(tare),
        "max_gross_kg": _weight(max_gross),
        "check_digit_ok": None if not _CONTAINER_RE.match(no) else not container_no_warnings(no),
        "seal_no": normalize_seal_no(seal_no),
        "seal_brand": "" if brand.lower() in ("null", "none") else brand[:30],
    }


def result_warnings(data: Dict[str, Any]) -> List[str]:
    """A seal-only photo has no container number on purpose: no warning for it."""
    if not data.get("container_no") and data.get("seal_no"):
        return []
    return container_no_warnings(data.get("container_no", ""))


# Offline OCR misreads painted container numbers in predictable ways. The owner code is always letters and the
# serial + check digit always digits, so a character in the wrong class is mapped to its look-alike; the ISO 6346
# check digit then decides whether the corrected reading is trusted.
_TO_LETTER = str.maketrans("012586", "OIZSBG")
_TO_DIGIT = str.maketrans("OQDILZSBG", "000112586")
_MAX_FIXES = 3
_OCR_TOTAL_BUDGET_S = 25   # first pass + rotated retries
_OCR_MIN_RETRY_S = 3


def find_container_no(text: str) -> str:
    """Best container number in OCR text: a reading that passes the check digit with the fewest corrected
    characters wins; failing that, an uncorrected 4 letters + 7 digits (so the check-digit warning can show)."""
    compact = re.sub(r"[^A-Z0-9]", "", (text or "").upper())   # the number is often split by spaces / lines
    best_valid = None
    first_exact = ""
    for i in range(len(compact) - 10):
        raw = compact[i:i + 11]
        # the category letter is only corrected V -> U: allowing 2 -> Z would turn "GROSS 2xxxx" into a number
        owner = raw[:3].translate(_TO_LETTER) + ("U" if raw[3] == "V" else raw[3])
        no = owner + raw[4:].translate(_TO_DIGIT)
        if not _CONTAINER_RE.match(no):
            continue
        fixes = sum(a != b for a, b in zip(raw, no))
        if fixes == 0 and not first_exact:
            first_exact = no
        if fixes <= _MAX_FIXES and iso6346_check_digit(no[:10]) == int(no[10]):
            if best_valid is None or fixes < best_valid[0]:
                best_valid = (fixes, no)
    if best_valid:
        return best_valid[1]
    return _number_with_detached_check_digit(text or "", compact) or first_exact


def _number_with_detached_check_digit(text: str, compact: str) -> str:
    """OCR often returns the boxed check digit as its own line, after the type code ("HPCU | 533004 | 45G1 | 2"):
    take an exactly printed owner code + serial whose computed check digit stands alone somewhere in the text."""
    lone_digits = set(re.findall(r"(?<![A-Z0-9])(\d)(?![A-Z0-9])", text.upper()))
    for m in re.finditer(r"(?=([A-Z]{3}[UJZ]\d{6}))", compact):
        first10 = m.group(1)
        digit = str(iso6346_check_digit(first10))
        if digit in lone_digits:
            return first10 + digit
    return ""


_WEIGHT_VALUE = r"([\dO][\dO ,.]*?)\s*K[GC6]S?\b"


def _ocr_weight(match: Optional[re.Match]) -> Optional[str]:
    return match.group(1).replace("O", "0") if match else None


def _weights_from_sum(upper: str):
    """(max_gross, tare) when OCR lists the labels and the kg values in separate columns: on every data plate
    MAX GROSS = TARE + PAYLOAD, and the tare is the smaller of the two parts."""
    values = [w for w in (_weight(m.replace("O", "0")) for m in re.findall(_WEIGHT_VALUE, upper)) if w]
    for gross in sorted(set(values), reverse=True):
        parts = [v for v in values if v < gross]
        for tare in sorted(set(parts)):
            if any(abs(gross - tare - payload) <= 10 for payload in parts if payload > tare):
                return gross, tare
    return None, None


# a seal number is a short letter prefix + digits, often split by a space ("NS 3693307", "EMCDJS8885", "A4260194118")
_OCR_SEAL_RE = re.compile(r"^[A-Z]{1,6}\d{4,10}$")
_SEAL_BRANDS = ("WAN HAI", "EVERGREEN", "MAERSK", "MSC", "CMA CGM", "COSCO", "HAPAG", "YANG MING", "HMM", "ZIM",
                "OOCL", "SITC", "KMTC", "TS LINES", "ONE")


def _seal_from_text(upper: str):
    seal = ""
    for line in upper.splitlines():
        code = re.sub(r"[\s\-]", "", line)
        if not seal and 7 <= len(code) <= 14 and _OCR_SEAL_RE.match(code) and not re.match(r"^[A-Z]{3}[UJZ]\d{6,7}$", code):
            seal = code
    brand = next((b for b in _SEAL_BRANDS if re.search(rf"(?<![A-Z]){b}(?![A-Z])", upper)), "") if seal else ""
    return seal, brand


def parse_container_text(text: str) -> Dict[str, Any]:
    """Offline fallback: pulls the fields out of OCR text with regexes."""
    upper = (text or "").upper()
    tare = _ocr_weight(re.search(r"TARE(?:\s*W(?:EIGH)?T)?\.?\s*[:\-]?\s*" + _WEIGHT_VALUE, upper))
    gross = _ocr_weight(re.search(r"(?:MAX\.?\s*GROSS(?:\s*W(?:EIGH)?T)?|MAX\.?\s*G\.?W|\bM\.?G\.?W)\.?\s*[:\-]?\s*" + _WEIGHT_VALUE, upper))
    if tare is None or gross is None:
        sum_gross, sum_tare = _weights_from_sum(upper)
        gross, tare = gross or sum_gross, tare or sum_tare
    seal, brand = _seal_from_text(upper)
    return _build_result(find_container_no(upper), tare, gross, seal, brand)


_BARCODE_MAX_SIDE = 8000   # thin seal barcodes need the full phone resolution; only giant scans are shrunk
_SEAL_RE = re.compile(r"^[A-Z0-9]{4,20}$")


def read_barcodes(image_bytes: bytes) -> List[str]:
    """Texts of the barcodes / QR codes in the photo (any direction), decoded offline; [] when none or unavailable."""
    try:
        import zxingcpp
        from PIL import Image, ImageOps  # lazy import
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("L")
        if max(image.size) > _BARCODE_MAX_SIDE:
            image.thumbnail((_BARCODE_MAX_SIDE, _BARCODE_MAX_SIDE))
        found = zxingcpp.read_barcodes(image)
    except Exception:
        return []
    texts: List[str] = []
    for barcode in found:
        text = (barcode.text or "").strip()
        if barcode.valid and text and text not in texts:
            texts.append(text)
    return texts


def classify_barcodes(texts: List[str]) -> Dict[str, str]:
    """{"container_no", "seal_no"} from barcode texts: an 11-character number passing the check digit is a container,
    another short alphanumeric code is a seal (URLs and long QR payloads are ignored)."""
    out = {"container_no": "", "seal_no": ""}
    for text in texts:
        if "://" in text:
            continue
        code = normalize_container_no(text)
        if _CONTAINER_RE.match(code) and not container_no_warnings(code):
            out["container_no"] = out["container_no"] or code
        elif _SEAL_RE.match(code):
            out["seal_no"] = out["seal_no"] or code
    return out


def apply_barcodes(data: Dict[str, Any], codes: Dict[str, str]) -> List[str]:
    """Barcode values replace the ones read from text (they carry their own checksum). Returns the warnings about
    disagreements. A printed seal number that contains the barcode value or is contained in it (brand prefix) is kept."""
    warnings: List[str] = []
    container, seal = codes.get("container_no", ""), codes.get("seal_no", "")
    if container and container != data.get("container_no"):
        if data.get("container_no"):
            warnings.append(W_BARCODE_CONTAINER.format(read=data["container_no"], barcode=container))
        data["container_no"], data["check_digit_ok"] = container, True
    read_seal = data.get("seal_no", "")
    if seal and not (read_seal and (seal in read_seal or read_seal in seal)):
        if read_seal:
            warnings.append(W_BARCODE_SEAL.format(read=read_seal, barcode=seal))
        data["seal_no"] = seal
    return warnings


def _rotated(image_bytes: bytes, angle: int) -> Optional[bytes]:
    try:
        from PIL import Image, ImageOps  # lazy import
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes)))
        out = io.BytesIO()
        image.rotate(angle, expand=True).save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return None


def _ocr_container(image_bytes: bytes, retry_rotated: bool = True):
    """Local OCR, retried on the photo turned 90° / 270° when no number passes the check digit
    (seal labels and some door markings are printed vertically). Returns (text, data, engines_tried)."""
    started = time.monotonic()
    text, tried = run_local_ocr(image_bytes, total_timeout=OCR_TIMEOUT_S)
    data = parse_container_text(text)
    if not tried or not retry_rotated:
        return text, data, tried
    for angle in (90, 270):
        if data["check_digit_ok"] or data["seal_no"]:
            break
        remaining = _OCR_TOTAL_BUDGET_S - (time.monotonic() - started)
        if remaining < _OCR_MIN_RETRY_S:
            break
        rotated = _rotated(image_bytes, angle)
        if rotated is None:
            break
        rotated_text, _ = run_local_ocr(rotated, total_timeout=remaining)
        rotated_data = parse_container_text(rotated_text)
        if rotated_data["check_digit_ok"]:
            for key in ("tare_kg", "max_gross_kg"):
                rotated_data[key] = rotated_data[key] or data[key]
            text, data = "\n".join(t for t in (text, rotated_text) if t), rotated_data
    return text, data, tried


def extract_container_from_image_ai(image_bytes: bytes, api_key: str, model: str = DEFAULT_MODEL,
                                    timeout: float = GEMINI_TIMEOUT_S) -> Dict[str, Any]:
    """Gemini Vision call. Raises GeminiError (classified) on failure."""
    if not api_key:
        raise ValueError("Gemini API key is required for AI Vision extraction")
    payload = {
        "contents": [{"parts": [
            {"text": PROMPT},
            {"inline_data": {"mime_type": get_image_mime_type(image_bytes), "data": base64.b64encode(image_bytes).decode("utf-8")}},
        ]}],
        "generationConfig": {"temperature": 0.0, "response_mime_type": "application/json"},
    }
    try:
        response = requests.post(GEMINI_API_URL.format(model=model), json=payload,
                                 headers={"x-goog-api-key": api_key}, timeout=timeout)
    except requests.exceptions.RequestException as e:
        raise GeminiError("network", str(e))
    if response.status_code != 200:
        msg = _error_message_from_response(response)
        raise GeminiError(classify_gemini_http_error(response.status_code, msg), msg, response.status_code)
    try:
        candidates = response.json().get("candidates", [])
        if not candidates:
            raise ValueError("No candidate returned from Gemini Vision API")
        raw = candidates[0].get("content", {}).get("parts", [])[0].get("text", "{}").strip()
        raw = re.sub(r"^```(?:json)?", "", raw).removesuffix("```").strip()
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("Gemini response is not a JSON object")
    except Exception as e:
        raise GeminiError("bad_response", f"Failed to parse Gemini Vision response: {e}")
    return _build_result(parsed.get("container_no"), parsed.get("tare_kg"), parsed.get("max_gross_kg"),
                         parsed.get("seal_no"), parsed.get("seal_brand"))


def extract_container_from_image_detailed(image_bytes: bytes, api_key: Optional[str] = None,
                                          model: Optional[str] = None) -> Dict[str, Any]:
    """Returns {"data", "engine_used": gemini|ocr|none, "warnings", "model_used", "gemini_error_kind"}
    (the same envelope as the booking image reader, so the UI can handle quota / invalid-key pauses the same way)."""
    warnings: List[str] = []
    gemini_error_kind: Optional[str] = None
    codes = classify_barcodes(read_barcodes(image_bytes))
    api_key = (api_key or get_system_setting("gemini_api_key", os.environ.get("GEMINI_API_KEY", "")) or "").strip()
    chosen = (model or get_system_setting("gemini_model", DEFAULT_MODEL) or DEFAULT_MODEL).strip()

    if api_key:
        outcome = run_gemini_with_fallback(
            api_key, chosen, lambda m, timeout: extract_container_from_image_ai(image_bytes, api_key, m, timeout=timeout))
        warnings.extend(outcome["warnings"])
        if outcome["data"] is not None:
            data = outcome["data"]
            warnings.extend(apply_barcodes(data, codes))
            warnings.extend(result_warnings(data))
            return {"data": data, "engine_used": "gemini", "warnings": warnings, "model_used": outcome["model_used"],
                    "gemini_error_kind": None}
        gemini_error_kind = outcome["error_kind"]
    else:
        warnings.append(W_NO_KEY)
        gemini_error_kind = "no_key"

    text, data, tried = _ocr_container(image_bytes, retry_rotated=not codes["container_no"])
    barcode_warnings = apply_barcodes(data, codes)
    if not tried:
        warnings.append(no_ocr_warning())
        return {"data": data, "engine_used": "none", "warnings": warnings, "model_used": None, "gemini_error_kind": gemini_error_kind}
    if not text.strip():
        warnings.append(W_OCR_NO_TEXT)
        return {"data": data, "engine_used": "none", "warnings": warnings, "model_used": None, "gemini_error_kind": gemini_error_kind}
    warnings.extend(barcode_warnings)
    warnings.extend(result_warnings(data))
    return {"data": data, "engine_used": "ocr", "warnings": warnings, "model_used": None, "gemini_error_kind": gemini_error_kind}
