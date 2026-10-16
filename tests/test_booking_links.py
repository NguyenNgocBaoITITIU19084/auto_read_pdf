"""A booking's ePort vessel schedules and containers (shown in the booking detail)."""
import time

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app


@pytest.fixture(autouse=True)
def _db():
    db.init_db()


@pytest.fixture
def col_id():
    return db.create_collection(f"booking-links-{time.time_ns()}")


def _vessel(name, voyage, closing="14:00 16/10/2026", site="CTL"):
    return {"site_id": site, "agent": "SNK", "vessel_name": name, "in_out_voyage": voyage, "closing_time": closing}


def _event(cont, book, event_time, event_type="INGATE", fel="F", im_exp="EXPORT", **extra):
    return {"containerno": cont, "bill_book": book, "event_time": event_time, "event_type": event_type,
            "fel": fel, "im_exp": im_exp, "site_id": "CTL", **extra}


def test_vessels_match_vessel_and_voyage_at_every_site(col_id):
    db.insert_vessel_schedules(col_id, [
        _vessel("SHANGHAI VOYAGER", "2608N-2608N"),
        _vessel("SHANGHAI VOYAGER", "2608N-2608N", "EST (dự kiến): 10:00 17/10/2026", site="TNT"),
        _vessel("SHANGHAI VOYAGER", "2609N-2609N"),
        _vessel("OTHER SHIP", "2608N-2608N"),
    ])
    b = db.insert_booking(col_id, {"Booking No": "BK1", "Vessel": "SHANGHAI VOYAGER 2608N"})
    vessels = db.get_booking_links(b)["vessels"]
    assert [(v["site_id"], v["in_out_voyage"], v["closing_estimated"]) for v in vessels] == [
        ("CTL", "2608N-2608N", False),
        ("TNT", "2608N-2608N", True),
    ]


def test_no_vessel_means_no_schedules(col_id):
    db.insert_vessel_schedules(col_id, [_vessel("SHANGHAI VOYAGER", "2608N-2608N")])
    b = db.insert_booking(col_id, {"Booking No": "BK1", "Vessel": "null"})
    assert db.get_booking_links(b)["vessels"] == []


def test_containers_latest_event_each_with_gate_in_count(col_id):
    other = db.create_collection(f"booking-links-other-{time.time_ns()}")
    db.insert_containers(col_id, [
        _event("ABCU1111111", "bk1", "2026-10-14 08:00:00", "INGATE"),
        _event("ABCU1111111", " BK1 ", "2026-10-15 09:30:00", "LOAD TO VESSEL", location="V-1"),
        _event("ABCU2222222", "BK1", "2026-10-13 07:00:00", "OUTGATE", fel="E"),
        _event("ABCU3333333", "BK2", "2026-10-13 07:00:00"),
    ])
    db.insert_containers(other, [_event("ABCU4444444", "BK1", "2026-10-13 07:00:00")])
    b = db.insert_booking(col_id, {"Booking No": "BK1", "Q'ty": "3", "Vessel": ""})
    links = db.get_booking_links(b)
    assert [(c["containerno"], c["event_type"], c["gated_in"]) for c in links["containers"]] == [
        ("ABCU1111111", "LOAD TO VESSEL", True),
        ("ABCU2222222", "OUTGATE", False),
    ]
    assert links["containers"][0]["location"] == "V-1"
    assert "customs_status" in links["containers"][0]
    assert (links["gated_in"], links["qty"]) == (1, 3)


def test_blank_booking_number_has_no_containers(col_id):
    db.insert_containers(col_id, [_event("ABCU1111111", "", "2026-10-14 08:00:00")])
    b = db.insert_booking(col_id, {"Booking No": "", "Q'ty": "x"})
    links = db.get_booking_links(b)
    assert (links["containers"], links["gated_in"], links["qty"]) == ([], 0, None)


def test_links_endpoint(col_id):
    b = db.insert_booking(col_id, {"Booking No": "BK9"})
    client = TestClient(app)
    res = client.get(f"/api/v1/bookings/{b}/links")
    assert res.status_code == 200
    assert set(res.json()) == {"vessels", "containers", "gated_in", "qty"}
    assert client.get("/api/v1/bookings/999999999/links").status_code == 404
