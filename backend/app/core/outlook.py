"""Outlook (Microsoft 365) persistence: connected accounts + tokens, pinned folders, PDF imports, OAuth config.

Mail itself is not cached: folders and messages are read live from Microsoft Graph, so every customer folder
and every page of it is always current (no "only the newest N" sync window).
"""
import json
import sqlite3
from typing import Any, Optional

KEY_OUTLOOK_OAUTH_CONFIG = "outlook_oauth_config"


def _conn():
    from backend.app.core.database import get_connection
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> str:
    from backend.app.core.database import _now_str
    return _now_str()


def create_outlook_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS outlook_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            access_token TEXT NOT NULL DEFAULT '',
            refresh_token TEXT NOT NULL DEFAULT '',
            token_expiry INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'connected',
            last_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS outlook_pinned_folders (
            account_id INTEGER NOT NULL,
            folder_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (account_id, folder_id),
            FOREIGN KEY (account_id) REFERENCES outlook_accounts(id) ON DELETE CASCADE
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS outlook_imports (
            account_id INTEGER NOT NULL,
            message_id TEXT NOT NULL,
            attachment_id TEXT NOT NULL,
            booking_no TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            PRIMARY KEY (account_id, message_id, attachment_id),
            FOREIGN KEY (account_id) REFERENCES outlook_accounts(id) ON DELETE CASCADE
        );
    """)


# ---------- OAuth config (tenant + client id; a public client has no secret) ----------

def get_oauth_config() -> dict[str, str]:
    import os
    from backend.app.core import database as db

    cfg: dict[str, Any] = {}
    raw = db.get_system_setting(KEY_OUTLOOK_OAUTH_CONFIG, "")
    if raw:
        try:
            cfg = json.loads(raw)
        except ValueError:
            cfg = {}
    client_id = str(cfg.get("client_id") or os.environ.get("OUTLOOK_CLIENT_ID") or "").strip()
    # The company's own tenant: a single-tenant app cannot sign in through /common or /organizations.
    tenant_id = str(cfg.get("tenant_id") or os.environ.get("OUTLOOK_TENANT_ID") or "").strip()
    return {"client_id": client_id, "tenant_id": tenant_id}


def save_oauth_config(client_id: str, tenant_id: str) -> dict[str, str]:
    from backend.app.core import database as db

    payload = {"client_id": client_id.strip(), "tenant_id": tenant_id.strip()}
    db.set_system_setting(KEY_OUTLOOK_OAUTH_CONFIG, json.dumps(payload))
    return payload


# ---------- accounts ----------

_PUBLIC_COLS = "id, email, display_name, status, last_error, created_at, updated_at"


def list_accounts() -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute(f"SELECT {_PUBLIC_COLS} FROM outlook_accounts ORDER BY id;").fetchall()]


def get_account(account_id: int, include_tokens: bool = False) -> Optional[dict[str, Any]]:
    cols = "*" if include_tokens else _PUBLIC_COLS
    with _conn() as conn:
        row = conn.execute(f"SELECT {cols} FROM outlook_accounts WHERE id = ?;", (account_id,)).fetchone()
        return dict(row) if row else None


def upsert_account(email: str, display_name: str, access_token: str, refresh_token: str, token_expiry: int) -> dict:
    now = _now()
    email_clean = email.strip().lower()
    with _conn() as conn:
        row = conn.execute("SELECT id, refresh_token FROM outlook_accounts WHERE email = ?;", (email_clean,)).fetchone()
        if row:
            conn.execute(
                """UPDATE outlook_accounts SET display_name = ?, access_token = ?, refresh_token = ?, token_expiry = ?,
                       status = 'connected', last_error = '', updated_at = ? WHERE id = ?;""",
                (display_name, access_token, refresh_token or row["refresh_token"], token_expiry, now, row["id"]),
            )
            acc_id = row["id"]
        else:
            cur = conn.execute(
                """INSERT INTO outlook_accounts (email, display_name, access_token, refresh_token, token_expiry,
                       status, last_error, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'connected', '', ?, ?);""",
                (email_clean, display_name, access_token, refresh_token, token_expiry, now, now),
            )
            acc_id = cur.lastrowid
    return get_account(acc_id)  # type: ignore[return-value]


def save_tokens(account_id: int, access_token: str, token_expiry: int, refresh_token: str = "") -> None:
    """Microsoft rotates refresh tokens: the newest one is kept every time one comes back."""
    with _conn() as conn:
        conn.execute(
            """UPDATE outlook_accounts
               SET access_token = ?, token_expiry = ?, refresh_token = CASE WHEN ? != '' THEN ? ELSE refresh_token END,
                   status = 'connected', last_error = '', updated_at = ?
               WHERE id = ?;""",
            (access_token, token_expiry, refresh_token, refresh_token, _now(), account_id),
        )


def set_account_error(account_id: int, error: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE outlook_accounts SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?;",
            (error[:500], _now(), account_id),
        )


def delete_account(account_id: int) -> bool:
    with _conn() as conn:
        return conn.execute("DELETE FROM outlook_accounts WHERE id = ?;", (account_id,)).rowcount > 0


# ---------- pinned folders ----------

def list_pinned(account_id: int) -> list[str]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT folder_id FROM outlook_pinned_folders WHERE account_id = ? ORDER BY created_at, folder_id;",
            (account_id,),
        ).fetchall()
        return [r["folder_id"] for r in rows]


def set_pinned(account_id: int, folder_id: str, pinned: bool) -> None:
    with _conn() as conn:
        if pinned:
            conn.execute(
                "INSERT OR IGNORE INTO outlook_pinned_folders (account_id, folder_id, created_at) VALUES (?, ?, ?);",
                (account_id, folder_id, _now()),
            )
        else:
            conn.execute(
                "DELETE FROM outlook_pinned_folders WHERE account_id = ? AND folder_id = ?;", (account_id, folder_id)
            )


# ---------- PDF imports ----------

def get_imports(account_id: int, message_ids: list[str]) -> dict[tuple[str, str], str]:
    if not message_ids:
        return {}
    marks = ",".join("?" for _ in message_ids)
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT message_id, attachment_id, booking_no FROM outlook_imports
                WHERE account_id = ? AND message_id IN ({marks});""",
            (account_id, *message_ids),
        ).fetchall()
        return {(r["message_id"], r["attachment_id"]): r["booking_no"] for r in rows}


def mark_imported(account_id: int, message_id: str, attachment_id: str, booking_no: str) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO outlook_imports (account_id, message_id, attachment_id, booking_no, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(account_id, message_id, attachment_id) DO UPDATE SET booking_no = excluded.booking_no;""",
            (account_id, message_id, attachment_id, booking_no, _now()),
        )
