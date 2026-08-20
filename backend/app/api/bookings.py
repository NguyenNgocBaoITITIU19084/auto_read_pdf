import os
import tempfile
import shutil
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from backend.app.core.database import (
    insert_booking, get_bookings, delete_booking, clear_bookings
)
from backend.app.services.extractor import extract_booking_data

router = APIRouter(prefix="/bookings", tags=["Bookings"])

@router.get("")
def list_bookings(
    collection_id: int = Query(..., description="ID of the collection"),
    search_query: Optional[str] = Query(None, description="Search keyword"),
    search_field: Optional[str] = Query(None, description="Specific field to search")
):
    return get_bookings(collection_id, search_query, search_field)

@router.post("/upload")
async def upload_pdf_bookings(
    collection_id: int = Form(...),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="No PDF files provided")
        
    extracted_results = []
    temp_dir = tempfile.mkdtemp(prefix="pdf_upload_")
    
    try:
        for file in files:
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext != ".pdf":
                continue
                
            temp_path = os.path.join(temp_dir, file.filename)
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
                
            try:
                data = extract_booking_data(temp_path)
                data["Tên file PDF"] = file.filename
                
                # Resolve Vessel & ETD
                vessel = data.get("Pre Carrier", "null")
                etd = data.get("ETD_Pre", "null")
                if vessel == "null" or not vessel:
                    vessel = data.get("Trunk Vessel", "null")
                    etd = data.get("ETD_Trunk", "null")
                
                data["Vessel"] = vessel
                data["ETD"] = etd
                
                row_id = insert_booking(collection_id, data)
                data["id"] = row_id
                extracted_results.append(data)
            except Exception as e:
                print(f"Error parsing {file.filename}: {e}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        
    return {"count": len(extracted_results), "items": extracted_results}

@router.delete("/{booking_id}")
def remove_booking(booking_id: int):
    delete_booking(booking_id)
    return {"status": "success", "deleted_id": booking_id}

@router.delete("/clear/{collection_id}")
def clear_all_bookings(collection_id: int):
    clear_bookings(collection_id)
    return {"status": "success", "cleared_collection_id": collection_id}
