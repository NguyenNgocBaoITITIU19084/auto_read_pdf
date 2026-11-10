"""'Việc hôm nay / ngày mai': open bookings by cut-off (passed, later today, tomorrow)."""
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
    return db.create_collection(f"tasks-{time.time_ns()}")


# December 2027: far from the dates other tests in this database use
def at(day, hour, minute=0):
    return datetime(2027, 12, day, hour, minute, tzinfo=VN_TZ)


def _booking(col_id, no, cutoff, status=None, **extra):
    bid = db.insert_booking(col_id, {"Booking No": no, "Vessel": "EVER OATH 1N", "Port Cargo Cut-off": cutoff, **extra})
    if status:
        db.set_booking_status([bid], status)
    return bid


def _nos(tasks, group, col_id=None):
    return [b["Booking No"] for b in tasks[group] if col_id is None or b["collection_id"] == col_id]


def test_open_bookings_split_into_late_today_and_tomorrow(col_id):
    _booking(col_id, "LATE-OLD", "01/12/2027 10:00", "stuffed")      # long gone, still not gated in
    _booking(col_id, "LATE", "10/12/2027 07:00", "dispatched")       # earlier today: late, not today
    _booking(col_id, "TODAY-2", "10/12/2027 18:00")
    _booking(col_id, "TODAY-1", "10/12/2027 09:30")
    _booking(col_id, "TOMORROW", "11/12/2027 06:00")
    _booking(col_id, "LATER", "12/12/2027 06:00")                    # the day after tomorrow: not listed
    _booking(col_id, "NO-CUTOFF", "")
    for status in ("gated_in", "done", "cancelled"):
        _booking(col_id, status.upper(), "10/12/2027 12:00", status)

    tasks = db.get_booking_tasks(col_id, at(10, 8))
    assert _nos(tasks, "late") == ["LATE-OLD", "LATE"]
    assert _nos(tasks, "today") == ["TODAY-1", "TODAY-2"]
    assert _nos(tasks, "tomorrow") == ["TOMORROW"]
    assert (tasks["date"], tasks["tomorrow_date"], tasks["generated_at"]) == ("10/12/2027", "11/12/2027", "10/12/2027 08:00")
    late = tasks["late"][1]
    assert (late["Trạng thái"], late["Hạn cut-off"], late["Cut-off cả ngày"]) == ("dispatched", "10/12/2027 07:00", False)
    assert tasks["today"][0]["Trạng thái"] == "new"                 # no status stored yet: still open


def test_eport_cutoff_wins_and_a_date_alone_is_due_all_day(col_id):
    moved = _booking(col_id, "MOVED", "10/12/2027 09:00")
    with db.get_connection() as conn:
        conn.execute("UPDATE bookings SET eport_cutoff = ? WHERE id = ?;", ("11/12/2027 14:00", moved))
    _booking(col_id, "ALL-DAY", "10/12/2027")

    tasks = db.get_booking_tasks(col_id, at(10, 8))
    assert _nos(tasks, "today") == ["ALL-DAY"] and _nos(tasks, "tomorrow") == ["MOVED"]
    assert tasks["tomorrow"][0]["Hạn cut-off"] == "11/12/2027 14:00"
    all_day = tasks["today"][0]
    assert (all_day["Hạn cut-off"], all_day["Cut-off cả ngày"]) == ("10/12/2027 23:59", True)


def test_one_collection_or_all_of_them(col_id):
    other = db.create_collection(f"tasks-other-{time.time_ns()}")
    _booking(col_id, "MINE", "10/12/2027 12:00")
    _booking(other, "THEIRS", "10/12/2027 13:00")

    assert _nos(db.get_booking_tasks(col_id, at(10, 8)), "today") == ["MINE"]
    everyone = db.get_booking_tasks(None, at(10, 8))
    mine = [b for b in everyone["today"] if b["collection_id"] in (col_id, other)]
    assert [(b["Booking No"], b["Bộ sưu tập"].startswith("tasks-other")) for b in mine] == [("MINE", False), ("THEIRS", True)]


def test_the_today_route(col_id):
    _booking(col_id, "TODAY", "31/12/2099 12:00")
    res = TestClient(app).get("/api/v1/bookings/today", params={"collection_id": col_id})
    assert res.status_code == 200
    body = res.json()
    assert set(body) >= {"date", "tomorrow_date", "generated_at", "late", "today", "tomorrow"}
    assert all(b["collection_id"] == col_id for g in ("late", "today", "tomorrow") for b in body[g])
    assert TestClient(app).get("/api/v1/bookings/today").status_code == 200
