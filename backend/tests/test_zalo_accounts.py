"""Zalo data owned by a Zalo account: the one-time move of old one-account data, and new rows stamped with the
account logged in."""
import glob
import sqlite3

from backend.app.core import zalo
from backend.app.core.database import get_connection, init_db

UID = "284586529135505316"

# The tables as they were before accounts existed (what an installed app has on disk today).
_OLD_SCHEMA = """
CREATE TABLE zalo_sessions (
    id INTEGER PRIMARY KEY CHECK (id = 1), uid TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'disconnected',
    last_error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE zalo_conversations (
    thread_id TEXT PRIMARY KEY, thread_type TEXT NOT NULL DEFAULT 'user', display_name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', driver_id INTEGER,
    unread_count INTEGER NOT NULL DEFAULT 0, needs_attention INTEGER NOT NULL DEFAULT 0,
    last_message_preview TEXT NOT NULL DEFAULT '', last_message_at TEXT NOT NULL DEFAULT '',
    last_direction TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0, watch_booking INTEGER NOT NULL DEFAULT 0);
CREATE TABLE zalo_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id TEXT UNIQUE,
    thread_id TEXT NOT NULL REFERENCES zalo_conversations(thread_id) ON DELETE CASCADE,
    direction TEXT NOT NULL DEFAULT 'in', sender_id TEXT NOT NULL DEFAULT '', sender_name TEXT NOT NULL DEFAULT '',
    msg_type TEXT NOT NULL DEFAULT 'text', content TEXT NOT NULL DEFAULT '', media_url TEXT NOT NULL DEFAULT '',
    booking_no TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL);
CREATE INDEX ix_zalo_msg_thread ON zalo_messages(thread_id, id DESC);
CREATE TABLE zalo_booking_scans (
    message_id INTEGER PRIMARY KEY REFERENCES zalo_messages(id) ON DELETE CASCADE, thread_id TEXT NOT NULL,
    file_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '',
    local_path TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '',
    engine_used TEXT NOT NULL DEFAULT '', booking_no TEXT NOT NULL DEFAULT '', db_duplicate INTEGER NOT NULL DEFAULT 0,
    booking_id INTEGER, collection_id INTEGER, message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX ix_zalo_scan_status ON zalo_booking_scans(status);
CREATE TABLE zalo_reactions (
    msg_id TEXT NOT NULL, thread_id TEXT NOT NULL DEFAULT '', sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (msg_id, sender_id));
"""


def _old_database(path: str, uid: str) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(_OLD_SCHEMA)
    conn.execute("INSERT INTO zalo_sessions (id, uid, display_name, status, updated_at) "
                 "VALUES (1, ?, 'Bảo', 'connected', '2026-11-25 08:00:00');", (uid,))
    conn.execute("INSERT INTO zalo_conversations (thread_id, display_name, unread_count, hidden, watch_booking) "
                 "VALUES ('t1', 'Tài xế A', 2, 0, 1), ('t2', 'Quảng cáo', 0, 1, 0);")
    conn.execute("INSERT INTO zalo_messages (msg_id, thread_id, content, created_at) VALUES "
                 "('m1', 't1', 'xin chào', '2026-11-25 08:01:00'), ('m2', 't1', 'booking.pdf', '2026-11-25 08:02:00'), "
                 "('m3', 't2', 'khuyến mãi', '2026-11-25 08:03:00');")
    conn.execute("INSERT INTO zalo_booking_scans (message_id, thread_id, status, created_at, updated_at) "
                 "VALUES (2, 't1', 'pending_review', 'x', 'x');")
    conn.execute("INSERT INTO zalo_reactions (msg_id, thread_id, sender_id, icon, updated_at) "
                 "VALUES ('m1', 't1', 'u9', '/-heart', 'x');")
    conn.commit()
    conn.close()


def _q(sql: str, params: tuple = ()):
    with get_connection() as conn:
        return conn.execute(sql, params).fetchall()


def test_old_data_moves_to_the_logged_in_account_and_keeps_everything(tmp_path, monkeypatch):
    path = str(tmp_path / "old.db")
    _old_database(path, UID)
    monkeypatch.setenv("DB_PATH", path)
    init_db()

    assert _q("SELECT account_uid, thread_id, unread_count, hidden, watch_booking FROM zalo_conversations "
              "ORDER BY thread_id;") == [(UID, "t1", 2, 0, 1), (UID, "t2", 0, 1, 0)]
    assert _q("SELECT account_uid, id, msg_id, thread_id FROM zalo_messages ORDER BY id;") == [
        (UID, 1, "m1", "t1"), (UID, 2, "m2", "t1"), (UID, 3, "m3", "t2")]
    assert _q("SELECT account_uid, message_id FROM zalo_booking_scans;") == [(UID, 2)]
    assert _q("SELECT account_uid, msg_id, icon FROM zalo_reactions;") == [(UID, "m1", "/-heart")]
    assert _q("SELECT uid, display_name FROM zalo_accounts;") == [(UID, "Bảo")]
    assert _q("PRAGMA foreign_key_check;") == []

    backups = glob.glob(path + ".bak-zalo-accounts-*")
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as old:      # the copy is the untouched old database
        assert old.execute("SELECT COUNT(*) FROM zalo_messages;").fetchone()[0] == 3
        assert "account_uid" not in {r[1] for r in old.execute("PRAGMA table_info(zalo_messages);")}

    init_db()                                     # runs once: no second backup, nothing changes
    assert len(glob.glob(path + ".bak-zalo-accounts-*")) == 1
    assert _q("SELECT COUNT(*) FROM zalo_messages;") == [(3,)]

    # Deleting a chat still takes its messages and booking scan with it
    with get_connection() as conn:
        conn.execute("DELETE FROM zalo_conversations WHERE thread_id = 't1';")
    assert _q("SELECT COUNT(*) FROM zalo_messages;") == [(1,)]
    assert _q("SELECT COUNT(*) FROM zalo_booking_scans;") == [(0,)]


def test_old_data_without_a_logged_in_account_stays_unassigned(tmp_path, monkeypatch):
    path = str(tmp_path / "old.db")
    _old_database(path, "")
    monkeypatch.setenv("DB_PATH", path)
    init_db()
    assert _q("SELECT DISTINCT account_uid FROM zalo_messages;") == [("",)]
    assert _q("SELECT COUNT(*) FROM zalo_accounts;") == [(0,)]


def test_new_rows_belong_to_the_account_logged_in(fresh_db):
    zalo.save_session(uid="acc-A", display_name="A", status="connected")
    zalo.record_message(thread_id="t1", direction="in", msg_id="same-msg", content="hi", sender_id="t1")
    zalo.record_reactions([{"msg_id": "same-msg", "thread_id": "t1", "sender_id": "t1", "icon": "/-strong"}])

    # Another account sees the same group message (same thread and msg id): stored separately, nothing overwritten
    zalo.save_session(uid="acc-B", display_name="B", status="connected")
    out = zalo.record_message(thread_id="t1", direction="in", msg_id="same-msg", content="hi", sender_id="t1")
    zalo.record_messages_batch([{"thread_id": "t9", "msg_id": "h1", "content": "cũ", "created_at": "2026-11-01 08:00:00"}])
    zalo.upsert_conversations_batch([{"thread_id": "t10", "display_name": "Bạn mới"}])
    zalo.record_reactions([{"msg_id": "same-msg", "thread_id": "t1", "sender_id": "t1", "icon": "/-heart"}])

    assert out["duplicate"] is False
    assert _q("SELECT account_uid, thread_id FROM zalo_conversations ORDER BY 1, 2;") == [
        ("acc-A", "t1"), ("acc-B", "t1"), ("acc-B", "t10"), ("acc-B", "t9")]
    assert _q("SELECT account_uid, msg_id FROM zalo_messages ORDER BY 1, 2;") == [
        ("acc-A", "same-msg"), ("acc-B", "h1"), ("acc-B", "same-msg")]
    assert _q("SELECT account_uid, icon FROM zalo_reactions ORDER BY 1;") == [("acc-A", "/-strong"), ("acc-B", "/-heart")]
    assert _q("SELECT uid FROM zalo_accounts ORDER BY uid;") == [("acc-A",), ("acc-B",)]


def test_logout_then_login_keeps_watch_status_driver_and_old_messages(fresh_db):
    from backend.app.core import fleet
    from backend.app.services import zalo_booking

    driver = fleet.create_driver({"name": "Tài xế B", "phone": "0909000111"})
    zalo.save_session(uid="acc-A", display_name="A", status="connected")
    for i in range(3):
        zalo.record_message(thread_id="t1", direction="in", msg_id=f"old-{i}", content=f"tin cũ {i}", sender_id="t1")
    zalo.update_conversation("t1", needs_attention=True, driver_id=driver)
    zalo_booking.set_watch("t1", True)
    zalo.record_message(thread_id="t2", direction="in", msg_id="ad", content="quảng cáo", sender_id="t2")
    zalo.update_conversation("t2", hidden=True)

    zalo.logout_session()
    assert zalo.list_conversations()["items"] == [] and zalo.list_messages("t1") == []
    assert zalo.get_conversation("t1") is None and zalo.list_unlinked_drivers() == []

    zalo.save_session(uid="acc-A", display_name="A", status="connected")
    conv = zalo.get_conversation("t1")
    assert (conv["needs_attention"], conv["driver_id"], conv["watch_booking"]) == (1, driver, 1)
    assert [m["msg_id"] for m in zalo.list_messages("t1")] == ["old-0", "old-1", "old-2"]
    assert zalo.get_conversation("t2")["hidden"] == 1
