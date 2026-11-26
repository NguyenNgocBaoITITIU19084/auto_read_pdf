"""Read a PDF attached to an email (Gmail or Outlook) into Bookings with the rule-based extractor (no AI)."""
from typing import Any, Optional

from backend.app.core import database as db
from backend.app.services.extractor import extract_booking_from_pdf_bytes, has_booking_fields, resolve_vessel_etd


class MailImportError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def target_collection(collection_id: Optional[int]) -> int:
    if collection_id and db.collection_exists(collection_id):
        return collection_id
    cols = db.get_collections()
    return cols[0]["id"] if cols else db.create_collection("Default Collection")


def import_pdf_bytes(raw_bytes: bytes, filename: str, collection_id: Optional[int]) -> dict[str, Any]:
    """Insert the booking read from the PDF, or report the existing one with the same Booking No (skip-and-notify)."""
    target_col = target_collection(collection_id)
    booking = extract_booking_from_pdf_bytes(raw_bytes)
    if not has_booking_fields(booking):
        raise MailImportError(
            "Không đọc được thông tin Booking từ PDF này (có thể là PDF scan hoặc mẫu chưa hỗ trợ).",
            status_code=422,
        )

    booking["Tên file PDF"] = filename or "email-attachment.pdf"
    resolve_vessel_etd(booking)
    booking_no = str(booking.get("Booking No") or "").strip()
    if booking_no.lower() == "null":
        booking_no = ""

    if booking_no and db.find_duplicate_booking_ids(target_col, booking_no):
        return {
            "status": "duplicate",
            "booking_no": booking_no,
            "collection_id": target_col,
            "message": f"Booking {booking_no} đã tồn tại trong bộ sưu tập.",
        }

    booking_id = db.insert_booking(target_col, booking)
    return {
        "status": "imported",
        "booking_id": booking_id,
        "booking_no": booking_no or f"#{booking_id}",
        "collection_id": target_col,
        "message": f"Đã nhập Booking {booking_no or booking_id} thành công.",
    }
