import os
import io
import re
import sys
import json
import time
import base64
import shutil
import subprocess
import tempfile
import requests
from typing import Optional, Dict, Any, List, Tuple

from backend.app.core.database import get_system_setting
from backend.app.services.extractor import (
    extract_booking_from_text, parse_date_str, parse_etd, detect_carrier, has_booking_fields
)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-2.5-flash"
FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]

GEMINI_TIMEOUT_S = 40
OCR_TIMEOUT_S = 15

SYSTEM_PROMPT = """You are an expert shipping & logistics document parser specialized in Shipping Orders, Booking Confirmations, and Booking Receipts from carriers like Dongjin, PIL, CULINES (China United Lines / CUL), ONE (Ocean Network Express), SITC, Cosco, Maersk, Evergreen, CMA CGM, Hapag-Lloyd, Yang Ming, OOCL, RCL, TS Lines, Sinokor, Heung-A, Samudera, etc.

Analyze the image (which may be a photo, scan, or screenshot of a booking confirmation document) and extract the booking details.

Return ONLY a valid JSON object with the following exact keys:
{
  "Booking No": "string or 'null'",
  "Carrier": "DONGJIN | PIL | CULINES | ONE | SITC | COSCO | MAERSK | CMA CGM | EVERGREEN | WAN HAI | HAPAG-LLOYD | YANG MING | HMM | SINOKOR | HEUNG-A | SAMUDERA | TS LINES | RCL | OOCL | Khác",
  "Port of Discharging": "string or 'null'",
  "Place of Delivery": "string or 'null'",
  "Block": "string or 'null'",
  "T/S Port": "string or 'null' (Transshipment port if non-direct, else 'null')",
  "Equipment Type": "string or 'null' (e.g. 20'DRY ST, 40'HC, 40HC, 20'GP, 20GP, 40GP)",
  "Q'ty": "string or 'null' (e.g. '1', '2' - number of containers)",
  "Empty Pick Up CY": "string or 'null' (Depot / CY to pick up empty container)",
  "Full return CY": "string or 'null' (Port / Depot / CY to return full container)",
  "Port Cargo Cut-off": "string or 'null' (Cargo cut-off normalized as DD/MM/YYYY HH:MM or DD/MM/YYYY)",
  "Pre Carrier": "string or 'null' (Pre-carrier / Feeder vessel name and voyage departing from Vietnam)",
  "ETD_Pre": "string or 'null' (ETD of pre carrier as DD/MM/YYYY)",
  "Trunk Vessel": "string or 'null' (Trunk / Mother vessel name and voyage)",
  "ETD_Trunk": "string or 'null' (ETD of trunk vessel as DD/MM/YYYY)",
  "Vessel": "string or 'null' (Pre Carrier if available, else Trunk Vessel)",
  "ETD": "string or 'null' (ETD_Pre if available, else ETD_Trunk - always ETD departing Vietnam)"
}

Rules:
1. Normalize all dates to DD/MM/YYYY or DD/MM/YYYY HH:MM format (e.g. '13Jul26 02:00' -> '13/07/2026 02:00', '2026-05-04' -> '04/05/2026').
2. If equipment format is '40HC-2' or '40'DRY HQ.-2' or '20'DRY ST.-1', split into Equipment Type (e.g. '40'HC' / '20'DRY ST') and Q'ty (e.g. '2' / '1').
3. If a field cannot be found or is empty, use 'null'.
4. Do NOT wrap the JSON in Markdown backticks or write conversational text. Output pure JSON only.
"""

# ---------------------------------------------------------------------------
# Human readable (Vietnamese) warnings
# ---------------------------------------------------------------------------
W_NO_KEY = "Chưa cấu hình Gemini API key — đang dùng OCR offline (độ chính xác thấp hơn)."
W_INVALID_KEY = "Gemini API key không hợp lệ hoặc không có quyền truy cập. Vui lòng kiểm tra lại key trong Cài đặt."
W_MODEL_NOT_FOUND = "Model Gemini \"{model}\" không khả dụng (có thể đã ngừng hỗ trợ). Vui lòng chọn model khác trong Cài đặt."
W_MODEL_REPLACED = "Model Gemini \"{model}\" không khả dụng, đã tự động dùng \"{fallback}\". Nên cập nhật model trong Cài đặt."
W_QUOTA = "Đã vượt hạn mức (quota) của Gemini API. Vui lòng thử lại sau hoặc dùng API key khác."
W_NETWORK = "Không kết nối được tới Gemini (lỗi mạng hoặc quá thời gian chờ)."
W_GEMINI_OTHER = "Gemini trả về lỗi ({status}): {message}"
W_GEMINI_BAD_RESPONSE = "Không đọc được kết quả trả về từ Gemini."
W_NO_OCR = "Không có công cụ OCR offline trên máy này — cần Gemini API key hợp lệ để đọc ảnh."
W_OCR_NO_TEXT = "OCR không nhận dạng được chữ nào trong ảnh."
W_NO_FIELDS = "Không tìm thấy thông tin booking trong ảnh. Vui lòng kiểm tra lại ảnh hoặc nhập tay."


class GeminiError(Exception):
    """Gemini call failure with a classified kind.

    kind in {"invalid_key", "model_not_found", "quota", "network", "bad_response", "unknown"}
    """

    def __init__(self, kind: str, message: str = "", status: Optional[int] = None):
        super().__init__(f"Gemini API Error ({status}): {message}" if status else message)
        self.kind = kind
        self.message = message
        self.status = status


def _error_message_from_response(response) -> str:
    msg = getattr(response, "text", "") or ""
    try:
        err_json = response.json()
        if isinstance(err_json, dict) and "error" in err_json and "message" in err_json["error"]:
            msg = err_json["error"]["message"]
    except Exception:
        pass
    return str(msg)[:300]


def classify_gemini_http_error(status: int, message: str) -> str:
    low = (message or "").lower()
    if status == 404:
        return "model_not_found"
    if status == 429 or "quota" in low or "resource_exhausted" in low:
        return "quota"
    if status in (401, 403) or "api key not valid" in low or "api_key_invalid" in low or "api key expired" in low:
        return "invalid_key"
    return "unknown"


def gemini_error_warning(err: GeminiError, model: str = "") -> str:
    if err.kind == "invalid_key":
        return W_INVALID_KEY
    if err.kind == "model_not_found":
        return W_MODEL_NOT_FOUND.format(model=model)
    if err.kind == "quota":
        return W_QUOTA
    if err.kind == "network":
        return W_NETWORK
    if err.kind == "bad_response":
        return W_GEMINI_BAD_RESPONSE
    return W_GEMINI_OTHER.format(status=err.status or "?", message=err.message)


def get_image_mime_type(image_bytes: bytes) -> str:
    """Determine MIME type from image bytes header."""
    if image_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return "image/png"
    elif image_bytes.startswith(b'\xff\xd8\xff'):
        return "image/jpeg"
    elif image_bytes.startswith(b'RIFF') and image_bytes[8:12] == b'WEBP':
        return "image/webp"
    elif image_bytes.startswith(b'BM'):
        return "image/bmp"
    return "image/jpeg"


def extract_booking_from_image_ai(
    image_bytes: bytes,
    filename: str = "",
    api_key: str = "",
    model: str = DEFAULT_MODEL,
    timeout: float = GEMINI_TIMEOUT_S,
) -> dict:
    """
    Extracts booking data using Gemini Multimodal Vision API.
    Raises GeminiError (classified) on failure.
    """
    if not api_key:
        raise ValueError("Gemini API key is required for AI Vision extraction")

    mime_type = get_image_mime_type(image_bytes)
    b64_data = base64.b64encode(image_bytes).decode("utf-8")

    url = GEMINI_API_URL.format(model=model, api_key=api_key)
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": SYSTEM_PROMPT},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": b64_data
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json"
        }
    }

    try:
        response = requests.post(url, json=payload, timeout=timeout)
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
        raise GeminiError("network", str(e))
    except requests.exceptions.RequestException as e:
        raise GeminiError("network", str(e))

    if response.status_code != 200:
        msg = _error_message_from_response(response)
        raise GeminiError(classify_gemini_http_error(response.status_code, msg), msg, response.status_code)

    try:
        resp_json = response.json()
        candidates = resp_json.get("candidates", [])
        if not candidates:
            raise ValueError("No candidate returned from Gemini Vision API")

        content_parts = candidates[0].get("content", {}).get("parts", [])
        raw_text = content_parts[0].get("text", "{}")

        # Clean any accidental markdown codeblock wrapper
        clean_text = raw_text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        elif clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        parsed = json.loads(clean_text)
        if not isinstance(parsed, dict):
            raise ValueError("Gemini response is not a JSON object")
    except Exception as e:
        raise GeminiError("bad_response", f"Failed to parse Gemini Vision response: {e}")

    def _s(key: str) -> str:
        val = parsed.get(key, "null")
        return "null" if val is None else str(val)

    # Build standardized booking dictionary
    result = {
        "STT": "",
        "Tên file PDF": filename,
        "Booking No": _s("Booking No"),
        "Carrier": _s("Carrier"),
        "Port of Discharging": _s("Port of Discharging"),
        "Place of Delivery": _s("Place of Delivery"),
        "Block": _s("Block"),
        "T/S Port": _s("T/S Port"),
        "Equipment Type": _s("Equipment Type"),
        "Q'ty": _s("Q'ty"),
        "Empty Pick Up CY": _s("Empty Pick Up CY"),
        "Full return CY": _s("Full return CY"),
        "Port Cargo Cut-off": parse_date_str(_s("Port Cargo Cut-off")),
        "Pre Carrier": _s("Pre Carrier"),
        "ETD_Pre": parse_date_str(_s("ETD_Pre")),
        "Trunk Vessel": _s("Trunk Vessel"),
        "ETD_Trunk": parse_date_str(_s("ETD_Trunk")),
        "Vessel": _s("Vessel"),
        "ETD": parse_date_str(_s("ETD"))
    }

    # Resolve Vessel & ETD if not directly resolved
    if result["Vessel"] == "null" or not result["Vessel"]:
        if result["Pre Carrier"] != "null" and result["Pre Carrier"]:
            result["Vessel"] = result["Pre Carrier"]
            result["ETD"] = result["ETD_Pre"]
        elif result["Trunk Vessel"] != "null" and result["Trunk Vessel"]:
            result["Vessel"] = result["Trunk Vessel"]
            result["ETD"] = result["ETD_Trunk"]

    # Fallback carrier detection if needed
    if result["Carrier"] in ("null", "", "Khác"):
        result["Carrier"] = detect_carrier(
            "", result["Booking No"], result["Vessel"], filename
        )

    for k in result:
        if k != "Tên file PDF" and k != "STT":
            if result[k] is None or result[k] == "":
                result[k] = "null"

    return result


_SWIFT_OCR_CODE = '''
import Foundation
import Vision
import AppKit

let url = URL(fileURLWithPath: "__IMAGE_PATH__")
guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    exit(1)
}

let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
let request = VNRecognizeTextRequest { (request, error) in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    for observation in observations {
        if let topCandidate = observation.topCandidates(1).first {
            print(topCandidate.string)
        }
    }
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

try? requestHandler.perform([request])
'''


def available_ocr_engines() -> List[str]:
    """Lists local OCR engines usable on this machine (cheap checks, no OCR run)."""
    engines = []
    if sys.platform == "darwin" and shutil.which("swift"):
        engines.append("swift")
    try:
        import pytesseract  # noqa: F401
        cmd = getattr(getattr(pytesseract, "pytesseract", None), "tesseract_cmd", "tesseract") or "tesseract"
        if shutil.which(cmd) or os.path.isfile(cmd):
            engines.append("tesseract")
    except Exception:
        pass
    return engines


def _ocr_swift(image_bytes: bytes, timeout: float) -> str:
    from PIL import Image  # lazy import

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_img:
            tmp_path = tmp_img.name
        Image.open(io.BytesIO(image_bytes)).save(tmp_path, format="PNG")
        code = _SWIFT_OCR_CODE.replace("__IMAGE_PATH__", tmp_path.replace("\\", "\\\\").replace('"', '\\"'))
        res = subprocess.run(
            ["swift", "-e", code],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=max(1.0, timeout),
        )
        if res.returncode == 0:
            return res.stdout.strip()
        return ""
    except Exception as e:
        print(f"macOS Vision OCR failed: {e}")
        return ""
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _ocr_tesseract(image_bytes: bytes, timeout: float) -> str:
    try:
        import pytesseract
        from PIL import Image

        image = Image.open(io.BytesIO(image_bytes))
        return (pytesseract.image_to_string(image, timeout=max(1.0, timeout)) or "").strip()
    except Exception as e:
        print(f"Tesseract OCR failed: {e}")
        return ""


def run_local_ocr(image_bytes: bytes, total_timeout: float = OCR_TIMEOUT_S) -> Tuple[str, List[str]]:
    """
    Runs available local OCR engines within a total time budget.
    Returns (text, engines_tried). engines_tried == [] means no OCR engine available.
    """
    engines = available_ocr_engines()
    tried: List[str] = []
    deadline = time.monotonic() + total_timeout
    text = ""
    for engine in engines:
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            break
        tried.append(engine)
        if engine == "swift":
            text = _ocr_swift(image_bytes, remaining)
        elif engine == "tesseract":
            text = _ocr_tesseract(image_bytes, remaining)
        if text:
            break
    return text, tried


def extract_text_local_ocr(image_bytes: bytes) -> str:
    """Backward compatible wrapper: returns OCR text ('' when unavailable/failed)."""
    return run_local_ocr(image_bytes)[0]


def extract_booking_from_image_detailed(
    image_bytes: bytes,
    filename: str = "",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Image booking extraction with diagnostics.
    Returns {"data": dict, "engine_used": "gemini"|"ocr"|"none", "warnings": [str]}.
    - Gemini Vision first (when a key is configured); on 404 for a non-default model it retries once
      with DEFAULT_MODEL.
    - Falls back to local OCR (macOS Vision via swift / pytesseract) + text parser.
    """
    warnings: List[str] = []

    if not api_key:
        api_key = get_system_setting("gemini_api_key", os.environ.get("GEMINI_API_KEY", ""))
    api_key = (api_key or "").strip()
    chosen_model = (model or get_system_setting("gemini_model", DEFAULT_MODEL) or DEFAULT_MODEL).strip()

    if api_key:
        started = time.monotonic()
        models_to_try = [chosen_model]
        if chosen_model != DEFAULT_MODEL:
            models_to_try.append(DEFAULT_MODEL)
        for i, m in enumerate(models_to_try):
            remaining = GEMINI_TIMEOUT_S - (time.monotonic() - started)
            if remaining <= 2:
                warnings.append(W_NETWORK)
                break
            try:
                data = extract_booking_from_image_ai(image_bytes, filename, api_key, m, timeout=remaining)
                if i > 0:
                    warnings.append(W_MODEL_REPLACED.format(model=chosen_model, fallback=m))
                if not has_booking_fields(data):
                    warnings.append(W_NO_FIELDS)
                return {"data": data, "engine_used": "gemini", "warnings": warnings}
            except GeminiError as err:
                print(f"AI Vision extraction error with model {m} ({err.kind}: {err}), falling back...")
                if err.kind == "model_not_found" and i + 1 < len(models_to_try):
                    continue
                warnings.append(gemini_error_warning(err, m))
                break
            except Exception as err:  # defensive: never fail silently
                print(f"AI Vision extraction unexpected error ({err}), falling back to Local OCR...")
                warnings.append(W_GEMINI_OTHER.format(status="?", message=str(err)[:200]))
                break
    else:
        warnings.append(W_NO_KEY)

    # Local OCR fallback
    ocr_text, tried = run_local_ocr(image_bytes)
    data = extract_booking_from_text(ocr_text, filename)
    if not tried:
        warnings.append(W_NO_OCR)
        return {"data": data, "engine_used": "none", "warnings": warnings}
    if not ocr_text.strip():
        warnings.append(W_OCR_NO_TEXT)
        return {"data": data, "engine_used": "none", "warnings": warnings}
    if not has_booking_fields(data):
        warnings.append(W_NO_FIELDS)
    return {"data": data, "engine_used": "ocr", "warnings": warnings}


def extract_booking_from_image(
    image_bytes: bytes,
    filename: str = "",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    return_details: bool = False,
):
    """
    Unified entrypoint for image booking extraction.
    Returns the booking dict, or the detailed {data, engine_used, warnings} when return_details=True.
    """
    detailed = extract_booking_from_image_detailed(image_bytes, filename, api_key, model)
    return detailed if return_details else detailed["data"]


def verify_gemini_api_key(api_key: str, model: str = DEFAULT_MODEL) -> Dict[str, Any]:
    """
    Tests if a Gemini API Key (and model) works.
    Returns {"valid": bool, "message": str, "error_type": None|"invalid_key"|"model_not_found"|"quota"|"network"|"unknown"}.
    """
    model = (model or DEFAULT_MODEL).strip()
    url = GEMINI_API_URL.format(model=model, api_key=api_key)
    payload = {
        "contents": [
            {
                "parts": [{"text": "Ping"}]
            }
        ]
    }
    try:
        res = requests.post(url, json=payload, timeout=10)
    except requests.exceptions.RequestException as e:
        return {"valid": False, "error_type": "network", "message": f"{W_NETWORK} ({e})"}

    if res.status_code == 200:
        return {"valid": True, "error_type": None, "message": "API Key is valid and working properly"}

    err_msg = _error_message_from_response(res)
    kind = classify_gemini_http_error(res.status_code, err_msg)
    if kind == "invalid_key":
        vn = W_INVALID_KEY
    elif kind == "model_not_found":
        vn = W_MODEL_NOT_FOUND.format(model=model)
    elif kind == "quota":
        vn = W_QUOTA
    else:
        vn = f"Gemini trả về lỗi ({res.status_code})"
    return {"valid": False, "error_type": kind, "message": f"{vn} ({err_msg})" if err_msg else vn}


def list_gemini_models(api_key: str = "", timeout: float = 10) -> Tuple[List[str], bool]:
    """
    Lists Gemini models supporting generateContent. Returns (models, from_api).
    Falls back to FALLBACK_MODELS on any error or when no key is available.
    """
    api_key = (api_key or "").strip()
    if not api_key:
        return list(FALLBACK_MODELS), False
    try:
        models: List[str] = []
        page_token = ""
        for _ in range(5):  # pagination guard
            params = {"key": api_key, "pageSize": 1000}
            if page_token:
                params["pageToken"] = page_token
            res = requests.get(GEMINI_MODELS_URL, params=params, timeout=timeout)
            if res.status_code != 200:
                return list(FALLBACK_MODELS), False
            body = res.json() or {}
            for item in body.get("models", []) or []:
                methods = item.get("supportedGenerationMethods", []) or []
                name = str(item.get("name", "")).split("/")[-1]
                if "generateContent" not in methods or not name.startswith("gemini"):
                    continue
                if re.search(r"embedding|tts|native-audio|live|image-generation", name):
                    continue
                if name not in models:
                    models.append(name)
            page_token = body.get("nextPageToken") or ""
            if not page_token:
                break
        if not models:
            return list(FALLBACK_MODELS), False

        preferred = {m: i for i, m in enumerate(FALLBACK_MODELS)}
        models.sort(key=lambda m: (preferred.get(m, len(preferred)), m))
        return models, True
    except Exception as e:
        print(f"List Gemini models failed: {e}")
        return list(FALLBACK_MODELS), False
