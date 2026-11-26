"""Outlook (Microsoft 365) REST API: sign-in, accounts, folder tree, messages, conversations, attachments, sending."""
import html
import logging
import unicodedata
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from backend.app.core import outlook as outlook_core
from backend.app.services import outlook_client, outlook_mail
from backend.app.services.outlook_client import OutlookClientError

logger = logging.getLogger("backend.outlook.api")

router = APIRouter(prefix="/outlook", tags=["Outlook"])


class OAuthConfigIn(BaseModel):
    client_id: str
    tenant_id: str = ""


class PinIn(BaseModel):
    folder_id: str
    pinned: bool


class ActionIn(BaseModel):
    message_ids: list[str]
    action: str
    destination: str = ""


class ImportIn(BaseModel):
    message_id: str
    attachment_id: str
    collection_id: Optional[int] = None


def _http(exc: OutlookClientError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _page(title: str, body: str, ok: bool, status: int = 200) -> HTMLResponse:
    color = "#059669" if ok else "#e11d48"
    close = "<script>setTimeout(function(){window.close();},1800);</script>" if ok else ""
    return HTMLResponse(
        f"""<!doctype html><html><head><meta charset="utf-8"></head>
        <body style="font-family:system-ui;padding:48px;text-align:center;background:#f8fafc;">
        <div style="max-width:480px;margin:0 auto;background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);">
        <h2 style="color:{color};margin-top:0;">{title}</h2><p style="color:#334155;">{body}</p>
        <p style="color:#64748b;font-size:14px;">Bạn có thể đóng tab này và quay lại Auto Read PDF Pro.</p></div>{close}
        </body></html>""",
        status_code=status,
    )


def _admin_consent_page() -> HTMLResponse:
    link = html.escape(outlook_client.admin_consent_url())
    return _page(
        "Cần IT công ty duyệt ứng dụng một lần",
        "Công ty bạn không cho nhân viên tự cấp quyền đọc mail cho ứng dụng. Gửi link dưới đây cho IT "
        "(tài khoản quản trị Microsoft 365) để duyệt một lần cho cả công ty, rồi đăng nhập lại:"
        f'<br><br><a href="{link}" style="word-break:break-all">{link}</a>',
        False,
        403,
    )


# ---------- config & sign-in ----------

@router.get("/config")
def get_config():
    cfg = outlook_core.get_oauth_config()
    own = cfg["source"] == "user"
    return {
        "has_oauth_config": bool(cfg["client_id"]),
        # The app shipped in the build (or env): the settings screen hides its ids and offers no form by default.
        "using_builtin": bool(cfg["client_id"]) and not own,
        "client_id": cfg["client_id"] if own else "",
        "tenant_id": cfg["tenant_id"] if own and cfg["tenant_id"] != "organizations" else "",
        "admin_consent_url": outlook_client.admin_consent_url(),
        "redirect_uri": outlook_client.redirect_uri(),
        "redirect_path": outlook_client.REDIRECT_PATH,
    }


@router.put("/config/oauth")
def update_config(body: OAuthConfigIn):
    if not body.client_id.strip():
        raise HTTPException(status_code=400, detail="Application (client) ID không được để trống.")
    outlook_core.save_oauth_config(body.client_id, body.tenant_id)
    return {"ok": True}


@router.delete("/config/oauth")
def clear_config():
    """Go back to the app shipped in the build."""
    outlook_core.clear_oauth_config()
    return {"ok": True}


@router.post("/oauth/start")
def start_oauth():
    try:
        return outlook_client.create_oauth_url()
    except OutlookClientError as exc:
        raise _http(exc)


@router.get("/oauth/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    if error:
        detail = error_description or error
        if outlook_client.needs_admin_consent(f"{error} {detail}"):
            return _admin_consent_page()
        return _page("Đăng nhập Microsoft bị huỷ hoặc lỗi", html.escape(detail), False, 400)
    if not code or not state:
        return _page("Thiếu thông tin đăng nhập", "Thiếu tham số code hoặc state.", False, 400)
    try:
        account = await outlook_client.exchange_oauth_code(code, state)
    except OutlookClientError as exc:
        if outlook_client.needs_admin_consent(str(exc)):
            return _admin_consent_page()
        return _page("Không kết nối được Outlook", html.escape(str(exc)), False, exc.status_code)
    return _page(
        "Kết nối Outlook thành công!",
        f"Đã liên kết tài khoản <strong>{html.escape(account['email'])}</strong>.",
        True,
    )


# ---------- accounts ----------

@router.get("/accounts")
def get_accounts():
    return {"items": outlook_core.list_accounts()}


@router.delete("/accounts/{account_id}")
def remove_account(account_id: int):
    if not outlook_core.delete_account(account_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Outlook.")
    outlook_mail._well_known_cache.pop(account_id, None)
    return {"ok": True}


@router.get("/unread-count")
async def unread_count():
    """New mail across every connected account (Inbox + customer folders; not Sent / Drafts / Deleted / Junk)."""
    total = 0
    for acc in outlook_core.list_accounts():
        try:
            total += (await outlook_mail.list_folders(acc["id"]))["total_unread"]
        except OutlookClientError:
            continue
    return {"unread": total}


# ---------- folders & messages ----------

@router.get("/accounts/{account_id}/folders")
async def get_folders(account_id: int):
    try:
        return await outlook_mail.list_folders(account_id)
    except OutlookClientError as exc:
        raise _http(exc)


@router.put("/accounts/{account_id}/pin")
def pin_folder(account_id: int, body: PinIn):
    # Folder ids are base64 and may hold "/", so they travel in the body, never in the path.
    if not outlook_core.get_account(account_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Outlook.")
    outlook_core.set_pinned(account_id, body.folder_id, body.pinned)
    return {"ok": True}


@router.get("/accounts/{account_id}/messages")
async def get_messages(
    account_id: int,
    folder_id: str = Query(""),
    search: str = Query(""),
    only_unread: bool = Query(False),
    only_attachments: bool = Query(False),
    cursor: str = Query(""),
):
    try:
        return await outlook_mail.list_messages(
            account_id, folder_id=folder_id, search=search, only_unread=only_unread,
            only_attachments=only_attachments, cursor=cursor,
        )
    except OutlookClientError as exc:
        raise _http(exc)


@router.get("/accounts/{account_id}/conversation")
async def get_conversation(account_id: int, conversation_id: str = Query(...), mark_read: bool = Query(True)):
    try:
        return await outlook_mail.get_conversation(account_id, conversation_id, mark_read=mark_read)
    except OutlookClientError as exc:
        raise _http(exc)


@router.post("/accounts/{account_id}/actions")
async def run_action(account_id: int, body: ActionIn):
    if not body.message_ids:
        raise HTTPException(status_code=400, detail="Chưa chọn email nào.")
    try:
        done = await outlook_mail.apply_action(account_id, body.message_ids, body.action, body.destination)
    except OutlookClientError as exc:
        raise _http(exc)
    return {"ok": True, "count": done}


# ---------- attachments ----------

def _content_disposition(filename: str) -> str:
    fallback = unicodedata.normalize("NFKD", filename).replace("đ", "d").replace("Đ", "D")
    fallback = fallback.encode("ascii", "ignore").decode("ascii")
    fallback = "".join(c if c.isprintable() and c not in '"\\' else "_" for c in fallback).strip() or "attachment"
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


@router.get("/accounts/{account_id}/attachment")
async def download_attachment(account_id: int, message_id: str = Query(...), attachment_id: str = Query(...)):
    try:
        raw, name, ctype = await outlook_mail.download_attachment(account_id, message_id, attachment_id)
    except OutlookClientError as exc:
        raise _http(exc)
    return Response(content=raw, media_type=ctype, headers={"Content-Disposition": _content_disposition(name)})


@router.post("/accounts/{account_id}/import-booking")
async def import_booking(account_id: int, body: ImportIn):
    try:
        return await outlook_mail.import_attachment(account_id, body.message_id, body.attachment_id, body.collection_id)
    except OutlookClientError as exc:
        raise _http(exc)


# ---------- sending ----------

@router.post("/accounts/{account_id}/send")
async def send(
    account_id: int,
    mode: str = Form("new"),
    to_addrs: str = Form(...),
    subject: str = Form(""),
    body_text: str = Form(""),
    cc_addrs: str = Form(""),
    bcc_addrs: str = Form(""),
    reply_to_message_id: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    if mode not in ("new", "reply", "forward"):
        raise HTTPException(status_code=400, detail="Kiểu gửi không hợp lệ.")
    att = [(f.filename or "attachment", f.content_type or "application/octet-stream", await f.read()) for f in files]
    try:
        return await outlook_mail.send_mail(
            account_id, mode, to_addrs, subject.strip() or "(Không có tiêu đề)", body_text,
            cc_addrs=cc_addrs, bcc_addrs=bcc_addrs, reply_to_message_id=reply_to_message_id, files=att,
        )
    except OutlookClientError as exc:
        raise _http(exc)
