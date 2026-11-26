"""Outlook mail over Microsoft Graph: folder tree, message pages, conversations, attachments, actions, sending."""
import base64
import html
import logging
from datetime import datetime
from email.utils import getaddresses
from typing import Any, Optional
from urllib.parse import quote

from backend.app.core import outlook as outlook_core
from backend.app.services import mail_booking_import
from backend.app.services.outlook_client import OutlookClientError, graph_request

logger = logging.getLogger("backend.outlook.mail")

# Folders Outlook names itself; shown first, in this order, with Vietnamese labels in the UI.
WELL_KNOWN = ("inbox", "sentitems", "drafts", "archive", "deleteditems", "junkemail")
# Folders whose unread mail is not "new mail for me" (left out of the tab badge).
NOT_COUNTED = {"sentitems", "drafts", "deleteditems", "junkemail"}

FOLDER_SELECT = "id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount"
LIST_SELECT = (
    "id,conversationId,parentFolderId,subject,bodyPreview,from,toRecipients,receivedDateTime,"
    "isRead,hasAttachments,flag,importance"
)
DETAIL_SELECT = (
    "id,conversationId,parentFolderId,subject,bodyPreview,body,from,toRecipients,ccRecipients,"
    "receivedDateTime,isRead,hasAttachments,flag,internetMessageId"
)
ATTACHMENT_SELECT = "id,name,contentType,size,isInline"
PAGE_SIZE = 50
MAX_SEND_BYTES = 3 * 1024 * 1024  # Graph takes at most ~4 MB per request; base64 adds a third.

# folder id -> well-known name, per account (folder ids do not change).
_well_known_cache: dict[int, dict[str, str]] = {}


def _seg(value: str) -> str:
    return quote(value, safe="")


def _fmt_addr(recipient: Optional[dict[str, Any]]) -> str:
    ea = (recipient or {}).get("emailAddress") or {}
    name = str(ea.get("name") or "").strip()
    addr = str(ea.get("address") or "").strip()
    if name and addr and name.lower() != addr.lower():
        return f'"{name}" <{addr}>' if "," in name else f"{name} <{addr}>"
    return addr or name


def _fmt_addrs(recipients: Optional[list[dict[str, Any]]]) -> str:
    return ", ".join(a for a in (_fmt_addr(r) for r in recipients or []) if a)


def _to_recipients(text: str) -> list[dict[str, Any]]:
    out = []
    for name, addr in getaddresses([text or ""]):
        addr = addr.strip()
        if addr and "@" in addr:
            out.append({"emailAddress": {"address": addr, **({"name": name.strip()} if name.strip() else {})}})
    return out


def _ms(iso: str) -> int:
    if not iso:
        return 0
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return 0


def _text_to_html(text: str) -> str:
    body = html.escape(text or "").replace("\r\n", "\n").replace("\n", "<br>")
    return f'<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">{body}</div>'


async def _paged(account_id: int, path: str, params: dict[str, Any], limit: int = 2000) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    data = await graph_request(account_id, "GET", path, params=params)
    items.extend(data.get("value") or [])
    while data.get("@odata.nextLink") and len(items) < limit:
        data = await graph_request(account_id, "GET", data["@odata.nextLink"])
        items.extend(data.get("value") or [])
    return items


# ---------- folders ----------

async def _well_known_ids(account_id: int) -> dict[str, str]:
    cached = _well_known_cache.get(account_id)
    if cached is not None:
        return cached
    found: dict[str, str] = {}
    for name in WELL_KNOWN:
        try:
            data = await graph_request(account_id, "GET", f"/mailFolders/{name}", params={"$select": "id"})
            if data.get("id"):
                found[data["id"]] = name
        except OutlookClientError as exc:
            if exc.status_code not in (400, 404):  # a mailbox may have no Archive folder
                raise
    _well_known_cache[account_id] = found
    return found


async def list_folders(account_id: int) -> dict[str, Any]:
    """Every folder (sub-folders included), flat, with Graph's unread/total counts; the UI builds the tree."""
    well_known = await _well_known_ids(account_id)
    pinned = set(outlook_core.list_pinned(account_id))
    params = {"$top": 100, "$select": FOLDER_SELECT}
    raw = await _paged(account_id, "/mailFolders", params)
    queue = [f for f in raw if int(f.get("childFolderCount") or 0) > 0]
    while queue:
        parent = queue.pop(0)
        children = await _paged(account_id, f"/mailFolders/{_seg(parent['id'])}/childFolders", params)
        raw.extend(children)
        queue.extend(c for c in children if int(c.get("childFolderCount") or 0) > 0)

    folders = []
    for f in raw:
        wk = well_known.get(f["id"], "")
        folders.append({
            "id": f["id"],
            "name": f.get("displayName") or "",
            "parent_id": f.get("parentFolderId") or "",
            "well_known": wk,
            "unread": int(f.get("unreadItemCount") or 0),
            "total": int(f.get("totalItemCount") or 0),
            "child_count": int(f.get("childFolderCount") or 0),
            "pinned": f["id"] in pinned,
        })
    unread = sum(f["unread"] for f in folders if f["well_known"] not in NOT_COUNTED)
    return {"folders": folders, "total_unread": unread}


# ---------- message lists ----------

def _list_item(m: dict[str, Any]) -> dict[str, Any]:
    received = str(m.get("receivedDateTime") or "")
    return {
        "message_id": m["id"],
        "conversation_id": m.get("conversationId") or "",
        "folder_id": m.get("parentFolderId") or "",
        "subject": m.get("subject") or "(Không có tiêu đề)",
        "snippet": (m.get("bodyPreview") or "").strip(),
        "from_addr": _fmt_addr(m.get("from")),
        "to_addrs": _fmt_addrs(m.get("toRecipients")),
        "is_unread": 0 if m.get("isRead") else 1,
        "is_flagged": 1 if ((m.get("flag") or {}).get("flagStatus") == "flagged") else 0,
        "has_attachments": 1 if m.get("hasAttachments") else 0,
        "is_important": 1 if m.get("importance") == "high" else 0,
        "date_iso": received,
        "internal_date_ms": _ms(received),
    }


async def list_messages(
    account_id: int,
    folder_id: str = "",
    search: str = "",
    only_unread: bool = False,
    only_attachments: bool = False,
    cursor: str = "",
) -> dict[str, Any]:
    """One page (50) of a folder, newest first, or search results ($search covers subject, body, people and,
    with no folder, the whole mailbox). `next_cursor` fetches the next page."""
    q = " ".join((search or "").replace('"', " ").split())
    if cursor:
        data = await graph_request(account_id, "GET", cursor)
    else:
        path = f"/mailFolders/{_seg(folder_id)}/messages" if folder_id else "/messages"
        params: dict[str, Any] = {"$top": PAGE_SIZE, "$select": LIST_SELECT}
        if q:
            # $search cannot be combined with $filter / $orderby; it already returns the newest first.
            params["$search"] = f'"{q}"'
        else:
            # Graph wants every $orderby property in $filter too, first and in the same order.
            filters = ["receivedDateTime ge 1900-01-01T00:00:00Z"]
            if only_unread:
                filters.append("isRead eq false")
            if only_attachments:
                filters.append("hasAttachments eq true")
            params["$filter"] = " and ".join(filters)
            params["$orderby"] = "receivedDateTime desc"
        data = await graph_request(account_id, "GET", path, params=params)

    items = [_list_item(m) for m in data.get("value") or []]
    if q or cursor:
        if only_unread:
            items = [i for i in items if i["is_unread"]]
        if only_attachments:
            items = [i for i in items if i["has_attachments"]]
    return {"items": items, "next_cursor": data.get("@odata.nextLink") or ""}


# ---------- conversation detail ----------

async def _attachments(account_id: int, message_id: str, body_html: str) -> list[dict[str, Any]]:
    rows = await _paged(
        account_id, f"/messages/{_seg(message_id)}/attachments", {"$select": ATTACHMENT_SELECT}, limit=200
    )
    out = []
    for a in rows:
        name = a.get("name") or "attachment"
        ctype = (a.get("contentType") or "application/octet-stream").lower()
        item = {
            "id": a["id"],
            "filename": name,
            "mime_type": ctype,
            "size": int(a.get("size") or 0),
            "is_pdf": 1 if (ctype == "application/pdf" or name.lower().endswith(".pdf")) else 0,
            "is_inline": 1 if a.get("isInline") else 0,
            "content_id": "",
            "imported_booking_no": "",
        }
        # contentId is only on the file attachment type; ask for it only where the body shows cid: images.
        if a.get("isInline") and "cid:" in body_html:
            try:
                full = await graph_request(
                    account_id, "GET", f"/messages/{_seg(message_id)}/attachments/{_seg(a['id'])}"
                )
                item["content_id"] = str(full.get("contentId") or "").strip("<>")
            except OutlookClientError:
                logger.warning("Could not read contentId of an inline attachment")
        out.append(item)
    return out


def _detail(m: dict[str, Any]) -> dict[str, Any]:
    item = _list_item(m)
    body = m.get("body") or {}
    content = str(body.get("content") or "")
    is_html = str(body.get("contentType") or "").lower() == "html"
    item.update({
        "cc_addrs": _fmt_addrs(m.get("ccRecipients")),
        "body_html": content if is_html else "",
        "body_text": "" if is_html else content,
        "rfc_message_id": m.get("internetMessageId") or "",
        "attachments": [],
    })
    return item


async def get_conversation(account_id: int, conversation_id: str, mark_read: bool = True) -> dict[str, Any]:
    """All messages of a conversation in every folder (replies usually sit in Sent Items), oldest first.
    Opening it marks the unread ones read in Outlook; the returned flags still show what was unread."""
    cid = conversation_id.replace("'", "''")
    raw = await _paged(
        account_id,
        "/messages",
        {"$filter": f"conversationId eq '{cid}'", "$top": PAGE_SIZE, "$select": DETAIL_SELECT},
        limit=200,
    )
    if not raw:
        raise OutlookClientError("Không tìm thấy email (có thể đã bị xoá hoặc chuyển đi).", 404)
    # Bodies come back as stored (HTML for nearly all Outlook mail); _detail handles plain text too.
    messages = sorted((_detail(m) for m in raw), key=lambda d: d["internal_date_ms"])

    imports = outlook_core.get_imports(account_id, [m["message_id"] for m in messages])
    for msg in messages:
        if msg["has_attachments"] or "cid:" in msg["body_html"]:
            msg["attachments"] = await _attachments(account_id, msg["message_id"], msg["body_html"])
            for att in msg["attachments"]:
                att["imported_booking_no"] = imports.get((msg["message_id"], att["id"]), "")

    if mark_read:
        for msg in messages:
            if msg["is_unread"]:
                try:
                    await graph_request(
                        account_id, "PATCH", f"/messages/{_seg(msg['message_id'])}", json_body={"isRead": True}
                    )
                except OutlookClientError:
                    logger.warning("Could not mark an Outlook message read")

    latest = messages[-1]
    return {
        "conversation_id": conversation_id,
        "subject": messages[0]["subject"],
        "is_unread": 1 if any(m["is_unread"] for m in messages) else 0,
        "is_flagged": 1 if any(m["is_flagged"] for m in messages) else 0,
        "latest_message_id": latest["message_id"],
        "messages": messages,
    }


# ---------- attachments ----------

async def download_attachment(account_id: int, message_id: str, attachment_id: str) -> tuple[bytes, str, str]:
    meta = await graph_request(
        account_id, "GET", f"/messages/{_seg(message_id)}/attachments/{_seg(attachment_id)}",
        params={"$select": ATTACHMENT_SELECT},
    )
    raw = await graph_request(
        account_id, "GET", f"/messages/{_seg(message_id)}/attachments/{_seg(attachment_id)}/$value", raw=True
    )
    return raw, meta.get("name") or "attachment", meta.get("contentType") or "application/octet-stream"


async def import_attachment(
    account_id: int, message_id: str, attachment_id: str, collection_id: Optional[int]
) -> dict[str, Any]:
    raw, name, ctype = await download_attachment(account_id, message_id, attachment_id)
    if not (ctype.lower() == "application/pdf" or name.lower().endswith(".pdf")):
        raise OutlookClientError("Chỉ đọc được tệp PDF vào Booking.", 400)
    try:
        res = mail_booking_import.import_pdf_bytes(raw, name, collection_id)
    except mail_booking_import.MailImportError as exc:
        raise OutlookClientError(str(exc), exc.status_code)
    outlook_core.mark_imported(account_id, message_id, attachment_id, res["booking_no"])
    return res


# ---------- actions ----------

ACTIONS = ("read", "unread", "flag", "unflag", "move", "archive", "delete")


async def apply_action(account_id: int, message_ids: list[str], action: str, destination: str = "") -> int:
    """Apply one action to the given messages (one at a time: Graph allows few parallel requests per mailbox)."""
    if action not in ACTIONS:
        raise OutlookClientError(f"Thao tác không hợp lệ: {action}", 400)
    if action == "move" and not destination:
        raise OutlookClientError("Chưa chọn thư mục đích.", 400)
    done = 0
    for mid in message_ids:
        path = f"/messages/{_seg(mid)}"
        if action in ("read", "unread"):
            await graph_request(account_id, "PATCH", path, json_body={"isRead": action == "read"})
        elif action in ("flag", "unflag"):
            status = "flagged" if action == "flag" else "notFlagged"
            await graph_request(account_id, "PATCH", path, json_body={"flag": {"flagStatus": status}})
        else:
            dest = {"move": destination, "archive": "archive", "delete": "deleteditems"}[action]
            await graph_request(account_id, "POST", f"{path}/move", json_body={"destinationId": dest})
        done += 1
    return done


# ---------- sending ----------

def _file_attachments(files: list[tuple[str, str, bytes]]) -> list[dict[str, Any]]:
    total = sum(len(b) for _, _, b in files)
    if total > MAX_SEND_BYTES:
        raise OutlookClientError(
            f"Tệp đính kèm quá lớn ({total / 1024 / 1024:.1f} MB). Outlook qua ứng dụng nhận tối đa 3 MB mỗi lần gửi.",
            413,
        )
    return [
        {
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": name,
            "contentType": ctype or "application/octet-stream",
            "contentBytes": base64.b64encode(data).decode("ascii"),
        }
        for name, ctype, data in files
    ]


async def send_mail(
    account_id: int,
    mode: str,
    to_addrs: str,
    subject: str,
    body_text: str,
    cc_addrs: str = "",
    bcc_addrs: str = "",
    reply_to_message_id: str = "",
    files: Optional[list[tuple[str, str, bytes]]] = None,
) -> dict[str, Any]:
    """New mail goes through sendMail. A reply / forward is created from the original message by Outlook (so it
    keeps the conversation and the quoted history), then edited, given its attachments, and sent."""
    to = _to_recipients(to_addrs)
    if not to:
        raise OutlookClientError("Vui lòng nhập địa chỉ người nhận hợp lệ.", 400)
    attachments = _file_attachments(files or [])
    cc, bcc = _to_recipients(cc_addrs), _to_recipients(bcc_addrs)

    if mode == "new" or not reply_to_message_id:
        message: dict[str, Any] = {
            "subject": subject,
            "body": {"contentType": "HTML", "content": _text_to_html(body_text)},
            "toRecipients": to,
            "ccRecipients": cc,
            "bccRecipients": bcc,
        }
        if attachments:
            message["attachments"] = attachments
        await graph_request(account_id, "POST", "/sendMail", json_body={"message": message, "saveToSentItems": True})
        return {"ok": True}

    op = "createForward" if mode == "forward" else "createReply"
    draft = await graph_request(
        account_id, "POST", f"/messages/{_seg(reply_to_message_id)}/{op}",
        json_body={"comment": _text_to_html(body_text)},
    )
    draft_id = draft["id"]
    try:
        await graph_request(
            account_id, "PATCH", f"/messages/{_seg(draft_id)}",
            json_body={"subject": subject, "toRecipients": to, "ccRecipients": cc, "bccRecipients": bcc},
        )
        for att in attachments:
            await graph_request(account_id, "POST", f"/messages/{_seg(draft_id)}/attachments", json_body=att)
        await graph_request(account_id, "POST", f"/messages/{_seg(draft_id)}/send")
    except OutlookClientError:
        try:
            await graph_request(account_id, "DELETE", f"/messages/{_seg(draft_id)}")
        except OutlookClientError:
            logger.warning("Could not remove an unsent Outlook draft")
        raise
    return {"ok": True, "conversation_id": draft.get("conversationId") or ""}
