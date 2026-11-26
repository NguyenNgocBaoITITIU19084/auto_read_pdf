"""Gmail persistence: accounts, cached threads/messages, attachments, templates, and OAuth config."""
import json
import logging
import sqlite3
from typing import Any, Optional

logger = logging.getLogger("backend.gmail")

KEY_GMAIL_OAUTH_CONFIG = "gmail_oauth_config"
KEY_GMAIL_SYNC_SETTINGS = "gmail_sync_settings"

# The Google OAuth Client ID & Secret are never written in source code. They come from Gmail settings
# (saved in system_settings) or from the GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET environment variables.

DEFAULT_GMAIL_TEMPLATES = (
    (
        "Xác nhận Booking",
        "/xac-nhan-booking",
        "booking",
        "Xác nhận Booking {booking_no} - Tàu {vessel}",
        "Kính gửi Quý khách hàng,\n\nChúng tôi xin xác nhận thông tin Booking {booking_no} ({qty_type}):\n• Tàu / Chuyến: {vessel}\n• Nơi lấy rỗng: {empty_pickup_cy}\n• Nơi hạ hàng: {full_return_cy}\n• Hạn Cut-off: {cutoff_time}\n\nTrân trọng,",
    ),
    (
        "Thông báo đổi lịch tàu / Cut-off",
        "/doi-lich-tau",
        "vessel",
        "Cập nhật lịch tàu {vessel} - Booking {booking_no}",
        "Kính gửi Quý khách hàng,\n\nXin thông báo cập nhật lịch tàu {vessel} cho Booking {booking_no}:\n• Hạn Cut-off mới: {cutoff_time}\n• Cảng hạ hàng: {full_return_cy}\n\nVui lòng sắp xếp kế hoạch đóng hàng phù hợp. Trân trọng,",
    ),
    (
        "Gửi chứng từ / File PDF",
        "/chung-tu",
        "general",
        "Chứng từ Booking {booking_no}",
        "Kính gửi Anh/Chị,\n\nEm xin gửi đính kèm chứng từ liên quan đến Booking {booking_no}.\nAnh/Chị vui lòng kiểm tra và phản hồi nếu cần điều chỉnh nhé.\n\nTrân trọng,",
    ),
)


def _conn():
    from backend.app.core.database import get_connection
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> str:
    from backend.app.core.database import _now_str
    return _now_str()


def create_gmail_tables(conn: sqlite3.Connection) -> None:
    """Create Gmail tables and seed default templates if empty."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gmail_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            avatar TEXT NOT NULL DEFAULT '',
            access_token TEXT NOT NULL DEFAULT '',
            refresh_token TEXT NOT NULL DEFAULT '',
            token_expiry INTEGER NOT NULL DEFAULT 0,
            history_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'connected',
            last_error TEXT NOT NULL DEFAULT '',
            last_sync_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gmail_threads (
            account_id INTEGER NOT NULL,
            thread_id TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            snippet TEXT NOT NULL DEFAULT '',
            participants TEXT NOT NULL DEFAULT '',
            labels_json TEXT NOT NULL DEFAULT '[]',
            is_unread INTEGER NOT NULL DEFAULT 0,
            is_starred INTEGER NOT NULL DEFAULT 0,
            has_attachments INTEGER NOT NULL DEFAULT 0,
            has_pdf INTEGER NOT NULL DEFAULT 0,
            message_count INTEGER NOT NULL DEFAULT 1,
            last_message_ms INTEGER NOT NULL DEFAULT 0,
            last_message_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (account_id, thread_id),
            FOREIGN KEY (account_id) REFERENCES gmail_accounts(id) ON DELETE CASCADE
        );
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_gmail_threads_account_ms
        ON gmail_threads(account_id, last_message_ms DESC);
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gmail_messages (
            account_id INTEGER NOT NULL,
            message_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            from_addr TEXT NOT NULL DEFAULT '',
            to_addrs TEXT NOT NULL DEFAULT '',
            cc_addrs TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT '',
            snippet TEXT NOT NULL DEFAULT '',
            body_text TEXT NOT NULL DEFAULT '',
            body_html TEXT NOT NULL DEFAULT '',
            labels_json TEXT NOT NULL DEFAULT '[]',
            is_unread INTEGER NOT NULL DEFAULT 0,
            is_starred INTEGER NOT NULL DEFAULT 0,
            internal_date_ms INTEGER NOT NULL DEFAULT 0,
            date_iso TEXT NOT NULL DEFAULT '',
            rfc_message_id TEXT NOT NULL DEFAULT '',
            references_header TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            PRIMARY KEY (account_id, message_id),
            FOREIGN KEY (account_id) REFERENCES gmail_accounts(id) ON DELETE CASCADE
        );
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_gmail_messages_thread
        ON gmail_messages(account_id, thread_id, internal_date_ms ASC);
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gmail_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            message_id TEXT NOT NULL,
            attachment_id TEXT NOT NULL,
            filename TEXT NOT NULL DEFAULT '',
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size INTEGER NOT NULL DEFAULT 0,
            is_pdf INTEGER NOT NULL DEFAULT 0,
            imported_booking_no TEXT NOT NULL DEFAULT '',
            content_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE (account_id, message_id, attachment_id),
            FOREIGN KEY (account_id) REFERENCES gmail_accounts(id) ON DELETE CASCADE
        );
    """)
    att_cols = {r[1] for r in conn.execute("PRAGMA table_info(gmail_attachments);").fetchall()}
    if "content_id" not in att_cols:
        conn.execute("ALTER TABLE gmail_attachments ADD COLUMN content_id TEXT NOT NULL DEFAULT '';")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gmail_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            shortcut TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'general',
            subject_tpl TEXT NOT NULL DEFAULT '',
            body_tpl TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)

    existing = conn.execute("SELECT COUNT(*) FROM gmail_templates;").fetchone()[0]
    if existing == 0:
        now = _now()
        for name, shortcut, cat, subj, body in DEFAULT_GMAIL_TEMPLATES:
            conn.execute(
                """
                INSERT INTO gmail_templates (name, shortcut, category, subject_tpl, body_tpl, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (name, shortcut, cat, subj, body, now, now),
            )


def get_oauth_config() -> dict[str, Any]:
    """Google OAuth Client ID + Secret, as a pair from one place: the user's own (settings), else the environment,
    else the ids shipped in the build (oauth_defaults). `using_embedded` = not the user's own, so it is not shown."""
    from backend.app.core.oauth_defaults import builtin
    import os
    from backend.app.core import database as db

    raw = db.get_system_setting(KEY_GMAIL_OAUTH_CONFIG, "")
    cfg: dict[str, Any] = {}
    if raw:
        try:
            cfg = json.loads(raw)
        except ValueError:
            cfg = {}
    saved_id = str(cfg.get("client_id") or "").strip()
    saved_secret = str(cfg.get("client_secret") or "").strip()
    env_id = str(os.environ.get("GMAIL_CLIENT_ID") or "").strip()
    env_secret = str(os.environ.get("GMAIL_CLIENT_SECRET") or "").strip()

    if saved_id:
        client_id, client_secret = saved_id, saved_secret
    elif env_id:
        client_id, client_secret = env_id, env_secret
    else:
        client_id, client_secret = builtin("GMAIL_CLIENT_ID"), builtin("GMAIL_CLIENT_SECRET")
    using_embedded = bool(not saved_id and client_id)
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "using_embedded": using_embedded,
    }


def clear_oauth_config() -> None:
    """Forget the user's own Client ID; the ids shipped in the build (if any) are used again."""
    from backend.app.core import database as db

    db.set_system_setting(KEY_GMAIL_OAUTH_CONFIG, "")


def save_oauth_config(client_id: str, client_secret: str) -> dict[str, str]:
    from backend.app.core import database as db

    payload = {"client_id": client_id.strip(), "client_secret": client_secret.strip()}
    db.set_system_setting(KEY_GMAIL_OAUTH_CONFIG, json.dumps(payload))
    return payload


def get_sync_settings() -> dict[str, Any]:
    from backend.app.core import database as db

    raw = db.get_system_setting(KEY_GMAIL_SYNC_SETTINGS, "")
    defaults = {
        "auto_sync_enabled": True,
        "interval_minutes": 2,
        "auto_import_pdf": False,
        "auto_import_collection_id": None,
        "auto_import_query": "has:attachment filename:pdf",
    }
    if not raw:
        return defaults
    try:
        parsed = json.loads(raw)
        return {**defaults, **parsed}
    except ValueError:
        return defaults


def save_sync_settings(data: dict[str, Any]) -> dict[str, Any]:
    from backend.app.core import database as db

    current = get_sync_settings()
    merged = {**current, **data}
    db.set_system_setting(KEY_GMAIL_SYNC_SETTINGS, json.dumps(merged))
    return merged


def list_accounts() -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, email, display_name, avatar, history_id, status, last_error, last_sync_at, created_at, updated_at
            FROM gmail_accounts
            ORDER BY id ASC;
            """
        ).fetchall()
        accounts = [dict(r) for r in rows]
        for acc in accounts:
            unread_row = conn.execute(
                """
                SELECT COUNT(*) FROM gmail_threads
                WHERE account_id = ? AND is_unread = 1 AND labels_json LIKE '%"INBOX"%';
                """,
                (acc["id"],),
            ).fetchone()
            acc["unread_count"] = unread_row[0] if unread_row else 0
        return accounts


def get_account(account_id: int, include_tokens: bool = False) -> Optional[dict[str, Any]]:
    cols = "*" if include_tokens else "id, email, display_name, avatar, history_id, status, last_error, last_sync_at, created_at, updated_at"
    with _conn() as conn:
        row = conn.execute(f"SELECT {cols} FROM gmail_accounts WHERE id = ?;", (account_id,)).fetchone()
        return dict(row) if row else None


def upsert_account(
    email: str,
    display_name: str,
    avatar: str,
    access_token: str,
    refresh_token: str,
    token_expiry: int,
    history_id: str = "",
) -> dict[str, Any]:
    now = _now()
    email_clean = email.strip().lower()
    with _conn() as conn:
        existing = conn.execute("SELECT id, refresh_token FROM gmail_accounts WHERE email = ?;", (email_clean,)).fetchone()
        if existing:
            # Google may omit refresh_token on re-auth if already granted; keep existing if empty.
            eff_refresh = refresh_token or existing["refresh_token"]
            conn.execute(
                """
                UPDATE gmail_accounts
                SET display_name = ?, avatar = ?, access_token = ?, refresh_token = ?,
                    token_expiry = ?, status = 'connected', last_error = '', updated_at = ?
                WHERE id = ?;
                """,
                (display_name, avatar, access_token, eff_refresh, token_expiry, now, existing["id"]),
            )
            acc_id = existing["id"]
        else:
            cur = conn.execute(
                """
                INSERT INTO gmail_accounts
                (email, display_name, avatar, access_token, refresh_token, token_expiry, history_id, status, last_error, last_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', '', '', ?, ?);
                """,
                (email_clean, display_name, avatar, access_token, refresh_token, token_expiry, history_id, now, now),
            )
            acc_id = cur.lastrowid
    return get_account(acc_id)  # type: ignore[return-value]


def update_account_tokens(account_id: int, access_token: str, token_expiry: int, refresh_token: Optional[str] = None) -> None:
    now = _now()
    with _conn() as conn:
        if refresh_token:
            conn.execute(
                """
                UPDATE gmail_accounts
                SET access_token = ?, refresh_token = ?, token_expiry = ?, status = 'connected', last_error = '', updated_at = ?
                WHERE id = ?;
                """,
                (access_token, refresh_token, token_expiry, now, account_id),
            )
        else:
            conn.execute(
                """
                UPDATE gmail_accounts
                SET access_token = ?, token_expiry = ?, status = 'connected', last_error = '', updated_at = ?
                WHERE id = ?;
                """,
                (access_token, token_expiry, now, account_id),
            )


def update_account_sync_state(account_id: int, history_id: Optional[str] = None, error: str = "") -> None:
    now = _now()
    with _conn() as conn:
        if error:
            conn.execute(
                "UPDATE gmail_accounts SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?;",
                (error[:500], now, account_id),
            )
        elif history_id is not None:
            conn.execute(
                """
                UPDATE gmail_accounts
                SET history_id = ?, status = 'connected', last_error = '', last_sync_at = ?, updated_at = ?
                WHERE id = ?;
                """,
                (history_id, now, now, account_id),
            )
        else:
            conn.execute(
                "UPDATE gmail_accounts SET status = 'connected', last_error = '', last_sync_at = ?, updated_at = ? WHERE id = ?;",
                (now, now, account_id),
            )


def delete_account(account_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM gmail_accounts WHERE id = ?;", (account_id,))
        return cur.rowcount > 0


def get_total_unread_count() -> int:
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) FROM gmail_threads
            WHERE is_unread = 1 AND labels_json LIKE '%"INBOX"%';
            """
        ).fetchone()
        return row[0] if row else 0


def list_threads(
    account_id: int,
    label: str = "INBOX",
    search: str = "",
    only_unread: bool = False,
    only_pdf: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    clauses = ["account_id = ?"]
    params: list[Any] = [account_id]

    if label and label != "ALL":
        if label == "STARRED":
            clauses.append("is_starred = 1")
        elif label == "UNREAD":
            clauses.append("is_unread = 1")
        else:
            clauses.append("labels_json LIKE ?")
            params.append(f'%"{label}"%')

    if label not in ("TRASH", "SPAM"):
        clauses.append("labels_json NOT LIKE '%\"TRASH\"%'")
        clauses.append("labels_json NOT LIKE '%\"SPAM\"%'")

    if only_unread:
        clauses.append("is_unread = 1")
    if only_pdf:
        clauses.append("has_pdf = 1")

    if search.strip():
        q = f"%{search.strip()}%"
        clauses.append("(subject LIKE ? OR snippet LIKE ? OR participants LIKE ?)")
        params.extend([q, q, q])

    where_sql = " AND ".join(clauses)
    with _conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM gmail_threads WHERE {where_sql};", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT * FROM gmail_threads
            WHERE {where_sql}
            ORDER BY last_message_ms DESC
            LIMIT ? OFFSET ?;
            """,
            [*params, limit, offset],
        ).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            try:
                d["labels"] = json.loads(d.pop("labels_json", "[]"))
            except ValueError:
                d["labels"] = []
            items.append(d)
        return {"items": items, "total": total}


def get_thread_detail(account_id: int, thread_id: str) -> Optional[dict[str, Any]]:
    with _conn() as conn:
        t_row = conn.execute(
            "SELECT * FROM gmail_threads WHERE account_id = ? AND thread_id = ?;",
            (account_id, thread_id),
        ).fetchone()
        if not t_row:
            return None
        thread = dict(t_row)
        try:
            thread["labels"] = json.loads(thread.pop("labels_json", "[]"))
        except ValueError:
            thread["labels"] = []

        m_rows = conn.execute(
            """
            SELECT * FROM gmail_messages
            WHERE account_id = ? AND thread_id = ?
            ORDER BY internal_date_ms ASC;
            """,
            (account_id, thread_id),
        ).fetchall()
        messages = []
        for mr in m_rows:
            md = dict(mr)
            try:
                md["labels"] = json.loads(md.pop("labels_json", "[]"))
            except ValueError:
                md["labels"] = []
            att_rows = conn.execute(
                """
                SELECT id, attachment_id, filename, mime_type, size, is_pdf, imported_booking_no, content_id
                FROM gmail_attachments
                WHERE account_id = ? AND message_id = ?
                ORDER BY id ASC;
                """,
                (account_id, md["message_id"]),
            ).fetchall()
            md["attachments"] = [dict(ar) for ar in att_rows]
            messages.append(md)

        thread["messages"] = messages
        return thread


def mark_attachment_imported(attachment_row_id: int, booking_no: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE gmail_attachments SET imported_booking_no = ? WHERE id = ?;",
            (booking_no, attachment_row_id),
        )


def get_attachment_by_row_id(attachment_row_id: int) -> Optional[dict[str, Any]]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM gmail_attachments WHERE id = ?;", (attachment_row_id,)).fetchone()
        return dict(row) if row else None


def list_templates() -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM gmail_templates ORDER BY id ASC;").fetchall()
        return [dict(r) for r in rows]


def save_template(data: dict[str, Any], template_id: Optional[int] = None) -> dict[str, Any]:
    now = _now()
    with _conn() as conn:
        if template_id:
            conn.execute(
                """
                UPDATE gmail_templates
                SET name = ?, shortcut = ?, category = ?, subject_tpl = ?, body_tpl = ?, updated_at = ?
                WHERE id = ?;
                """,
                (
                    data["name"],
                    data.get("shortcut", ""),
                    data.get("category", "general"),
                    data.get("subject_tpl", ""),
                    data.get("body_tpl", ""),
                    now,
                    template_id,
                ),
            )
            tid = template_id
        else:
            cur = conn.execute(
                """
                INSERT INTO gmail_templates (name, shortcut, category, subject_tpl, body_tpl, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    data["name"],
                    data.get("shortcut", ""),
                    data.get("category", "general"),
                    data.get("subject_tpl", ""),
                    data.get("body_tpl", ""),
                    now,
                    now,
                ),
            )
            tid = cur.lastrowid
        row = conn.execute("SELECT * FROM gmail_templates WHERE id = ?;", (tid,)).fetchone()
        return dict(row)


def delete_template(template_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM gmail_templates WHERE id = ?;", (template_id,))
        return cur.rowcount > 0
