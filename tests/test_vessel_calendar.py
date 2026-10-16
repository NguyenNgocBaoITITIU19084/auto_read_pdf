"""Week calendar of vessel schedules by closing time (cắt máng), with the collection's bookings per vessel."""
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
    return db.create_collection(f"vessel-cal-{time.time_ns()}")


def _vessel(name, voyage, closing, site="CTL"):
    return {"site_id": site, "agent": "SNK", "vessel_name": name, "in_out_voyage": voyage, "closing_time": closing}


NOW = datetime(2026, 10, 16, 9, 0, tzinfo=VN_TZ)


def test_vessels_by_closing_time_with_state(col_id):
    db.insert_vessel_schedules(col_id, [
        _vessel("LATER SHIP", "002S", "18:00 21/10/2026"),
        _vessel("SOON SHIP", "001N", "EST (dự kiến): 14:00 16/10/2026"),
        _vessel("PAST SHIP", "003N", "08:00 15/10/2026"),
        _vessel("NEXT WEEK", "004N", "08:00 27/10/2026"),
        _vessel("NO TIME", "005N", ""),
    ])
    res = db.get_vessel_calendar(col_id, "2026-10-12", "2026-10-18", now=NOW)
    assert [(i["vessel_name"], i["calendar_deadline"], i["closing_state"], i["closing_estimated"]) for i in res["items"]] == [
        ("PAST SHIP", "2026-10-15 08:00", "closed", False),
        ("SOON SHIP", "2026-10-16 14:00", "soon", True),
    ]
    later = db.get_vessel_calendar(col_id, "2026-10-19", "2026-10-25", now=NOW)["items"]
    assert [(i["vessel_name"], i["closing_state"]) for i in later] == [("LATER SHIP", "open")]
    assert res["undated"] == 1


def test_vessel_card_counts_its_bookings(col_id):
    db.insert_vessel_schedules(col_id, [_vessel("SHANGHAI VOYAGER", "2608N-2608N", "14:00 16/10/2026")])
    a = db.insert_booking(col_id, {"Booking No": "A", "Vessel": "SHANGHAI VOYAGER 2608N"})
    db.insert_booking(col_id, {"Booking No": "B", "Vessel": "SHANGHAI VOYAGER 2608N"})
    db.insert_booking(col_id, {"Booking No": "C", "Vessel": "OTHER SHIP 1N"})
    db.set_booking_status([a], "done")
    item = db.get_vessel_calendar(col_id, "2026-10-12", "2026-10-18", now=NOW)["items"][0]
    assert (item["booking_count"], item["booking_open_count"]) == (2, 1)


def test_vessel_calendar_search_and_bad_dates(col_id):
    db.insert_vessel_schedules(col_id, [_vessel("ALPHA", "1N", "10:00 16/10/2026"),
                                        _vessel("BETA", "2N", "11:00 16/10/2026")])
    names = [i["vessel_name"] for i in db.get_vessel_calendar(col_id, "2026-10-12", "2026-10-18", "BETA")["items"]]
    assert names == ["BETA"]
    client = TestClient(app)
    res = client.get("/api/v1/vessels/calendar", params={"collection_id": col_id, "date_from": "x", "date_to": "y"})
    assert res.status_code == 400
    ok = client.get("/api/v1/vessels/calendar", params={"collection_id": col_id, "date_from": "2026-10-12", "date_to": "2026-10-18"})
    assert ok.status_code == 200 and len(ok.json()["items"]) == 2
