import os
import asyncio
import logging
import tempfile
import shutil
from typing import List, Optional, Dict, Any, Tuple
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel
from backend.app.core.database import (
    insert_booking, get_bookings, delete_booking, clear_bookings, delete_bookings_batch,
    get_bookings_page, get_booking_ids, get_bookings_by_ids,
    update_booking, find_duplicate_booking_ids, get_booking_collection_id,
)
from backend.app.schemas.models import BatchIdsRequest
from backend.app.services.extractor import extract_booking_data, has_booking_fields
from backend.app.services.image_extractor import extract_booking_from_image
from backend.app.services.booking_validation import normalize_manual_booking

logger = logging.getLogger("backend.api.bookings")

router = APIRouter(prefix="/bookings", tags=["Bookings"])

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
PDF_EXTENSIONS = {".pdf"}
ALLOWED_EXTENSIONS = PDF_EXTENSIONS.union(IMAGE_EXTENSIONS)

W_PDF_NO_TEXT = "Không tìm thấy thông tin booking trong PDF (có thể là bản scan không có lớp chữ). Vui lòng thử dán ảnh hoặc nhập tay."

class SaveBookingRequest(BaseModel):
    collection_id: int
    booking: Dict[str, Any]

class BatchDeleteRequest(BaseModel):
    ids: List[int] = []

class UpdateBookingRequest(BaseModel):
    booking: Dict[str, Any]

def _duplicate_warnings(col_id: int, booking_no: str, exclude_id: Optional[int]) -> List[str]:
    dups = find_duplicate_booking_ids(col_id, booking_no, exclude_id)
    return [f"Booking No '{booking_no.strip()}' đã có trong bộ sưu tập ({len(dups)} dòng)"] if dups else []

def _resolve_vessel_etd(data: dict) -> None:
    """Vessel/ETD = Pre Carrier/ETD_Pre if present, else Trunk Vessel/ETD_Trunk."""
    vessel = data.get("Pre Carrier", "null")
    etd = data.get("ETD_Pre", "null")
    if vessel == "null" or not vessel:
        vessel = data.get("Trunk Vessel", "null")
        etd = data.get("ETD_Trunk", "null")
    if vessel != "null" and vessel:
        data["Vessel"] = vessel
        data["ETD"] = etd

def _safe_basename(filename: str) -> str:
    name = os.path.basename((filename or "").replace("\\", "/"))
    return name or "uploaded_file"

def _extract_pdf_bytes(file_bytes: bytes) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
        tmp_pdf.write(file_bytes)
        tmp_pdf_path = tmp_pdf.name
    try:
        return extract_booking_data(tmp_pdf_path)
    finally:
        if os.path.exists(tmp_pdf_path):
            os.remove(tmp_pdf_path)

def _process_uploads(collection_id: int, uploads: List[Tuple[str, bytes]]) -> List[dict]:
    """Blocking work (pdfplumber / Gemini / OCR / sqlite) — run in a worker thread."""
    extracted_results = []
    temp_dir = tempfile.mkdtemp(prefix="booking_upload_")
    try:
        for filename, file_bytes in uploads:
            file_ext = os.path.splitext(filename)[1].lower()
            try:
                if file_ext == ".pdf":
                    temp_path = os.path.join(temp_dir, _safe_basename(filename))
                    with open(temp_path, "wb") as buffer:
                        buffer.write(file_bytes)
                    data = extract_booking_data(temp_path)
                else:
                    data = extract_booking_from_image(file_bytes, filename=filename)

                data["Tên file PDF"] = filename
                _resolve_vessel_etd(data)

                row_id = insert_booking(collection_id, data)
                data["id"] = row_id
                extracted_results.append(data)
            except Exception as e:
                print(f"Error parsing {filename}: {e}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    return extracted_results

@router.get("")
def list_bookings(
    collection_id: int = Query(..., description="ID of the collection"),
    search_query: Optional[str] = Query(None, description="Search keyword"),
    search_field: Optional[str] = Query(None, description="Specific field to search")
):
    return get_bookings(collection_id, search_query, search_field)

@router.get("/page")
def list_bookings_page(
    collection_id: int = Query(...),
    limit: int = Query(50),
    offset: int = Query(0),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
):
    return get_bookings_page(collection_id, limit, offset, search_query, search_field)

@router.get("/ids")
def list_booking_ids(
    collection_id: int = Query(...),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
):
    return {"ids": get_booking_ids(collection_id, search_query, search_field)}

@router.post("/by-ids")
def list_bookings_by_ids(payload: BatchIdsRequest):
    return get_bookings_by_ids(payload.ids)

@router.post("/upload")
async def upload_bookings(
    collection_id: int = Form(...),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    uploads: List[Tuple[str, bytes]] = []
    for file in files:
        filename = file.filename or "uploaded_file"
        file_ext = os.path.splitext(filename)[1].lower()
        if file_ext not in ALLOWED_EXTENSIONS:
            continue
        uploads.append((filename, await file.read()))

    extracted_results = await asyncio.to_thread(_process_uploads, collection_id, uploads)
    logger.info(f"Upload {len(uploads)} file(s) to collection {collection_id} -> {len(extracted_results)} booking(s)")
    return {"count": len(extracted_results), "items": extracted_results}

def _extract_preview(file_bytes: bytes, filename: str, file_ext: str, api_key: Optional[str]) -> dict:
    engine_used = "none"
    warnings: List[str] = []
    if file_ext == ".pdf":
        data = _extract_pdf_bytes(file_bytes)
        # PDF text layer parsing (no AI); reported as local extraction
        if has_booking_fields(data):
            engine_used = "ocr"
        else:
            warnings.append(W_PDF_NO_TEXT)
    else:
        result = extract_booking_from_image(
            file_bytes, filename=filename, api_key=api_key, return_details=True
        )
        if isinstance(result, dict) and "data" in result and "engine_used" in result:
            data = result["data"]
            engine_used = result.get("engine_used") or "none"
            warnings = list(result.get("warnings") or [])
        else:
            data = result

    data["Tên file PDF"] = filename
    _resolve_vessel_etd(data)
    return {"status": "success", "data": data, "engine_used": engine_used, "warnings": warnings}

@router.post("/extract-image")
async def extract_image_preview(
    file: UploadFile = File(...),
    api_key: Optional[str] = Form(None)
):
    """
    Extracts booking details from a single uploaded image (or PDF) without saving to DB.
    Returns {status, data, engine_used, warnings} for preview/editing.
    """
    filename = file.filename or "booking_photo.jpg"
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in IMAGE_EXTENSIONS and file_ext not in PDF_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Please upload an image (PNG, JPG, WEBP, BMP) or PDF."
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    try:
        result = await asyncio.to_thread(_extract_preview, file_bytes, filename, file_ext, api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract image: {e}")
    logger.info(f"Image extract engine={result['engine_used']} warnings={len(result['warnings'])}")
    return result

@router.post("/manual-save")
def save_manual_booking(req: SaveBookingRequest):
    """
    Saves a reviewed or manually created booking to a collection.
    """
    data, errors = normalize_manual_booking(req.booking)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    warnings = _duplicate_warnings(req.collection_id, data.get("Booking No", ""), None)
    row_id = insert_booking(req.collection_id, data)
    logger.info(f"Manual booking saved id={row_id} collection={req.collection_id} duplicate={bool(warnings)}")
    saved = get_bookings_by_ids([row_id])
    item = saved[0] if saved else {**data, "id": row_id}
    return {"status": "success", "id": row_id, "item": item, "warnings": warnings}

@router.post("/batch-delete")
def batch_delete_bookings(req: BatchDeleteRequest):
    deleted = delete_bookings_batch(list(req.ids or []))
    logger.info(f"Deleted {deleted} booking(s)")
    return {"status": "success", "deleted": deleted}

@router.put("/{booking_id}")
def edit_booking(booking_id: int, req: UpdateBookingRequest):
    data, errors = normalize_manual_booking(req.booking, require_identity=False)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    current = get_bookings_by_ids([booking_id])
    if not current:
        raise HTTPException(status_code=404, detail="Booking không tồn tại")
    merged_no = data.get("Booking No", current[0].get("Booking No") or "")
    merged_vessel = data.get("Vessel", current[0].get("Vessel") or "")
    if not (merged_no or merged_vessel):
        raise HTTPException(status_code=400, detail="Cần nhập ít nhất Booking No hoặc Tàu (Vessel)")
    item = update_booking(booking_id, data)
    col_id = get_booking_collection_id(booking_id)
    warnings = _duplicate_warnings(col_id, merged_no, booking_id) if col_id is not None else []
    logger.info(f"Booking updated id={booking_id} fields={sorted(data.keys())}")
    return {"status": "success", "item": item, "warnings": warnings}

@router.delete("/{booking_id}")
def remove_booking(booking_id: int):
    delete_booking(booking_id)
    return {"status": "success", "deleted_id": booking_id}

@router.delete("/clear/{collection_id}")
def clear_all_bookings(collection_id: int):
    clear_bookings(collection_id)
    logger.info(f"Cleared bookings of collection {collection_id}")
    return {"status": "success", "cleared_collection_id": collection_id}
