from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services import change_detection as cd

API = "/api/v1"


@pytest.fixture
def col(fresh_db):
    return db.create_collection("notify test")


def sched(closing="2026-09-23 11:00:00", name="HMM HOPE", voyage="062E-062E", **more):
    return {"SITE_ID": "CTL", "VESSELNAME": name, "IN_OUT_VOYAGE": voyage, "CLOSING_TIME": closing, **more}


def notes(unread_only=False):
    return db.list_notifications(100, unread_only)["items"]


def cont(event_type, event_time, cust="", no="EMCU1234567", **more):
    return {"SITE": "CTL", "CONTAINERNO": no, "EVENT_TYPE": event_type, "EVENT_TIME": event_time, "CUST": cust, **more}


# ----------------------------------------------------------------------------------------------- pure rules
@pytest.mark.parametrize("raw, expected", [
    ("EST (dự kiến): 22:59 24/09/2026", datetime(2026, 9, 24, 22, 59)),
    ("06:00 16/09/2026", datetime(2026, 9, 16, 6, 0)),
    ("2026-09-16 06:00:00", datetime(2026, 9, 16, 6, 0)),
    ("16/09/2026 06:00", datetime(2026, 9, 16, 6, 0)),
    ("/Date(-2209017600000)/", None),
    ("1900-01-01 00:00:00", None),
    ("", None),
    (None, None),
])
def test_extract_datetime(raw, expected):
    assert cd.extract_datetime(raw) == expected


# ----------------------------------------------------------------------------------------------- vessels
def test_a_vessel_seen_for_the_first_time_is_silent(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()], "auto_sync")
    assert notes() == []


def test_changed_cutoff_of_a_watched_vessel_notifies_with_old_and_new(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()], "manual")
    db.insert_vessel_schedules(col, [sched(closing="2026-09-24 09:30:00")], "auto_sync")
    (n,) = notes()
    assert n["kind"] == cd.VESSEL_CLOSING
    assert (n["old_value"], n["new_value"]) == ("23/09/2026 11:00", "24/09/2026 09:30")
    assert "HMM HOPE" in n["title"] and "hạn đóng máng" in n["title"]
    assert (n["source"], n["nav_tab"], n["nav_query"], n["read"]) == ("auto_sync", "vessel", "HMM HOPE", False)


def test_open_gate_icd_eta_and_etd_changes_are_reported_separately(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "")
    first = sched(OPEN_TS="00:00 09/09/2026", CLOSING_TIME_ICD="11:00 23/09/2026",
                  ACTUAL_BERTH_TIME="EST (dự kiến): 22:59 24/09/2026", ACTUAL_DEPATURE_TIME="EST (dự kiến): 16:59 25/09/2026")
    db.insert_vessel_schedules(col, [first])
    db.insert_vessel_schedules(col, [sched(OPEN_TS="00:00 10/09/2026", CLOSING_TIME_ICD="08:00 23/09/2026",
                                           ACTUAL_BERTH_TIME="EST (dự kiến): 05:00 25/09/2026",
                                           ACTUAL_DEPATURE_TIME="EST (dự kiến): 16:59 25/09/2026")])
    assert sorted(n["kind"] for n in notes()) == sorted([cd.VESSEL_OPEN_GATE, cd.VESSEL_CLOSING_ICD, cd.VESSEL_ETA])


def test_a_pure_format_difference_is_silent(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched(closing="06:00 16/09/2026")])          # stored the old display way
    db.insert_vessel_schedules(col, [sched(closing="2026-09-16 06:00:00")])       # ePort's own format
    assert notes() == []


@pytest.mark.parametrize("new_value", ["", "/Date(-2209017600000)/", "not a date"])
def test_a_time_turning_blank_or_unreadable_is_silent(col, new_value, caplog):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()])
    db.insert_vessel_schedules(col, [sched(closing=new_value)])
    assert notes() == []
    assert not [r for r in caplog.records if r.levelname == "ERROR"]     # silent by rule, not because a step crashed


@pytest.mark.parametrize("old, new", [
    ("2026-09-23 11:00:00", ""), ("", "2026-09-24 09:00:00"), (None, None), ("2026-09-23 11:00:00", "/Date(-2209017600000)/"),
    ("06:00 16/09/2026", "2026-09-16 06:00:00"),
])
def test_vessel_time_changes_ignore_blank_unreadable_and_format_only_differences(old, new):
    assert cd.vessel_time_changes({"closing_time": old}, {"closing_time": new}, set(cd.ALL_KINDS)) == []


def test_vessel_time_changes_reports_a_real_change():
    (ch,) = cd.vessel_time_changes({"closing_time": "06:00 16/09/2026"}, {"closing_time": "2026-09-17 06:00:00"}, {cd.VESSEL_CLOSING})
    assert (ch["kind"], ch["old"], ch["new"]) == (cd.VESSEL_CLOSING, "16/09/2026 06:00", "17/09/2026 06:00")


def test_only_watched_or_booking_vessels_are_reported(col):
    db.insert_vessel_schedules(col, [sched()])
    db.insert_vessel_schedules(col, [sched(closing="2026-09-24 09:30:00")])
    assert notes() == []                                                         # nobody follows it

    db.insert_booking(col, {"Booking No": "SGNGX2311600", "Vessel": "HMM HOPE 062E(EC2)"})
    db.insert_vessel_schedules(col, [sched(closing="2026-09-25 10:00:00")])
    (n,) = notes()
    assert n["detail"]["bookings"] == ["SGNGX2311600"]                           # a booking uses it: affected bookings listed

    db.add_to_watchlist(col, "CTL", "HMM", "")                                    # a different vessel with a similar name
    other = db.create_collection("other")
    db.add_to_watchlist(other, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(other, [sched()]); db.insert_vessel_schedules(other, [sched(closing="2026-09-26 10:00:00")])
    assert [x["collection_id"] for x in notes()].count(other) == 1               # collections are kept apart


def test_watch_for_another_voyage_does_not_count(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "999E")
    db.insert_vessel_schedules(col, [sched()])
    db.insert_vessel_schedules(col, [sched(closing="2026-09-24 09:30:00")])
    assert notes() == []


def test_disabled_kinds_are_not_recorded(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.set_notification_settings([cd.VESSEL_ETA], True)
    db.insert_vessel_schedules(col, [sched()])
    db.insert_vessel_schedules(col, [sched(closing="2026-09-24 09:30:00")])
    assert notes() == []


def test_a_flip_flop_does_not_repeat_the_same_alert_within_a_day(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched(closing="2026-09-23 11:00:00")])
    for value in ("2026-09-24 09:30:00", "2026-09-23 11:00:00", "2026-09-24 09:30:00"):
        db.insert_vessel_schedules(col, [sched(closing=value)])
    assert [n["new_value"] for n in reversed(notes())] == ["24/09/2026 09:30", "23/09/2026 11:00"]


def test_restore_and_move_do_not_notify(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()])
    backup = db.export_backup_data()
    db.clear_vessel_schedules(col)
    db.import_backup_data(backup)
    (row,) = db.get_vessel_schedules(col)
    target = db.create_collection("moved")
    db.move_items_to_collection("vessels", [row["id"]], target, copy=False)
    assert notes() == []


def test_detection_failures_never_block_saving(col, monkeypatch):
    monkeypatch.setattr(db, "_detect_vessel_changes", lambda *a: 1 / 0)
    assert db.insert_vessel_schedules(col, [sched()])
    assert len(db.get_vessel_schedules(col)) == 1


# ----------------------------------------------------------------------------------------------- containers
def test_new_outgate_of_a_known_watched_container_notifies(col):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    assert notes() == []                                                         # first sight: silent
    db.insert_containers(col, [cont("OUTGATE", "2026-09-26 09:46:08")], "auto_sync")
    (n,) = notes()
    assert n["kind"] == cd.CONTAINER_OUTGATE and "EMCU1234567" in n["title"] and "OUTGATE" in n["title"]
    assert (n["nav_tab"], n["nav_query"], n["source"]) == ("container", "EMCU1234567", "auto_sync")


def test_ingate_notifies_and_other_events_do_not(col):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    db.insert_containers(col, [cont("LOAD", "2026-09-21 01:00:00"), cont("INGATE", "2026-09-22 08:00:00")])
    assert [n["kind"] for n in notes()] == [cd.CONTAINER_INGATE]


def test_back_filled_history_is_not_news(col):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    # the watch is widened to "all" and ePort now returns older gate events too
    db.insert_containers(col, [cont("INGATE", "2026-09-10 08:00:00"), cont("OUTGATE", "2026-09-12 09:00:00")])
    assert notes() == []
    db.insert_containers(col, [cont("INGATE", "2026-09-10 08:00:00")])           # and the same event again is not new either
    assert notes() == []


def test_a_watch_made_for_one_event_type_still_reports_the_gate_events(col):
    """Bookmarking an UNLOAD row watches that container; its later OUTGATE is exactly what the user wants to hear about."""
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "UNLOAD")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    db.insert_containers(col, [cont("OUTGATE", "2026-09-26 09:46:08"), cont("LOAD", "2026-09-27 08:00:00")])
    assert [n["kind"] for n in notes()] == [cd.CONTAINER_OUTGATE]


def test_customs_clearance_switch_notifies_once(col):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05", cust="N")])
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05", cust="Y")], "auto_sync")     # same event row, N -> Y
    (n,) = notes()
    assert n["kind"] == cd.CONTAINER_CUSTOMS and n["new_value"] == "Đã thông quan" and "thông quan" in n["title"]
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05", cust="Y")])
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05", cust="N")])                    # cleared -> not cleared: silent
    assert len(notes()) == 1


def test_unknown_customs_status_turning_cleared_is_silent(col):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05", cust="")])
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05", cust="Y")])
    assert notes() == []


def test_unwatched_containers_and_other_collections_are_silent(col):
    other = db.create_collection("other")
    db.add_to_container_watchlist(other, "CTL", "EMCU1234567", "")
    for c in (col, other):
        db.insert_containers(c, [cont("UNLOAD", "2026-09-20 23:46:05")])
        db.insert_containers(c, [cont("OUTGATE", "2026-09-26 09:46:08")])
    assert [n["collection_id"] for n in notes()] == [other]


def test_restore_does_not_notify_containers(col):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05"), cont("OUTGATE", "2026-09-26 09:46:08")])
    backup = db.export_backup_data()
    db.import_backup_data(backup)
    assert notes() == []


def test_the_retention_prunes_old_and_excess_rows(col):
    now = datetime(2026, 9, 30, 12, 0)
    with db.get_connection() as conn:
        change = lambda i: {"kind": cd.VESSEL_CLOSING, "entity_key": f"e{i}", "old": "", "new": f"n{i}", "title": "t"}
        db._record_notifications(conn, col, [change(0)], "manual", now=now - timedelta(days=40))
        db._record_notifications(conn, col, [change(1)], "manual", now=now)
    assert [n["new_value"] for n in notes()] == ["n1"]                                  # the 40-day-old one is gone


# ----------------------------------------------------------------------------------------------- API
@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def _make(col, n=2):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()])
    for i in range(n):
        db.insert_vessel_schedules(col, [sched(closing=f"2026-09-2{4 + i} 09:30:00")], "auto_sync")


def test_list_mark_read_and_clear(client, col):
    _make(col, 2)
    body = client.get(f"{API}/notifications").json()
    assert body["unread"] == 2 and len(body["items"]) == 2 and body["items"][0]["id"] > body["items"][1]["id"]

    first = body["items"][0]["id"]
    assert client.post(f"{API}/notifications/mark-read", json={"ids": [first]}).json() == {"updated": 1}
    assert client.get(f"{API}/notifications", params={"unread_only": True}).json()["unread"] == 1
    assert client.post(f"{API}/notifications/mark-read", json={}).json() == {"updated": 1}   # everything else
    assert client.delete(f"{API}/notifications").json() == {"deleted": 2}
    assert client.get(f"{API}/notifications").json() == {"items": [], "unread": 0}


def test_settings_round_trip(client):
    body = client.get(f"{API}/notifications/settings").json()
    assert body["kinds"] == list(cd.ALL_KINDS) and body["os_enabled"] is True
    put = client.put(f"{API}/notifications/settings", json={"kinds": [cd.CONTAINER_OUTGATE, "bogus"], "os_enabled": False}).json()
    assert put["kinds"] == [cd.CONTAINER_OUTGATE] and put["os_enabled"] is False


def test_claim_os_hands_out_each_background_change_once(client, col):
    _make(col, 2)
    db.insert_vessel_schedules(col, [sched(closing="2026-09-28 09:30:00")], "manual")     # manual: never a popup
    claim = client.post(f"{API}/notifications/claim-os").json()
    assert [i["source"] for i in claim["items"]] == ["auto_sync", "auto_sync"]
    assert claim["summary"]["count"] == 2 and "2 thay đổi" in claim["summary"]["title"] and "tàu đổi hạn đóng máng" in claim["summary"]["body"]
    assert client.post(f"{API}/notifications/claim-os").json() == {"items": [], "summary": None}      # atomic: nothing twice


def test_claim_os_single_change_uses_its_own_text_and_skips_read_ones(client, col):
    _make(col, 2)
    first = client.get(f"{API}/notifications").json()["items"][-1]["id"]
    client.post(f"{API}/notifications/mark-read", json={"ids": [first]})                   # the user already saw it
    claim = client.post(f"{API}/notifications/claim-os").json()
    assert claim["summary"]["count"] == 1
    assert "→" in claim["summary"]["body"] and claim["summary"]["nav_tab"] == "vessel"
    assert claim["summary"]["notification_id"] == claim["items"][0]["id"]   # the popup opens this notification's detail


def test_claim_os_marks_taken_even_when_popups_are_off(client, col):
    client.put(f"{API}/notifications/settings", json={"kinds": list(cd.ALL_KINDS), "os_enabled": False})
    _make(col, 1)
    assert client.post(f"{API}/notifications/claim-os").json() == {"items": [], "summary": None}
    client.put(f"{API}/notifications/settings", json={"kinds": list(cd.ALL_KINDS), "os_enabled": True})
    assert client.post(f"{API}/notifications/claim-os").json() == {"items": [], "summary": None}       # not replayed later


def test_auto_sync_marks_its_writes_as_background(col, monkeypatch):
    import asyncio
    from backend.app.services import background_tasks as bt
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()])
    monkeypatch.setattr(bt, "search_vessels_detailed", lambda *a, **k: {"items": [sched(closing="2026-09-24 09:30:00")]})
    monkeypatch.setattr(bt.asyncio, "sleep", lambda s: asyncio.sleep(0))
    asyncio.run(bt.sync_vessel_watchlists())
    assert [n["source"] for n in notes()] == ["auto_sync"]


# ----------------------------------------------------------------------------------------------- sync keeps gate rows
def _run_auto_sync(monkeypatch, rows):
    import asyncio
    from backend.app.services import background_tasks as bt
    monkeypatch.setattr(bt, "search_containers", lambda *a, **k: rows)
    monkeypatch.setattr(bt.asyncio, "sleep", lambda s: asyncio.sleep(0))
    asyncio.run(bt.sync_container_watchlists())


def test_auto_sync_stores_and_reports_gate_events_of_a_container_watched_for_another_event(col, monkeypatch):
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "UNLOAD")          # what a row bookmark creates
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    rows = [cont("UNLOAD", "2026-09-20 23:46:05"), cont("OUTGATE", "2026-09-26 09:46:08"), cont("LOAD", "2026-09-27 01:00:00")]

    _run_auto_sync(monkeypatch, rows)
    (n,) = notes()
    assert (n["kind"], n["source"]) == (cd.CONTAINER_OUTGATE, "auto_sync")
    stored = {r["event_type"] for r in db.get_containers(col)}
    assert stored == {"UNLOAD", "OUTGATE"}                                       # the gate row is kept, LOAD (not watched) is not

    _run_auto_sync(monkeypatch, rows)                                            # the next cycle sees nothing new
    assert len(notes()) == 1


def test_gate_rows_are_not_kept_when_their_alerts_are_off(col, monkeypatch):
    db.set_notification_settings([cd.VESSEL_CLOSING], True)
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "UNLOAD")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    _run_auto_sync(monkeypatch, [cont("UNLOAD", "2026-09-20 23:46:05"), cont("OUTGATE", "2026-09-26 09:46:08")])
    assert {r["event_type"] for r in db.get_containers(col)} == {"UNLOAD"}
    assert notes() == []


def test_extra_gate_rows_only_for_watched_containers():
    rows = [cont("OUTGATE", "t1"), cont("OUTGATE", "t2", no="OTHER0000001"), cont("INGATE", "t3"), cont("UNLOAD", "t4")]
    kept = [rows[3]]
    got = cd.extra_gate_rows(rows, {"EMCU1234567"}, kept, set(cd.ALL_KINDS))
    assert [r["EVENT_TYPE"] for r in got] == ["OUTGATE", "INGATE"]
    assert cd.extra_gate_rows(rows, {"EMCU1234567"}, kept, {cd.VESSEL_ETA}) == []


# ----------------------------------------------------------------------------------------------- stale popups
def test_claim_os_does_not_popup_old_changes_found_while_the_app_was_closed(col):
    db.add_to_watchlist(col, "CTL", "HMM HOPE", "062E")
    db.insert_vessel_schedules(col, [sched()])
    db.insert_vessel_schedules(col, [sched(closing="2026-09-24 09:30:00")], "auto_sync")
    db.insert_vessel_schedules(col, [sched(closing="2026-09-25 09:30:00")], "auto_sync")
    with db.get_connection() as conn:                                    # the first one is from yesterday
        conn.execute("UPDATE notifications SET created_at = ? WHERE id = (SELECT MIN(id) FROM notifications);",
                     ((datetime.now() - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S"),))
    claim = db.claim_os_notifications()
    assert [i["new_value"] for i in claim["items"]] == ["25/09/2026 09:30"]
    assert claim["summary"]["count"] == 1
    assert db.claim_os_notifications() == {"items": [], "summary": None}  # and the stale one is not replayed later
    assert len(notes()) == 2                                             # yet both are still in the bell


def test_notification_polls_stay_out_of_the_request_log():
    from backend.app.core.request_logging import _QUIET
    assert "/api/v1/notifications" in _QUIET


def test_the_manual_watchlist_sync_button_keeps_gate_rows_as_well(fresh_db, monkeypatch):
    import backend.app.api.containers as containers_api
    col = db.create_collection("manual sync")
    db.add_to_container_watchlist(col, "CTL", "EMCU1234567", "UNLOAD")
    db.insert_containers(col, [cont("UNLOAD", "2026-09-20 23:46:05")])
    monkeypatch.setattr(containers_api, "search_containers", lambda *a, **k: [
        cont("UNLOAD", "2026-09-20 23:46:05"), cont("OUTGATE", "2026-09-26 09:46:08"), cont("LOAD", "2026-09-27 01:00:00")])
    res = TestClient(app).post(f"{API}/containers/watchlist/sync", params={"collection_id": col})
    assert res.status_code == 200
    assert {r["event_type"] for r in db.get_containers(col)} == {"UNLOAD", "OUTGATE"}
    (n,) = notes()
    assert (n["kind"], n["source"]) == (cd.CONTAINER_OUTGATE, "manual")        # a click, not the background job: no popup


def test_send_test_creates_a_notification_that_reaches_the_popup_and_is_never_deduplicated(client):
    first = client.post(f"{API}/notifications/test").json()
    second = client.post(f"{API}/notifications/test").json()
    assert first["kind"] == second["kind"] == "test" and first["id"] != second["id"]
    assert first["source"] == "auto_sync" and first["nav_tab"] is None
    claim = client.post(f"{API}/notifications/claim-os").json()
    assert claim["summary"]["count"] == 2 and claim["summary"]["title"] == "2 thay đổi mới"
    third = client.post(f"{API}/notifications/test").json()
    claim = client.post(f"{API}/notifications/claim-os").json()
    assert claim["summary"]["title"] == "Thông báo thử" and "popup" in claim["summary"]["body"]
    assert client.get(f"{API}/notifications").json()["unread"] == 3 and third["read"] is False
