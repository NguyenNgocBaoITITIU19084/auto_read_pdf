"""Dashboard: the Zalo / Gmail block (what is waiting there, account-wide)."""
import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import gmail, zalo
from backend.app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh(fresh_db):
    yield


def _messaging(url="/api/v1/dashboard/summary"):
    res = client.get(url)
    assert res.status_code == 200
    return res.json()["messaging"]


def test_nothing_connected():
    m = _messaging()
    assert m["zalo"] == {"connected": False, "account_name": "", "unread_messages": 0, "unread_conversations": 0,
                         "pending_conversations": 0, "bookings_to_review": 0}
    assert m["gmail"] == {"accounts": [], "unread_total": 0, "accounts_with_error": 0}


def test_zalo_unread_and_gmail_accounts_whatever_the_scope():
    zalo.save_session(uid="u1", display_name="TRASAS Điều xe", status="connected")
    zalo.record_message(thread_id="t1", direction="in", content="Mai giao cont nhé", msg_id="m1", display_name="Khách A")
    zalo.record_message(thread_id="t1", direction="in", content="Booking đây", msg_id="m2", display_name="Khách A")
    zalo.record_message(thread_id="t2", direction="in", content="ok", msg_id="m3", display_name="Tài xế B")

    with db.get_connection() as conn:  # one read booking waiting for review, one already saved, one of another account
        conn.executemany("INSERT INTO zalo_booking_scans (message_id, thread_id, status, account_uid, created_at, updated_at) "
                         "VALUES (?, 't1', ?, ?, '', '');", [(1, "pending_review", "u1"), (2, "saved", "u1"),
                                                             (3, "pending_review", "u2")])

    a = gmail.upsert_account("ops@example.com", "Ops", "", "tok", "ref", 0)
    b = gmail.upsert_account("cs@example.com", "CS", "", "tok", "ref", 0)
    gmail.update_account_sync_state(b["id"], error="invalid_grant")
    with db.get_connection() as conn:
        conn.executemany(
            "INSERT INTO gmail_threads (account_id, thread_id, labels_json, is_unread, updated_at) VALUES (?, ?, ?, ?, '');",
            [(a["id"], "g1", '["INBOX"]', 1), (a["id"], "g2", '["INBOX"]', 1), (a["id"], "g3", '["INBOX"]', 0),
             (a["id"], "g4", '["SENT"]', 1), (b["id"], "g5", '["INBOX"]', 1)])

    for url in ("/api/v1/dashboard/summary", "/api/v1/dashboard/summary?collection_id=999"):
        m = _messaging(url)
        z = m["zalo"]
        assert z["connected"] and z["account_name"] == "TRASAS Điều xe"
        assert (z["unread_messages"], z["unread_conversations"], z["bookings_to_review"]) == (3, 2, 1)
        g = m["gmail"]
        assert g["unread_total"] == 3 and g["accounts_with_error"] == 1
        assert [(x["email"], x["status"], x["unread_count"]) for x in g["accounts"]] == [
            ("ops@example.com", "connected", 2), ("cs@example.com", "error", 1)]


def test_a_failing_side_leaves_the_other(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db locked")
    monkeypatch.setattr(gmail, "list_accounts", boom)
    m = _messaging()
    assert m["gmail"] is None and m["zalo"]["connected"] is False
