"""Tests for Zalo messaging DB + REST API (conversations, incoming/outgoing, driver matching, templates)."""
import pytest
from fastapi.testclient import TestClient

from backend.app.core import fleet
from backend.app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_zalo_session_and_templates_seeded(client):
    res = client.get("/api/v1/zalo/session")
    assert res.status_code == 200
    assert res.json()["status"] == "disconnected"

    tpl_res = client.get("/api/v1/zalo/templates")
    assert tpl_res.status_code == 200
    templates = tpl_res.json()
    assert len(templates) >= 4
    assert any(t["shortcut"] == "/dieu-xe" for t in templates)


def test_zalo_incoming_auto_matches_driver_and_deduplicates(client):
    driver_id = fleet.create_driver({"name": "Nguyễn Văn A", "phone": "0901234567"})

    payload = {
        "thread_id": "uid_driver_a",
        "msg_id": "msg_1001",
        "thread_type": "user",
        "display_name": "Zalo Tài Xế A",
        "phone": "+84 901 234 567",
        "sender_id": "uid_driver_a",
        "sender_name": "Zalo Tài Xế A",
        "msg_type": "text",
        "content": "Em đã tới cảng Cát Lái lấy rỗng rồi anh",
    }
    r1 = client.post("/api/v1/zalo/messages/incoming", json=payload)
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["duplicate"] is False
    assert d1["conversation"]["driver_id"] == driver_id
    assert d1["conversation"]["driver_name"] == "Nguyễn Văn A"
    assert d1["conversation"]["unread_count"] == 1
    assert d1["conversation"]["needs_attention"] == 1

    # Duplicate msg_id should not double-count unread or insert twice
    r2 = client.post("/api/v1/zalo/messages/incoming", json=payload)
    assert r2.status_code == 200
    assert r2.json()["duplicate"] is True
    assert r2.json()["conversation"]["unread_count"] == 1

    # Filter by drivers & unread
    convs = client.get("/api/v1/zalo/conversations?filter=drivers").json()
    assert convs["counts"]["drivers"] == 1
    assert convs["counts"]["unread"] == 1
    assert len(convs["items"]) == 1

    # Mark read & resolved
    read_res = client.post("/api/v1/zalo/conversations/uid_driver_a/read")
    assert read_res.status_code == 200
    assert read_res.json()["unread_count"] == 0

    patch_res = client.patch("/api/v1/zalo/conversations/uid_driver_a", json={"needs_attention": False})
    assert patch_res.status_code == 200
    assert patch_res.json()["needs_attention"] == 0

    # A single conversation can be fetched even when it is outside the current list filter
    one = client.get("/api/v1/zalo/conversations/uid_driver_a")
    assert one.status_code == 200
    assert one.json()["driver_name"] == "Nguyễn Văn A"
    assert client.get("/api/v1/zalo/conversations/no_such_thread").status_code == 404


def test_zalo_outgoing_and_template_crud(client):
    out_res = client.post(
        "/api/v1/zalo/messages/outgoing",
        json={
            "thread_id": "uid_customer_1",
            "msg_id": "out_1",
            "display_name": "Khách Hàng B",
            "content": "Booking SGN123456 cắt máng 18:00",
            "booking_no": "SGN123456",
        },
    )
    assert out_res.status_code == 200
    assert out_res.json()["message"]["direction"] == "out"
    assert out_res.json()["conversation"]["unread_count"] == 0

    msgs = client.get("/api/v1/zalo/conversations/uid_customer_1/messages").json()
    assert len(msgs) == 1
    assert msgs[0]["booking_no"] == "SGN123456"

    # Template CRUD
    created = client.post(
        "/api/v1/zalo/templates",
        json={"name": "Báo hạ bãi", "shortcut": "/ha-bai", "category": "dispatch", "content": "Đã hạ cont {booking_no}"},
    )
    assert created.status_code == 200
    tid = created.json()["id"]

    updated = client.put(f"/api/v1/zalo/templates/{tid}", json={"content": "Đã hạ cont {booking_no} OK"})
    assert updated.status_code == 200
    assert "OK" in updated.json()["content"]

    deleted = client.delete(f"/api/v1/zalo/templates/{tid}")
    assert deleted.status_code == 200

    # Logout clears conversations & messages but preserves templates
    logout_res = client.post("/api/v1/zalo/logout")
    assert logout_res.status_code == 200
    assert logout_res.json()["status"] == "disconnected"
    assert client.get("/api/v1/zalo/conversations").json()["counts"]["all"] == 0
    assert client.get(f"/api/v1/zalo/conversations/uid_customer_1/messages").json() == []
    assert len(client.get("/api/v1/zalo/templates").json()) >= 4


def test_zalo_messages_page_by_time_even_when_history_is_inserted_later(client):
    tid = "uid_paging"
    # Live messages arrive first (low ids, newest times)...
    for i in range(3):
        client.post("/api/v1/zalo/messages/incoming", json={
            "thread_id": tid, "msg_id": f"live_{i}", "content": f"live {i}",
            "created_at": f"2026-11-20 10:00:0{i}",
        })
    # ...then a phone sync inserts older history (higher ids, older times).
    batch = [
        {"thread_id": tid, "msg_id": f"old_{i}", "content": f"old {i}", "created_at": f"2026-11-01 09:00:0{i}"}
        for i in range(3)
    ]
    assert client.post("/api/v1/zalo/messages/batch", json=batch).json()["inserted"] == 3

    page1 = client.get(f"/api/v1/zalo/conversations/{tid}/messages", params={"limit": 2}).json()
    assert [m["content"] for m in page1] == ["live 1", "live 2"]

    page2 = client.get(
        f"/api/v1/zalo/conversations/{tid}/messages", params={"limit": 2, "before_id": page1[0]["id"]}
    ).json()
    assert [m["content"] for m in page2] == ["old 2", "live 0"]

    page3 = client.get(
        f"/api/v1/zalo/conversations/{tid}/messages", params={"limit": 10, "before_id": page2[0]["id"]}
    ).json()
    assert [m["content"] for m in page3] == ["old 0", "old 1"]


def test_zalo_reactions_attach_to_messages_and_newest_wins(client):
    tid = "uid_react"
    client.post("/api/v1/zalo/session", json={"uid": "me_uid", "status": "connected"})
    client.post("/api/v1/zalo/messages/incoming", json={"thread_id": tid, "msg_id": "m_react", "content": "Em tới cảng rồi"})

    r = client.post("/api/v1/zalo/reactions", json=[
        {"msg_id": "m_react", "thread_id": tid, "sender_id": "me_uid", "icon": "/-strong", "created_at": "2026-11-25 10:00:00"},
        {"msg_id": "m_react", "thread_id": tid, "sender_id": "other", "sender_name": "A", "icon": "/-strong", "created_at": "2026-11-25 10:00:01"},
        {"msg_id": "m_react", "thread_id": tid, "sender_id": "third", "icon": ":>", "created_at": "2026-11-25 10:00:02"},
        # An older event for the same person must not override the newer one
        {"msg_id": "m_react", "thread_id": tid, "sender_id": "third", "icon": "/-heart", "created_at": "2026-11-25 09:00:00"},
    ])
    assert r.status_code == 200

    msgs = client.get(f"/api/v1/zalo/conversations/{tid}/messages").json()
    reactions = msgs[-1]["reactions"]
    assert reactions[0] == {"icon": "/-strong", "count": 2, "mine": True, "names": ["A"]}
    assert reactions[1]["icon"] == ":>" and reactions[1]["count"] == 1

    # Empty icon removes that person's reaction
    client.post("/api/v1/zalo/reactions", json=[{"msg_id": "m_react", "sender_id": "third", "icon": "", "created_at": "2026-11-25 10:05:00"}])
    msgs = client.get(f"/api/v1/zalo/conversations/{tid}/messages").json()
    assert [x["icon"] for x in msgs[-1]["reactions"]] == ["/-strong"]
