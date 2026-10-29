import base64
import os
import asyncio
import logging
from typing import List, Optional, Dict, Any, Tuple
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel
from backend.app.core.database import (
    insert_booking, get_bookings, delete_booking, clear_bookings, delete_bookings_batch,
    get_bookings_page, get_booking_ids, get_bookings_by_ids, get_booking_carriers,
    update_booking, find_duplicate_booking_ids, get_booking_collection_id,
    get_booking_trash, get_booking_trash_ids, count_booking_trash, restore_bookings, delete_trashed_bookings,
    BOOKING_TRASH_KEEP_DAYS, BOOKING_STATUSES, set_booking_status, get_booking_status_counts,
    get_bookings_calendar, get_booking_links,
)
from backend.app.schemas.models import BatchIdsRequest
from backend.app.services.extractor import (
    has_booking_fields, extract_booking_from_pdf_bytes as _extract_pdf_bytes, resolve_vessel_etd as _resolve_vessel_etd,
)
from backend.app.services.image_extractor import extract_booking_from_image
from backend.app.services.booking_validation import normalize_manual_booking
from backend.app.services.pdf_preview import render_pdf_pages, render_pdf_for_ocr
from backend.app.services.file_kind import IMAGE, PDF, detect_file_kind, to_ocr_image

logger = logging.getLogger("backend.api.bookings")

router = APIRouter(prefix="/bookings", tags=["Bookings"])

W_PDF_NO_TEXT = "Không tìm thấy thông tin booking trong PDF (có thể là bản scan không có lớp chữ). Vui lòng thử dán ảnh hoặc nhập tay."
W_PDF_SCANNED = "PDF không có lớp chữ (bản scan) nên đã được đọc như ảnh bằng OCR. Vui lòng kiểm tra lại."
W_UNSUPPORTED = "Unsupported file format. Please upload an image (PNG, JPG, WEBP, BMP, GIF, TIFF) or PDF."

class SaveBookingRequest(BaseModel):
    collection_id: int
    booking: Dict[str, Any]
    # Replace the newest row with the same Booking No instead of adding another one
    overwrite: bool = False

class CheckDuplicatesRequest(BaseModel):
    collection_id: int
    booking_nos: List[str] = []

class BatchDeleteRequest(BaseModel):
    ids: List[int] = []

class UpdateBookingRequest(BaseModel):
    booking: Dict[str, Any]

class SetStatusRequest(BaseModel):
    ids: List[int] = []
    status: str

def _duplicate_warnings(col_id: int, booking_no: str, exclude_id: Optional[int]) -> List[str]:
    dups = find_duplicate_booking_ids(col_id, booking_no, exclude_id)
    return [f"Booking No '{booking_no.strip()}' đã có trong bộ sưu tập ({len(dups)} dòng)"] if dups else []

def _process_uploads(collection_id: int, uploads: List[Tuple[str, bytes]]) -> List[dict]:
    """Blocking work (pdfplumber / Gemini / OCR / sqlite) — run in a worker thread."""
    extracted_results = []
    for filename, file_bytes in uploads:
        try:
            kind = detect_file_kind(file_bytes, filename)
            if kind is None:
                logger.warning(f"Skipped {filename}: neither a PDF nor an image")
                continue
            data = _extract_preview(file_bytes, filename, kind, None)["data"]
            if not has_booking_fields(data):
                logger.warning(f"No booking fields extracted from {filename} (carrier={data.get('Carrier')}); saved as empty row")

            row_id = insert_booking(collection_id, data)
            data["id"] = row_id
            extracted_results.append(data)
        except Exception as e:
            logger.exception(f"Error parsing {filename}: {e}")
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
    sort_by: Optional[str] = Query(None, description="Table column to sort by, e.g. 'ETD'"),
    sort_dir: Optional[str] = Query(None, description="'asc' or 'desc'"),
    carriers: Optional[List[str]] = Query(None, description="Only these carriers ('' = no carrier)"),
    statuses: Optional[List[str]] = Query(None, description="Only these statuses (new, dispatched, ...)"),
    hide_closed: bool = Query(False, description="Leave out done and cancelled bookings"),
):
    return get_bookings_page(collection_id, limit, offset, search_query, search_field, sort_by, sort_dir, carriers,
                             statuses, hide_closed)

@router.get("/ids")
def list_booking_ids(
    collection_id: int = Query(...),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None),
    carriers: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    hide_closed: bool = Query(False),
):
    return {"ids": get_booking_ids(collection_id, search_query, search_field, sort_by, sort_dir, carriers,
                                   statuses, hide_closed)}

@router.get("/carriers")
def list_booking_carriers(collection_id: int = Query(...)):
    return get_booking_carriers(collection_id)

@router.get("/calendar")
def list_bookings_calendar(
    collection_id: int = Query(...),
    date_from: str = Query(..., description="First day, YYYY-MM-DD"),
    date_to: str = Query(..., description="Last day, YYYY-MM-DD"),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
    carriers: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    hide_closed: bool = Query(False),
):
    try:
        return get_bookings_calendar(collection_id, date_from, date_to, search_query, search_field, carriers,
                                     statuses, hide_closed)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ngày không hợp lệ (cần dạng YYYY-MM-DD)")

@router.get("/{booking_id}/links")
def booking_links(booking_id: int):
    """The booking's ePort vessel schedules and containers."""
    links = get_booking_links(booking_id)
    if links is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")
    return links

@router.get("/statuses")
def list_booking_statuses(collection_id: int = Query(...)):
    return get_booking_status_counts(collection_id)

@router.post("/status")
def change_booking_status(req: SetStatusRequest):
    if req.status not in BOOKING_STATUSES:
        raise HTTPException(status_code=400, detail=f"Trạng thái không hợp lệ: {req.status}")
    updated = set_booking_status(list(req.ids or []), req.status)
    logger.info(f"Set status={req.status} on {updated} booking(s)")
    return {"status": "success", "updated": updated}

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
        uploads.append((filename, await file.read()))

    extracted_results = await asyncio.to_thread(_process_uploads, collection_id, uploads)
    logger.info(f"Upload {len(uploads)} file(s) to collection {collection_id} -> {len(extracted_results)} booking(s)")
    return {"count": len(extracted_results), "items": extracted_results}

def _read_image(image_bytes: bytes, filename: str, api_key: Optional[str]) -> dict:
    result = extract_booking_from_image(to_ocr_image(image_bytes), filename=filename, api_key=api_key, return_details=True)
    if isinstance(result, dict) and "data" in result and "engine_used" in result:
        return result
    return {"data": result, "engine_used": "none", "warnings": []}

def _extract_preview(file_bytes: bytes, filename: str, kind: str, api_key: Optional[str]) -> dict:
    """Reads a booking from a PDF's text layer, or with Gemini / OCR from a photo or a scanned PDF."""
    engine_used = "none"
    warnings: List[str] = []
    model_used: Optional[str] = None
    gemini_error_kind: Optional[str] = None
    result = None
    if kind == PDF:
        data = _extract_pdf_bytes(file_bytes)
        # Read from the PDF text layer (no AI / OCR)
        if has_booking_fields(data):
            engine_used = "pdf"
        else:
            # no text layer (a scan / photo saved as PDF): read the page images like a dropped photo
            try:
                result = _read_image(render_pdf_for_ocr(file_bytes), filename, api_key)
                warnings.append(W_PDF_SCANNED)
            except Exception as e:
                logger.warning(f"Could not OCR the pages of {filename}: {e}")
                warnings.append(W_PDF_NO_TEXT)
    else:
        result = _read_image(file_bytes, filename, api_key)
    if result is not None:
        data = result["data"]
        engine_used = result.get("engine_used") or "none"
        warnings.extend(result.get("warnings") or [])
        model_used = result.get("model_used")
        gemini_error_kind = result.get("gemini_error_kind")

    data["Tên file PDF"] = filename
    _resolve_vessel_etd(data)
    return {"status": "success", "data": data, "engine_used": engine_used, "warnings": warnings,
            "model_used": model_used, "gemini_error_kind": gemini_error_kind}

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
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    # by content, not by name: a photo saved as .pdf (or with no extension) is still read with OCR
    kind = await asyncio.to_thread(detect_file_kind, file_bytes, filename)
    if kind is None:
        raise HTTPException(status_code=400, detail=W_UNSUPPORTED)

    try:
        result = await asyncio.to_thread(_extract_preview, file_bytes, filename, kind, api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract image: {e}")
    logger.info(f"Image extract kind={kind} engine={result['engine_used']} warnings={len(result['warnings'])}")
    return result

@router.post("/pdf-preview")
def pdf_preview(file: UploadFile = File(...)):
    """Page images of a PDF (JPEG data URLs) for the review window; nothing is saved."""
    filename = file.filename or "booking.pdf"
    file_bytes = file.file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    kind = detect_file_kind(file_bytes, filename)
    named_pdf = os.path.splitext(filename)[1].lower() == ".pdf"
    if kind != PDF and not (kind == IMAGE and named_pdf):
        raise HTTPException(status_code=400, detail="Only PDF files can be previewed")
    try:
        if kind == IMAGE:  # a photo saved under a .pdf name: show the photo itself
            image = to_ocr_image(file_bytes)
            mime = "image/png" if image.startswith(b"\x89PNG") else "image/webp" if image.startswith(b"RIFF") else "image/jpeg"
            return {"pages": [f"data:{mime};base64," + base64.b64encode(image).decode("ascii")],
                    "page_count": 1, "truncated": False}
        return render_pdf_pages(file_bytes)
    except Exception as e:
        logger.warning(f"PDF preview failed for {filename}: {e}")
        raise HTTPException(status_code=422, detail=f"Không hiển thị được PDF: {e}")

@router.post("/check-duplicates")
def check_duplicate_bookings(req: CheckDuplicatesRequest):
    """Which of these Booking Nos already exist in the collection (case/space-insensitive). Used by the image queue."""
    existing = [no for no in dict.fromkeys(n.strip() for n in req.booking_nos if n and n.strip())
                if find_duplicate_booking_ids(req.collection_id, no)]
    return {"existing": existing}

@router.post("/manual-save")
def save_manual_booking(req: SaveBookingRequest):
    """
    Saves a reviewed or manually created booking to a collection.
    """
    data, errors = normalize_manual_booking(req.booking)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    dups = find_duplicate_booking_ids(req.collection_id, data.get("Booking No", "")) if req.overwrite else []
    if dups:
        # Fields the reading does not carry (note, status, created time) are kept
        item = update_booking(dups[-1], data)
        logger.info(f"Booking overwritten id={dups[-1]} collection={req.collection_id}")
        return {"status": "success", "id": dups[-1], "item": item, "warnings": [], "overwritten": True}
    warnings = _duplicate_warnings(req.collection_id, data.get("Booking No", ""), None)
    row_id = insert_booking(req.collection_id, data)
    logger.info(f"Manual booking saved id={row_id} collection={req.collection_id} duplicate={bool(warnings)}")
    saved = get_bookings_by_ids([row_id])
    item = saved[0] if saved else {**data, "id": row_id}
    return {"status": "success", "id": row_id, "item": item, "warnings": warnings}

@router.post("/batch-delete")
def batch_delete_bookings(req: BatchDeleteRequest):
    deleted = delete_bookings_batch(list(req.ids or []))
    logger.info(f"Moved {deleted} booking(s) to the trash")
    return {"status": "success", "deleted": deleted}

@router.get("/trash")
def list_booking_trash(collection_id: int = Query(...), limit: int = Query(50), offset: int = Query(0)):
    """A page of the collection's deleted bookings, kept BOOKING_TRASH_KEEP_DAYS days before being purged."""
    return {**get_booking_trash(collection_id, limit, offset), "keep_days": BOOKING_TRASH_KEEP_DAYS}

@router.get("/trash/ids")
def list_booking_trash_ids(collection_id: int = Query(...)):
    return {"ids": get_booking_trash_ids(collection_id)}

@router.get("/trash/count")
def booking_trash_count(collection_id: int = Query(...)):
    return {"count": count_booking_trash(collection_id)}

@router.post("/trash/restore")
def restore_trashed_bookings(req: BatchDeleteRequest):
    restored = restore_bookings(list(req.ids or []))
    logger.info(f"Restored {restored} booking(s) from the trash")
    return {"status": "success", "restored": restored}

@router.post("/trash/delete")
def delete_trashed_bookings_now(req: BatchDeleteRequest):
    deleted = delete_trashed_bookings(list(req.ids or []))
    logger.info(f"Permanently deleted {deleted} booking(s) from the trash")
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
    deleted = clear_bookings(collection_id)
    logger.info(f"Moved all {deleted} booking(s) of collection {collection_id} to the trash")
    return {"status": "success", "cleared_collection_id": collection_id, "deleted": deleted}
