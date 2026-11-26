"""Trucks (xe tải): fleet_vehicles rows of category "truck", next to the tractors (đầu kéo). They have drivers, papers,
trash and reminders like a tractor, but never a trailer."""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import fleet
from backend.app.core import fleet_trailers as trailers
from backend.app.core.timezone import VN_TZ
from backend.app.main import app
from backend.app.services import change_detection as cd

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "fleet.db"))
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")


def _by_plate():
    return {v["plate"]: v for v in fleet.list_vehicles()}


def test_a_truck_has_its_own_body_and_payload_and_a_tractor_is_the_default():
    fleet.create_vehicle({"plate": "51C-1"})
    fleet.create_vehicle({"plate": "51D-2", "category": "truck", "vehicle_type": "Hino 8T", "body_type": "Thùng kín",
                          "payload": "8 tấn"})
    v = _by_plate()
    assert v["51C-1"]["category"] == "tractor"
    assert (v["51D-2"]["category"], v["51D-2"]["body_type"], v["51D-2"]["payload"]) == ("truck", "Thùng kín", "8 tấn")
    with pytest.raises(fleet.FleetError):
        fleet.create_vehicle({"plate": "51D-3", "category": "bus"})


def test_the_category_stays_as_made():
    truck = fleet.create_vehicle({"plate": "51D-2", "category": "truck"})
    fleet.update_vehicle(truck, {"category": "tractor", "payload": "5 tấn"})
    assert (_by_plate()["51D-2"]["category"], _by_plate()["51D-2"]["payload"]) == ("truck", "5 tấn")


def test_a_truck_never_pulls_a_trailer():
    with pytest.raises(fleet.FleetError):
        fleet.create_vehicle({"plate": "51D-2", "category": "truck", "trailer_plate": "51R-1"})
    truck = fleet.create_vehicle({"plate": "51D-2", "category": "truck"})
    with pytest.raises(fleet.FleetError):
        fleet.update_vehicle(truck, {"trailer_plate": "51R-1"})
    fleet.update_vehicle(truck, {"trailer_plate": "", "note": "ok"})     # an empty trailer field is fine
    trailer = trailers.create_trailer({"plate": "51R-1"})
    with pytest.raises(fleet.FleetError) as e:
        trailers.hitch(trailer, truck)
    assert "xe tải" in e.value.message
    with pytest.raises(fleet.FleetError):
        trailers.create_trailer({"plate": "51R-2", "vehicle_id": truck})
    assert trailers.get_trailer(trailer)["vehicle"] is None


def test_a_driver_can_move_between_a_tractor_and_a_truck():
    tractor = fleet.create_vehicle({"plate": "51C-1"})
    truck = fleet.create_vehicle({"plate": "51D-2", "category": "truck"})
    an = fleet.create_driver({"name": "An"})
    fleet.assign_vehicle(an, tractor)
    fleet.set_vehicle_status(tractor, "broken", move_to_vehicle_id=truck)
    d = next(x for x in fleet.list_drivers() if x["id"] == an)
    assert d["current_vehicle"]["plate"] == "51D-2" and d["current_vehicle"]["category"] == "truck"


def test_history_by_category():
    tractor = fleet.create_vehicle({"plate": "51C-1"})
    truck = fleet.create_vehicle({"plate": "51D-2", "category": "truck"})
    fleet.assign_vehicle(fleet.create_driver({"name": "An"}), tractor)
    fleet.assign_vehicle(fleet.create_driver({"name": "Bình"}), truck)
    plates = lambda **kw: {r["vehicle_plate"] for r in fleet.history_page(**kw)["items"]}
    assert plates() == {"51C-1", "51D-2"}
    assert plates(category="tractor") == {"51C-1"}
    assert plates(category="truck") == {"51D-2"}
    res = client.get("/api/v1/fleet/history/page", params={"category": "truck"}).json()
    assert [r["vehicle_plate"] for r in res["items"]] == ["51D-2"]


def test_tractors_and_trucks_have_their_own_trash():
    tractor = fleet.create_vehicle({"plate": "51C-1"})
    truck = fleet.create_vehicle({"plate": "51D-2", "category": "truck"})
    fleet.delete_vehicle(tractor)
    fleet.delete_vehicle(truck)
    assert fleet.trash_count() == {"vehicle": 1, "truck": 1, "driver": 0, "trailer": 0}
    assert [r["plate"] for r in fleet.trash_page("truck")["items"]] == ["51D-2"]
    assert fleet.trash_ids("vehicle") == [tractor]
    assert fleet.restore_from_trash("vehicle", [truck]) == 0          # not a tractor
    assert fleet.restore_from_trash("truck", [truck]) == 1
    assert fleet.delete_from_trash("truck", [tractor]) == 0
    assert fleet.delete_from_trash("vehicle", [tractor]) == 1
    assert fleet.trash_count() == {"vehicle": 0, "truck": 0, "driver": 0, "trailer": 0}
    assert set(_by_plate()) == {"51D-2"}


def test_a_trucks_expiring_papers_open_the_truck_tab():
    fleet.create_vehicle({"plate": "51D-2", "category": "truck", "registration_expiry": "2026-11-20"})
    now = datetime(2026, 11, 16, 8, 0, tzinfo=VN_TZ)
    docs = fleet.expiring_documents(now.date())
    assert [(d["subject"], d["tab"]) for d in docs] == [("51D-2", "trucks")]
    assert fleet.scan_expiry_reminders(now) == 1
    with db.get_connection() as conn:
        assert conn.execute("SELECT nav_tab FROM notifications ORDER BY id DESC LIMIT 1;").fetchone()[0] == "trucks"


def test_old_databases_make_every_truck_a_tractor():
    fleet.create_vehicle({"plate": "51C-1"})
    with db.get_connection() as conn:
        for column in ("category", "body_type", "payload"):
            conn.execute(f"ALTER TABLE fleet_vehicles DROP COLUMN {column};")
        fleet.create_fleet_tables(conn)
    v = _by_plate()["51C-1"]
    assert (v["category"], v["body_type"], v["payload"]) == ("tractor", "", "")


def test_api_makes_a_truck_and_keeps_its_export_templates_apart():
    res = client.post("/api/v1/fleet/vehicles", json={"plate": "51D-2", "category": "truck", "payload": "8 tấn"})
    assert res.status_code == 200, res.text
    assert res.json()["category"] == "truck" and res.json()["payload"] == "8 tấn"
    cols = [{"key": "plate", "header": "Biển số"}]
    assert client.post("/api/v1/export/templates", json={"tab": "fleet_truck", "name": "Xe tải", "columns": cols}).status_code == 200
    assert client.get("/api/v1/export/templates", params={"tab": "fleet_vehicle"}).json() == []
