"""Gmail synchronization and PDF-to-Booking import service."""
import json
import logging
from typing import Any, Optional

from backend.app.core import gmail as gmail_core
from backend.app.services import gmail_client
from backend.app.services import mail_booking_import

logger = logging.getLogger("backend.gmail.sync")


def _upsert_thread_from_api(account_id: int, raw_thread: dict[str, Any]) -> dict[str, Any]:
    """Persist one Gmail API thread and all its messages/attachments into SQLite."""
    thread_id = str(raw_thread.get("id") or "")
    raw_msgs = raw_thread.get("messages") or []
    parsed_msgs = [gmail_client.parse_message_payload(m) for m in raw_msgs]
    if not parsed_msgs:
        return {"thread_id": thread_id, "messages": 0}

    now = gmail_core._now()
    all_labels: set[str] = set()
    participants: list[str] = []
    seen_p: set[str] = set()
    has_attachments = False
    has_pdf = False
    is_unread = False
    is_starred = False

    for pm in parsed_msgs:
        all_labels.update(pm["labels"])
        if pm["is_unread"]:
            is_unread = True
        if pm["is_starred"]:
            is_starred = True
        sender = pm["from_addr"].strip()
        if sender and sender not in seen_p:
            seen_p.add(sender)
            participants.append(sender)
        if pm["attachments"]:
            has_attachments = True
            if any(a["is_pdf"] for a in pm["attachments"]):
                has_pdf = True

    latest = max(parsed_msgs, key=lambda m: m["internal_date_ms"])
    first = parsed_msgs[0]

    with gmail_core._conn() as conn:
        conn.execute(
            """
            INSERT INTO gmail_threads
            (account_id, thread_id, subject, snippet, participants, labels_json, is_unread, is_starred,
             has_attachments, has_pdf, message_count, last_message_ms, last_message_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, thread_id) DO UPDATE SET
                subject = excluded.subject,
                snippet = excluded.snippet,
                participants = excluded.participants,
                labels_json = excluded.labels_json,
                is_unread = excluded.is_unread,
                is_starred = excluded.is_starred,
                has_attachments = excluded.has_attachments,
                has_pdf = excluded.has_pdf,
                message_count = excluded.message_count,
                last_message_ms = excluded.last_message_ms,
                last_message_at = excluded.last_message_at,
                updated_at = excluded.updated_at;
            """,
            (
                account_id,
                thread_id,
                first["subject"],
                latest["snippet"],
                ", ".join(participants[:4]),
                json.dumps(sorted(all_labels)),
                1 if is_unread else 0,
                1 if is_starred else 0,
                1 if has_attachments else 0,
                1 if has_pdf else 0,
                len(parsed_msgs),
                latest["internal_date_ms"],
                latest["date_iso"],
                now,
            ),
        )

        for pm in parsed_msgs:
            conn.execute(
                """
                INSERT INTO gmail_messages
                (account_id, message_id, thread_id, from_addr, to_addrs, cc_addrs, subject, snippet,
                 body_text, body_html, labels_json, is_unread, is_starred, internal_date_ms, date_iso,
                 rfc_message_id, references_header, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id, message_id) DO UPDATE SET
                    labels_json = excluded.labels_json,
                    is_unread = excluded.is_unread,
                    is_starred = excluded.is_starred,
                    snippet = excluded.snippet;
                """,
                (
                    account_id,
                    pm["message_id"],
                    thread_id,
                    pm["from_addr"],
                    pm["to_addrs"],
                    pm["cc_addrs"],
                    pm["subject"],
                    pm["snippet"],
                    pm["body_text"],
                    pm["body_html"],
                    json.dumps(pm["labels"]),
                    pm["is_unread"],
                    pm["is_starred"],
                    pm["internal_date_ms"],
                    pm["date_iso"],
                    pm["rfc_message_id"],
                    pm["references_header"],
                    now,
                ),
            )
            for att in pm["attachments"]:
                conn.execute(
                    """
                    INSERT INTO gmail_attachments
                    (account_id, message_id, attachment_id, filename, mime_type, size, is_pdf, imported_booking_no,
                     content_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
                    ON CONFLICT(account_id, message_id, attachment_id) DO UPDATE SET
                        filename = excluded.filename,
                        mime_type = excluded.mime_type,
                        size = excluded.size,
                        is_pdf = excluded.is_pdf,
                        content_id = excluded.content_id;
                    """,
                    (
                        account_id,
                        pm["message_id"],
                        att["attachment_id"],
                        att["filename"],
                        att["mime_type"],
                        att["size"],
                        att["is_pdf"],
                        att.get("content_id", ""),
                        now,
                    ),
                )

    return {"thread_id": thread_id, "messages": len(parsed_msgs), "has_pdf": has_pdf}


async def sync_account(account_id: int, max_results: int = 40, query: str = "") -> dict[str, Any]:
    """Sync threads from Gmail API to local SQLite cache."""
    acc = gmail_core.get_account(account_id)
    if not acc:
        raise gmail_client.GmailClientError("Không tìm thấy tài khoản Gmail.", status_code=404)

    try:
        prof = await gmail_client.gmail_request(account_id, "GET", "/profile")
        latest_history_id = str(prof.get("historyId") or "")

        params: dict[str, Any] = {"maxResults": max_results}
        if query.strip():
            params["q"] = query.strip()

        list_res = await gmail_client.gmail_request(account_id, "GET", "/threads", params=params)
        threads_meta = list_res.get("threads") or []

        synced = 0
        for tm in threads_meta:
            tid = tm.get("id")
            if not tid:
                continue
            raw_thread = await gmail_client.gmail_request(account_id, "GET", f"/threads/{tid}", params={"format": "full"})
            _upsert_thread_from_api(account_id, raw_thread)
            synced += 1

        gmail_core.update_account_sync_state(account_id, history_id=latest_history_id)
        return {"account_id": account_id, "synced_threads": synced, "history_id": latest_history_id}
    except gmail_client.GmailClientError as exc:
        gmail_core.update_account_sync_state(account_id, error=str(exc))
        raise
    except Exception as exc:
        logger.exception("Gmail sync failed for account %s", account_id)
        gmail_core.update_account_sync_state(account_id, error=str(exc))
        raise gmail_client.GmailClientError(f"Đồng bộ Gmail thất bại: {exc}", status_code=500)


async def sync_single_thread(account_id: int, thread_id: str) -> Optional[dict[str, Any]]:
    raw_thread = await gmail_client.gmail_request(account_id, "GET", f"/threads/{thread_id}", params={"format": "full"})
    _upsert_thread_from_api(account_id, raw_thread)
    return gmail_core.get_thread_detail(account_id, thread_id)


async def import_attachment_to_booking(
    attachment_row_id: int,
    collection_id: Optional[int] = None,
) -> dict[str, Any]:
    """Download a PDF attachment from Gmail and import it into Bookings."""
    att = gmail_core.get_attachment_by_row_id(attachment_row_id)
    if not att:
        raise gmail_client.GmailClientError("Không tìm thấy tệp đính kèm.", status_code=404)
    if not att["is_pdf"]:
        raise gmail_client.GmailClientError("Chỉ hỗ trợ đọc trực tiếp tệp PDF vào Booking.", status_code=400)

    raw_bytes = await gmail_client.download_attachment(att["account_id"], att["message_id"], att["attachment_id"])
    try:
        res = mail_booking_import.import_pdf_bytes(raw_bytes, att["filename"] or "gmail-attachment.pdf", collection_id)
    except mail_booking_import.MailImportError as exc:
        raise gmail_client.GmailClientError(str(exc), status_code=exc.status_code)
    gmail_core.mark_attachment_imported(attachment_row_id, res["booking_no"])
    return res
