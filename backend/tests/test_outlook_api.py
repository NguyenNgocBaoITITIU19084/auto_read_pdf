"""Outlook (Microsoft 365) integration with Microsoft Graph faked out."""
import asyncio
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.core import outlook as outlook_core
from backend.app.main import app
from backend.app.services import outlook_client, outlook_mail
from backend.app.services.outlook_client import OutlookClientError


@pytest.fixture()
def client(fresh_db, monkeypatch):
    monkeypatch.delenv("OUTLOOK_CLIENT_ID", raising=False)
    monkeypatch.delenv("OUTLOOK_TENANT_ID", raising=False)
    outlook_mail._well_known_cache.clear()
    with TestClient(app) as c:
        yield c


def _account() -> dict:
    return outlook_core.upsert_account("Ops@Company.vn", "Ops", "tok", "ref-1", int(time.time()) + 3600)


class FakeGraph:
    """Answers graph_request(method, path) from a dict; records every call."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[tuple[str, str, dict | None, dict | None]] = []

    async def __call__(self, account_id, method, path, params=None, json_body=None, raw=False):
        self.calls.append((method, path, params, json_body))
        for (m, prefix), answer in self.routes.items():
            if m == method and path == prefix:
                if isinstance(answer, Exception):
                    raise answer
                return answer(params, json_body) if callable(answer) else answer
        raise AssertionError(f"unexpected Graph call {method} {path}")


def test_outlook_config_and_sign_in_url(client):
    assert client.get("/api/v1/outlook/config").json()["has_oauth_config"] is False
    assert client.post("/api/v1/outlook/oauth/start").status_code == 400

    # A single-tenant app cannot sign in without its tenant id.
    assert client.put("/api/v1/outlook/config/oauth", json={"client_id": "app-123", "tenant_id": " "}).status_code == 400
    assert client.put("/api/v1/outlook/config/oauth", json={"client_id": "app-123", "tenant_id": "tenant-9"}).status_code == 200
    cfg = client.get("/api/v1/outlook/config").json()
    assert cfg["redirect_uri"].startswith("http://localhost:") and cfg["redirect_uri"].endswith("/api/v1/outlook/oauth/callback")

    url = client.post("/api/v1/outlook/oauth/start").json()["auth_url"]
    assert url.startswith("https://login.microsoftonline.com/tenant-9/oauth2/v2.0/authorize?")
    assert "code_challenge_method=S256" in url and "client_id=app-123" in url
    assert "client_secret" not in url
    assert httpx.URL(url).params["scope"] == "offline_access User.Read Mail.ReadWrite Mail.Send"


def test_graph_url_never_sends_the_token_elsewhere():
    assert outlook_client._graph_url("/messages") == "https://graph.microsoft.com/v1.0/me/messages"
    ok = "https://graph.microsoft.com/v1.0/me/mailFolders/abc/messages?$skip=50"
    assert outlook_client._graph_url(ok) == ok
    with pytest.raises(OutlookClientError):
        outlook_client._graph_url("https://evil.example.com/steal")


def test_refresh_keeps_the_rotated_refresh_token(fresh_db, monkeypatch):
    outlook_core.save_oauth_config("app-123", "tenant-9")
    acc = outlook_core.upsert_account("a@b.vn", "A", "old", "ref-old", 0)  # expired access token
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"access_token": "new", "refresh_token": "ref-new", "expires_in": 3600})

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler)))
    token = asyncio.run(outlook_client._access_token(acc["id"]))
    assert token == "new"
    assert seen["url"] == "https://login.microsoftonline.com/tenant-9/oauth2/v2.0/token"
    assert "refresh_token=ref-old" in seen["body"] and "client_secret" not in seen["body"]
    stored = outlook_core.get_account(acc["id"], include_tokens=True)
    assert stored["refresh_token"] == "ref-new" and stored["access_token"] == "new"


def test_folder_tree_includes_sub_folders_and_pins(client, monkeypatch):
    acc = _account()
    outlook_core.set_pinned(acc["id"], "f-nestle", True)
    fake = FakeGraph({
        ("GET", "/mailFolders/inbox"): {"id": "f-inbox"},
        ("GET", "/mailFolders/sentitems"): {"id": "f-sent"},
        ("GET", "/mailFolders/drafts"): {"id": "f-drafts"},
        ("GET", "/mailFolders/archive"): OutlookClientError("no archive", 404),
        ("GET", "/mailFolders/deleteditems"): {"id": "f-del"},
        ("GET", "/mailFolders/junkemail"): {"id": "f-junk"},
        ("GET", "/mailFolders"): {"value": [
            {"id": "f-inbox", "displayName": "Inbox", "parentFolderId": "root", "childFolderCount": 1, "unreadItemCount": 3},
            {"id": "f-sent", "displayName": "Sent Items", "parentFolderId": "root", "unreadItemCount": 9},
            {"id": "f-nestle", "displayName": "NESTLE", "parentFolderId": "root", "unreadItemCount": 82},
        ]},
        ("GET", "/mailFolders/f-inbox/childFolders"): {"value": [
            {"id": "f-u1", "displayName": "U1", "parentFolderId": "f-inbox", "unreadItemCount": 5},
        ]},
    })
    monkeypatch.setattr(outlook_mail, "graph_request", fake)
    res = client.get(f"/api/v1/outlook/accounts/{acc['id']}/folders").json()
    by_id = {f["id"]: f for f in res["folders"]}
    assert set(by_id) == {"f-inbox", "f-sent", "f-nestle", "f-u1"}
    assert by_id["f-inbox"]["well_known"] == "inbox" and by_id["f-u1"]["parent_id"] == "f-inbox"
    assert by_id["f-nestle"]["pinned"] is True
    assert res["total_unread"] == 3 + 82 + 5  # Sent Items is not new mail

    assert client.put(f"/api/v1/outlook/accounts/{acc['id']}/pin", json={"folder_id": "f-nestle", "pinned": False}).status_code == 200
    assert outlook_core.list_pinned(acc["id"]) == []


def test_message_page_filters_and_search(client, monkeypatch):
    acc = _account()
    item = {
        "id": "m1", "conversationId": "c1", "parentFolderId": "f-nestle", "subject": "BK 123",
        "bodyPreview": "Booking", "from": {"emailAddress": {"name": "Nestle, Ops", "address": "ops@nestle.com"}},
        "receivedDateTime": "2026-11-25T05:10:53Z", "isRead": False, "hasAttachments": True,
        "flag": {"flagStatus": "flagged"},
    }
    fake = FakeGraph({
        ("GET", "/mailFolders/f%2Fnestle/messages"): {"value": [item], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/next"},
        ("GET", "/messages"): {"value": [item, {**item, "id": "m2", "isRead": True}]},
    })
    monkeypatch.setattr(outlook_mail, "graph_request", fake)

    page = client.get(
        f"/api/v1/outlook/accounts/{acc['id']}/messages",
        params={"folder_id": "f/nestle", "only_unread": True},
    ).json()
    params = fake.calls[-1][2]
    assert params["$filter"] == "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false"
    assert params["$orderby"] == "receivedDateTime desc"
    first = page["items"][0]
    assert first["from_addr"] == '"Nestle, Ops" <ops@nestle.com>'
    assert first["is_unread"] == 1 and first["is_flagged"] == 1 and first["internal_date_ms"] > 0
    assert page["next_cursor"] == "https://graph.microsoft.com/v1.0/me/next"

    found = client.get(
        f"/api/v1/outlook/accounts/{acc['id']}/messages", params={"search": 'BK "123"', "only_unread": True}
    ).json()
    params = fake.calls[-1][2]
    assert params["$search"] == '"BK 123"' and "$filter" not in params
    assert [i["message_id"] for i in found["items"]] == ["m1"]  # unread filter applied after search


def test_conversation_resolves_inline_images_and_marks_read(client, monkeypatch):
    acc = _account()
    outlook_core.mark_imported(acc["id"], "m2", "a-pdf", "BK999")
    msgs = [
        {"id": "m2", "conversationId": "c1", "subject": "RE: BK", "receivedDateTime": "2026-11-25T06:00:00Z",
         "isRead": False, "hasAttachments": True, "from": {"emailAddress": {"address": "x@y.vn"}},
         "body": {"contentType": "html", "content": '<img src="cid:logo@1">'}},
        {"id": "m1", "conversationId": "c1", "subject": "BK", "receivedDateTime": "2026-11-25T05:00:00Z",
         "isRead": True, "hasAttachments": False, "body": {"contentType": "text", "content": "hello"}},
    ]
    fake = FakeGraph({
        ("GET", "/messages"): {"value": msgs},
        ("GET", "/messages/m2/attachments"): {"value": [
            {"id": "a-logo", "name": "logo.png", "contentType": "image/png", "size": 10, "isInline": True},
            {"id": "a-pdf", "name": "BK.pdf", "contentType": "application/pdf", "size": 99, "isInline": False},
        ]},
        ("GET", "/messages/m2/attachments/a-logo"): {"contentId": "<logo@1>"},
        ("PATCH", "/messages/m2"): {},
    })
    monkeypatch.setattr(outlook_mail, "graph_request", fake)
    conv = client.get(f"/api/v1/outlook/accounts/{acc['id']}/conversation", params={"conversation_id": "c'1"}).json()
    assert fake.calls[0][2]["$filter"] == "conversationId eq 'c''1'"
    assert [m["message_id"] for m in conv["messages"]] == ["m1", "m2"]
    assert conv["messages"][0]["body_text"] == "hello"
    atts = {a["id"]: a for a in conv["messages"][1]["attachments"]}
    assert atts["a-logo"]["content_id"] == "logo@1"
    assert atts["a-pdf"]["is_pdf"] == 1 and atts["a-pdf"]["imported_booking_no"] == "BK999"
    assert ("PATCH", "/messages/m2", None, {"isRead": True}) in fake.calls
    assert conv["is_unread"] == 1  # still shows what was unread when opened


def test_reply_goes_through_a_draft_and_cleans_up_on_failure(client, monkeypatch):
    acc = _account()
    fake = FakeGraph({
        ("POST", "/messages/m1/createReply"): {"id": "d1", "conversationId": "c1"},
        ("PATCH", "/messages/d1"): {},
        ("POST", "/messages/d1/attachments"): {},
        ("POST", "/messages/d1/send"): {},
    })
    monkeypatch.setattr(outlook_mail, "graph_request", fake)
    res = client.post(
        f"/api/v1/outlook/accounts/{acc['id']}/send",
        data={"mode": "reply", "to_addrs": "Ops <ops@nestle.com>", "subject": "RE: BK", "body_text": "Dạ <ok>\nem gửi",
              "reply_to_message_id": "m1"},
        files=[("files", ("BK.pdf", b"%PDF", "application/pdf"))],
    )
    assert res.status_code == 200
    steps = [(m, p) for m, p, _, _ in fake.calls]
    assert steps == [("POST", "/messages/m1/createReply"), ("PATCH", "/messages/d1"),
                     ("POST", "/messages/d1/attachments"), ("POST", "/messages/d1/send")]
    assert fake.calls[0][3]["comment"].count("Dạ &lt;ok&gt;<br>em gửi") == 1
    assert fake.calls[1][3]["toRecipients"] == [{"emailAddress": {"address": "ops@nestle.com", "name": "Ops"}}]

    fake.routes[("POST", "/messages/d1/send")] = OutlookClientError("boom", 400)
    fake.routes[("DELETE", "/messages/d1")] = {}
    fake.calls.clear()
    bad = client.post(
        f"/api/v1/outlook/accounts/{acc['id']}/send",
        data={"mode": "reply", "to_addrs": "ops@nestle.com", "reply_to_message_id": "m1"},
    )
    assert bad.status_code == 400
    assert fake.calls[-1][:2] == ("DELETE", "/messages/d1")


def test_new_mail_and_size_limit(client, monkeypatch):
    acc = _account()
    fake = FakeGraph({("POST", "/sendMail"): {}})
    monkeypatch.setattr(outlook_mail, "graph_request", fake)
    ok = client.post(
        f"/api/v1/outlook/accounts/{acc['id']}/send",
        data={"to_addrs": "a@b.vn, C <c@d.vn>", "subject": "Hi", "body_text": "x"},
    )
    assert ok.status_code == 200
    msg = fake.calls[0][3]["message"]
    assert [r["emailAddress"]["address"] for r in msg["toRecipients"]] == ["a@b.vn", "c@d.vn"]

    big = client.post(
        f"/api/v1/outlook/accounts/{acc['id']}/send",
        data={"to_addrs": "a@b.vn"},
        files=[("files", ("big.pdf", b"0" * (3 * 1024 * 1024 + 1), "application/pdf"))],
    )
    assert big.status_code == 413
    assert len(fake.calls) == 1


def test_actions_move_one_message_at_a_time(client, monkeypatch):
    acc = _account()
    fake = FakeGraph({
        ("POST", "/messages/m1/move"): {},
        ("POST", "/messages/m2/move"): {},
    })
    monkeypatch.setattr(outlook_mail, "graph_request", fake)
    res = client.post(
        f"/api/v1/outlook/accounts/{acc['id']}/actions",
        json={"message_ids": ["m1", "m2"], "action": "move", "destination": "f-nestle"},
    )
    assert res.json()["count"] == 2
    assert all(c[3] == {"destinationId": "f-nestle"} for c in fake.calls)
    assert client.post(
        f"/api/v1/outlook/accounts/{acc['id']}/actions", json={"message_ids": ["m1"], "action": "explode"}
    ).status_code == 400
