"""Trailers: their own records, hitching to tractors, the tractor form's trailer plate, trash, photos, reminders."""
import io
import json
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import fleet
from backend.app.core import fleet_trailers as tr
from backend.app.core.timezone import VN_TZ
from backend.app.main import app
from backend.app.services import change_detection as cd

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "fleet.db"))
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")


def _trucks():
    return {v["plate"]: v for v in fleet.list_vehicles()}


def _trailers():
    return {t["plate"]: t for t in tr.list_trailers()}


def _open_hitches():
    with db.get_connection() as conn:
        return conn.execute("SELECT trailer_plate, vehicle_plate FROM fleet_trailer_hitches WHERE ended_at IS NULL "
                            "ORDER BY trailer_plate;").fetchall()


def test_a_trailer_has_its_own_record_and_checks_its_fields():
    t = tr.create_trailer({"plate": "51r-001.11", "trailer_type": "Sàn 40'", "chassis_no": "abc123", "payload": "32 tấn",
                           "year": "2019", "registration_expiry": "2027-01-31"})
    item = _trailers()["51R-001.11"]
    assert item["id"] == t and item["chassis_no"] == "ABC123" and item["year"] == "2019" and item["vehicle"] is None
    with pytest.raises(fleet.FleetError) as e:
        tr.create_trailer({"plate": "51R 00111"})
    assert e.value.status == 409
    for bad in ({"plate": ""}, {"plate": "51R-2", "year": "19"}, {"plate": "51R-2", "year": "1800"},
                {"plate": "51R-2", "registration_expiry": "31/12/2026"}, {"plate": "51R-2", "status": "flying"}):
        with pytest.raises(fleet.FleetError):
            tr.create_trailer(bad)


def test_hitching_moves_a_trailer_and_keeps_every_tractor_in_sync():
    a = fleet.create_vehicle({"plate": "51C-1"})
    b = fleet.create_vehicle({"plate": "51C-2", "trailer_plate": "51R-2"})
    t1 = tr.create_trailer({"plate": "51R-1", "vehicle_id": a})
    assert _trucks()["51C-1"]["trailer_plate"] == "51R-1"
    assert _trailers()["51R-2"]["vehicle"]["plate"] == "51C-2"       # made from the tractor form

    # 51R-1 onto 51C-2: off 51C-1, and 51R-2 off 51C-2
    moved = tr.hitch(t1, b, "Đổi moóc")
    assert moved == {"replaced": "51R-2", "from_plate": "51C-1"}
    assert _trucks()["51C-1"]["trailer_plate"] == "" and _trucks()["51C-2"]["trailer_plate"] == "51R-1"
    assert _open_hitches() == [("51R-1", "51C-2")]
    assert _trailers()["51R-2"]["vehicle"] is None
    hist = tr.hitch_history(trailer_id=t1)
    assert [(h["vehicle_plate"], h["ended_at"] is None) for h in hist] == [("51C-2", True), ("51C-1", False)]
    assert hist[1]["end_reason"] == "Chuyển sang đầu kéo 51C-2"

    tr.hitch(t1, None)
    assert _trucks()["51C-2"]["trailer_plate"] == "" and _open_hitches() == []


def test_the_tractor_form_hitches_by_plate_but_never_takes_another_tractors_trailer():
    a = fleet.create_vehicle({"plate": "51C-1", "trailer_plate": "51R-1"})
    b = fleet.create_vehicle({"plate": "51C-2"})
    with pytest.raises(fleet.FleetError) as e:
        fleet.update_vehicle(b, {"trailer_plate": "51r1"})
    assert e.value.status == 409 and "51C-1" in e.value.message
    with pytest.raises(fleet.FleetError):
        fleet.create_vehicle({"plate": "51C-3", "trailer_plate": "51R-1"})
    assert "51C-3" not in _trucks()                                     # nothing half-made

    fleet.update_vehicle(a, {"trailer_plate": "51R-9"})                # a new plate: a new trailer
    assert _trucks()["51C-1"]["trailer_plate"] == "51R-9"
    assert _trailers()["51R-1"]["vehicle"] is None
    fleet.update_vehicle(b, {"trailer_plate": "51R-1"})                # free now
    fleet.update_vehicle(a, {"trailer_plate": ""})
    assert _open_hitches() == [("51R-1", "51C-2")]
    fleet.update_vehicle(b, {"plate": "51C-22"})                       # the open hitch follows the new plate
    assert _open_hitches() == [("51R-1", "51C-22")]


def test_renaming_or_stopping_a_trailer_shows_on_its_tractor():
    a = fleet.create_vehicle({"plate": "51C-1", "trailer_plate": "51R-1"})
    t = _trailers()["51R-1"]["id"]
    tr.update_trailer(t, {"plate": "51R-111"})
    assert _trucks()["51C-1"]["trailer_plate"] == "51R-111"
    tr.update_trailer(t, {"status": "broken"})                          # broken: still on it
    assert _trucks()["51C-1"]["trailer_plate"] == "51R-111"
    tr.update_trailer(t, {"status": "inactive"})                        # out of service: off
    assert _trucks()["51C-1"]["trailer_plate"] == ""
    with pytest.raises(fleet.FleetError):
        tr.hitch(t, a)


def test_trash_unhitches_both_ways_and_restores_free():
    a = fleet.create_vehicle({"plate": "51C-1", "trailer_plate": "51R-1"})
    t = _trailers()["51R-1"]["id"]
    tr.delete_trailer(t)
    assert _trucks()["51C-1"]["trailer_plate"] == "" and "51R-1" not in _trailers()
    assert fleet.trash_count() == {"vehicle": 0, "driver": 0, "trailer": 1}
    with pytest.raises(fleet.FleetError) as e:
        fleet.update_vehicle(a, {"trailer_plate": "51R-1"})
    assert "thùng rác" in e.value.message
    assert fleet.restore_from_trash("trailer", [t]) == 1
    assert _trailers()["51R-1"]["vehicle"] is None

    tr.hitch(t, a)
    fleet.delete_vehicle(a)
    assert _trailers()["51R-1"]["vehicle"] is None
    b = fleet.create_vehicle({"plate": "51C-2", "trailer_plate": "51R-1"})   # no clash with the trashed tractor
    fleet.restore_from_trash("vehicle", [a])
    assert _trucks()["51C-1"]["trailer_plate"] == "" and _trucks()["51C-2"]["trailer_plate"] == "51R-1"
    assert b


def test_old_typed_trailer_plates_become_trailers_once():
    with db.get_connection() as conn:
        stamp = "2026-01-01 00:00:00"
        conn.executemany(
            "INSERT INTO fleet_vehicles (plate, plate_key, trailer_plate, trailer_key, created_at, updated_at, deleted_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?);",
            [("51C-1", "51C1", "51R-1", "51R1", stamp, stamp, None),
             ("51C-2", "51C2", "51R-2", "51R2", stamp, stamp, stamp)])     # in the trash
    db.init_db()
    db.init_db()                                                          # runs on every start: nothing twice
    trailers = _trailers()
    assert set(trailers) == {"51R-1", "51R-2"}
    assert trailers["51R-1"]["vehicle"]["plate"] == "51C-1" and trailers["51R-2"]["vehicle"] is None
    assert _open_hitches() == [("51R-1", "51C-1")]
    with db.get_connection() as conn:
        assert conn.execute("SELECT trailer_key FROM fleet_vehicles WHERE plate = '51C-2';").fetchone()[0] == ""


def test_trailer_documents_are_reminded_and_open_the_trailer_tab():
    tr.create_trailer({"plate": "51R-1", "registration_expiry": "2026-11-20"})
    tr.create_trailer({"plate": "51R-2", "insurance_expiry": "2026-11-20", "status": "inactive"})
    docs = fleet.expiring_documents(date(2026, 11, 15))
    assert [(d["kind"], d["entity"], d["subject"]) for d in docs] == [("trailer_registration", "trailer", "51R-1")]
    assert fleet.scan_expiry_reminders(datetime(2026, 11, 15, 8, 0, tzinfo=VN_TZ)) == 1
    with db.get_connection() as conn:
        nav_tab, title, detail = conn.execute(
            "SELECT nav_tab, title, detail FROM notifications WHERE kind = ?;", (cd.FLEET_EXPIRY,)).fetchone()
    assert nav_tab == "trailers" and title.startswith("Đăng kiểm moóc 51R-1")
    assert json.loads(detail)["documents"][0]["entity"] == "trailer"


def test_trailer_photo():
    from PIL import Image
    t = tr.create_trailer({"plate": "51R-1"})
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 20, 30)).save(buf, "PNG")
    name = fleet.set_photo("trailer", t, buf.getvalue())
    assert name.startswith(f"trailer_{t}_") and fleet.photo_path(name) is not None
    assert _trailers()["51R-1"]["photo"] == name
    fleet.remove_photo("trailer", t)
    assert fleet.photo_path(name) is None


def test_trailer_api():
    truck = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-1"}).json()
    res = client.post("/api/v1/fleet/trailers", json={"plate": "51r-1", "trailer_type": "Xương 40'", "vehicle_id": truck["id"]})
    assert res.status_code == 200, res.text
    t = res.json()
    assert t["plate"] == "51R-1" and t["vehicle"]["plate"] == "51C-1"
    assert client.post("/api/v1/fleet/trailers", json={"plate": "51R1"}).status_code == 409
    assert client.put(f"/api/v1/fleet/trailers/{t['id']}", json={"note": "Lốp mới"}).json()["note"] == "Lốp mới"
    off = client.post(f"/api/v1/fleet/trailers/{t['id']}/hitch", json={"vehicle_id": None}).json()
    assert off["vehicle"] is None
    on = client.post(f"/api/v1/fleet/trailers/{t['id']}/hitch", json={"vehicle_id": truck["id"], "reason": "Gắn lại"}).json()
    assert on["vehicle"]["plate"] == "51C-1" and on["replaced"] == ""
    page = client.get("/api/v1/fleet/trailers/history/page", params={"trailer_id": t["id"], "states": "closed"}).json()
    assert page["total"] == 1 and page["items"][0]["end_reason"] == "Tháo moóc"
    assert client.get("/api/v1/fleet/trailers/history/page", params={"q": "gan lai"}).json()["total"] == 1
    assert client.post("/api/v1/fleet/trailers/999/hitch", json={"vehicle_id": truck["id"]}).status_code == 404
    assert client.delete(f"/api/v1/fleet/trailers/{t['id']}").status_code == 200
    assert client.get("/api/v1/fleet/trash", params={"kind": "trailer"}).json()["items"][0]["plate"] == "51R-1"
    assert client.get("/api/v1/export/templates", params={"tab": "fleet_trailer"}).status_code == 200
