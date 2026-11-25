"""Zalo messaging API: conversations, incoming/outgoing messages, driver linking, and message templates."""
import hashlib
import subprocess
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from fastapi.responses import FileResponse

from backend.app.core import zalo as zalo_core
from backend.app.services import zalo_booking

router = APIRouter(prefix="/zalo", tags=["Zalo"])


class SessionUpdateIn(BaseModel):
    uid: str = ""
    display_name: str = ""
    phone: str = ""
    avatar: str = ""
    status: str = "disconnected"
    last_error: str = ""


class ConversationUpsertIn(BaseModel):
    thread_id: str
    thread_type: str = "user"
    display_name: str = ""
    avatar: str = ""
    phone: str = ""
    driver_id: Optional[int] = None


class ConversationPatchIn(BaseModel):
    needs_attention: Optional[bool] = None
    driver_id: Optional[int] = None
    unlink_driver: bool = False
    display_name: Optional[str] = None
    phone: Optional[str] = None
    hidden: Optional[bool] = None


class MessageIn(BaseModel):
    thread_id: str
    msg_id: Optional[str] = None
    thread_type: str = "user"
    display_name: str = ""
    avatar: str = ""
    phone: str = ""
    sender_id: str = ""
    sender_name: str = ""
    msg_type: str = "text"
    content: str = ""
    media_url: str = ""
    booking_no: str = ""
    status: str = "received"
    created_at: Optional[str] = None
    is_history: bool = False


class OutgoingMessageIn(BaseModel):
    thread_id: str
    msg_id: Optional[str] = None
    thread_type: str = "user"
    display_name: str = ""
    phone: str = ""
    msg_type: str = "text"
    content: str = ""
    media_url: str = ""
    booking_no: str = ""
    status: str = "sent"
    is_history: bool = False


class TemplateIn(BaseModel):
    name: str
    shortcut: str = ""
    category: str = "general"
    content: str


class TemplatePatchIn(BaseModel):
    name: Optional[str] = None
    shortcut: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None


@router.get("/session")
def get_session():
    return zalo_core.get_session()


@router.post("/session")
def update_session(body: SessionUpdateIn):
    return zalo_core.save_session(**body.model_dump())


@router.post("/logout")
def clear_on_logout():
    return zalo_core.clear_zalo_data()


@router.get("/conversations")
def list_conversations(
    filter: str = Query("all", pattern="^(all|drivers|unread|pending|hidden|watching)$"),
    q: str = Query(""),
    limit: int = Query(300, ge=1, le=500),
):
    return zalo_core.list_conversations(filter_by=filter, q=q, limit=limit)


@router.post("/conversations")
def upsert_conversation(body: ConversationUpsertIn):
    return zalo_core.upsert_conversation(**body.model_dump())


@router.post("/conversations/batch")
def upsert_conversations_batch(items: list[ConversationUpsertIn]):
    synced = zalo_core.upsert_conversations_batch([i.model_dump() for i in items])
    return {"synced": synced}


@router.get("/conversations/{thread_id}")
def get_conversation(thread_id: str):
    conv = zalo_core.get_conversation(thread_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    return conv


@router.post("/conversations/{thread_id}/read")
def mark_read(thread_id: str):
    conv = zalo_core.mark_conversation_read(thread_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    return conv


@router.patch("/conversations/{thread_id}")
def patch_conversation(thread_id: str, body: ConversationPatchIn):
    try:
        conv = zalo_core.update_conversation(thread_id, **body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    return conv


@router.get("/conversations/{thread_id}/messages")
def get_messages(
    thread_id: str,
    limit: int = Query(50, ge=1, le=200),
    before_id: Optional[int] = Query(None),
):
    rows = zalo_core.list_messages(thread_id, limit=limit, before_id=before_id)
    scans = zalo_booking.scans_for_messages([r["id"] for r in rows])
    for r in rows:
        r["booking_scan"] = scans.get(r["id"])
    return rows


def _after_record(res: dict) -> dict:
    # A booking file in a watched chat (sent by anyone, the user included) goes to the scan queue
    if res.get("message") and not res.get("duplicate"):
        zalo_booking.on_message(res["message"], res.get("conversation"))
    return res


@router.post("/messages/incoming")
def record_incoming_message(body: MessageIn):
    return _after_record(zalo_core.record_message(direction="in", **body.model_dump()))


@router.post("/messages/outgoing")
def record_outgoing_message(body: OutgoingMessageIn):
    return _after_record(zalo_core.record_message(direction="out", **body.model_dump()))


class BatchMessageItemIn(BaseModel):
    thread_id: str
    msg_id: Optional[str] = None
    thread_type: str = "user"
    display_name: str = ""
    direction: str = "in"
    sender_id: str = ""
    sender_name: str = ""
    msg_type: str = "text"
    content: str = ""
    media_url: str = ""
    created_at: Optional[str] = None


@router.post("/messages/batch")
def record_messages_batch(items: list[BatchMessageItemIn]):
    inserted = zalo_core.record_messages_batch([i.model_dump() for i in items])
    return {"inserted": inserted}


class ReactionIn(BaseModel):
    msg_id: str
    thread_id: str = ""
    sender_id: str
    sender_name: str = ""
    icon: str = ""
    created_at: Optional[str] = None


@router.post("/reactions")
def record_reactions(items: list[ReactionIn]):
    return {"changed": zalo_core.record_reactions([i.model_dump() for i in items])}


@router.get("/drivers/link-candidates")
def list_link_candidates():
    return zalo_core.list_link_candidates()


@router.get("/drivers/unlinked")
def list_unlinked_drivers():
    return zalo_core.list_unlinked_drivers()


@router.get("/templates")
def list_templates():
    return zalo_core.list_templates()


@router.post("/templates")
def create_template(body: TemplateIn):
    if not body.name.strip() or not body.content.strip():
        raise HTTPException(status_code=400, detail="Tên và nội dung mẫu không được để trống")
    return zalo_core.create_template(
        name=body.name,
        content=body.content,
        shortcut=body.shortcut,
        category=body.category,
    )


@router.put("/templates/{template_id}")
def update_template(template_id: int, body: TemplatePatchIn):
    if (body.name is not None and not body.name.strip()) or (body.content is not None and not body.content.strip()):
        raise HTTPException(status_code=400, detail="Tên và nội dung mẫu không được để trống")
    tpl = zalo_core.update_template(template_id, **body.model_dump())
    if not tpl:
        raise HTTPException(status_code=404, detail="Không tìm thấy mẫu tin nhắn")
    return tpl


@router.delete("/templates/{template_id}")
def delete_template(template_id: int):
    if not zalo_core.delete_template(template_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy mẫu tin nhắn")
    return {"ok": True}


_ALLOWED_MEDIA_SUFFIXES = (".zdn.vn", ".zadn.vn", ".dlfl.vn", ".zaloapp.com", ".zalo.me")
_MEDIA_CACHE_DIR = Path(tempfile.gettempdir()) / "auto_read_pdf_zalo_media"


@router.get("/media")
def proxy_zalo_media(url: str = Query(...)):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not any(host == s.lstrip(".") or host.endswith(s) for s in _ALLOWED_MEDIA_SUFFIXES):
        raise HTTPException(status_code=400, detail="URL media không hợp lệ")

    _MEDIA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    cached_jpg = _MEDIA_CACHE_DIR / f"{key}.jpg"
    if cached_jpg.exists():
        return Response(content=cached_jpg.read_bytes(), media_type="image/jpeg")

    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Không tải được ảnh Zalo: {e}")

    content_type = (resp.headers.get("Content-Type") or "").lower()
    is_jxl = url.lower().split("?")[0].endswith(".jxl") or "jxl" in content_type or resp.content[:2] == b"\xff\x0a"
    if is_jxl:
        raw_jxl = _MEDIA_CACHE_DIR / f"{key}.jxl"
        raw_jxl.write_bytes(resp.content)
        try:
            subprocess.run(
                ["sips", "-s", "format", "jpeg", str(raw_jxl), "--out", str(cached_jpg)],
                check=True,
                capture_output=True,
                timeout=10,
            )
            return Response(content=cached_jpg.read_bytes(), media_type="image/jpeg")
        except Exception:
            pass
        finally:
            raw_jxl.unlink(missing_ok=True)

    return Response(content=resp.content, media_type=content_type or "image/jpeg")


# ---------------------------------------------------------------------------
# Watched chats and booking scans (services/zalo_booking.py)
# ---------------------------------------------------------------------------
class WatchIn(BaseModel):
    watch: bool


class ScanHistoryIn(BaseModel):
    days: Optional[int] = None  # None = every file stored for the chat


class BookingSettingsIn(BaseModel):
    collection_id: Optional[int] = None
    image_mode: str = zalo_booking.DEFAULT_IMAGE_MODE


class ScanSavedIn(BaseModel):
    booking_id: int
    collection_id: Optional[int] = None


@router.post("/conversations/{thread_id}/watch")
def watch_conversation(thread_id: str, body: WatchIn):
    if not zalo_booking.set_watch(thread_id, body.watch):
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    conv = zalo_core.get_conversation(thread_id)
    # Turning it on: say how many older files there are, so the user can choose to scan them
    return {"conversation": conv, "history": zalo_booking.history_counts(thread_id) if body.watch else None}


@router.post("/conversations/{thread_id}/scan-history")
def scan_conversation_history(thread_id: str, body: ScanHistoryIn):
    if not zalo_core.get_conversation(thread_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    if body.days is not None and body.days <= 0:
        raise HTTPException(status_code=400, detail="Số ngày phải lớn hơn 0")
    return {"queued": zalo_booking.scan_history(thread_id, body.days)}


class LocalCopyIn(BaseModel):
    msg_id: str
    file_name: str
    data_b64: str


@router.post("/messages/local-copy")
def message_local_copy(body: LocalCopyIn):
    import base64
    import binascii

    try:
        data = base64.b64decode(body.data_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Dữ liệu tệp không hợp lệ")
    return {"scan": zalo_booking.attach_local_copy(body.msg_id, body.file_name, data)}


@router.post("/messages/{message_id}/scan")
def scan_message(message_id: int):
    try:
        return zalo_booking.scan_now(message_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/booking-scans")
def list_booking_scans(status: str = Query(zalo_booking.PENDING_REVIEW)):
    if status not in zalo_booking.STATUSES:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ")
    return zalo_booking.list_queue(status)


@router.get("/booking-scans/summary")
def booking_scans_summary():
    return zalo_booking.summary()


@router.get("/booking-scans/{message_id}/file")
def booking_scan_file(message_id: int):
    path = zalo_booking.file_path(message_id)
    if not path:
        raise HTTPException(status_code=404, detail="Không còn tệp trên máy")
    media = "application/pdf" if path.endswith(".pdf") else "image/jpeg"
    return FileResponse(path, media_type=media)


@router.post("/booking-scans/{message_id}/saved")
def booking_scan_saved(message_id: int, body: ScanSavedIn):
    res = zalo_booking.mark_saved(message_id, body.booking_id, body.collection_id)
    if not res:
        raise HTTPException(status_code=404, detail="Không tìm thấy lượt quét")
    return res


@router.post("/booking-scans/{message_id}/dismiss")
def booking_scan_dismiss(message_id: int):
    res = zalo_booking.dismiss(message_id)
    if not res:
        raise HTTPException(status_code=404, detail="Không tìm thấy lượt quét")
    return res


@router.get("/booking-settings")
def get_booking_settings():
    return zalo_booking.get_settings()


@router.put("/booking-settings")
def put_booking_settings(body: BookingSettingsIn):
    try:
        return zalo_booking.save_settings(body.collection_id, body.image_mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
