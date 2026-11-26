"""Tests for Gmail persistence, MIME parsing, OAuth config, and REST API."""
import base64
import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import gmail as gmail_core
from backend.app.main import app
from backend.app.services import gmail_client, gmail_sync


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode("ascii")


@pytest.fixture()
def client(fresh_db):
    with TestClient(app) as c:
        yield c


def test_gmail_oauth_config_and_start(client, monkeypatch):
    monkeypatch.delenv("GMAIL_CLIENT_ID", raising=False)
    monkeypatch.delenv("GMAIL_CLIENT_SECRET", raising=False)
    res = client.get("/api/v1/gmail/config")
    assert res.status_code == 200
    assert res.json()["has_oauth_config"] is False

    # Starting OAuth without Client ID returns 400
    err = client.post("/api/v1/gmail/oauth/start")
    assert err.status_code == 400

    save_res = client.put(
        "/api/v1/gmail/config/oauth",
        json={"client_id": "test-client-id.apps.googleusercontent.com", "client_secret": "test-secret"},
    )
    assert save_res.status_code == 200

    start_res = client.post("/api/v1/gmail/oauth/start")
    assert start_res.status_code == 200
    body = start_res.json()
    assert "accounts.google.com/o/oauth2/v2/auth" in body["auth_url"]
    assert "code_challenge=" in body["auth_url"]
    assert body["state"]


def test_gmail_mime_parse_and_thread_filtering(client):
    acc = gmail_core.upsert_account(
        email="ops@example.com",
        display_name="Ops Team",
        avatar="",
        access_token="tok",
        refresh_token="ref",
        token_expiry=9999999999,
        history_id="100",
    )
    raw_thread = {
        "id": "th-1",
        "messages": [
            {
                "id": "msg-1",
                "threadId": "th-1",
                "labelIds": ["INBOX", "UNREAD", "STARRED"],
                "snippet": "Booking Confirmation BKG12345",
                "internalDate": "1732500000000",
                "payload": {
                    "mimeType": "multipart/mixed",
                    "headers": [
                        {"name": "From", "value": "carrier@maersk.com"},
                        {"name": "To", "value": "ops@example.com"},
                        {"name": "Subject", "value": "Booking Confirmation BKG12345"},
                        {"name": "Message-ID", "value": "<m1@maersk.com>"},
                    ],
                    "parts": [
                        {"mimeType": "text/plain", "body": {"data": _b64("Attached PDF booking.")}},
                        {"mimeType": "text/html", "body": {"data": _b64("<p>Attached PDF booking.</p>")}},
                        {
                            "filename": "BKG12345.pdf",
                            "mimeType": "application/pdf",
                            "body": {"attachmentId": "att-1", "size": 12345},
                        },
                    ],
                },
            }
        ],
    }
    gmail_sync._upsert_thread_from_api(acc["id"], raw_thread)

    acc_res = client.get("/api/v1/gmail/accounts")
    assert acc_res.status_code == 200
    assert acc_res.json()["total_unread"] == 1

    threads_res = client.get(
        "/api/v1/gmail/threads",
        params={"account_id": acc["id"], "only_pdf": True, "only_unread": True},
    )
    assert threads_res.status_code == 200
    items = threads_res.json()["items"]
    assert len(items) == 1
    assert items[0]["has_pdf"] == 1
    assert items[0]["subject"] == "Booking Confirmation BKG12345"

    detail_res = client.get(f"/api/v1/gmail/threads/{acc['id']}/th-1")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert len(detail["messages"]) == 1
    assert detail["messages"][0]["attachments"][0]["filename"] == "BKG12345.pdf"
    assert detail["messages"][0]["attachments"][0]["is_pdf"] == 1


def test_gmail_templates_seeded_and_crud(client):
    res = client.get("/api/v1/gmail/templates")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) >= 3

    created = client.post(
        "/api/v1/gmail/templates",
        json={"name": "Test Tpl", "shortcut": "/test", "category": "booking", "subject_tpl": "Sub", "body_tpl": "Body"},
    )
    assert created.status_code == 200
    tid = created.json()["id"]

    deleted = client.delete(f"/api/v1/gmail/templates/{tid}")
    assert deleted.status_code == 200


def test_gmail_oauth_config_has_no_built_in_secret(fresh_db, monkeypatch):
    monkeypatch.delenv("GMAIL_CLIENT_ID", raising=False)
    monkeypatch.delenv("GMAIL_CLIENT_SECRET", raising=False)
    import inspect
    assert "GOCSPX" not in inspect.getsource(gmail_core)
    cfg = gmail_core.get_oauth_config()
    assert cfg["client_id"] == "" and cfg["client_secret"] == ""


def _account_with_attachment(attachment_id: str, filename: str) -> dict:
    acc = gmail_core.upsert_account(
        email="ops@example.com", display_name="Ops", avatar="", access_token="tok",
        refresh_token="ref", token_expiry=9999999999,
    )
    with gmail_core._conn() as conn:
        conn.execute(
            """INSERT INTO gmail_attachments (account_id, message_id, attachment_id, filename, mime_type, size, is_pdf, created_at)
               VALUES (?, 'msg-1', ?, ?, 'application/pdf', 4, 1, 'now');""",
            (acc["id"], attachment_id, filename),
        )
        return dict(conn.execute("SELECT * FROM gmail_attachments WHERE account_id = ?;", (acc["id"],)).fetchone())


def test_gmail_download_vietnamese_filename(client, monkeypatch):
    att = _account_with_attachment("att-1", "Phiếu đặt chỗ \"BK\".pdf")

    async def fake_request(account_id, method, path, params=None, json_body=None):
        assert path == "/messages/msg-1/attachments/att-1"
        return {"data": _b64("%PDF")}

    monkeypatch.setattr(gmail_client, "gmail_request", fake_request)
    res = client.get(f"/api/v1/gmail/attachments/{att['id']}/download")
    assert res.status_code == 200
    assert res.content == b"%PDF"
    cd = res.headers["content-disposition"]
    assert "filename*=UTF-8''Phi%E1%BA%BFu" in cd
    assert 'filename="Phieu dat cho _BK_.pdf"' in cd


def test_gmail_download_inline_attachment(client, monkeypatch):
    raw_msg = {
        "id": "msg-1",
        "payload": {
            "mimeType": "multipart/mixed",
            "parts": [
                {"mimeType": "text/plain", "body": {"data": _b64("hi")}},
                {"filename": "a.pdf", "mimeType": "application/pdf", "body": {"data": _b64("%PDF-inline"), "size": 11}},
            ],
        },
    }
    parsed = gmail_client.parse_message_payload(raw_msg)
    inline_id = parsed["attachments"][0]["attachment_id"]
    assert inline_id.startswith(gmail_client.INLINE_ATTACHMENT_PREFIX)
    att = _account_with_attachment(inline_id, "a.pdf")

    async def fake_request(account_id, method, path, params=None, json_body=None):
        assert path == "/messages/msg-1"
        return raw_msg

    monkeypatch.setattr(gmail_client, "gmail_request", fake_request)
    res = client.get(f"/api/v1/gmail/attachments/{att['id']}/download")
    assert res.status_code == 200
    assert res.content == b"%PDF-inline"


def test_gmail_parse_keeps_content_id_of_inline_images(client):
    raw_msg = {
        "id": "msg-9",
        "threadId": "th-9",
        "payload": {
            "mimeType": "multipart/related",
            "parts": [
                {"mimeType": "text/html", "body": {"data": _b64('<img src="cid:icon@x">')}},
                {
                    "mimeType": "image/png",
                    "filename": "",
                    "headers": [{"name": "Content-ID", "value": "<icon@x>"}],
                    "body": {"attachmentId": "att-9", "size": 10},
                },
            ],
        },
    }
    parsed = gmail_client.parse_message_payload(raw_msg)
    assert parsed["attachments"][0]["content_id"] == "icon@x"
    assert parsed["attachments"][0]["filename"] == "icon"

    acc = gmail_core.upsert_account(
        email="ops@example.com", display_name="Ops", avatar="", access_token="tok",
        refresh_token="ref", token_expiry=9999999999,
    )
    gmail_sync._upsert_thread_from_api(acc["id"], {"id": "th-9", "messages": [raw_msg]})
    detail = client.get(f"/api/v1/gmail/threads/{acc['id']}/th-9").json()
    assert detail["messages"][0]["attachments"][0]["content_id"] == "icon@x"


def test_gmail_snippet_entities_are_decoded():
    parsed = gmail_client.parse_message_payload({"id": "m", "snippet": "Here&#39;s it", "payload": {}})
    assert parsed["snippet"] == "Here's it"
