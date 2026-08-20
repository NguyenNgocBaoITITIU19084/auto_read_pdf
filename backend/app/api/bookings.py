import os
import tempfile
import shutil
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, Body
from pydantic import BaseModel
from backend.app.core.database import (
    insert_booking, get_bookings, delete_booking, clear_bookings
)
from backend.app.services.extractor import extract_booking_data
from backend.app.services.image_extractor import extract_booking_from_image

router = APIRouter(prefix="/bookings", tags=["Bookings"])

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
PDF_EXTENSIONS = {".pdf"}
ALLOWED_EXTENSIONS = PDF_EXTENSIONS.union(IMAGE_EXTENSIONS)

class SaveBookingRequest(BaseModel):
    collection_id: int
    booking: Dict[str, Any]

@router.get("")
def list_bookings(
    collection_id: int = Query(..., description="ID of the collection"),
    search_query: Optional[str] = Query(None, description="Search keyword"),
    search_field: Optional[str] = Query(None, description="Specific field to search")
):
    return get_bookings(collection_id, search_query, search_field)

@router.post("/upload")
async def upload_bookings(
    collection_id: int = Form(...),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
        
    extracted_results = []
    temp_dir = tempfile.mkdtemp(prefix="booking_upload_")
    
    try:
        for file in files:
            filename = file.filename or "uploaded_file"
            file_ext = os.path.splitext(filename)[1].lower()
            if file_ext not in ALLOWED_EXTENSIONS:
                continue
                
            temp_path = os.path.join(temp_dir, filename)
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
                
            try:
                if file_ext == ".pdf":
                    data = extract_booking_data(temp_path)
                else:
                    with open(temp_path, "rb") as f_img:
                        img_bytes = f_img.read()
                    data = extract_booking_from_image(img_bytes, filename=filename)
                    
                data["Tên file PDF"] = filename
                
                # Resolve Vessel & ETD
                vessel = data.get("Pre Carrier", "null")
                etd = data.get("ETD_Pre", "null")
                if vessel == "null" or not vessel:
                    vessel = data.get("Trunk Vessel", "null")
                    etd = data.get("ETD_Trunk", "null")
                
                if vessel != "null" and vessel:
                    data["Vessel"] = vessel
                    data["ETD"] = etd
                
                row_id = insert_booking(collection_id, data)
                data["id"] = row_id
                extracted_results.append(data)
            except Exception as e:
                print(f"Error parsing {filename}: {e}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        
    return {"count": len(extracted_results), "items": extracted_results}

@router.post("/extract-image")
async def extract_image_preview(
    file: UploadFile = File(...),
    api_key: Optional[str] = Form(None)
):
    """
    Extracts booking details from a single uploaded image without saving to DB.
    Returns the parsed booking object for preview/editing.
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
        if file_ext == ".pdf":
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
                tmp_pdf.write(file_bytes)
                tmp_pdf_path = tmp_pdf.name
            try:
                data = extract_booking_data(tmp_pdf_path)
            finally:
                if os.path.exists(tmp_pdf_path):
                    os.remove(tmp_pdf_path)
        else:
            data = extract_booking_from_image(file_bytes, filename=filename, api_key=api_key)

        data["Tên file PDF"] = filename
        # Ensure Vessel & ETD are consistent
        vessel = data.get("Pre Carrier", "null")
        etd = data.get("ETD_Pre", "null")
        if vessel == "null" or not vessel:
            vessel = data.get("Trunk Vessel", "null")
            etd = data.get("ETD_Trunk", "null")
        if vessel != "null" and vessel:
            data["Vessel"] = vessel
            data["ETD"] = etd

        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract image: {e}")

@router.post("/manual-save")
def save_manual_booking(req: SaveBookingRequest):
    """
    Saves a reviewed or manually created booking to a collection.
    """
    row_id = insert_booking(req.collection_id, req.booking)
    saved_booking = dict(req.booking)
    saved_booking["id"] = row_id
    return {"status": "success", "id": row_id, "item": saved_booking}

@router.delete("/{booking_id}")
def remove_booking(booking_id: int):
    delete_booking(booking_id)
    return {"status": "success", "deleted_id": booking_id}

@router.delete("/clear/{collection_id}")
def clear_all_bookings(collection_id: int):
    clear_bookings(collection_id)
    return {"status": "success", "cleared_collection_id": collection_id}
