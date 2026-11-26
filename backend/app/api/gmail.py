"""Gmail REST API router: OAuth 2.0, accounts, threads/messages, attachments, templates, and booking import."""
import asyncio
import html
import logging
import unicodedata
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from backend.app.core import gmail as gmail_core
from backend.app.services import gmail_client, gmail_sync

logger = logging.getLogger("backend.gmail.api")

router = APIRouter(prefix="/gmail", tags=["Gmail"])


class OAuthConfigIn(BaseModel):
    client_id: str
    client_secret: str = ""


class SyncSettingsIn(BaseModel):
    auto_sync_enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None
    auto_import_pdf: Optional[bool] = None
    auto_import_collection_id: Optional[int] = None
    auto_import_query: Optional[str] = None


class ThreadPatchIn(BaseModel):
    action: str  # read | unread | star | unstar | archive | trash | untrash


class ImportAttachmentIn(BaseModel):
    collection_id: Optional[int] = None


class TemplateIn(BaseModel):
    name: str
    shortcut: str = ""
    category: str = "general"
    subject_tpl: str = ""
    body_tpl: str = ""


def _raise_http(exc: gmail_client.GmailClientError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/config")
def get_config():
    oauth = gmail_core.get_oauth_config()
    sync_cfg = gmail_core.get_sync_settings()
    return {
        "has_oauth_config": bool(oauth["client_id"]),
        "using_embedded_oauth": bool(oauth.get("using_embedded")),
        "client_id": "" if oauth.get("using_embedded") else oauth["client_id"],
        "has_client_secret": bool(oauth["client_secret"]),
        "redirect_uri": gmail_client.default_redirect_uri(),
        "sync": sync_cfg,
    }


@router.put("/config/oauth")
def update_oauth_config(body: OAuthConfigIn):
    if not body.client_id.strip():
        raise HTTPException(status_code=400, detail="Client ID không được để trống.")
    existing = gmail_core.get_oauth_config()
    secret = body.client_secret.strip() or existing["client_secret"]
    gmail_core.save_oauth_config(body.client_id.strip(), secret)
    return {"ok": True}


@router.put("/config/sync")
def update_sync_config(body: SyncSettingsIn):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    saved = gmail_core.save_sync_settings(patch)
    return {"ok": True, "sync": saved}


@router.post("/oauth/start")
def start_oauth():
    try:
        return gmail_client.create_oauth_url()
    except gmail_client.GmailClientError as exc:
        _raise_http(exc)


@router.get("/oauth/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    if error:
        msg = html.escape(error)
        return HTMLResponse(
            f"""<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center;">
            <h2 style="color:#e11d48;">Đăng nhập Gmail bị hủy hoặc lỗi</h2>
            <p>{msg}</p><p>Bạn có thể đóng tab này và thử lại trong Auto Read PDF Pro.</p></body></html>""",
            status_code=400,
        )
    if not code or not state:
        return HTMLResponse("Thiếu tham số code hoặc state.", status_code=400)

    try:
        account = await gmail_client.exchange_oauth_code(code, state)
        # Kick off initial sync in background so callback returns immediately
        asyncio.create_task(gmail_sync.sync_account(account["id"], max_results=30))
        email_safe = html.escape(account["email"])
        return HTMLResponse(
            f"""<!doctype html><html><body style="font-family:system-ui;padding:48px;text-align:center;background:#f8fafc;">
            <div style="max-width:460px;margin:0 auto;background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
              <h2 style="color:#059669;margin-top:0;">Kết nối Gmail thành công!</h2>
              <p style="color:#334155;">Đã liên kết tài khoản <strong>{email_safe}</strong>.</p>
              <p style="color:#64748b;font-size:14px;">Bạn có thể đóng tab trình duyệt này và quay lại <strong>Auto Read PDF Pro</strong>.</p>
            </div>
            <script>setTimeout(function(){{ window.close(); }}, 1800);</script>
            </body></html>"""
        )
    except gmail_client.GmailClientError as exc:
        err_safe = html.escape(str(exc))
        return HTMLResponse(
            f"""<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center;">
            <h2 style="color:#e11d48;">Không thể kết nối Gmail</h2>
            <p>{err_safe}</p></body></html>""",
            status_code=exc.status_code,
        )


@router.get("/accounts")
def get_accounts():
    return {"items": gmail_core.list_accounts(), "total_unread": gmail_core.get_total_unread_count()}


@router.delete("/accounts/{account_id}")
def remove_account(account_id: int):
    if not gmail_core.delete_account(account_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Gmail.")
    return {"ok": True}


@router.post("/accounts/{account_id}/sync")
async def sync_account_now(
    account_id: int,
    max_results: int = Query(40, ge=5, le=100),
    q: str = Query(""),
):
    try:
        return await gmail_sync.sync_account(account_id, max_results=max_results, query=q)
    except gmail_client.GmailClientError as exc:
        _raise_http(exc)


@router.get("/unread-count")
def get_unread_count():
    return {"unread": gmail_core.get_total_unread_count()}


@router.get("/threads")
def get_threads(
    account_id: int = Query(...),
    label: str = Query("INBOX"),
    search: str = Query(""),
    only_unread: bool = Query(False),
    only_pdf: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return gmail_core.list_threads(
        account_id=account_id,
        label=label,
        search=search,
        only_unread=only_unread,
        only_pdf=only_pdf,
        limit=limit,
        offset=offset,
    )


@router.get("/threads/{account_id}/{thread_id}")
async def get_thread(account_id: int, thread_id: str, refresh: bool = Query(False)):
    if refresh:
        try:
            detail = await gmail_sync.sync_single_thread(account_id, thread_id)
        except gmail_client.GmailClientError as exc:
            _raise_http(exc)
    else:
        detail = gmail_core.get_thread_detail(account_id, thread_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại email.")
    return detail


@router.patch("/threads/{account_id}/{thread_id}")
async def patch_thread(account_id: int, thread_id: str, body: ThreadPatchIn):
    action = body.action.strip().lower()
    try:
        if action == "read":
            await gmail_client.modify_thread_labels(account_id, thread_id, remove_labels=["UNREAD"])
        elif action == "unread":
            await gmail_client.modify_thread_labels(account_id, thread_id, add_labels=["UNREAD"])
        elif action == "star":
            await gmail_client.modify_thread_labels(account_id, thread_id, add_labels=["STARRED"])
        elif action == "unstar":
            await gmail_client.modify_thread_labels(account_id, thread_id, remove_labels=["STARRED"])
        elif action == "archive":
            await gmail_client.modify_thread_labels(account_id, thread_id, remove_labels=["INBOX"])
        elif action == "trash":
            await gmail_client.trash_thread(account_id, thread_id)
        elif action == "untrash":
            await gmail_client.untrash_thread(account_id, thread_id)
        else:
            raise HTTPException(status_code=400, detail=f"Hành động không hợp lệ: {action}")

        updated = await gmail_sync.sync_single_thread(account_id, thread_id)
        return {"ok": True, "thread": updated}
    except gmail_client.GmailClientError as exc:
        _raise_http(exc)


@router.post("/messages/send")
async def send_message(
    account_id: int = Form(...),
    to_addrs: str = Form(...),
    subject: str = Form(""),
    body_text: str = Form(""),
    body_html: str = Form(""),
    cc_addrs: str = Form(""),
    bcc_addrs: str = Form(""),
    thread_id: str = Form(""),
    in_reply_to: str = Form(""),
    references: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    if not to_addrs.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập địa chỉ người nhận (To).")

    att_tuples: list[tuple[str, str, bytes]] = []
    for f in files:
        raw = await f.read()
        att_tuples.append((f.filename or "attachment", f.content_type or "application/octet-stream", raw))

    try:
        res = await gmail_client.send_email(
            account_id=account_id,
            to_addrs=to_addrs.strip(),
            subject=subject.strip() or "(Không có tiêu đề)",
            body_text=body_text,
            body_html=body_html,
            cc_addrs=cc_addrs,
            bcc_addrs=bcc_addrs,
            thread_id=thread_id.strip() or None,
            in_reply_to=in_reply_to.strip() or None,
            references=references.strip() or None,
            attachments=att_tuples,
        )
        sent_tid = res.get("threadId")
        if sent_tid:
            try:
                await gmail_sync.sync_single_thread(account_id, sent_tid)
            except Exception:
                logger.warning("Could not refresh thread %s after send", sent_tid)
        return {"ok": True, "id": res.get("id"), "thread_id": sent_tid}
    except gmail_client.GmailClientError as exc:
        _raise_http(exc)


@router.get("/attachments/{attachment_row_id}/download")
async def download_attachment_file(attachment_row_id: int):
    att = gmail_core.get_attachment_by_row_id(attachment_row_id)
    if not att:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp đính kèm.")
    try:
        raw = await gmail_client.download_attachment(att["account_id"], att["message_id"], att["attachment_id"])
    except gmail_client.GmailClientError as exc:
        _raise_http(exc)

    return Response(
        content=raw,
        media_type=att["mime_type"] or "application/octet-stream",
        headers={"Content-Disposition": _content_disposition(att["filename"] or "attachment")},
    )


def _content_disposition(filename: str) -> str:
    """HTTP headers must be latin-1, so a Vietnamese name goes in filename*= (RFC 5987) with an ASCII fallback."""
    fallback = unicodedata.normalize("NFKD", filename).replace("đ", "d").replace("Đ", "D")
    fallback = fallback.encode("ascii", "ignore").decode("ascii")
    fallback = "".join(c if c.isprintable() and c not in '"\\' else "_" for c in fallback).strip() or "attachment"
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


@router.post("/attachments/{attachment_row_id}/import-booking")
async def import_attachment_booking(attachment_row_id: int, body: ImportAttachmentIn):
    try:
        return await gmail_sync.import_attachment_to_booking(attachment_row_id, body.collection_id)
    except gmail_client.GmailClientError as exc:
        _raise_http(exc)


@router.get("/templates")
def get_templates():
    return {"items": gmail_core.list_templates()}


@router.post("/templates")
def create_template(body: TemplateIn):
    return gmail_core.save_template(body.model_dump())


@router.put("/templates/{template_id}")
def update_template(template_id: int, body: TemplateIn):
    return gmail_core.save_template(body.model_dump(), template_id=template_id)


@router.delete("/templates/{template_id}")
def remove_template(template_id: int):
    if not gmail_core.delete_template(template_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy mẫu email.")
    return {"ok": True}
