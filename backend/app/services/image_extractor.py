import os
import io
import re
import json
import base64
import platform
import subprocess
import tempfile
import requests
from typing import Optional, Dict, Any
from PIL import Image

from backend.app.core.database import get_system_setting
from backend.app.services.extractor import (
    extract_booking_from_text, parse_date_str, parse_etd, detect_carrier
)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
DEFAULT_MODEL = "gemini-2.0-flash"

SYSTEM_PROMPT = """You are an expert shipping & logistics document parser specialized in Shipping Orders, Booking Confirmations, and Booking Receipts from carriers like Dongjin, PIL, ONE (Ocean Network Express), SITC, Cosco, Maersk, Evergreen, CMA CGM, Hapag-Lloyd, Yang Ming, OOCL, RCL, TS Lines, Sinokor, Heung-A, Samudera, etc.

Analyze the image (which may be a photo, scan, or screenshot of a booking confirmation document) and extract the booking details.

Return ONLY a valid JSON object with the following exact keys:
{
  "Booking No": "string or 'null'",
  "Carrier": "DONGJIN | PIL | ONE | SITC | COSCO | MAERSK | CMA CGM | EVERGREEN | WAN HAI | HAPAG-LLOYD | YANG MING | HMM | SINOKOR | HEUNG-A | SAMUDERA | TS LINES | RCL | OOCL | Khác",
  "Port of Discharging": "string or 'null'",
  "Place of Delivery": "string or 'null'",
  "Block": "string or 'null'",
  "T/S Port": "string or 'null' (Transshipment port if non-direct, else 'null')",
  "Equipment Type": "string or 'null' (e.g. 20'DRY ST, 40HC, 20GP, 40GP)",
  "Q'ty": "string or 'null' (e.g. '1', '2' - number of containers)",
  "Empty Pick Up CY": "string or 'null' (Depot / CY to pick up empty container)",
  "Full return CY": "string or 'null' (Port / Depot / CY to return full container)",
  "Port Cargo Cut-off": "string or 'null' (Cargo cut-off normalized as DD/MM/YYYY HH:MM or DD/MM/YYYY)",
  "Pre Carrier": "string or 'null' (Pre-carrier / Feeder vessel name and voyage)",
  "ETD_Pre": "string or 'null' (ETD of pre carrier as DD/MM/YYYY or DD/MM/YYYY HH:MM)",
  "Trunk Vessel": "string or 'null' (Trunk / Mother vessel name and voyage)",
  "ETD_Trunk": "string or 'null' (ETD of trunk vessel as DD/MM/YYYY or DD/MM/YYYY HH:MM)",
  "Vessel": "string or 'null' (Pre Carrier if available, else Trunk Vessel)",
  "ETD": "string or 'null' (ETD_Pre if available, else ETD_Trunk)"
}

Rules:
1. Normalize all dates to DD/MM/YYYY or DD/MM/YYYY HH:MM format (e.g. '13Jul26 02:00' -> '13/07/2026 02:00', '2026-05-04' -> '04/05/2026' or '2026-05-04').
2. If equipment format is '40HC-2' or '20'DRY ST.-1', split into Equipment Type '40HC' and Q'ty '2'.
3. If a field cannot be found or is empty, use 'null'.
4. Do NOT wrap the JSON in Markdown backticks or write conversational text. Output pure JSON only.
"""

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
    model: str = DEFAULT_MODEL
) -> dict:
    """
    Extracts booking data using Gemini Multimodal Vision API.
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

    response = requests.post(url, json=payload, timeout=45)
    if response.status_code != 200:
        error_detail = response.text
        try:
            err_json = response.json()
            if "error" in err_json and "message" in err_json["error"]:
                error_detail = err_json["error"]["message"]
        except Exception:
            pass
        raise RuntimeError(f"Gemini API Error ({response.status_code}): {error_detail}")

    resp_json = response.json()
    try:
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
    except Exception as e:
        raise ValueError(f"Failed to parse Gemini Vision response: {e}")

    # Build standardized booking dictionary
    result = {
        "STT": "",
        "Tên file PDF": filename,
        "Booking No": str(parsed.get("Booking No", "null")),
        "Carrier": str(parsed.get("Carrier", "null")),
        "Port of Discharging": str(parsed.get("Port of Discharging", "null")),
        "Place of Delivery": str(parsed.get("Place of Delivery", "null")),
        "Block": str(parsed.get("Block", "null")),
        "T/S Port": str(parsed.get("T/S Port", "null")),
        "Equipment Type": str(parsed.get("Equipment Type", "null")),
        "Q'ty": str(parsed.get("Q'ty", "null")),
        "Empty Pick Up CY": str(parsed.get("Empty Pick Up CY", "null")),
        "Full return CY": str(parsed.get("Full return CY", "null")),
        "Port Cargo Cut-off": parse_date_str(str(parsed.get("Port Cargo Cut-off", "null"))),
        "Pre Carrier": str(parsed.get("Pre Carrier", "null")),
        "ETD_Pre": parse_date_str(str(parsed.get("ETD_Pre", "null"))),
        "Trunk Vessel": str(parsed.get("Trunk Vessel", "null")),
        "ETD_Trunk": parse_date_str(str(parsed.get("ETD_Trunk", "null"))),
        "Vessel": str(parsed.get("Vessel", "null")),
        "ETD": parse_date_str(str(parsed.get("ETD", "null")))
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

def extract_text_local_ocr(image_bytes: bytes) -> str:
    """
    Extracts raw text from image using available local OCR engines:
    1. macOS native Vision OCR
    2. Tesseract OCR (via pytesseract or CLI)
    3. Basic fallback
    """
    text_result = ""

    # 1. macOS native Vision framework OCR
    if platform.system() == "Darwin":
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_img:
                tmp_path = tmp_img.name
                image = Image.open(io.BytesIO(image_bytes))
                image.save(tmp_path, format="PNG")

            swift_ocr_code = f'''
import Foundation
import Vision
import AppKit

let url = URL(fileURLWithPath: "{tmp_path}")
guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {{
    exit(1)
}}

let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
let request = VNRecognizeTextRequest {{ (request, error) in
    guard let observations = request.results as? [VNRecognizedTextObservation] else {{ return }}
    for observation in observations {{
        if let topCandidate = observation.topCandidates(1).first {{
            print(topCandidate.string)
        }}
    }}
}}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

try? requestHandler.perform([request])
'''
            res = subprocess.run(
                ["swift", "-e", swift_ocr_code],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15
            )
            if res.returncode == 0 and res.stdout.strip():
                text_result = res.stdout.strip()
            
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception as e:
            print(f"macOS Vision OCR failed: {e}")

    # 2. Tesseract OCR fallback
    if not text_result:
        try:
            import pytesseract
            image = Image.open(io.BytesIO(image_bytes))
            text_result = pytesseract.image_to_string(image)
        except Exception:
            pass

    return text_result

def extract_booking_from_image(
    image_bytes: bytes,
    filename: str = "",
    api_key: Optional[str] = None,
    model: Optional[str] = None
) -> dict:
    """
    Unified entrypoint for image booking extraction:
    - First attempts Google Gemini Vision AI if API key is provided or configured.
    - Falls back to Local OCR + Text Parser if AI key is missing or AI request fails.
    """
    if not api_key:
        api_key = get_system_setting("gemini_api_key", os.environ.get("GEMINI_API_KEY", ""))

    chosen_model = model or get_system_setting("gemini_model", DEFAULT_MODEL)

    if api_key:
        try:
            return extract_booking_from_image_ai(image_bytes, filename, api_key, chosen_model)
        except Exception as ai_err:
            print(f"AI Vision extraction error ({ai_err}), falling back to Local OCR...")

    # Local OCR fallback
    ocr_text = extract_text_local_ocr(image_bytes)
    return extract_booking_from_text(ocr_text, filename)

def verify_gemini_api_key(api_key: str, model: str = DEFAULT_MODEL) -> Dict[str, Any]:
    """Tests if a Gemini API Key is valid and active."""
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
        if res.status_code == 200:
            return {"valid": True, "message": "API Key is valid and working properly"}
        else:
            err_msg = res.text
            try:
                err_json = res.json()
                if "error" in err_json and "message" in err_json["error"]:
                    err_msg = err_json["error"]["message"]
            except Exception:
                pass
            return {"valid": False, "message": err_msg}
    except Exception as e:
        return {"valid": False, "message": str(e)}
