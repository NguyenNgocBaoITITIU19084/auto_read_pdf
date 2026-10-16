"""Booking workflow status: storage, filters, sort, the late cut-off flag and the automatic move to gated_in."""
import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core.timezone import VN_TZ
from backend.app.main import app


@pytest.fixture(autouse=True)
def _db():
    db.init_db()


@pytest.fixture
def col_id():
    return db.create_collection(f"status-{time.time_ns()}")


def _booking(col_id, no, **extra):
    return db.insert_booking(col_id, {"Booking No": no, "Vessel": "V 001", **extra})


def _status(booking_id):
    return db.get_bookings_by_ids([booking_id])[0]["Trạng thái"]


def _gate_in(no, bill_book, fel="F", im_exp="Export", event_type="INGATE"):
    return {"CONTAINERNO": no, "EVENT_TIME": "16/10/2026 08:00", "EVENT_TYPE": event_type, "FEL": fel,
            "IM_EXP": im_exp, "BILL_BOOK": bill_book, "SITE": "CTL"}


def test_new_booking_starts_as_new_and_status_can_be_set(col_id):
    a, b = _booking(col_id, "A1"), _booking(col_id, "B1")
    assert _status(a) == "new"
    assert db.set_booking_status([a, b], "dispatched") == 2
    assert _status(a) == _status(b) == "dispatched"
    with pytest.raises(ValueError):
        db.set_booking_status([a], "bogus")


def test_status_filter_hide_closed_and_counts(col_id):
    a, b, c = _booking(col_id, "A1"), _booking(col_id, "B1"), _booking(col_id, "C1")
    db.set_booking_status([b], "done")
    db.set_booking_status([c], "cancelled")

    def nos(**kw):
        return sorted(r["Booking No"] for r in db.get_bookings_page(col_id, **kw)["items"])

    assert nos(hide_closed=True) == ["A1"]
    assert nos(statuses=["done", "new"]) == ["A1", "B1"]
    assert sorted(db.get_booking_ids(col_id, hide_closed=True)) == [a]
    assert nos(statuses=["done"], hide_closed=True) == ["B1"]  # an explicit choice wins over the toggle
    assert db.get_booking_status_counts(col_id) == [
        {"status": "new", "count": 1}, {"status": "done", "count": 1}, {"status": "cancelled", "count": 1}]


def test_sort_by_status_follows_the_workflow(col_id):
    a, b, c = _booking(col_id, "A1"), _booking(col_id, "B1"), _booking(col_id, "C1")
    db.set_booking_status([a], "done")
    db.set_booking_status([b], "stuffed")
    rows = db.get_bookings_page(col_id, sort_by="Trạng thái", sort_dir="asc")["items"]
    assert [r["Booking No"] for r in rows] == ["C1", "B1", "A1"]


def test_backup_restore_keeps_status(col_id):
    a = _booking(col_id, "A1")
    db.set_booking_status([a], "stuffed")
    exported = [r for r in db.get_bookings(col_id) if r["Booking No"] == "A1"][0]
    other = db.create_collection(f"status-restore-{time.time_ns()}")
    restored = db.insert_booking(other, exported)
    assert _status(restored) == "stuffed"


@pytest.mark.parametrize("cutoff, status, overdue", [
    ("15/10/2026 18:00", "new", True),
    ("15/10/2026 18:00", "gated_in", False),
    ("15/10/2026 18:00", "done", False),
    ("16/10/2026", "dispatched", False),   # date only = end of that day
    ("15/10/2026", "dispatched", True),
    ("2026-10-17 06:00:00", "new", False),
    ("", "new", False),
    ("null", "new", False),
])
def test_cutoff_overdue(cutoff, status, overdue):
    now = datetime(2026, 10, 16, 9, 0, tzinfo=VN_TZ)
    assert db._is_cutoff_overdue({"cutoff_time": cutoff, "status": status}, now) is overdue


def test_eport_cutoff_wins_over_the_booking_own():
    now = datetime(2026, 10, 16, 9, 0, tzinfo=VN_TZ)
    row = {"cutoff_time": "15/10/2026 18:00", "eport_cutoff": "17/10/2026 06:00", "status": "new"}
    assert db._is_cutoff_overdue(row, now) is False


def test_full_export_gate_ins_move_the_booking_to_gated_in(col_id):
    a = _booking(col_id, "BK001", **{"Q'ty": "2"})
    db.insert_containers(col_id, [_gate_in("CONT0000001", "BK001")])
    assert _status(a) == "new"  # 1 of 2 containers
    db.insert_containers(col_id, [_gate_in("CONT0000002", "bk001 ", event_type="GATE IN")])
    assert _status(a) == "gated_in"


def test_gate_ins_that_do_not_count(col_id):
    a = _booking(col_id, "BK002")
    db.insert_containers(col_id, [
        _gate_in("CONT0000003", "BK002", fel="E"),            # empty
        _gate_in("CONT0000004", "BK002", im_exp="Import"),    # import
        _gate_in("CONT0000005", "BK002", event_type="OUTGATE"),
        _gate_in("CONT0000006", "OTHER"),
    ])
    assert _status(a) == "new"


def test_gate_in_never_moves_a_closed_booking(col_id):
    a = _booking(col_id, "BK003")
    db.set_booking_status([a], "cancelled")
    db.insert_containers(col_id, [_gate_in("CONT0000007", "BK003")])
    assert _status(a) == "cancelled"


def test_booking_added_after_its_containers_is_gated_in(col_id):
    db.insert_containers(col_id, [_gate_in("CONT0000008", "BK004")])
    assert _status(_booking(col_id, "BK004")) == "gated_in"


def test_status_api(col_id):
    client = TestClient(app)
    a = _booking(col_id, "A1")
    res = client.post("/api/v1/bookings/status", json={"ids": [a], "status": "done"})
    assert res.status_code == 200 and res.json()["updated"] == 1
    assert client.post("/api/v1/bookings/status", json={"ids": [a], "status": "nope"}).status_code == 400
    page = client.get("/api/v1/bookings/page", params={"collection_id": col_id, "hide_closed": True}).json()
    assert page["total"] == 0
    assert client.get("/api/v1/bookings/statuses", params={"collection_id": col_id}).json() == [
        {"status": "done", "count": 1}]


# --- calendar ------------------------------------------------------------------------------------------------
def test_calendar_lists_bookings_by_cutoff_in_range(col_id):
    _booking(col_id, "LATE", **{"Port Cargo Cut-off": "20/10/2026 18:00"})
    _booking(col_id, "EARLY", **{"Port Cargo Cut-off": "2026-10-19 08:00:00"})
    _booking(col_id, "DAYONLY", **{"Port Cargo Cut-off": "19/10/2026"})
    _booking(col_id, "OUTSIDE", **{"Port Cargo Cut-off": "27/10/2026 10:00"})
    _booking(col_id, "NONE", **{"Port Cargo Cut-off": "null"})
    res = db.get_bookings_calendar(col_id, "2026-10-19", "2026-10-25")
    assert [(i["Booking No"], i["Hạn cut-off"], i["Cut-off cả ngày"]) for i in res["items"]] == [
        ("EARLY", "2026-10-19 08:00", False),
        ("DAYONLY", "2026-10-19 23:59", True),
        ("LATE", "2026-10-20 18:00", False),
    ]
    assert res["undated"] == 1


def test_calendar_uses_eport_cutoff_and_table_filters(col_id):
    a = _booking(col_id, "A1", **{"Port Cargo Cut-off": "19/10/2026 08:00", "Cut-off ePort": "22/10/2026 06:00"})
    b = _booking(col_id, "B1", **{"Port Cargo Cut-off": "21/10/2026 08:00"})
    db.set_booking_status([b], "done")
    res = db.get_bookings_calendar(col_id, "2026-10-19", "2026-10-25", hide_closed=True)
    assert [(i["id"], i["Hạn cut-off"]) for i in res["items"]] == [(a, "2026-10-22 06:00")]


def test_calendar_api_rejects_bad_dates(col_id):
    client = TestClient(app)
    res = client.get("/api/v1/bookings/calendar", params={"collection_id": col_id, "date_from": "19/10", "date_to": "x"})
    assert res.status_code == 400
