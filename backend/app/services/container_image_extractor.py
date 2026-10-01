"""Reads a photo of a container door: container number, tare and max gross weight.

Gemini Vision first (same key / model settings and error classes as the booking image reader), then the local
OCR text + regex as an offline fallback. The container number is always validated with the ISO 6346 check digit.
"""
import base64
import json
import os
import re
import time
from typing import Any, Dict, List, Optional

import requests

from backend.app.core.database import get_system_setting
from backend.app.services.image_extractor import (
    DEFAULT_MODEL, GEMINI_API_URL, GEMINI_TIMEOUT_S, GeminiError, W_GEMINI_BAD_RESPONSE, W_GEMINI_OTHER,
    W_MODEL_REPLACED, W_NETWORK, W_NO_KEY, W_NO_OCR, W_OCR_NO_TEXT, _error_message_from_response,
    classify_gemini_http_error, gemini_error_warning, get_image_mime_type, list_gemini_models, run_local_ocr,
)

PROMPT = """You read photos of shipping container doors / data plates.
Extract these fields and answer with pure JSON only (no markdown):
{
  "container_no": "owner code + serial + check digit, e.g. HPCU5330042. The number is often printed in pieces ('HPCU 533004 2'): join them, no spaces. Letters O/I are never digits in the 6-digit serial: read them as 0/1.",
  "tare_kg": "TARE weight in KG as an integer (the kg value, not the lb value), e.g. 3700",
  "max_gross_kg": "MAX GROSS weight in KG as an integer (the kg value, not the lb value), e.g. 32500"
}
Use null for anything you cannot read. Do not guess or calculate values that are not printed."""

W_NO_CONTAINER = "Không tìm thấy số container trong ảnh. Vui lòng kiểm tra lại ảnh hoặc nhập tay."
W_BAD_FORMAT = "Số cont \"{no}\" không đúng dạng chuẩn (4 chữ cái + 7 chữ số). Hãy kiểm tra lại với ảnh."
W_BAD_CHECK_DIGIT = "Số cont \"{no}\" sai chữ số kiểm tra (đúng phải là {expected}). Có thể đọc nhầm ký tự, hãy kiểm tra lại với ảnh."

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


def _build_result(container_no: Any, tare: Any, max_gross: Any) -> Dict[str, Any]:
    no = normalize_container_no(container_no)
    return {
        "container_no": no,
        "tare_kg": _weight(tare),
        "max_gross_kg": _weight(max_gross),
        "check_digit_ok": None if not _CONTAINER_RE.match(no) else not container_no_warnings(no),
    }


def parse_container_text(text: str) -> Dict[str, Any]:
    """Offline fallback: pulls the fields out of OCR text with regexes."""
    upper = (text or "").upper()
    no = ""
    # owner code, 6-digit serial and check digit are often split by spaces / line breaks
    m = re.search(r"([A-Z]{3}[UJZ])[\s\-]*(\d{6})[\s\-]*(\d)", upper)
    if m:
        no = m.group(1) + m.group(2) + m.group(3)
    else:
        m = re.search(r"\b([A-Z]{3}[UJZ]\d{7})\b", upper)
        no = m.group(1) if m else ""
    tare = re.search(r"TARE\s*[:\-]?\s*([\d][\d ,.]*?)\s*KGS?\b", upper)
    gross = re.search(r"(?:MAX\.?\s*GROSS|MAX\.?\s*G\.?W\.?)\s*[:\-]?\s*([\d][\d ,.]*?)\s*KGS?\b", upper)
    return _build_result(no, tare.group(1) if tare else None, gross.group(1) if gross else None)


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
    return _build_result(parsed.get("container_no"), parsed.get("tare_kg"), parsed.get("max_gross_kg"))


def extract_container_from_image_detailed(image_bytes: bytes, api_key: Optional[str] = None,
                                          model: Optional[str] = None) -> Dict[str, Any]:
    """Returns {"data", "engine_used": gemini|ocr|none, "warnings", "model_used", "gemini_error_kind"}
    (the same envelope as the booking image reader, so the UI can handle quota / invalid-key pauses the same way)."""
    warnings: List[str] = []
    gemini_error_kind: Optional[str] = None
    api_key = (api_key or get_system_setting("gemini_api_key", os.environ.get("GEMINI_API_KEY", "")) or "").strip()
    chosen = (model or get_system_setting("gemini_model", DEFAULT_MODEL) or DEFAULT_MODEL).strip()

    if api_key:
        started = time.monotonic()
        models_to_try = [chosen]
        looked_up_live = False
        i = 0
        while i < len(models_to_try):
            m = models_to_try[i]
            remaining = GEMINI_TIMEOUT_S - (time.monotonic() - started)
            if remaining <= 2:
                warnings.append(W_NETWORK)
                gemini_error_kind = "network"
                break
            try:
                data = extract_container_from_image_ai(image_bytes, api_key, m, timeout=remaining)
                if i > 0:
                    warnings.append(W_MODEL_REPLACED.format(model=chosen, fallback=m))
                warnings.extend(container_no_warnings(data["container_no"]))
                return {"data": data, "engine_used": "gemini", "warnings": warnings, "model_used": m, "gemini_error_kind": None}
            except GeminiError as err:
                if err.kind == "model_not_found":
                    if not looked_up_live:
                        looked_up_live = True
                        live_models, from_api = list_gemini_models(api_key)
                        if from_api:
                            models_to_try.extend([mm for mm in live_models if mm not in models_to_try][:4])
                    if i + 1 < len(models_to_try):
                        i += 1
                        continue
                warnings.append(gemini_error_warning(err, m))
                gemini_error_kind = err.kind
                break
            except Exception as err:  # never fail silently
                warnings.append(W_GEMINI_OTHER.format(status="?", message=str(err)[:200]))
                gemini_error_kind = "unknown"
                break
    else:
        warnings.append(W_NO_KEY)
        gemini_error_kind = "no_key"

    text, tried = run_local_ocr(image_bytes)
    data = parse_container_text(text)
    if not tried:
        warnings.append(W_NO_OCR)
        return {"data": data, "engine_used": "none", "warnings": warnings, "model_used": None, "gemini_error_kind": gemini_error_kind}
    if not text.strip():
        warnings.append(W_OCR_NO_TEXT)
        return {"data": data, "engine_used": "none", "warnings": warnings, "model_used": None, "gemini_error_kind": gemini_error_kind}
    warnings.extend(container_no_warnings(data["container_no"]))
    return {"data": data, "engine_used": "ocr", "warnings": warnings, "model_used": None, "gemini_error_kind": gemini_error_kind}
