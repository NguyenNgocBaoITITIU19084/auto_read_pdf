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

from backend.app.core import zalo as zalo_core

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
    content: str
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
    filter: str = Query("all", pattern="^(all|drivers|unread|pending)$"),
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
    conv = zalo_core.update_conversation(thread_id, **body.model_dump())
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    return conv


@router.get("/conversations/{thread_id}/messages")
def get_messages(
    thread_id: str,
    limit: int = Query(50, ge=1, le=200),
    before_id: Optional[int] = Query(None),
):
    return zalo_core.list_messages(thread_id, limit=limit, before_id=before_id)


@router.post("/messages/incoming")
def record_incoming_message(body: MessageIn):
    return zalo_core.record_message(direction="in", **body.model_dump())


@router.post("/messages/outgoing")
def record_outgoing_message(body: OutgoingMessageIn):
    return zalo_core.record_message(direction="out", **body.model_dump())


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
