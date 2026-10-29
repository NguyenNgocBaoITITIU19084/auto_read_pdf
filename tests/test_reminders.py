"""Cut-off reminders (24h / 6h / 2h) and the morning brief."""
import json
import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core.timezone import VN_TZ
from backend.app.main import app
from backend.app.services import change_detection as cd


@pytest.fixture(autouse=True)
def _db():
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")
    db.set_system_setting("notify_last_brief_date", "")


@pytest.fixture
def col_id():
    return db.create_collection(f"reminders-{time.time_ns()}")


def _booking(col_id, no, cutoff, vessel="EVER OATH 1N", **extra):
    return db.insert_booking(col_id, {"Booking No": no, "Vessel": vessel, "Port Cargo Cut-off": cutoff, **extra})


def _notes(kind, col_id=None):
    with db.get_connection() as conn:
        rows = db._select_dicts(conn, "SELECT * FROM notifications WHERE kind = ? ORDER BY id;", (kind,))
    rows = [r for r in rows if col_id is None or r["collection_id"] == col_id]
    for r in rows:
        r["detail"] = json.loads(r["detail"] or "{}")
    return rows


def at(day, hour, minute=0):
    return datetime(2026, 11, day, hour, minute, tzinfo=VN_TZ)


# --- cut-off reminders ---------------------------------------------------------------------------------------
def test_reminders_fire_once_per_threshold(col_id):
    _booking(col_id, "BK1", "20/11/2026 14:00")
    scan = lambda now: db.scan_cutoff_reminders(now, [col_id])
    assert scan(at(19, 9)) == 0                     # 29h left
    assert scan(at(19, 15)) == 1                    # 23h -> 24h reminder
    assert scan(at(19, 16)) == 0                    # already sent
    assert scan(at(20, 9)) == 1                     # 5h -> 6h reminder
    assert scan(at(20, 12, 30)) == 1                # 1.5h -> 2h reminder
    assert scan(at(20, 13)) == 0
    assert scan(at(20, 15)) == 0                    # overdue: left to the late flag
    notes = _notes(cd.BOOKING_CUTOFF, col_id)
    assert [n["detail"]["hours"] for n in notes] == [24, 6, 2]
    assert notes[0]["title"] == "Cut-off còn 24 giờ: BK1"
    assert notes[0]["nav_tab"] == "booking" and notes[0]["nav_query"] == "BK1"
    assert notes[0]["source"] == db.NOTIFY_SOURCE_AUTO


def test_only_the_tightest_threshold_when_first_seen_late(col_id):
    _booking(col_id, "BK2", "20/11/2026 14:00")
    assert db.scan_cutoff_reminders(at(20, 12, 30), [col_id]) == 1
    assert [n["detail"]["hours"] for n in _notes(cd.BOOKING_CUTOFF, col_id)] == [2]


def test_clearing_read_notifications_does_not_bring_reminders_back(col_id):
    _booking(col_id, "BK3", "20/11/2026 14:00")
    assert db.scan_cutoff_reminders(at(20, 9), [col_id]) == 1
    db.mark_notifications_read()
    db.clear_notifications(read_only=True)
    assert db.scan_cutoff_reminders(at(20, 9, 5), [col_id]) == 0


def test_a_new_cutoff_rearms_the_reminders(col_id):
    b = _booking(col_id, "BK4", "20/11/2026 14:00")
    assert db.scan_cutoff_reminders(at(20, 9), [col_id]) == 1
    db.update_booking(b, {"Port Cargo Cut-off": "20/11/2026 18:00"})
    assert db.scan_cutoff_reminders(at(20, 9, 5), [col_id]) == 1


def test_closed_and_gated_in_bookings_are_not_reminded(col_id):
    done = _booking(col_id, "BK5", "20/11/2026 14:00")
    gated = _booking(col_id, "BK6", "20/11/2026 14:00")
    db.set_booking_status([done], "done")
    db.set_booking_status([gated], "gated_in")
    assert db.scan_cutoff_reminders(at(20, 9), [col_id]) == 0


def test_bookings_of_one_vessel_share_a_reminder(col_id):
    _booking(col_id, "A1", "20/11/2026 14:00", vessel="WAN HAI 286 S115")
    _booking(col_id, "A2", "20/11/2026 14:00", vessel="wan hai 286  s115")
    _booking(col_id, "B1", "20/11/2026 14:00", vessel="OTHER 1N")
    assert db.scan_cutoff_reminders(at(20, 9), [col_id]) == 2
    grouped = [n for n in _notes(cd.BOOKING_CUTOFF, col_id) if n["detail"]["count"] == 2][0]
    assert grouped["detail"]["bookings"] == ["A1", "A2"]
    assert grouped["title"] == "Cut-off còn 6 giờ: 2 booking"


def test_reminders_respect_the_kind_toggle(col_id):
    _booking(col_id, "BK7", "20/11/2026 14:00")
    db.set_notification_settings([k for k in cd.ALL_KINDS if k != cd.BOOKING_CUTOFF], True)
    assert db.scan_cutoff_reminders(at(20, 9), [col_id]) == 0


# --- morning brief -------------------------------------------------------------------------------------------
def test_morning_brief_once_a_day_in_its_window(col_id):
    _booking(col_id, "TODAY1", "21/11/2026 16:00")
    _booking(col_id, "TODAY2", "21/11/2026 10:00")
    _booking(col_id, "LATE", "20/11/2026 10:00")
    _booking(col_id, "TOMORROW", "22/11/2026")
    done = _booking(col_id, "DONE", "21/11/2026 11:00")
    db.set_booking_status([done], "done")
    brief = lambda now: db.maybe_send_morning_brief(now, [col_id])
    assert brief(at(21, 7, 0)) is False             # before 07:30
    assert brief(at(21, 13, 0)) is False            # after the window
    assert brief(at(21, 8, 0)) is True
    assert brief(at(21, 9, 0)) is False             # already sent today
    note = [n for n in _notes(cd.MORNING_BRIEF) if n["entity_key"] == "brief|2026-11-21"][0]
    d = note["detail"]
    assert (d["today"], d["late"], d["tomorrow"]) == (2, 1, 1)
    assert [i["booking_no"] for i in d["items"]] == ["TODAY2", "TODAY1"]
    assert note["title"] == "Bản tin sáng 21/11"
    assert note["new_value"].startswith("2 cut-off hôm nay · 1 trễ · 1 ngày mai")


def test_morning_brief_follows_its_time_and_toggle(col_id):
    db.set_notification_settings(cd.ALL_KINDS, True, "09:15")
    assert db.maybe_send_morning_brief(at(22, 8, 0), [col_id]) is False
    assert db.maybe_send_morning_brief(at(22, 9, 20), [col_id]) is True
    db.set_system_setting("notify_last_brief_date", "")
    db.set_notification_settings([k for k in cd.ALL_KINDS if k != cd.MORNING_BRIEF], True)
    assert db.maybe_send_morning_brief(at(23, 9, 20), [col_id]) is False


def test_brief_survives_cleared_notifications(col_id):
    assert db.maybe_send_morning_brief(at(24, 8), [col_id]) is True
    db.mark_notifications_read()
    db.clear_notifications(read_only=True)
    assert db.maybe_send_morning_brief(at(24, 9), [col_id]) is False


# --- settings and desktop popups -----------------------------------------------------------------------------
def test_new_kinds_are_on_for_settings_saved_before_them():
    db.set_system_setting("notify_kinds", json.dumps(["container_customs"]))
    db.set_system_setting("notify_kinds_known", "")
    kinds = db.get_notification_settings()["kinds"]
    assert kinds == {"container_customs", cd.BOOKING_CUTOFF, cd.MORNING_BRIEF, cd.BOOKING_AUTO_IMPORT}
    db.set_notification_settings(["container_customs"], True)   # now offered and left off
    assert db.get_notification_settings()["kinds"] == {"container_customs"}


def test_brief_time_kept_when_omitted_and_validated():
    db.set_notification_settings(cd.ALL_KINDS, True, "6:05")
    assert db.get_notification_settings()["brief_time"] == "06:05"
    db.set_notification_settings(cd.ALL_KINDS, False)
    assert db.get_notification_settings()["brief_time"] == "06:05"
    client = TestClient(app)
    bad = client.put("/api/v1/notifications/settings", json={"kinds": [], "os_enabled": True, "brief_time": "25:00"})
    assert bad.status_code == 400
    ok = client.put("/api/v1/notifications/settings", json={"kinds": list(cd.ALL_KINDS), "os_enabled": True})
    assert ok.json()["brief_time"] == "06:05"


def test_desktop_summary_handles_reminders_with_other_kinds():
    rows = [
        {"kind": cd.BOOKING_CUTOFF, "nav_tab": "booking", "nav_query": "A", "id": 1},
        {"kind": cd.MORNING_BRIEF, "nav_tab": "booking", "nav_query": None, "id": 2},
    ]
    only = db._summarize_for_os(rows)
    assert only["title"] == "2 nhắc việc" and "nhắc cut-off" in only["body"] and "bản tin sáng" in only["body"]
    mixed = db._summarize_for_os([*rows, {"kind": cd.CONTAINER_INGATE, "nav_tab": "container", "nav_query": "C", "id": 3}])
    assert mixed["title"] == "3 thay đổi mới"
