"""Watched Zalo chats: booking files are downloaded, read and queued for review (services/zalo_booking.py)."""
import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services import zalo_booking as zb

PDF_BYTES = b"%PDF-1.4 booking pdf"
PDF_BYTES_2 = b"%PDF-1.4 another booking pdf"
JPG_BYTES = b"\xff\xd8\xff\xe0 fake jpeg"
BOOKING = {"Booking No": "BKG123456", "Carrier": "EVERGREEN", "Vessel": "EVER X", "ETD": "2026-12-01"}


@pytest.fixture()
def client(fresh_db, monkeypatch):
    """No network, no Gemini, no background thread: scans run when the test drains the queue."""
    files = {
        "https://f.dlfl.vn/a.pdf": PDF_BYTES,
        "https://f.dlfl.vn/b.pdf": PDF_BYTES_2,
        "https://f.dlfl.vn/notbooking.pdf": b"%PDF-1.4 invoice",
        "https://p.zdn.vn/photo.jpg": JPG_BYTES,
    }
    monkeypatch.setattr(zb, "_ensure_worker", lambda: None)
    monkeypatch.setattr(zb, "GEMINI_GAP_SECONDS", 0)

    def fake_download(url):
        if url.endswith("/dead.pdf"):
            return None, zb.EXPIRED, zb.MSG_EXPIRED
        return files[url], "", ""

    monkeypatch.setattr(zb, "_download", fake_download)
    monkeypatch.setattr(zb, "_pdf_has_text", lambda data: True)
    monkeypatch.setattr(zb, "detect_file_kind", lambda data, name: zb.PDF if data.startswith(b"%PDF") else zb.IMAGE)
    monkeypatch.setattr(
        zb, "extract_booking_from_pdf_bytes",
        lambda data: dict(BOOKING) if data in (PDF_BYTES, PDF_BYTES_2) else {"Carrier": None},
    )
    monkeypatch.setattr(zb, "has_booking_fields", lambda d: bool(d.get("Booking No")))
    monkeypatch.setattr(zb, "resolve_vessel_etd", lambda d: None)
    reads = []

    def fake_gemini(data, name, kind):
        reads.append(name)
        return {"data": {"Booking No": "IMG777"}, "engine_used": "gemini", "warnings": []}

    monkeypatch.setattr(zb, "_read_with_gemini", fake_gemini)
    with TestClient(app) as c:
        c.gemini_reads = reads
        yield c


def drain():
    while not zb._queue.empty():
        message_id, force = zb._queue.get()
        zb.process(message_id, force)
        zb._queue.task_done()


def send(client, tid, msg_id, *, kind="file", name="booking.pdf", url="https://f.dlfl.vn/a.pdf", direction="in", text=None):
    body = {"thread_id": tid, "msg_id": msg_id, "msg_type": kind, "media_url": url,
            "content": text if text is not None else (name if kind == "file" else "")}
    endpoint = "incoming" if direction == "in" else "outgoing"
    return client.post(f"/api/v1/zalo/messages/{endpoint}", json=body).json()["message"]


def scan_of(client, tid, message_id):
    msgs = client.get(f"/api/v1/zalo/conversations/{tid}/messages").json()
    return next(m for m in msgs if m["id"] == message_id)["booking_scan"]


def test_pdf_in_watched_chat_goes_to_review_queue(client):
    col_id = db.create_collection("Zalo watch test")
    client.put("/api/v1/zalo/booking-settings", json={"collection_id": col_id, "image_mode": "manual"})
    tid = "grp_watch_1"
    send(client, tid, "w1_hello", kind="text", url="", text="chào")  # creates the chat
    watched = client.post(f"/api/v1/zalo/conversations/{tid}/watch", json={"watch": True}).json()
    assert watched["conversation"]["watch_booking"] == 1
    assert "7" in watched["history"]

    msg = send(client, tid, "w1_pdf")
    drain()
    scan = scan_of(client, tid, msg["id"])
    assert scan["status"] == "pending_review"
    assert scan["booking_no"] == "BKG123456"
    assert scan["data"]["Booking No"] == "BKG123456"
    assert scan["has_file"] is True

    queue = client.get("/api/v1/zalo/booking-scans").json()
    assert any(q["message_id"] == msg["id"] for q in queue)
    assert client.get("/api/v1/zalo/booking-scans/summary").json()["pending_review"] >= 1
    assert client.get(f"/api/v1/zalo/booking-scans/{msg['id']}/file").content == PDF_BYTES

    # Saving it from the review window marks the message
    saved = client.post(f"/api/v1/zalo/booking-scans/{msg['id']}/saved", json={"booking_id": 42, "collection_id": col_id}).json()
    assert saved["status"] == "saved" and saved["booking_id"] == 42

    # The same file sent again (or forwarded) is not read twice
    again = send(client, tid, "w1_pdf_again")
    drain()
    assert scan_of(client, tid, again["id"])["status"] == "duplicate"


def test_unwatched_chat_is_not_scanned_but_a_click_scans(client):
    tid = "grp_watch_2"
    msg = send(client, tid, "w2_pdf", url="https://f.dlfl.vn/b.pdf")
    drain()
    assert scan_of(client, tid, msg["id"]) is None

    res = client.post(f"/api/v1/zalo/messages/{msg['id']}/scan").json()
    assert res["status"] == "downloading"
    drain()
    assert scan_of(client, tid, msg["id"])["status"] == "pending_review"


def test_own_files_are_scanned_and_other_cases(client):
    tid = "grp_watch_3"
    send(client, tid, "w3_hello", kind="text", url="", text="hi")
    client.post(f"/api/v1/zalo/conversations/{tid}/watch", json={"watch": True})

    mine = send(client, tid, "w3_mine", url="https://f.dlfl.vn/b.pdf", direction="out")
    other = send(client, tid, "w3_invoice", name="invoice.pdf", url="https://f.dlfl.vn/notbooking.pdf")
    dead = send(client, tid, "w3_dead", url="https://f.dlfl.vn/dead.pdf")
    word = send(client, tid, "w3_docx", name="report.docx", url="https://f.dlfl.vn/x.docx")
    drain()
    assert scan_of(client, tid, mine["id"])["status"] in ("pending_review", "duplicate")
    assert scan_of(client, tid, other["id"])["status"] == "not_booking"
    assert scan_of(client, tid, dead["id"])["status"] == "expired"
    assert scan_of(client, tid, word["id"]) is None  # not a PDF or photo: never a candidate


def test_image_modes(client):
    tid = "grp_watch_4"
    send(client, tid, "w4_hello", kind="text", url="", text="hi")
    client.post(f"/api/v1/zalo/conversations/{tid}/watch", json={"watch": True})

    client.put("/api/v1/zalo/booking-settings", json={"image_mode": "manual"})
    p1 = send(client, tid, "w4_p1", kind="image", url="https://p.zdn.vn/photo.jpg", text="booking mới nè")
    drain()
    assert scan_of(client, tid, p1["id"])["status"] == "manual"
    assert client.gemini_reads == []

    # A click reads it even in manual mode
    client.post(f"/api/v1/zalo/messages/{p1['id']}/scan")
    drain()
    assert scan_of(client, tid, p1["id"])["status"] == "pending_review"
    assert len(client.gemini_reads) == 1

    client.put("/api/v1/zalo/booking-settings", json={"image_mode": "caption"})
    db.get_connection().execute("DELETE FROM zalo_booking_scans;").connection.commit()
    p2 = send(client, tid, "w4_p2", kind="image", url="https://p.zdn.vn/photo.jpg", text="ảnh seal cont")
    p3 = send(client, tid, "w4_p3", kind="image", url="https://p.zdn.vn/photo.jpg", text="BKG 123 gửi anh")
    drain()
    assert scan_of(client, tid, p2["id"])["status"] == "manual"
    assert scan_of(client, tid, p3["id"])["status"] == "pending_review"

    assert client.put("/api/v1/zalo/booking-settings", json={"image_mode": "everything"}).status_code == 400
    client.put("/api/v1/zalo/booking-settings", json={"image_mode": "manual"})


def test_history_scan_and_dismiss(client):
    tid = "grp_watch_5"
    old = send(client, tid, "w5_old", url="https://f.dlfl.vn/b.pdf")
    drain()
    assert scan_of(client, tid, old["id"]) is None  # sent before the chat was watched

    watched = client.post(f"/api/v1/zalo/conversations/{tid}/watch", json={"watch": True}).json()
    assert watched["history"]["7"]["pdf"] == 1
    assert client.post(f"/api/v1/zalo/conversations/{tid}/scan-history", json={"days": 7}).json()["queued"] == 1
    drain()
    scan = scan_of(client, tid, old["id"])
    assert scan["status"] in ("pending_review", "duplicate")

    gone = client.post(f"/api/v1/zalo/booking-scans/{old['id']}/dismiss").json()
    assert gone["status"] == "dismissed"
    assert client.post(f"/api/v1/zalo/conversations/{tid}/watch", json={"watch": False}).json()["history"] is None

    convs = client.get("/api/v1/zalo/conversations?filter=watching").json()
    assert tid not in [c["thread_id"] for c in convs["items"]]


def test_file_sent_from_the_app_is_read_from_its_local_copy(client):
    """Zalo's link for a file sent from the app may never come back: the bytes the app sent are used instead."""
    import base64

    tid = "grp_watch_6"
    send(client, tid, "w6_hello", kind="text", url="", text="hi")
    client.post(f"/api/v1/zalo/conversations/{tid}/watch", json={"watch": True})
    # Recorded at send time, before (or without) Zalo's link
    msg = client.post("/api/v1/zalo/messages/outgoing", json={
        "thread_id": tid, "msg_id": "w6_sent", "msg_type": "file", "content": "SGNE1.pdf", "status": "sent",
    }).json()["message"]
    res = client.post("/api/v1/zalo/messages/local-copy", json={
        "msg_id": "w6_sent", "file_name": "SGNE1.pdf", "data_b64": base64.b64encode(PDF_BYTES_2).decode(),
    }).json()
    assert res["scan"]["status"] == "downloading"
    drain()
    scan = scan_of(client, tid, msg["id"])
    assert scan["status"] == "pending_review" and scan["has_file"] is True

    # The link arriving later does not queue it a second time
    client.post("/api/v1/zalo/messages/outgoing", json={
        "thread_id": tid, "msg_id": "w6_sent", "msg_type": "file", "content": "SGNE1.pdf", "media_url": "https://f.dlfl.vn/b.pdf",
    })
    assert zb._queue.empty()

    # Not watched: nothing kept
    assert client.post("/api/v1/zalo/messages/local-copy", json={
        "msg_id": "w2_pdf", "file_name": "x.pdf", "data_b64": base64.b64encode(PDF_BYTES).decode(),
    }).json()["scan"] is None
