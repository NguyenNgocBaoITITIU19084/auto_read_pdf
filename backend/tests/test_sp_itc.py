from unittest.mock import MagicMock, patch
import pytest

from backend.app.services import sp_itc_client, eport_client

SAMPLE_SP_ITC_VESSELS = [
    {
        "OprID": "EMC",
        "ShipName": "EVER OUTWIT",
        "ImVoy": "0579-061N",
        "ExVoy": "0582-062S",
        "BERTH_NO": "BERTH1",
        "ETA": "2026-10-13 19:00:00.000",
        "ETD": "2026-10-14 14:00:00.000",
        "BerthDate": "2026-10-13 19:30:00.000",
        "ATD": "2026-10-14 15:00:00.000",
        "YARD_CLOSE": "2026-10-13 15:00:00.000",
        "ShipArrStatus": "Đã rời",
    },
    {
        "OprID": "OCL",
        "ShipName": "SAN PEDRO",
        "ImVoy": "116N",
        "ExVoy": "116S",
        "BERTH_NO": "BERTH2",
        "ETA": "2026-10-14 04:00:00.000",
        "ETD": "2026-10-15 04:00:00.000",
        "BerthDate": "2026-10-14 04:30:00.000",
        "YARD_CLOSE": "2026-10-13 22:00:00.000",
        "ShipArrStatus": "Kế hoạch",
    },
]


def test_fetch_sp_itc_vessels_mapping(monkeypatch):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = SAMPLE_SP_ITC_VESSELS
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: MagicMock(post=lambda *a, **k: mock_resp))

    res = sp_itc_client.fetch_sp_itc_vessel_schedules()
    assert len(res) == 2
    assert res[0]["SITE_ID"] == "ITC"
    assert res[0]["AGENT"] == "EMC"
    assert res[0]["VESSELNAME"] == "EVER OUTWIT"
    assert res[0]["IN_OUT_VOYAGE"] == "0579-061N-0582-062S"
    assert res[0]["CLOSING_TIME"] == "2026-10-13 15:00:00"
    assert "BERTH1" in res[0]["REMARKS"]


def test_search_sp_itc_vessels_detailed_filter(monkeypatch):
    monkeypatch.setattr(sp_itc_client, "fetch_sp_itc_vessel_schedules", lambda *a, **k: [
        {
            "SITE_ID": "ITC",
            "VESSELNAME": "EVER OUTWIT",
            "IN_OUT_VOYAGE": "0579-061N-0582-062S",
            "CLOSING_TIME": "2026-10-13 15:00:00",
            "REMARKS": "Cầu bến: BERTH1",
        },
        {
            "SITE_ID": "ITC",
            "VESSELNAME": "SAN PEDRO",
            "IN_OUT_VOYAGE": "116N-116S",
            "CLOSING_TIME": "2026-10-13 22:00:00",
            "REMARKS": "Cầu bến: BERTH2",
        },
    ])

    all_res = sp_itc_client.search_sp_itc_vessels_detailed()
    assert len(all_res["items"]) == 2

    # Match vessel
    v_res = sp_itc_client.search_sp_itc_vessels_detailed("EVER OUTWIT")
    assert len(v_res["items"]) == 1
    assert v_res["items"][0]["VESSELNAME"] == "EVER OUTWIT"

    # Match voyage
    voy_res = sp_itc_client.search_sp_itc_vessels_detailed("EVER OUTWIT", "0582-062S")
    assert len(voy_res["items"]) == 1
    assert voy_res["reason"] == "ok"

    # Voyage mismatch
    mismatch = sp_itc_client.search_sp_itc_vessels_detailed("EVER OUTWIT", "9999X")
    assert len(mismatch["items"]) == 0
    assert mismatch["reason"] == "voyage_mismatch"

    # Vessel not found
    not_found = sp_itc_client.search_sp_itc_vessels_detailed("UNKNOWN VESSEL")
    assert len(not_found["items"]) == 0
    assert not_found["reason"] == "vessel_not_found"


def test_eport_client_routes_to_sp_itc(monkeypatch):
    mock_vessels = MagicMock(return_value={"items": [{"VESSELNAME": "EVER OUTWIT"}], "reason": "ok"})
    mock_conts = MagicMock(return_value=[{"CONTAINERNO": "TEMU1234567"}])

    monkeypatch.setattr("backend.app.services.sp_itc_client.search_sp_itc_vessels_detailed", mock_vessels)
    monkeypatch.setattr("backend.app.services.sp_itc_client.search_sp_itc_containers", mock_conts)

    v_out = eport_client.search_vessels_detailed("ITC", "EVER OUTWIT")
    assert mock_vessels.called
    assert v_out["items"][0]["VESSELNAME"] == "EVER OUTWIT"

    c_out = eport_client.search_containers("ITC", "TEMU1234567")
    assert mock_conts.called
    assert c_out[0]["CONTAINERNO"] == "TEMU1234567"


# ---------- containers: mapping onto ePort's event names ----------

EXPORT_FULL_STACKING = {
    "CntrNo": "TEMU1234567", "CntrClass": "3", "Status": "F", "CMStatus": "S",
    "DateIn": "2026-10-20 08:15:00.000", "OprID": "EMC", "IsTLHQ": "1", "ISO_SZTP": "45G1",
}
IMPORT_DISCHARGED = {
    "CntrNo": "OOLU7654321", "CntrClass": "1", "Status": "F", "CMStatus": "S",
    "CJMode_CD": "NTAU", "Fdate": "2026-10-21 03:00:00.000", "DateIn": "", "OprID": "OCL",
}
IMPORT_DELIVERED = {
    "CntrNo": "OOLU7654321", "CntrClass": "1", "Status": "F", "CMStatus": "D",
    "CJMode_CD": "NTAU", "Fdate": "2026-10-21 03:00:00.000", "DateOut": "2026-10-23 10:30:00.000",
}


def test_export_full_stacking_is_an_export_ingate():
    rows = sp_itc_client._map_sp_itc_container(EXPORT_FULL_STACKING)
    assert len(rows) == 1
    r = rows[0]
    assert (r["EVENT_TYPE"], r["EVENT_TIME"]) == ("INGATE", "2026-10-20 08:15:00")
    assert r["IM_EXP"] == "Export" and r["FEL"] == "F" and r["IN_YARD"] == "Y"
    assert r["event_type"] == r["EVENT_TYPE"] and r["site_id"] == "ITC"


def test_export_ingate_counts_as_gated_in_and_raises_gate_alert():
    from backend.app.core import database
    from backend.app.services.change_detection import event_kind, CONTAINER_INGATE
    r = sp_itc_client._map_sp_itc_container(EXPORT_FULL_STACKING)[0]
    assert event_kind(r["EVENT_TYPE"]) == CONTAINER_INGATE
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE c (fel TEXT, im_exp TEXT, event_type TEXT)")
    conn.execute("INSERT INTO c VALUES (?,?,?)", (r["FEL"], r["IM_EXP"], r["EVENT_TYPE"]))
    assert conn.execute(f"SELECT COUNT(*) FROM c WHERE {database._gated_in_sql('c')}").fetchone()[0] == 1


def test_import_from_vessel_is_unload_not_ingate():
    rows = sp_itc_client._map_sp_itc_container(IMPORT_DISCHARGED)
    assert [(r["EVENT_TYPE"], r["EVENT_TIME"]) for r in rows] == [("UNLOAD", "2026-10-21 03:00:00")]
    assert rows[0]["IM_EXP"] == "Import"


def test_delivered_import_has_unload_and_outgate():
    rows = sp_itc_client._map_sp_itc_container(IMPORT_DELIVERED)
    assert [(r["EVENT_TYPE"], r["EVENT_TIME"]) for r in rows] == [
        ("UNLOAD", "2026-10-21 03:00:00"), ("OUTGATE", "2026-10-23 10:30:00")]
    assert rows[1]["IN_YARD"] == "N"


def test_reserved_without_dates_still_shows_once():
    rows = sp_itc_client._map_sp_itc_container({"CntrNo": "ABCU1111111", "CMStatus": "R", "CntrClass": "3"})
    assert len(rows) == 1 and rows[0]["EVENT_TYPE"] == "RESERVED"


def test_booking_search_links_containers_to_the_booking(monkeypatch):
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: MagicMock())
    monkeypatch.setattr(sp_itc_client, "_query_sp_itc", lambda s, opt, v, n=3: [EXPORT_FULL_STACKING])
    rows = sp_itc_client.search_sp_itc_booking(" bk123 ")
    assert rows[0]["BILL_BOOK"] == "BK123" and rows[0]["bill_book"] == "BK123"


def test_container_search_keeps_rcbook_when_present():
    rows = sp_itc_client._map_sp_itc_container({**EXPORT_FULL_STACKING, "rcBook": "bk999"})
    assert rows[0]["BILL_BOOK"] == "BK999"


# ---------- containers: "not found" vs "could not query" ----------

def _session_answering(*answers):
    session = MagicMock()
    resp = [MagicMock(json=MagicMock(return_value=a)) for a in answers]
    session.post.side_effect = resp
    return session


def test_empty_results_mean_not_found(monkeypatch):
    monkeypatch.setattr(sp_itc_client, "solve_sp_itc_captcha", lambda *a, **k: "12345")
    session = _session_answering({"results": []})
    assert sp_itc_client.search_sp_itc_single_container(session, "TEMU1234567") == []


def test_captcha_rejected_every_time_raises(monkeypatch):
    monkeypatch.setattr(sp_itc_client, "solve_sp_itc_captcha", lambda *a, **k: "12345")
    session = _session_answering(*[{"ccWrong": True, "captchaTracking": ""}] * 3)
    with pytest.raises(sp_itc_client.SpItcUnavailable):
        sp_itc_client.search_sp_itc_single_container(session, "TEMU1234567")


def test_no_ocr_engine_fails_fast(monkeypatch):
    session = MagicMock()
    session.post.return_value.json.return_value = {"captchaTracking": '<img src="/captcha.png">'}
    session.get.return_value.content = b"png"
    monkeypatch.setattr(sp_itc_client, "run_local_ocr", lambda *a, **k: ("", []))
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: session)
    monkeypatch.setattr(sp_itc_client.time, "sleep", lambda s: None)
    with pytest.raises(sp_itc_client.SpItcUnavailable, match="OCR"):
        sp_itc_client.search_sp_itc_containers("TEMU1234567, OOLU7654321")
    assert session.get.call_count == 1  # gave up after the first captcha, no retries


def test_one_failing_container_keeps_the_others(monkeypatch):
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: MagicMock())
    monkeypatch.setattr(sp_itc_client.time, "sleep", lambda s: None)

    def fake_single(session, c, max_retries=3):
        if c == "BAD":
            raise sp_itc_client.SpItcUnavailable("timeout")
        return sp_itc_client._map_sp_itc_container(EXPORT_FULL_STACKING)

    monkeypatch.setattr(sp_itc_client, "search_sp_itc_single_container", fake_single)
    assert len(sp_itc_client.search_sp_itc_containers("TEMU1234567,BAD")) == 1
    with pytest.raises(sp_itc_client.SpItcUnavailable):
        sp_itc_client.search_sp_itc_containers("BAD")


def test_rcbook_that_is_not_a_booking_number_is_dropped():
    for junk in ("<span>BK1</span>", "BK 1", ""):
        assert sp_itc_client._map_sp_itc_container({**EXPORT_FULL_STACKING, "rcBook": junk})[0]["BILL_BOOK"] == ""


def test_manual_captcha_generation(monkeypatch):
    mock_session = MagicMock()
    mock_session.post.return_value.json.return_value = {
        "captchaTracking": '<img src="https://eport.sp-itc.com.vn/assets/img/captcha/123.jpg" />'
    }
    mock_session.get.return_value.content = b"fake-jpeg-bytes"
    mock_session.get.return_value.raise_for_status = lambda: None
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: mock_session)

    res = sp_itc_client.get_manual_captcha()
    assert "session_id" in res
    assert res["image_data"].startswith("data:image/jpeg;base64,")
    assert res["expires_in"] == 600  # what the screen counts down from


def _manual_session(*answers):
    """SP-ITC session whose searches answer `answers` in turn; every captcha image is a tiny PNG."""
    session = MagicMock()
    session.post.side_effect = [MagicMock(json=MagicMock(return_value=a)) for a in answers]
    session.get.return_value = MagicMock(content=b"png", headers={"Content-Type": "image/png"})
    session.get.return_value.raise_for_status = lambda: None
    return session


def test_manual_captcha_search_submission():
    session = _manual_session({"results": [EXPORT_FULL_STACKING]})
    sp_itc_client._CAPTCHA_SESSIONS["test-sess-123"] = (session, sp_itc_client.time.time())

    res = sp_itc_client.search_sp_itc_manual("TEMU1234567", "88888", "test-sess-123")
    assert [r["CONTAINERNO"] for r in res["rows"]] == ["TEMU1234567"]
    assert res["remaining"] == [] and res["captcha"] is None
    call_payload = session.post.call_args[1]["data"]
    assert call_payload["capt"] == "88888"
    assert call_payload["checkval"] == "TEMU1234567"
    assert "test-sess-123" not in sp_itc_client._CAPTCHA_SESSIONS  # a code answers one search only


def test_manual_mode_searches_one_container_per_code_and_hands_out_the_next_captcha():
    session = _manual_session({"results": [EXPORT_FULL_STACKING], "captchaTracking": "<img src='/next.png'>"})
    sp_itc_client._CAPTCHA_SESSIONS["s1"] = (session, sp_itc_client.time.time())

    res = sp_itc_client.search_sp_itc_manual("TEMU1234567, OOLU7654321;ABCU1111111", "11111", "s1")
    assert session.post.call_count == 1  # the typed code was not reused for the other containers
    assert len(res["rows"]) == 1 and res["searched"] == "TEMU1234567"
    assert res["remaining"] == ["OOLU7654321", "ABCU1111111"]
    nxt = res["captcha"]
    assert nxt["image_data"].startswith("data:image/png;base64,")
    assert session.get.call_args[0][0].endswith("/next.png")  # the image SP-ITC sent with its answer
    assert sp_itc_client._CAPTCHA_SESSIONS[nxt["session_id"]][0] is session  # same SP-ITC session
    assert nxt["expires_in"] == 600


def test_manual_mode_expired_session_says_so():
    with pytest.raises(sp_itc_client.SpItcCaptchaExpired, match="hết hạn"):
        sp_itc_client.search_sp_itc_manual("TEMU1234567", "11111", "no-such-session")
    old = _manual_session()
    sp_itc_client._CAPTCHA_SESSIONS["old"] = (old, sp_itc_client.time.time() - 601)
    with pytest.raises(sp_itc_client.SpItcCaptchaExpired):
        sp_itc_client.search_sp_itc_manual("TEMU1234567", "11111", "old")
    assert old.post.call_count == 0


def test_manual_mode_wrong_code():
    for answer, message in (({"ccWrong": "Sai mã rồi"}, "Sai mã rồi"), ({"ccWrong": True}, "không chính xác")):
        sp_itc_client._CAPTCHA_SESSIONS["w"] = (_manual_session(answer), sp_itc_client.time.time())
        with pytest.raises(ValueError, match=message):
            sp_itc_client.search_sp_itc_manual("TEMU1234567", "00000", "w")
        assert "w" not in sp_itc_client._CAPTCHA_SESSIONS


def test_manual_search_api_saves_the_first_and_returns_the_rest():
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.core import database as db
    col = db.create_collection("SP-ITC manual")
    session = _manual_session({"results": [EXPORT_FULL_STACKING], "captchaTracking": "<img src='/n.png'>"})
    sp_itc_client._CAPTCHA_SESSIONS["api"] = (session, sp_itc_client.time.time())
    body = {"collection_id": col["id"] if isinstance(col, dict) else col, "site_id": "ITC",
            "container_nos": "TEMU1234567,OOLU7654321", "captcha_code": "12345", "captcha_session_id": "api"}
    res = TestClient(app).post("/api/v1/containers/search", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1 and data["remaining"] == ["OOLU7654321"] and data["next_captcha"]["session_id"]

    expired = TestClient(app).post("/api/v1/containers/search", json={**body, "captcha_session_id": "gone"})
    assert expired.status_code == 400 and "hết hạn" in expired.json()["detail"]


def test_customs_flag_feeds_the_apps_customs_status():
    from backend.app.core.database import compute_customs_status, CUSTOMS_CLEARED, CUSTOMS_NOT_CLEARED
    status = lambda raw: compute_customs_status(sp_itc_client._map_sp_itc_container(raw)[0]["CUST"])
    assert status({**EXPORT_FULL_STACKING, "IsTLHQ": "1"}) == CUSTOMS_CLEARED
    assert status({**EXPORT_FULL_STACKING, "IsTLHQ": 0}) == CUSTOMS_NOT_CLEARED
    assert status({k: v for k, v in EXPORT_FULL_STACKING.items() if k != "IsTLHQ"}) == ""  # unknown, not "not cleared"


def test_watched_itc_container_raises_customs_and_outgate_alerts(monkeypatch):
    """Sync twice through the real API: cleared customs and a delivery each raise their notification."""
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.core import database as db
    state = {**IMPORT_DISCHARGED, "IsTLHQ": "0"}
    session = MagicMock()
    session.post.side_effect = lambda url, data=None, **k: MagicMock(json=lambda: {"results": [dict(state)]})
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: session)
    monkeypatch.setattr(sp_itc_client, "solve_sp_itc_captcha", lambda *a, **k: "12345")
    col = db.create_collection("ITC alerts")
    client = TestClient(app)
    client.post("/api/v1/containers/watchlist", json={"collection_id": col, "site_id": "ITC", "container_no": "OOLU7654321"})
    client.post("/api/v1/containers/watchlist/sync", params={"collection_id": col})
    state.update(IsTLHQ="1", CMStatus="D", DateOut="2026-11-06 10:00:00.000")
    client.post("/api/v1/containers/watchlist/sync", params={"collection_id": col})
    notes = db.list_notifications(limit=200)
    titles = [n["title"] for n in (notes["items"] if isinstance(notes, dict) else notes)]
    assert "Cont OOLU7654321 đã OUTGATE" in titles and "Cont OOLU7654321 đã thông quan" in titles


# ---------- booking: "Update from ePort" at SP-ITC ----------

def test_itc_booking_lookup_links_its_containers_and_survives_a_container_resync(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.core import database as db
    session = MagicMock()

    def post(url, data=None, **k):
        rec = dict(EXPORT_FULL_STACKING)
        return MagicMock(json=lambda: {"results": [rec]})
    session.post.side_effect = post
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: session)
    monkeypatch.setattr(sp_itc_client, "solve_sp_itc_captcha", lambda *a, **k: "12345")
    col = db.create_collection("ITC booking")
    bid = db.insert_booking(col, {"booking_no": "bkitc77", "qty": "1x40HC", "full_return_cy": "SP-ITC"})
    client = TestClient(app)

    res = client.post("/api/v1/containers/sp-itc-booking", json={"booking_id": bid}).json()
    assert res == {"status": "success", "updated": 1, "not_found": [], "errors": []}
    assert session.post.call_args[1]["data"]["opt"] == "booking"
    assert session.post.call_args[1]["data"]["checkval"] == "BKITC77"
    links = db.get_booking_links(bid)
    assert [c["containerno"] for c in links["containers"]] == ["TEMU1234567"] and links["gated_in"] == 1
    assert db.get_bookings_by_ids([bid])[0]["Trạng thái"] == "gated_in"

    # the Cont tab looks the same container up again (no booking number in that answer): still linked
    client.post("/api/v1/containers/search", json={"collection_id": col, "site_id": "ITC", "container_nos": "TEMU1234567"})
    assert [c["containerno"] for c in db.get_booking_links(bid)["containers"]] == ["TEMU1234567"]


def test_itc_booking_lookup_reports_not_found_and_errors(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.core import database as db
    col = db.create_collection("ITC booking 2")
    bid = db.insert_booking(col, {"booking_no": "BKNONE", "full_return_cy": "SP-ITC"})
    client = TestClient(app)
    monkeypatch.setattr(sp_itc_client, "search_sp_itc_booking", lambda b, max_retries=3: [])
    assert client.post("/api/v1/containers/sp-itc-booking", json={"booking_id": bid}).json()["not_found"] == ["BKNONE"]

    def boom(b, max_retries=3):
        raise sp_itc_client.SpItcUnavailable("Máy này không có công cụ OCR")
    monkeypatch.setattr(sp_itc_client, "search_sp_itc_booking", boom)
    assert client.post("/api/v1/containers/sp-itc-booking", json={"booking_id": bid}).json()["errors"] == ["ITC: Máy này không có công cụ OCR"]
    assert client.post("/api/v1/containers/sp-itc-booking", json={"booking_id": 999999}).status_code == 404


# ---------- auto-sync / watchlist sync / resync: an ITC container that could not be asked is an error ----------

def _one_bad_container(monkeypatch):
    def fake_single(session, c, max_retries=3):
        if c == "BADU0000001":
            raise sp_itc_client.SpItcUnavailable("Không tra được 'BADU0000001' (read timed out)")
        return sp_itc_client._map_sp_itc_container({**EXPORT_FULL_STACKING, "CntrNo": c})
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: MagicMock())
    monkeypatch.setattr(sp_itc_client, "search_sp_itc_single_container", fake_single)
    monkeypatch.setattr(sp_itc_client.time, "sleep", lambda s: None)


def test_failed_containers_are_listed_with_the_results(monkeypatch):
    _one_bad_container(monkeypatch)
    res = sp_itc_client.search_sp_itc_containers("TEMU0000001,BADU0000001")
    assert [r["CONTAINERNO"] for r in res] == ["TEMU0000001"]
    assert list(eport_client.failed_containers(res)) == ["BADU0000001"]
    assert eport_client.failed_containers([]) == {}


def test_auto_sync_reports_a_failed_itc_container_as_error_not_not_found(monkeypatch):
    import asyncio
    from backend.app.core import database as db
    from backend.app.services import background_tasks as bt
    _one_bad_container(monkeypatch)
    col = db.create_collection("ITC auto-sync")
    db.add_container_watchlist_batch(col, [{"site_id": "ITC", "container_no": n, "event_type": ""}
                                           for n in ("TEMU0000001", "BADU0000001")])
    monkeypatch.setattr(bt, "get_all_container_watchlists", lambda: db.get_container_watchlist(col))
    result = asyncio.run(bt.sync_container_watchlists())
    assert result["containers_ok"] == 1 and result["errors"] == 1
    status = {w["container_no"]: (w["last_sync_status"], w["last_sync_message"]) for w in db.get_container_watchlist(col)}
    assert status["TEMU0000001"][0] == "ok"
    assert status["BADU0000001"][0] == "error" and "timed out" in status["BADU0000001"][1]


def test_watchlist_sync_and_resync_report_a_failed_itc_container_as_error(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.core import database as db
    _one_bad_container(monkeypatch)
    col = db.create_collection("ITC manual sync")
    client = TestClient(app)
    for n in ("TEMU0000001", "BADU0000001"):
        client.post("/api/v1/containers/watchlist", json={"collection_id": col, "site_id": "ITC", "container_no": n})
    sync = client.post("/api/v1/containers/watchlist/sync", params={"collection_id": col}).json()
    assert len(sync["errors"]) == 1 and "BADU0000001" in sync["errors"][0]
    status = {w["container_no"]: w["last_sync_status"] for w in db.get_container_watchlist(col)}
    assert status == {"TEMU0000001": "ok", "BADU0000001": "error"}

    db.insert_containers(col, sp_itc_client._map_sp_itc_container({**EXPORT_FULL_STACKING, "CntrNo": "BADU0000001"}))
    ids = [r["id"] for r in db.get_containers(col)]
    rs = client.post("/api/v1/containers/resync", json={"ids": ids}).json()
    assert rs["not_found"] == [] and any("BADU0000001" in e for e in rs["errors"])


# ---------- a real SP-ITC answer (MEDU5049541, 2026-11-06), trimmed to the fields the app reads ----------

REAL_IMPORT_BY_BARGE_DELIVERED = {
    "CntrClass": "4", "CntrNo": "MEDU5049541", "Status": "F", "BLNo": "MEDUOM455038", "SealNo": "FX43043140",
    "OprID": "MSC", "DateIn": "2026-10-08 09:51:04.820", "DateOut": "2026-11-05 01:18:54.160",
    "CJMode_CD": "HBAI", "DMethod_CD": "BAI-SALAN", "Note": " ;  / Phụ thu phí nâng cont hàng PIN:ITC26102701948 ",
    "POD": "VNITC", "FPOD": "VNITC", "CMStatus": "D", "LocalSZPT": "20DV", "ISO_SZTP": "22G0", "Temperature": None,
    "CMDWeight": "23.87", "EIRNo": "261027030284", "bTLHQHN": None, "TKHNNo": "108689159940", "bTLHQHX": "1",
    "TKHXNo": None, "BookingNo": "MEDUOM455038", "IsTruckBarge": "B", "cTLHQ": "Đã thanh lý hải quan",
    "CJMode_OUT_CD": "LAYN", "DMethod_OUT_CD": "BAI-XE", "Fdate": "2026-10-08 09:44:16.490",
    "CJModeName": "Hạ bãi", "cLocation": "E2-51-03-2", "rcBook": "", "ShipInfo": "MSC JORDAN III/XO639A/XO639A",
    "BARGE_CODE": "TM68", "TruckNo": None,
}


def test_real_record_maps_booking_customs_import_and_barge_discharge():
    from backend.app.core.database import compute_customs_status, CUSTOMS_CLEARED
    rows = sp_itc_client._map_sp_itc_container(REAL_IMPORT_BY_BARGE_DELIVERED)
    assert [(r["EVENT_TYPE"], r["EVENT_TIME"]) for r in rows] == [
        ("UNLOAD", "2026-10-08 09:51:04"),   # brought in by barge: discharged, not "vào cổng"
        ("OUTGATE", "2026-11-05 01:18:54"),  # delivered full by truck
    ]
    r = rows[0]
    assert r["BILL_BOOK"] == "MEDUOM455038"
    assert r["IM_EXP"] == "Import"           # CntrClass 4 + import declaration
    assert compute_customs_status(r["CUST"]) == CUSTOMS_CLEARED
    assert (r["FEL"], r["IN_YARD"], r["ISO"], r["GROSS"], r["LINE_OPER"]) == ("F", "N", "22G0", 23.87, "MSC")
    assert r["ITEM_SEAL_NO"] == "FX43043140" and r["TEMP"] == ""


def test_real_record_rows_say_what_belongs_to_each_event():
    """The two rows of one SP-ITC record differ beyond event type/time (they looked like duplicates)."""
    unload, outgate = sp_itc_client._map_sp_itc_container(REAL_IMPORT_BY_BARGE_DELIVERED)
    assert unload["LOCATION"] == "E2-51-03-2"
    assert unload["TRUCK_VESSEL"] == "Sà lan TM68 (MSC JORDAN III/XO639A/XO639A)"
    assert unload["NOTE"] == "Phương án vào: Hạ bãi"
    assert outgate["LOCATION"] == ""                     # it has left the yard
    assert outgate["TRUCK_VESSEL"] == ""                 # SP-ITC gave no truck number
    assert outgate["NOTE"] == ("Trạng thái SP-ITC: Delivery | Phương án ra: Lấy nguyên | EIR: 261027030284 | "
                               "Ghi chú: Phụ thu phí nâng cont hàng PIN:ITC26102701948")
    assert unload["location"] == unload["LOCATION"] and outgate["note"] == outgate["NOTE"]


def test_export_still_in_yard_is_one_gate_in_row_with_everything():
    (row,) = sp_itc_client._map_sp_itc_container({**EXPORT_FULL_STACKING, "cLocation": "B1-02-03-1",
                                                  "TruckNo": "51C12345", "CJModeName": "Hạ bãi", "EIRNo": "E1"})
    assert (row["EVENT_TYPE"], row["LOCATION"], row["TRUCK_VESSEL"]) == ("INGATE", "B1-02-03-1", "51C12345")
    assert row["NOTE"] == "Trạng thái SP-ITC: Stacking | Phương án vào: Hạ bãi | EIR: E1"


def test_customs_and_booking_fallbacks():
    base = {k: v for k, v in REAL_IMPORT_BY_BARGE_DELIVERED.items() if k not in ("cTLHQ", "bTLHQHX", "BookingNo")}
    assert sp_itc_client._sp_itc_cust({**base, "cTLHQ": "Chưa thanh lý hải quan"}) == "N"
    assert sp_itc_client._sp_itc_cust({**base, "bTLHQHN": "1"}) == "Y"
    assert sp_itc_client._sp_itc_cust(base) == ""
    assert sp_itc_client._sp_itc_bill_book(base) == "MEDUOM455038"            # BLNo when no BookingNo
    assert sp_itc_client._sp_itc_bill_book(base, "bk1") == "BK1"              # the booking searched for wins


def test_real_import_by_barge_links_to_its_booking_without_a_gate_in_alert():
    from backend.app.core import database as db
    from backend.app.services.change_detection import event_kind
    col = db.create_collection("ITC real")
    bid = db.insert_booking(col, {"booking_no": "MEDUOM455038", "qty": "1x20DV"})
    rows = sp_itc_client._map_sp_itc_container(REAL_IMPORT_BY_BARGE_DELIVERED)
    db.insert_containers(col, rows)
    links = db.get_booking_links(bid)
    assert [c["containerno"] for c in links["containers"]] == ["MEDU5049541"]
    assert links["gated_in"] == 0                       # an import is never an export gate-in
    assert [event_kind(r["EVENT_TYPE"]) for r in rows] == [None, "container_outgate"]


def test_sp_itc_gate_open_times_from_cut_off(monkeypatch):
    """SP-ITC gives only the cut-off; the gate opens 144h (dry) / 72h (reefer) / 48h (DG) before it."""
    from backend.app.services import port_gate_rules
    monkeypatch.setattr(port_gate_rules, "get_gate_open_hours", lambda: port_gate_rules._clean({}))
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = [dict(SAMPLE_SP_ITC_VESSELS[0], YARD_CLOSE="2026-11-16 07:00:00.000")]
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: MagicMock(post=lambda *a, **k: mock_resp))

    row = sp_itc_client.fetch_sp_itc_vessel_schedules()[0]
    assert row["CLOSING_TIME"] == "2026-11-16 07:00:00"
    assert row["OPEN_TS"] == row["open_ts"] == "2026-11-10 07:00:00"
    assert row["REEFER_OPEN_TS"] == "2026-11-13 07:00:00"
    assert row["HAZ_OPEN_TS"] == "2026-11-14 07:00:00"
    assert row["OOG_OPEN_TS"] == ""


def test_sp_itc_gate_open_times_follow_saved_hours(monkeypatch):
    from backend.app.services import port_gate_rules
    saved = {"ITC": {"dry": 120, "reefer": -5, "haz": "x"}, "XYZ": {"dry": 1}}
    monkeypatch.setattr(port_gate_rules, "get_gate_open_hours", lambda: port_gate_rules._clean(saved))
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = [dict(SAMPLE_SP_ITC_VESSELS[0], YARD_CLOSE="2026-11-16 07:00:00.000")]
    monkeypatch.setattr(sp_itc_client, "_create_session", lambda: MagicMock(post=lambda *a, **k: mock_resp))

    row = sp_itc_client.fetch_sp_itc_vessel_schedules()[0]
    assert row["OPEN_TS"] == "2026-11-11 07:00:00"  # edited to 120h
    assert row["REEFER_OPEN_TS"] == "2026-11-13 07:00:00"  # bad values keep the default
    assert row["HAZ_OPEN_TS"] == "2026-11-14 07:00:00"


def test_sp_itc_no_cut_off_means_no_gate_open():
    from backend.app.services.port_gate_rules import gate_open_times
    assert gate_open_times("", {"dry": 144}) == {}


def test_port_gate_hours_settings_roundtrip(tmp_path, monkeypatch):
    from backend.app.services import port_gate_rules
    store = {}
    monkeypatch.setattr("backend.app.core.database.get_system_setting", lambda k, d="": store.get(k, d))
    monkeypatch.setattr("backend.app.core.database.set_system_setting", lambda k, v: store.__setitem__(k, v))
    assert port_gate_rules.get_gate_open_hours() == {"ITC": {"dry": 144, "reefer": 72, "haz": 48}}
    port_gate_rules.set_gate_open_hours({"ITC": {"dry": 168, "reefer": 72, "haz": 48}})
    assert port_gate_rules.get_gate_open_hours()["ITC"]["dry"] == 168
