"""Zalo messaging persistence: sessions, conversations, messages, templates, and driver matching."""
import logging
import re
import sqlite3
from typing import Any, Optional

logger = logging.getLogger("backend.zalo")

_PHONE_DIGITS = re.compile(r"\D+")

DEFAULT_TEMPLATES = (
    (
        "Lệnh điều xe",
        "/dieu-xe",
        "dispatch",
        "Chào anh {driver_name} ({vehicle_plate}),\nAnh nhận lệnh chạy Booking {booking_no} ({qty_type}):\n• Lấy rỗng: {empty_pickup_cy}\n• Hạ hàng: {full_return_cy}\n• Hạn cut-off: {cutoff_time}\nCó gì phát sinh báo em ngay nhé.",
    ),
    (
        "Nhắc hạn Cut-off",
        "/cutoff",
        "booking",
        "Anh {driver_name} lưu ý Booking {booking_no} sắp tới hạn cut-off lúc {cutoff_time} tại {full_return_cy}. Anh cập nhật tiến độ giúp em nhé.",
    ),
    (
        "Báo đổi lịch tàu",
        "/doi-lich",
        "vessel",
        "Thông báo đổi lịch tàu {vessel}:\nBooking {booking_no} thay đổi giờ cut-off mới: {cutoff_time}.\nAnh {driver_name} nắm thông tin điều chỉnh lịch chạy giúp em nhé.",
    ),
    (
        "Hỏi tiến độ / Xin ảnh",
        "/tien-do",
        "general",
        "Anh {driver_name} ơi, xe {vehicle_plate} tới đâu rồi ạ? Xong anh chụp giúp em ảnh phiếu cân / số cont / seal gửi qua đây nhé.",
    ),
)


def _conn():
    from backend.app.core.database import get_connection
    return get_connection()


def _now() -> str:
    from backend.app.core.database import _now_str
    return _now_str()


def normalize_phone(phone: Optional[str]) -> str:
    """Normalize a Vietnamese phone number to 0xxxxxxxxx digits for matching."""
    digits = _PHONE_DIGITS.sub("", str(phone or ""))
    if not digits:
        return ""
    if digits.startswith("84") and len(digits) >= 10:
        digits = "0" + digits[2:]
    return digits


def create_zalo_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS zalo_sessions (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            uid TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            avatar TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'disconnected',
            last_error TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS zalo_conversations (
            thread_id TEXT PRIMARY KEY,
            thread_type TEXT NOT NULL DEFAULT 'user',
            display_name TEXT NOT NULL DEFAULT '',
            avatar TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
            unread_count INTEGER NOT NULL DEFAULT 0,
            needs_attention INTEGER NOT NULL DEFAULT 0,
            last_message_preview TEXT NOT NULL DEFAULT '',
            last_message_at TEXT NOT NULL DEFAULT '',
            last_direction TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
    """)
    conv_cols = {row[1] for row in conn.execute("PRAGMA table_info(zalo_conversations);")}
    if "hidden" not in conv_cols:
        # Personal chats and ads hidden from the work view: kept and still synced, just not shown or counted.
        conn.execute("ALTER TABLE zalo_conversations ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;")
    if "watch_booking" not in conv_cols:
        # Booking PDFs / photos sent in a watched chat are read into the review queue (services/zalo_booking.py).
        conn.execute("ALTER TABLE zalo_conversations ADD COLUMN watch_booking INTEGER NOT NULL DEFAULT 0;")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_zalo_conv_driver ON zalo_conversations(driver_id);")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_zalo_conv_last_at ON zalo_conversations(last_message_at DESC);")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS zalo_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            msg_id TEXT UNIQUE,
            thread_id TEXT NOT NULL REFERENCES zalo_conversations(thread_id) ON DELETE CASCADE,
            direction TEXT NOT NULL DEFAULT 'in',
            sender_id TEXT NOT NULL DEFAULT '',
            sender_name TEXT NOT NULL DEFAULT '',
            msg_type TEXT NOT NULL DEFAULT 'text',
            content TEXT NOT NULL DEFAULT '',
            media_url TEXT NOT NULL DEFAULT '',
            booking_no TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'received',
            created_at TEXT NOT NULL
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS ix_zalo_msg_thread ON zalo_messages(thread_id, id DESC);")

    # One row per message with a file: the booking read from it and where it stands (services/zalo_booking.py).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS zalo_booking_scans (
            message_id INTEGER PRIMARY KEY REFERENCES zalo_messages(id) ON DELETE CASCADE,
            thread_id TEXT NOT NULL,
            file_name TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT '',
            sha256 TEXT NOT NULL DEFAULT '',
            local_path TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '',
            engine_used TEXT NOT NULL DEFAULT '',
            booking_no TEXT NOT NULL DEFAULT '',
            db_duplicate INTEGER NOT NULL DEFAULT 0,
            booking_id INTEGER,
            collection_id INTEGER,
            message TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS ix_zalo_scan_status ON zalo_booking_scans(status);")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_zalo_scan_sha ON zalo_booking_scans(sha256);")

    # One row per (message, person): Zalo shows each person's latest reaction; an empty icon removes it.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS zalo_reactions (
            msg_id TEXT NOT NULL,
            thread_id TEXT NOT NULL DEFAULT '',
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (msg_id, sender_id)
        );
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS zalo_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            shortcut TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'general',
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)

    existing_tpl = conn.execute("SELECT COUNT(*) FROM zalo_templates;").fetchone()[0]
    if existing_tpl == 0:
        now = _now()
        for name, shortcut, category, content in DEFAULT_TEMPLATES:
            conn.execute(
                """
                INSERT INTO zalo_templates (name, shortcut, category, content, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (name, shortcut, category, content, now, now),
            )


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _match_driver_id(conn: sqlite3.Connection, phone: Optional[str]) -> Optional[int]:
    norm = normalize_phone(phone)
    if not norm:
        return None
    for row in conn.execute("SELECT id, phone FROM fleet_drivers WHERE deleted_at IS NULL AND phone IS NOT NULL;"):
        if normalize_phone(row[1]) == norm:
            return int(row[0])
    return None


def get_session() -> dict[str, Any]:
    with _conn() as conn:
        rows = _rows(conn, "SELECT * FROM zalo_sessions WHERE id = 1;")
        if rows:
            return rows[0]
        return {
            "id": 1,
            "uid": "",
            "display_name": "",
            "phone": "",
            "avatar": "",
            "status": "disconnected",
            "last_error": "",
            "updated_at": "",
        }


def save_session(
    *,
    uid: str = "",
    display_name: str = "",
    phone: str = "",
    avatar: str = "",
    status: str = "disconnected",
    last_error: str = "",
) -> dict[str, Any]:
    now = _now()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO zalo_sessions (id, uid, display_name, phone, avatar, status, last_error, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                uid = excluded.uid,
                display_name = excluded.display_name,
                phone = excluded.phone,
                avatar = excluded.avatar,
                status = excluded.status,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at;
            """,
            (uid, display_name, phone, avatar, status, last_error, now),
        )
    return get_session()


def clear_zalo_data() -> dict[str, Any]:
    """Delete all synced Zalo conversations and messages and reset session (templates are kept)."""
    with _conn() as conn:
        conn.execute("DELETE FROM zalo_booking_scans;")
        conn.execute("DELETE FROM zalo_reactions;")
        conn.execute("DELETE FROM zalo_messages;")
        conn.execute("DELETE FROM zalo_conversations;")
    return save_session(status="disconnected")


_CONV_SELECT = """
    SELECT
        c.*,
        d.name AS driver_name,
        d.phone AS driver_phone,
        d.status AS driver_status,
        v.plate AS vehicle_plate
    FROM zalo_conversations c
    LEFT JOIN fleet_drivers d ON d.id = c.driver_id AND d.deleted_at IS NULL
    LEFT JOIN fleet_assignments a ON a.driver_id = d.id AND a.ended_at IS NULL
    LEFT JOIN fleet_vehicles v ON v.id = a.vehicle_id AND v.deleted_at IS NULL
"""


def get_conversation(thread_id: str) -> Optional[dict[str, Any]]:
    with _conn() as conn:
        rows = _rows(conn, _CONV_SELECT + " WHERE c.thread_id = ?;", (thread_id,))
        return rows[0] if rows else None


def list_conversations(filter_by: str = "all", q: str = "", limit: int = 300) -> dict[str, Any]:
    with _conn() as conn:
        all_rows = _rows(
            conn,
            _CONV_SELECT
            + """
            ORDER BY
                CASE WHEN c.last_message_at != '' THEN 0 ELSE 1 END,
                c.last_message_at DESC,
                (c.thread_type = 'group') DESC,
                (c.driver_id IS NOT NULL) DESC,
                COALESCE(NULLIF(d.name, ''), c.display_name) COLLATE NOCASE ASC;
            """,
        )
        # Hidden chats leave every count and list except the "hidden" one, so they never raise the badge.
        visible = [r for r in all_rows if not r.get("hidden")]
        counts = {
            "all": len(visible),
            "drivers": sum(1 for r in visible if r.get("driver_id") is not None),
            "unread": sum(1 for r in visible if (r.get("unread_count") or 0) > 0),
            "pending": sum(1 for r in visible if r.get("needs_attention")),
            "unread_messages": sum(int(r.get("unread_count") or 0) for r in visible),
            "hidden": len(all_rows) - len(visible),
            "watching": sum(1 for r in visible if r.get("watch_booking")),
        }

        items = visible
        if filter_by == "hidden":
            items = [r for r in all_rows if r.get("hidden")]
        elif filter_by == "watching":
            items = [r for r in items if r.get("watch_booking")]
        elif filter_by == "drivers":
            items = [r for r in items if r.get("driver_id") is not None]
        elif filter_by == "unread":
            items = [r for r in items if (r.get("unread_count") or 0) > 0]
        elif filter_by == "pending":
            items = [r for r in items if r.get("needs_attention")]

        needle = str(q or "").strip().lower()
        if needle:
            items = [
                r for r in items
                if needle in (r.get("display_name") or "").lower()
                or needle in (r.get("driver_name") or "").lower()
                or needle in (r.get("phone") or "").lower()
                or needle in (r.get("driver_phone") or "").lower()
                or needle in (r.get("vehicle_plate") or "").lower()
                or needle in (r.get("last_message_preview") or "").lower()
            ]

        return {"items": items[:max(1, min(limit, 500))], "counts": counts}


def upsert_conversation(
    *,
    thread_id: str,
    thread_type: str = "user",
    display_name: str = "",
    avatar: str = "",
    phone: str = "",
    driver_id: Optional[int] = None,
) -> dict[str, Any]:
    now = _now()
    with _conn() as conn:
        existing = _rows(conn, "SELECT * FROM zalo_conversations WHERE thread_id = ?;", (thread_id,))
        resolved_driver_id = driver_id
        if resolved_driver_id is None and existing:
            resolved_driver_id = existing[0].get("driver_id")
        if resolved_driver_id is None and phone:
            resolved_driver_id = _match_driver_id(conn, phone)

        if existing:
            cur = existing[0]
            conn.execute(
                """
                UPDATE zalo_conversations
                SET thread_type = ?,
                    display_name = COALESCE(NULLIF(?, ''), display_name),
                    avatar = COALESCE(NULLIF(?, ''), avatar),
                    phone = COALESCE(NULLIF(?, ''), phone),
                    driver_id = ?,
                    updated_at = ?
                WHERE thread_id = ?;
                """,
                (
                    thread_type or cur["thread_type"],
                    display_name,
                    avatar,
                    phone,
                    resolved_driver_id,
                    now,
                    thread_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO zalo_conversations
                    (thread_id, thread_type, display_name, avatar, phone, driver_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (thread_id, thread_type or "user", display_name or thread_id, avatar, phone, resolved_driver_id, now),
            )
    return get_conversation(thread_id)  # type: ignore[return-value]


def upsert_conversations_batch(items: list[dict[str, Any]]) -> int:
    """Bulk upsert friends/groups from Zalo so existing contacts appear immediately."""
    if not items:
        return 0
    now = _now()
    count = 0
    with _conn() as conn:
        for item in items:
            thread_id = str(item.get("thread_id") or "").strip()
            if not thread_id:
                continue
            thread_type = str(item.get("thread_type") or "user")
            display_name = str(item.get("display_name") or "").strip()
            avatar = str(item.get("avatar") or "").strip()
            phone = str(item.get("phone") or "").strip()
            existing = _rows(conn, "SELECT driver_id FROM zalo_conversations WHERE thread_id = ?;", (thread_id,))
            driver_id = item.get("driver_id")
            if driver_id is None and existing:
                driver_id = existing[0].get("driver_id")
            if driver_id is None and phone:
                driver_id = _match_driver_id(conn, phone)

            if existing:
                conn.execute(
                    """
                    UPDATE zalo_conversations
                    SET thread_type = ?,
                        display_name = COALESCE(NULLIF(?, ''), display_name),
                        avatar = COALESCE(NULLIF(?, ''), avatar),
                        phone = COALESCE(NULLIF(?, ''), phone),
                        driver_id = ?,
                        updated_at = ?
                    WHERE thread_id = ?;
                    """,
                    (thread_type, display_name, avatar, phone, driver_id, now, thread_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO zalo_conversations
                        (thread_id, thread_type, display_name, avatar, phone, driver_id, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?);
                    """,
                    (thread_id, thread_type, display_name or thread_id, avatar, phone, driver_id, now),
                )
            count += 1
    return count


def mark_conversation_read(thread_id: str) -> Optional[dict[str, Any]]:
    with _conn() as conn:
        conn.execute(
            "UPDATE zalo_conversations SET unread_count = 0 WHERE thread_id = ? AND unread_count > 0;",
            (thread_id,),
        )
    return get_conversation(thread_id)


def update_conversation(
    thread_id: str,
    *,
    needs_attention: Optional[bool] = None,
    driver_id: Optional[int] = None,
    unlink_driver: bool = False,
    display_name: Optional[str] = None,
    phone: Optional[str] = None,
    hidden: Optional[bool] = None,
) -> Optional[dict[str, Any]]:
    now = _now()
    with _conn() as conn:
        existing = _rows(conn, "SELECT thread_id FROM zalo_conversations WHERE thread_id = ?;", (thread_id,))
        if not existing:
            return None
        updates: list[str] = ["updated_at = ?"]
        params: list[Any] = [now]
        if needs_attention is not None:
            updates.append("needs_attention = ?")
            params.append(1 if needs_attention else 0)
        if driver_id is not None and not unlink_driver:
            ok = conn.execute(
                "SELECT 1 FROM fleet_drivers WHERE id = ? AND deleted_at IS NULL;", (driver_id,)
            ).fetchone()
            if not ok:
                raise ValueError("Không tìm thấy tài xế")
        if unlink_driver:
            updates.append("driver_id = NULL")
        elif driver_id is not None:
            updates.append("driver_id = ?")
            params.append(driver_id)
        if display_name is not None:
            updates.append("display_name = ?")
            params.append(display_name.strip())
        if phone is not None:
            updates.append("phone = ?")
            params.append(phone.strip())
        if hidden is not None:
            updates.append("hidden = ?")
            params.append(1 if hidden else 0)
            if hidden:
                # Nothing left to act on in a chat you set aside.
                updates.append("needs_attention = 0")
        params.append(thread_id)
        conn.execute(f"UPDATE zalo_conversations SET {', '.join(updates)} WHERE thread_id = ?;", tuple(params))
    return get_conversation(thread_id)


def _fill_missing_media(conn: sqlite3.Connection, msg_id: str, msg_type: str, content: str, media_url: str) -> None:
    """A file sent from the app is recorded before Zalo has a link for it; its echo from the listener
    arrives with the same msg_id and the CDN link, so copy the link onto the existing row."""
    if not msg_id or not media_url:
        return
    conn.execute(
        """
        UPDATE zalo_messages
        SET media_url = ?,
            msg_type = CASE WHEN ? IN ('image', 'file') THEN ? ELSE msg_type END,
            content = CASE WHEN content = '' THEN ? ELSE content END
        WHERE msg_id = ? AND media_url = '';
        """,
        (media_url, msg_type, msg_type, content or "", msg_id),
    )


def record_message(
    *,
    thread_id: str,
    direction: str,
    content: str = "",
    msg_id: Optional[str] = None,
    thread_type: str = "user",
    display_name: str = "",
    avatar: str = "",
    phone: str = "",
    sender_id: str = "",
    sender_name: str = "",
    msg_type: str = "text",
    media_url: str = "",
    booking_no: str = "",
    status: str = "received",
    created_at: Optional[str] = None,
    is_history: bool = False,
) -> dict[str, Any]:
    now = created_at or _now()
    with _conn() as conn:
        if msg_id:
            dup = _rows(conn, "SELECT * FROM zalo_messages WHERE msg_id = ?;", (msg_id,))
            if dup:
                if media_url and not dup[0].get("media_url"):
                    _fill_missing_media(conn, msg_id, msg_type, content, media_url)
                    dup = _rows(conn, "SELECT * FROM zalo_messages WHERE msg_id = ?;", (msg_id,))
                    # Not a new message, but the open chat should redraw the now-visible image.
                    return {"message": dup[0], "duplicate": False, "updated": True, "conversation": get_conversation(thread_id)}
                return {"message": dup[0], "duplicate": True, "conversation": get_conversation(thread_id)}

        existing = _rows(conn, "SELECT * FROM zalo_conversations WHERE thread_id = ?;", (thread_id,))
        driver_id = existing[0].get("driver_id") if existing else None
        if driver_id is None and phone:
            driver_id = _match_driver_id(conn, phone)

        preview = (content or "").strip()
        if not preview:
            preview = "[Hình ảnh]" if msg_type == "image" else "[Tệp đính kèm]"
        preview = preview[:140]

        mark_unread = (direction == "in") and (not is_history)
        # An outgoing message names its sender (us), not the chat: never rename an existing chat from it.
        if direction == "out" and existing:
            display_name = ""

        if not existing:
            conn.execute(
                """
                INSERT INTO zalo_conversations
                    (thread_id, thread_type, display_name, avatar, phone, driver_id,
                     unread_count, needs_attention, last_message_preview, last_message_at, last_direction, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    thread_id,
                    thread_type or "user",
                    display_name or sender_name or thread_id,
                    avatar,
                    phone,
                    driver_id,
                    1 if mark_unread else 0,
                    1 if mark_unread else 0,
                    preview,
                    now,
                    direction,
                    now,
                ),
            )
        else:
            unread_delta = 1 if mark_unread else 0
            attention_sql = "CASE WHEN hidden = 1 THEN 0 ELSE 1 END" if mark_unread else "needs_attention"
            conn.execute(
                f"""
                UPDATE zalo_conversations
                SET display_name = COALESCE(NULLIF(?, ''), display_name),
                    avatar = COALESCE(NULLIF(?, ''), avatar),
                    phone = COALESCE(NULLIF(?, ''), phone),
                    driver_id = COALESCE(driver_id, ?),
                    unread_count = unread_count + ?,
                    needs_attention = {attention_sql},
                    last_message_preview = ?,
                    last_message_at = ?,
                    last_direction = ?,
                    updated_at = ?
                WHERE thread_id = ?;
                """,
                (
                    display_name,
                    avatar,
                    phone,
                    driver_id,
                    unread_delta,
                    preview,
                    now,
                    direction,
                    now,
                    thread_id,
                ),
            )

        try:
            cur = conn.execute(
                """
                INSERT INTO zalo_messages
                    (msg_id, thread_id, direction, sender_id, sender_name, msg_type, content, media_url, booking_no, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (msg_id, thread_id, direction, sender_id, sender_name, msg_type, content, media_url, booking_no, status, now),
            )
            msg_row = _rows(conn, "SELECT * FROM zalo_messages WHERE id = ?;", (cur.lastrowid,))[0]
        except sqlite3.IntegrityError:
            dup_rows = _rows(conn, "SELECT * FROM zalo_messages WHERE msg_id = ?;", (msg_id,))
            return {"message": dup_rows[0] if dup_rows else None, "duplicate": True, "conversation": get_conversation(thread_id)}
    return {"message": msg_row, "duplicate": False, "conversation": get_conversation(thread_id)}


def record_messages_batch(items: list[dict[str, Any]]) -> int:
    """Bulk insert historical messages (from phone sync or group history) in one transaction."""
    if not items:
        return 0
    now = _now()
    inserted = 0
    latest_by_thread: dict[str, tuple[str, str, str, str, str]] = {}

    with _conn() as conn:
        for item in items:
            thread_id = str(item.get("thread_id") or "").strip()
            if not thread_id:
                continue
            msg_id = item.get("msg_id")
            if msg_id:
                dup = conn.execute("SELECT 1 FROM zalo_messages WHERE msg_id = ?;", (str(msg_id),)).fetchone()
                if dup:
                    _fill_missing_media(
                        conn, str(msg_id), str(item.get("msg_type") or ""), str(item.get("content") or ""),
                        str(item.get("media_url") or ""),
                    )
                    continue

            direction = str(item.get("direction") or "in")
            thread_type = str(item.get("thread_type") or "user")
            display_name = str(item.get("display_name") or "").strip()
            sender_id = str(item.get("sender_id") or "")
            sender_name = str(item.get("sender_name") or "")
            msg_type = str(item.get("msg_type") or "text")
            content = str(item.get("content") or "")
            media_url = str(item.get("media_url") or "")
            created_at = str(item.get("created_at") or now)

            existing_conv = conn.execute(
                "SELECT last_message_at FROM zalo_conversations WHERE thread_id = ?;", (thread_id,)
            ).fetchone()
            if not existing_conv:
                conn.execute(
                    """
                    INSERT INTO zalo_conversations
                        (thread_id, thread_type, display_name, updated_at)
                    VALUES (?, ?, ?, ?);
                    """,
                    (thread_id, thread_type, display_name or sender_name or thread_id, now),
                )

            conn.execute(
                """
                INSERT INTO zalo_messages
                    (msg_id, thread_id, direction, sender_id, sender_name, msg_type, content, media_url, booking_no, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?);
                """,
                (
                    str(msg_id) if msg_id else None,
                    thread_id,
                    direction,
                    sender_id,
                    sender_name,
                    msg_type,
                    content,
                    media_url,
                    "sent" if direction == "out" else "received",
                    created_at,
                ),
            )
            inserted += 1

            preview = content.strip() or ("[Hình ảnh]" if msg_type == "image" else "[Tin nhắn]")
            prev_rec = latest_by_thread.get(thread_id)
            if not prev_rec or created_at >= prev_rec[0]:
                latest_by_thread[thread_id] = (created_at, preview[:140], direction, display_name, thread_type)

        for tid, (ts, preview, direction, dname, ttype) in latest_by_thread.items():
            conn.execute(
                """
                UPDATE zalo_conversations
                SET thread_type = COALESCE(NULLIF(?, ''), thread_type),
                    display_name = COALESCE(NULLIF(?, ''), display_name),
                    last_message_preview = CASE WHEN last_message_at = '' OR ? >= last_message_at THEN ? ELSE last_message_preview END,
                    last_direction = CASE WHEN last_message_at = '' OR ? >= last_message_at THEN ? ELSE last_direction END,
                    last_message_at = CASE WHEN last_message_at = '' OR ? >= last_message_at THEN ? ELSE last_message_at END,
                    updated_at = ?
                WHERE thread_id = ?;
                """,
                (ttype, dname, ts, preview, ts, direction, ts, ts, now, tid),
            )
    return inserted


def record_reactions(items: list[dict[str, Any]]) -> int:
    """Apply reactions (live or the recent list Zalo sends on connect). Idempotent; an older event never
    overrides a newer one, and an empty icon removes that person's reaction."""
    now = _now()
    changed = 0
    with _conn() as conn:
        for item in items:
            msg_id = str(item.get("msg_id") or "").strip()
            sender_id = str(item.get("sender_id") or "").strip()
            if not msg_id or not sender_id:
                continue
            icon = str(item.get("icon") or "")
            ts = str(item.get("created_at") or now)
            existing = conn.execute(
                "SELECT updated_at FROM zalo_reactions WHERE msg_id = ? AND sender_id = ?;", (msg_id, sender_id)
            ).fetchone()
            if existing and existing[0] > ts:
                continue
            if not icon:
                cur = conn.execute("DELETE FROM zalo_reactions WHERE msg_id = ? AND sender_id = ?;", (msg_id, sender_id))
                changed += cur.rowcount
                continue
            conn.execute(
                """
                INSERT INTO zalo_reactions (msg_id, thread_id, sender_id, sender_name, icon, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(msg_id, sender_id) DO UPDATE SET
                    icon = excluded.icon,
                    sender_name = COALESCE(NULLIF(excluded.sender_name, ''), sender_name),
                    thread_id = COALESCE(NULLIF(excluded.thread_id, ''), thread_id),
                    updated_at = excluded.updated_at;
                """,
                (msg_id, str(item.get("thread_id") or ""), sender_id, str(item.get("sender_name") or ""), icon, ts),
            )
            changed += 1
    return changed


def _attach_reactions(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> None:
    """Add `reactions`: [{icon, count, mine, names}] to each message, most used icon first."""
    ids = [r["msg_id"] for r in rows if r.get("msg_id")]
    for r in rows:
        r["reactions"] = []
    if not ids:
        return
    own = conn.execute("SELECT uid FROM zalo_sessions WHERE id = 1;").fetchone()
    own_uid = str(own[0]) if own and own[0] else ""
    placeholders = ",".join("?" * len(ids))
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for msg_id, sender_id, sender_name, icon in conn.execute(
        f"SELECT msg_id, sender_id, sender_name, icon FROM zalo_reactions WHERE msg_id IN ({placeholders}) ORDER BY updated_at;",
        tuple(ids),
    ):
        entry = grouped.setdefault(msg_id, {}).setdefault(icon, {"icon": icon, "count": 0, "mine": False, "names": []})
        entry["count"] += 1
        if own_uid and sender_id == own_uid:
            entry["mine"] = True
        if sender_name:
            entry["names"].append(sender_name)
    for r in rows:
        by_icon = grouped.get(r.get("msg_id") or "")
        if by_icon:
            r["reactions"] = sorted(by_icon.values(), key=lambda e: -e["count"])


def list_messages(thread_id: str, limit: int = 50, before_id: Optional[int] = None) -> list[dict[str, Any]]:
    with _conn() as conn:
        lim = max(1, min(limit, 200))
        anchor = None
        if before_id:
            anchor = conn.execute(
                "SELECT created_at, id FROM zalo_messages WHERE id = ? AND thread_id = ?;", (before_id, thread_id)
            ).fetchone()
        if anchor:
            # Page by the same (created_at, id) order the chat shows: phone-synced history is inserted after
            # newer live messages, so a plain `id < before_id` would skip or repeat messages.
            rows = _rows(
                conn,
                """
                SELECT * FROM zalo_messages
                WHERE thread_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
                ORDER BY created_at DESC, id DESC LIMIT ?;
                """,
                (thread_id, anchor[0], anchor[0], anchor[1], lim),
            )
        else:
            rows = _rows(
                conn,
                "SELECT * FROM zalo_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?;",
                (thread_id, lim),
            )
        rows.reverse()
        _attach_reactions(conn, rows)
        return rows


def list_link_candidates() -> list[dict[str, Any]]:
    """Working drivers for the "Gắn với tài xế" picker, with the chat each is already linked to (if any)."""
    with _conn() as conn:
        rows = _rows(
            conn,
            """
            SELECT
                d.id, d.name, d.phone, d.status,
                v.plate AS vehicle_plate,
                (SELECT c.thread_id FROM zalo_conversations c WHERE c.driver_id = d.id LIMIT 1) AS linked_thread_id,
                (SELECT c.display_name FROM zalo_conversations c WHERE c.driver_id = d.id LIMIT 1) AS linked_name
            FROM fleet_drivers d
            LEFT JOIN fleet_assignments a ON a.driver_id = d.id AND a.ended_at IS NULL
            LEFT JOIN fleet_vehicles v ON v.id = a.vehicle_id AND v.deleted_at IS NULL
            WHERE d.deleted_at IS NULL AND d.status != 'left'
            ORDER BY d.name COLLATE NOCASE ASC;
            """,
        )
        return rows


def list_unlinked_drivers() -> list[dict[str, Any]]:
    with _conn() as conn:
        return _rows(
            conn,
            """
            SELECT
                d.id, d.name, d.phone, d.status,
                v.plate AS vehicle_plate
            FROM fleet_drivers d
            LEFT JOIN zalo_conversations c ON c.driver_id = d.id
            LEFT JOIN fleet_assignments a ON a.driver_id = d.id AND a.ended_at IS NULL
            LEFT JOIN fleet_vehicles v ON v.id = a.vehicle_id AND v.deleted_at IS NULL
            WHERE d.deleted_at IS NULL
              AND d.status != 'left'
              AND c.thread_id IS NULL
            ORDER BY d.name ASC;
            """,
        )


def list_templates() -> list[dict[str, Any]]:
    with _conn() as conn:
        return _rows(conn, "SELECT * FROM zalo_templates ORDER BY id ASC;")


def create_template(name: str, content: str, shortcut: str = "", category: str = "general") -> dict[str, Any]:
    now = _now()
    with _conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO zalo_templates (name, shortcut, category, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (name.strip(), shortcut.strip(), category.strip() or "general", content, now, now),
        )
        return _rows(conn, "SELECT * FROM zalo_templates WHERE id = ?;", (cur.lastrowid,))[0]


def update_template(
    template_id: int,
    *,
    name: Optional[str] = None,
    shortcut: Optional[str] = None,
    category: Optional[str] = None,
    content: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    now = _now()
    with _conn() as conn:
        existing = _rows(conn, "SELECT * FROM zalo_templates WHERE id = ?;", (template_id,))
        if not existing:
            return None
        cur = existing[0]
        conn.execute(
            """
            UPDATE zalo_templates
            SET name = ?, shortcut = ?, category = ?, content = ?, updated_at = ?
            WHERE id = ?;
            """,
            (
                name.strip() if name is not None else cur["name"],
                shortcut.strip() if shortcut is not None else cur["shortcut"],
                category.strip() if category is not None else cur["category"],
                content if content is not None else cur["content"],
                now,
                template_id,
            ),
        )
        return _rows(conn, "SELECT * FROM zalo_templates WHERE id = ?;", (template_id,))[0]


def delete_template(template_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM zalo_templates WHERE id = ?;", (template_id,))
        return cur.rowcount > 0
