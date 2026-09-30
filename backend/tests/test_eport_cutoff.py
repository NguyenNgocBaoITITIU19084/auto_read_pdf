from datetime import datetime

import pytest
from backend.app.core import database as db

ORIGINAL = "20/09/2026 03:00"


def _schedule(name="HMM HOPE", voyage="062E-062E", closing="2026-09-23 11:00:00"):
    return {"site_id": "CTL", "vessel_name": name, "in_out_voyage": voyage, "closing_time": closing}


def _booking(col, no="BK1", vessel="HMM HOPE 062E(EC2)", cutoff=ORIGINAL):
    return db.insert_booking(col, {"Booking No": no, "Vessel": vessel, "Port Cargo Cut-off": cutoff})


def _row(booking_id):
    return db.get_bookings_by_ids([booking_id])[0]


@pytest.fixture
def col(fresh_db):
    return db.create_collection("cutoff test")


def test_lookup_fills_eport_cutoff_and_keeps_original(col):
    b = _booking(col)
    assert _row(b)["Cut-off ePort"] == ""
    db.insert_vessel_schedules(col, [_schedule()])
    row = _row(b)
    assert row["Cut-off ePort"] == "23/09/2026 11:00"
    assert row["Cut-off ePort cập nhật"]
    assert row["Port Cargo Cut-off"] == ORIGINAL          # the booking's own value is never overwritten


def test_relookup_updates_when_eport_changes_the_time(col):
    b = _booking(col)
    db.insert_vessel_schedules(col, [_schedule()])
    db.insert_vessel_schedules(col, [_schedule(closing="2026-09-24 09:00:00")])   # same row, replaced
    assert _row(b)["Cut-off ePort"] == "24/09/2026 09:00"


def test_booking_added_after_the_lookup_gets_it_too(col):
    db.insert_vessel_schedules(col, [_schedule()])
    assert _row(_booking(col))["Cut-off ePort"] == "23/09/2026 11:00"


def test_unrelated_or_placeholder_data_is_not_written(col):
    other = _booking(col, "BK2", vessel="WAN HAI 31 E246")
    db.insert_vessel_schedules(col, [_schedule(), _schedule("WAN HAI 317", "E246-W247", "/Date(-2209017600000)/")])
    assert _row(other)["Cut-off ePort"] == ""


def test_other_collections_are_not_mixed(col):
    other_col = db.create_collection("another")
    b = _booking(other_col)
    db.insert_vessel_schedules(col, [_schedule()])
    assert _row(b)["Cut-off ePort"] == ""


def test_changing_the_vessel_drops_the_old_cutoff(col):
    b = _booking(col)
    db.insert_vessel_schedules(col, [_schedule()])
    db.update_booking(b, {"Vessel": "MSC VENICE FV638N"})
    assert _row(b)["Cut-off ePort"] == ""
    db.update_booking(b, {"Vessel": "HMM HOPE 062E"})
    assert _row(b)["Cut-off ePort"] == "23/09/2026 11:00"


def test_editing_other_fields_keeps_it(col):
    b = _booking(col)
    db.insert_vessel_schedules(col, [_schedule()])
    db.update_booking(b, {"Ghi chú": "gọi khách"})
    assert _row(b)["Cut-off ePort"] == "23/09/2026 11:00"


def test_edit_form_cannot_overwrite_the_derived_value(col):
    b = _booking(col)
    db.insert_vessel_schedules(col, [_schedule()])
    db.update_booking(b, {"Cut-off ePort": "01/01/2030 00:00", "eport_cutoff": "01/01/2030 00:00"})
    assert _row(b)["Cut-off ePort"] == "23/09/2026 11:00"


def test_backup_restore_and_move_keep_it(col):
    b = _booking(col)
    db.insert_vessel_schedules(col, [_schedule()])
    backup = db.export_backup_data()
    db.clear_bookings(col)
    db.import_backup_data(backup)
    restored = db.get_bookings(col)
    assert [r["Cut-off ePort"] for r in restored] == ["23/09/2026 11:00"]

    target = db.create_collection("target")
    db.move_items_to_collection("bookings", [restored[0]["id"]], target, copy=True)
    assert db.get_bookings(target)[0]["Cut-off ePort"] == "23/09/2026 11:00"


NOW = datetime(2026, 9, 21, 8, 0)


def _alerts(col):
    return db.get_dashboard_summary(collection_id=col, now=NOW)["alerts"]["critical_cutoffs"]


def test_alert_uses_eport_time_when_original_already_passed(col):
    _booking(col)                                         # original 20/09 03:00 is in the past
    assert _alerts(col) == []
    db.insert_vessel_schedules(col, [_schedule()])        # ePort: 23/09 11:00 -> upcoming
    (alert,) = _alerts(col)
    assert alert["cutoff_time"] == "23/09/2026 11:00"
    assert alert["cutoff_source"] == "eport"
    assert alert["original_cutoff"] == ORIGINAL


def test_alert_drops_a_booking_whose_eport_time_is_over(col):
    _booking(col, cutoff="25/09/2026 12:00")
    assert len(_alerts(col)) == 1
    db.insert_vessel_schedules(col, [_schedule(closing="2026-09-20 11:00:00")])   # ePort says it already closed
    assert _alerts(col) == []


def test_alert_without_lookup_is_unchanged(col):
    _booking(col, cutoff="25/09/2026 12:00")
    (alert,) = _alerts(col)
    assert (alert["cutoff_time"], alert["cutoff_source"], alert["original_cutoff"]) == ("25/09/2026 12:00", "booking", None)


def test_alert_has_no_original_when_times_agree(col):
    _booking(col, cutoff="23/09/2026 11:00")
    db.insert_vessel_schedules(col, [_schedule()])
    (alert,) = _alerts(col)
    assert alert["cutoff_source"] == "eport" and alert["original_cutoff"] is None


def test_api_flow_lookup_updates_booking_list_and_dashboard(fresh_db, monkeypatch):
    from fastapi.testclient import TestClient
    import backend.app.api.vessels as vessels_api
    from backend.app.main import app

    col = db.create_collection("api flow")
    _booking(col, cutoff="18/09/2026 03:00")
    monkeypatch.setattr(vessels_api, "search_vessels_detailed", lambda *a, **k: {
        "items": [_schedule()], "reason": "ok", "message": "", "available_voyages": []})

    client = TestClient(app)
    res = client.post("/api/v1/vessels/search", json={"collection_id": col, "site_id": "CTL", "vessel_name": "HMM HOPE",
                                                 "voyage": "062E"})
    assert res.status_code == 200 and res.json()["count"] == 1

    (item,) = client.get("/api/v1/bookings", params={"collection_id": col}).json()
    assert item["Cut-off ePort"] == "23/09/2026 11:00"
    assert item["Port Cargo Cut-off"] == "18/09/2026 03:00"

    put = client.put(f"/api/v1/bookings/{item['id']}", json={"booking": {"Ghi chú": "x"}})
    assert put.status_code == 200 and put.json()["item"]["Cut-off ePort"] == "23/09/2026 11:00"


def test_startup_backfills_bookings_for_vessels_looked_up_earlier(col):
    b = _booking(col)
    with db.get_connection() as conn:   # a schedule stored the way old versions did: no sync ran
        db._insert_vessel_rows(conn.cursor(), col, [_schedule()], "2026-09-01 00:00:00")
    assert _row(b)["Cut-off ePort"] == ""
    db.init_db()
    assert _row(b)["Cut-off ePort"] == "23/09/2026 11:00"
