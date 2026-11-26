"""Gmail REST API v1 & Google OAuth 2.0 PKCE client built on httpx."""
import base64
import hashlib
import html
import logging
import secrets
import time
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from backend.app.core import gmail as gmail_core
from backend.app.core.config import BACKEND_HOST, BACKEND_PORT

logger = logging.getLogger("backend.gmail.client")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

GMAIL_SCOPES = " ".join([
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
])

# Attachments whose bytes live inside the message body (no Gmail attachmentId) are stored as "inline:<n>".
INLINE_ATTACHMENT_PREFIX = "inline:"

# In-memory PKCE state store: state -> {code_verifier, redirect_uri, created_at}
_OAUTH_STATES: dict[str, dict[str, Any]] = {}
_OAUTH_STATE_TTL = 600  # 10 minutes


class GmailClientError(Exception):
    """Raised when Google OAuth or Gmail API returns an error."""
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def default_redirect_uri() -> str:
    return f"http://{BACKEND_HOST}:{BACKEND_PORT}/api/v1/gmail/oauth/callback"


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padded = data + "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def create_oauth_url(redirect_uri: Optional[str] = None) -> dict[str, str]:
    """Generate a Google OAuth 2.0 PKCE authorization URL."""
    cfg = gmail_core.get_oauth_config()
    if not cfg["client_id"]:
        raise GmailClientError(
            "Chưa cấu hình Google OAuth Client ID. Vào Cài đặt Gmail để nhập Client ID & Client Secret.",
            status_code=400,
        )

    # Prune expired states
    now = time.time()
    expired = [k for k, v in _OAUTH_STATES.items() if now - v["created_at"] > _OAUTH_STATE_TTL]
    for k in expired:
        _OAUTH_STATES.pop(k, None)

    state = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = _b64url_encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
    eff_redirect = redirect_uri or default_redirect_uri()

    _OAUTH_STATES[state] = {
        "code_verifier": code_verifier,
        "redirect_uri": eff_redirect,
        "created_at": now,
    }

    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": eff_redirect,
        "response_type": "code",
        "scope": GMAIL_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent select_account",
    }
    return {"auth_url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}", "state": state}


async def exchange_oauth_code(code: str, state: str) -> dict[str, Any]:
    """Exchange authorization code for tokens and upsert the Gmail account."""
    pending = _OAUTH_STATES.pop(state, None)
    if not pending or (time.time() - pending["created_at"] > _OAUTH_STATE_TTL):
        raise GmailClientError("Phiên đăng nhập OAuth đã hết hạn hoặc không hợp lệ.", status_code=400)

    cfg = gmail_core.get_oauth_config()
    if not cfg["client_id"]:
        raise GmailClientError("Thiếu Google OAuth Client ID.", status_code=400)

    token_payload = {
        "client_id": cfg["client_id"],
        "code": code,
        "code_verifier": pending["code_verifier"],
        "grant_type": "authorization_code",
        "redirect_uri": pending["redirect_uri"],
    }
    if cfg["client_secret"]:
        token_payload["client_secret"] = cfg["client_secret"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        tok_res = await client.post(GOOGLE_TOKEN_URL, data=token_payload)
        if tok_res.status_code >= 400:
            raise GmailClientError(f"Lỗi đổi token Google: {tok_res.text}", status_code=tok_res.status_code)
        tok_data = tok_res.json()
        access_token = tok_data["access_token"]
        refresh_token = tok_data.get("refresh_token", "")
        expires_in = int(tok_data.get("expires_in", 3600))
        expiry = int(time.time()) + expires_in - 60

        user_res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code >= 400:
            raise GmailClientError(f"Không lấy được thông tin tài khoản Google: {user_res.text}", status_code=user_res.status_code)
        user_info = user_res.json()

        prof_res = await client.get(
            f"{GMAIL_API_BASE}/profile",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        history_id = ""
        if prof_res.status_code == 200:
            history_id = str(prof_res.json().get("historyId") or "")

    return gmail_core.upsert_account(
        email=user_info.get("email", ""),
        display_name=user_info.get("name", "") or user_info.get("email", ""),
        avatar=user_info.get("picture", ""),
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=expiry,
        history_id=history_id,
    )


async def _refresh_access_token(account: dict[str, Any]) -> str:
    refresh_token = account.get("refresh_token") or ""
    if not refresh_token:
        gmail_core.update_account_sync_state(account["id"], error="Thiếu refresh_token, vui lòng đăng nhập lại.")
        raise GmailClientError("Phiên Gmail đã hết hạn, vui lòng kết nối lại tài khoản.", status_code=401)

    cfg = gmail_core.get_oauth_config()
    if not cfg["client_id"]:
        raise GmailClientError("Thiếu Google OAuth Client ID.", status_code=400)

    payload = {
        "client_id": cfg["client_id"],
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    if cfg["client_secret"]:
        payload["client_secret"] = cfg["client_secret"]

    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(GOOGLE_TOKEN_URL, data=payload)
        if res.status_code >= 400:
            gmail_core.update_account_sync_state(account["id"], error=f"Refresh token thất bại ({res.status_code})")
            raise GmailClientError("Không thể làm mới token Gmail, vui lòng đăng nhập lại.", status_code=401)
        data = res.json()
        new_access = data["access_token"]
        expiry = int(time.time()) + int(data.get("expires_in", 3600)) - 60
        gmail_core.update_account_tokens(account["id"], new_access, expiry, data.get("refresh_token"))
        return new_access


async def get_valid_access_token(account_id: int) -> str:
    acc = gmail_core.get_account(account_id, include_tokens=True)
    if not acc:
        raise GmailClientError("Không tìm thấy tài khoản Gmail.", status_code=404)
    if acc["access_token"] and int(acc["token_expiry"] or 0) > int(time.time()):
        return acc["access_token"]
    return await _refresh_access_token(acc)


async def gmail_request(
    account_id: int,
    method: str,
    path: str,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
) -> Any:
    """Perform an authenticated request to Gmail API v1 with automatic 401 refresh."""
    token = await get_valid_access_token(account_id)
    url = f"{GMAIL_API_BASE}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.request(
            method,
            url,
            params=params,
            json=json_body,
            headers={"Authorization": f"Bearer {token}"},
        )
        if res.status_code == 401:
            acc = gmail_core.get_account(account_id, include_tokens=True)
            if acc:
                token = await _refresh_access_token(acc)
                res = await client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    headers={"Authorization": f"Bearer {token}"},
                )
        if res.status_code >= 400:
            raise GmailClientError(f"Gmail API error ({res.status_code}): {res.text}", status_code=res.status_code)
        if res.status_code == 204 or not res.content:
            return {}
        return res.json()


def parse_message_payload(raw_msg: dict[str, Any]) -> dict[str, Any]:
    """Extract headers, text/html bodies, and attachment metadata from a Gmail API message."""
    payload = raw_msg.get("payload") or {}
    headers_list = payload.get("headers") or []
    headers = {str(h.get("name", "")).lower(): str(h.get("value", "")) for h in headers_list}

    body_text_parts: list[str] = []
    body_html_parts: list[str] = []
    attachments: list[dict[str, Any]] = []

    def _walk(part: dict[str, Any]) -> None:
        mime = str(part.get("mimeType") or "").lower()
        filename = str(part.get("filename") or "").strip()
        body = part.get("body") or {}
        att_id = body.get("attachmentId")
        data_b64 = body.get("data")
        part_headers = {str(h.get("name", "")).lower(): str(h.get("value", "")) for h in part.get("headers") or []}
        # Images shown inside the HTML body are referenced as <img src="cid:...">.
        content_id = part_headers.get("content-id", "").strip().strip("<>").strip()
        if not filename and content_id and mime.startswith("image/"):
            filename = content_id.split("@")[0] or "image"

        if filename and (att_id or data_b64):
            is_pdf = mime == "application/pdf" or filename.lower().endswith(".pdf")
            att: dict[str, Any] = {
                "attachment_id": att_id or f"{INLINE_ATTACHMENT_PREFIX}{len(attachments)}",
                "filename": filename,
                "mime_type": mime or "application/octet-stream",
                "size": int(body.get("size") or 0),
                "is_pdf": 1 if is_pdf else 0,
                "content_id": content_id,
            }
            if not att_id:
                # Small files sit inside the message itself; Gmail gives them no attachmentId to download by.
                att["inline_data"] = data_b64
            attachments.append(att)
        elif mime == "text/plain" and data_b64:
            try:
                body_text_parts.append(_b64url_decode(data_b64).decode("utf-8", errors="replace"))
            except Exception:
                pass
        elif mime == "text/html" and data_b64:
            try:
                body_html_parts.append(_b64url_decode(data_b64).decode("utf-8", errors="replace"))
            except Exception:
                pass

        for sub in part.get("parts") or []:
            _walk(sub)

    _walk(payload)

    internal_ms = int(raw_msg.get("internalDate") or 0)
    date_iso = ""
    raw_date = headers.get("date", "")
    if raw_date:
        try:
            date_iso = parsedate_to_datetime(raw_date).isoformat()
        except Exception:
            date_iso = ""
    if not date_iso and internal_ms:
        from datetime import datetime, timezone
        date_iso = datetime.fromtimestamp(internal_ms / 1000.0, tz=timezone.utc).isoformat()

    labels = [str(x) for x in (raw_msg.get("labelIds") or [])]
    return {
        "message_id": str(raw_msg.get("id") or ""),
        "thread_id": str(raw_msg.get("threadId") or ""),
        "from_addr": headers.get("from", ""),
        "to_addrs": headers.get("to", ""),
        "cc_addrs": headers.get("cc", ""),
        "subject": headers.get("subject", "") or "(Không có tiêu đề)",
        "snippet": html.unescape(str(raw_msg.get("snippet") or "")),
        "body_text": "\n".join(body_text_parts).strip(),
        "body_html": "\n".join(body_html_parts).strip(),
        "labels": labels,
        "is_unread": 1 if "UNREAD" in labels else 0,
        "is_starred": 1 if "STARRED" in labels else 0,
        "internal_date_ms": internal_ms,
        "date_iso": date_iso,
        "rfc_message_id": headers.get("message-id", ""),
        "references_header": headers.get("references", ""),
        "attachments": attachments,
    }


async def download_attachment(account_id: int, message_id: str, attachment_id: str) -> bytes:
    if attachment_id.startswith(INLINE_ATTACHMENT_PREFIX):
        raw_msg = await gmail_request(account_id, "GET", f"/messages/{message_id}", params={"format": "full"})
        for att in parse_message_payload(raw_msg)["attachments"]:
            if att["attachment_id"] == attachment_id and att.get("inline_data"):
                return _b64url_decode(att["inline_data"])
        raise GmailClientError("Không tìm thấy tệp đính kèm trong email.", status_code=404)
    res = await gmail_request(account_id, "GET", f"/messages/{message_id}/attachments/{attachment_id}")
    data = res.get("data") or ""
    return _b64url_decode(data)


async def modify_thread_labels(
    account_id: int,
    thread_id: str,
    add_labels: Optional[list[str]] = None,
    remove_labels: Optional[list[str]] = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if add_labels:
        body["addLabelIds"] = add_labels
    if remove_labels:
        body["removeLabelIds"] = remove_labels
    return await gmail_request(account_id, "POST", f"/threads/{thread_id}/modify", json_body=body)


async def trash_thread(account_id: int, thread_id: str) -> dict[str, Any]:
    return await gmail_request(account_id, "POST", f"/threads/{thread_id}/trash")


async def untrash_thread(account_id: int, thread_id: str) -> dict[str, Any]:
    return await gmail_request(account_id, "POST", f"/threads/{thread_id}/untrash")


async def send_email(
    account_id: int,
    to_addrs: str,
    subject: str,
    body_text: str = "",
    body_html: str = "",
    cc_addrs: str = "",
    bcc_addrs: str = "",
    thread_id: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
    attachments: Optional[list[tuple[str, str, bytes]]] = None,
) -> dict[str, Any]:
    """Build and send an RFC 2822 email via Gmail API."""
    acc = gmail_core.get_account(account_id)
    if not acc:
        raise GmailClientError("Không tìm thấy tài khoản Gmail.", status_code=404)

    msg = EmailMessage()
    msg["From"] = f"{acc['display_name']} <{acc['email']}>" if acc.get("display_name") else acc["email"]
    msg["To"] = to_addrs
    if cc_addrs.strip():
        msg["Cc"] = cc_addrs.strip()
    if bcc_addrs.strip():
        msg["Bcc"] = bcc_addrs.strip()
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = f"{references} {in_reply_to}".strip() if references else in_reply_to

    plain = body_text or ""
    if body_html:
        msg.set_content(plain or " ")
        msg.add_alternative(body_html, subtype="html")
    else:
        msg.set_content(plain)

    for filename, mime_type, raw_bytes in attachments or []:
        maintype, _, subtype = (mime_type or "application/octet-stream").partition("/")
        msg.add_attachment(raw_bytes, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=filename)

    raw_b64 = _b64url_encode(msg.as_bytes())
    payload: dict[str, Any] = {"raw": raw_b64}
    if thread_id:
        payload["threadId"] = thread_id

    return await gmail_request(account_id, "POST", "/messages/send", json_body=payload)
