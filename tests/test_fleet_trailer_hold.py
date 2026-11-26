"""Ghép / tháo rơ moóc from the tractor, and the hold: a hitched trailer that cannot run keeps its tractor in
"not_ready" (Không sẵn sàng) until it comes off or runs again, when the tractor gets its own status back."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import fleet
from backend.app.core import fleet_trailers as tr
from backend.app.core.timezone import VN_TZ
from backend.app.main import app
from backend.app.services import change_detection as cd

client = TestClient(app)
TODAY = datetime.now(VN_TZ).date()
SOON = (TODAY + timedelta(days=3)).isoformat()
LATER = (TODAY + timedelta(days=400)).isoformat()


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "fleet.db"))
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")


def _v(plate):
    return next(v for v in fleet.list_vehicles() if v["plate"] == plate)


def _driver_on(plate):
    return (_v(plate)["current_driver"] or {}).get("name")


def _rig(status="active"):
    """Tractor 51C-1 (status), driven by An, pulling trailer 51R-1."""
    v = fleet.create_vehicle({"plate": "51C-1", "status": status})
    t = tr.create_trailer({"plate": "51R-1", "vehicle_id": v})
    d = fleet.create_driver({"name": "An"})
    fleet.assign_vehicle(d, v) if status in ("ready", "active") else None
    return v, t, d


@pytest.mark.parametrize("trailer_status", ["broken", "maintenance", "not_ready", "inactive"])
def test_only_a_trailer_that_can_run_is_hitched(trailer_status):
    v = fleet.create_vehicle({"plate": "51C-1"})
    t = tr.create_trailer({"plate": "51R-1", "status": trailer_status})
    with pytest.raises(fleet.FleetError) as e:
        tr.hitch_vehicle(v, t)
    assert e.value.status == 409 and "chỉ ghép được moóc sẵn sàng hoặc đang dùng" in e.value.message
    with pytest.raises(fleet.FleetError):
        fleet.update_vehicle(v, {"trailer_plate": "51R-1"})
    with pytest.raises(fleet.FleetError):
        tr.create_trailer({"plate": "51R-2", "status": trailer_status, "vehicle_id": v})
    assert _v("51C-1")["trailer"] is None


@pytest.mark.parametrize("trailer_status", ["ready", "active"])
def test_the_tractor_hitches_and_unhitches_a_trailer(trailer_status):
    v = fleet.create_vehicle({"plate": "51C-1"})
    t = tr.create_trailer({"plate": "51R-1", "status": trailer_status})
    tr.hitch_vehicle(v, t)
    assert _v("51C-1")["trailer"]["id"] == t and _v("51C-1")["trailer_plate"] == "51R-1"
    assert tr.hitch_vehicle(v, None)["replaced"] == "51R-1"
    assert _v("51C-1")["trailer"] is None and _v("51C-1")["trailer_plate"] == ""
    with pytest.raises(fleet.FleetError):                       # nothing left to take off
        tr.hitch_vehicle(v, None)


@pytest.mark.parametrize("trailer_status", ["broken", "maintenance", "not_ready", "inactive"])
def test_a_stopped_trailer_holds_its_tractor_and_unhitching_gives_its_status_back(trailer_status):
    v, t, _ = _rig("active")                                    # An drives it: Đang chạy
    tr.update_trailer(t, {"status": trailer_status})
    item = _v("51C-1")
    assert (item["status"], item["trailer_hold_status"], item["trailer"]["status"]) == ("not_ready", "active",
                                                                                         trailer_status)
    assert _driver_on("51C-1") == "An"                          # the driver stays on it
    tr.hitch_vehicle(v, None)
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("active", "")
    assert _driver_on("51C-1") == "An"


def test_a_held_tractor_whose_driver_left_comes_back_ready():
    v, t, d = _rig("active")
    tr.update_trailer(t, {"status": "broken"})
    fleet.revoke_vehicle(d)                                     # taken back while held
    tr.hitch_vehicle(v, None)
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("ready", "")


def test_the_trailer_running_again_lets_the_tractor_go():
    v, t, _ = _rig("active")
    tr.update_trailer(t, {"status": "maintenance"})
    assert _v("51C-1")["status"] == "not_ready"
    tr.update_trailer(t, {"status": "broken"})                   # still stopped: still held, its own status kept
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("not_ready", "active")
    tr.update_trailer(t, {"status": "ready"})
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("active", "")


@pytest.mark.parametrize("release", ["unhitch_trailer", "swap", "form_blank", "trash"])
def test_every_way_the_trailer_comes_off_lets_the_tractor_go(release):
    v, t, _ = _rig("ready")
    spare = tr.create_trailer({"plate": "51R-9"})
    tr.update_trailer(t, {"status": "broken"})
    if release == "unhitch_trailer":
        tr.hitch(t, None)
    elif release == "swap":
        tr.hitch_vehicle(v, spare)
    elif release == "form_blank":
        fleet.update_vehicle(v, {"trailer_plate": "", "status": "not_ready"})   # the form's stale status is no change
    else:
        tr.delete_trailer(t)
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("active", "")    # An still drives it


def test_a_tractor_that_is_not_running_is_not_held_and_keeps_its_status():
    v, t, _ = _rig("maintenance")
    tr.update_trailer(t, {"status": "broken"})
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("maintenance", "")
    tr.hitch_vehicle(v, None)
    assert _v("51C-1")["status"] == "maintenance"


def test_a_held_tractor_cannot_be_set_running_by_hand_but_can_be_stopped():
    v, t, _ = _rig("active")
    tr.update_trailer(t, {"status": "broken"})
    for status in ("ready", "active"):
        with pytest.raises(fleet.FleetError) as e:
            fleet.set_vehicle_status(v, status)
        assert e.value.status == 409 and "tháo moóc trước" in e.value.message
    fleet.set_vehicle_status(v, "maintenance")                    # picked by hand: that one stays, the hold is gone
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("maintenance", "")
    tr.hitch_vehicle(v, None)
    assert _v("51C-1")["status"] == "maintenance"


def test_the_paper_lock_and_the_hold_together():
    v = fleet.create_vehicle({"plate": "51C-1", "status": "active", "registration_expiry": SOON})
    t = tr.create_trailer({"plate": "51R-1", "vehicle_id": v})
    d = fleet.create_driver({"name": "An"})
    fleet.assign_vehicle(d, v)
    tr.update_trailer(t, {"status": "broken"})
    # its own papers run out while held: nothing moves now, and coming off it is the paper lock's not_ready
    assert fleet.enforce_vehicle_papers(v, TODAY + timedelta(days=10)) is None
    with db.get_connection() as conn:                             # as if the date had passed
        conn.execute("UPDATE fleet_vehicles SET registration_expiry = ? WHERE id = ?;",
                     ((TODAY - timedelta(days=1)).isoformat(), v))
    tr.hitch_vehicle(v, None)
    item = _v("51C-1")
    assert (item["status"], item["status_forced"], item["trailer_hold_status"]) == ("not_ready", 1, "")
    assert _driver_on("51C-1") is None                            # as for any paper lock


def test_renewed_papers_while_held_wait_for_the_trailer():
    v = fleet.create_vehicle({"plate": "51C-1", "registration_expiry": (TODAY - timedelta(days=1)).isoformat()})
    assert _v("51C-1")["status"] == "not_ready"                   # forced by its papers, not held
    t = tr.create_trailer({"plate": "51R-1", "vehicle_id": v})
    tr.update_trailer(t, {"status": "broken"})
    fleet.update_vehicle(v, {"registration_expiry": LATER})       # renewed: still held by the broken trailer
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("not_ready", "ready")
    tr.update_trailer(t, {"status": "ready"})
    assert (_v("51C-1")["status"], _v("51C-1")["status_forced"]) == ("ready", 0)


def test_a_hold_from_before_is_picked_up_on_start():
    v, t, _ = _rig("active")
    with db.get_connection() as conn:                             # a trailer that stopped before the hold existed
        conn.execute("UPDATE fleet_trailers SET status = 'broken' WHERE id = ?;", (t,))
    db.init_db()
    assert (_v("51C-1")["status"], _v("51C-1")["trailer_hold_status"]) == ("not_ready", "active")


def test_vehicle_trailer_api():
    v = fleet.create_vehicle({"plate": "51C-1"})
    good = tr.create_trailer({"plate": "51R-1"})
    bad = tr.create_trailer({"plate": "51R-2", "status": "broken"})
    res = client.post(f"/api/v1/fleet/vehicles/{v}/trailer", json={"trailer_id": bad})
    assert res.status_code == 409
    res = client.post(f"/api/v1/fleet/vehicles/{v}/trailer", json={"trailer_id": good})
    assert res.status_code == 200 and res.json()["trailer"]["plate"] == "51R-1"
    res = client.post(f"/api/v1/fleet/vehicles/{v}/trailer", json={"trailer_id": None})
    assert res.status_code == 200 and res.json()["trailer"] is None and res.json()["replaced"] == "51R-1"
    assert client.post(f"/api/v1/fleet/vehicles/{v}/trailer", json={}).status_code == 400


# ---------------------------------------------------------------------------
# Hạng bằng lái: a tractor needs FC / CE, a truck a class covering C
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("license_class,tractor_ok,truck_ok", [
    ("FC", True, True), ("CE", True, True), ("b2, fc", True, True), (" fc ", True, True),
    ("C", False, True), ("E", False, True), ("FE", False, True),
    ("C1", False, False), ("B2", False, False), ("B", False, False), ("D", False, False), ("", False, False),
])
def test_the_licence_class_decides_which_trucks_a_driver_may_drive(license_class, tractor_ok, truck_ok):
    """A truck with no gross weight entered takes only the classes that drive any truck."""
    tractor = fleet.create_vehicle({"plate": "51C-1"})
    truck = fleet.create_vehicle({"plate": "51D-1", "category": "truck"})
    d = fleet.create_driver({"name": "An", "license_class": license_class})
    for vehicle_id, ok in ((tractor, tractor_ok), (truck, truck_ok)):
        if ok:
            fleet.assign_vehicle(d, vehicle_id)
        else:
            with pytest.raises(fleet.FleetError) as e:
                fleet.assign_vehicle(d, vehicle_id)
            assert e.value.status == 409 and "cần bằng" in e.value.message


def test_a_breakdown_moves_the_driver_only_to_a_spare_their_licence_allows():
    broken = fleet.create_vehicle({"plate": "51D-1", "category": "truck"})
    tractor = fleet.create_vehicle({"plate": "51C-9"})
    d = fleet.create_driver({"name": "Bình", "license_class": "C"})
    fleet.assign_vehicle(d, broken)
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_vehicle_status(broken, "broken", move_to_vehicle_id=tractor)
    assert e.value.status == 409 and "FC/CE" in e.value.message
    assert _driver_on("51D-1") == "Bình" and _v("51D-1")["status"] == "active"      # nothing moved


def test_a_driver_on_a_truck_their_licence_does_not_allow_is_listed_with_their_class():
    v = fleet.create_vehicle({"plate": "51C-1"})
    d = fleet.create_driver({"name": "An"})
    fleet.assign_vehicle(d, v)
    fleet.update_driver(d, {"license_class": "C"})                # the true class is saved; the office reassigns
    assert _v("51C-1")["current_driver"]["license_class"] == "C"
    assert not fleet.license_allows("C", {"category": "tractor"})


# ---------------------------------------------------------------------------
# Sẵn sàng / Đang chạy (moóc: Đang dùng) follow use
# ---------------------------------------------------------------------------
def test_a_truck_is_running_when_driven_and_ready_when_free():
    v = fleet.create_vehicle({"plate": "51C-1", "status": "active"})
    assert _v("51C-1")["status"] == "ready"
    d = fleet.create_driver({"name": "An"})
    fleet.assign_vehicle(d, v)
    assert _v("51C-1")["status"] == "active"
    fleet.set_vehicle_status(v, "ready")                          # picking the other one changes nothing
    assert _v("51C-1")["status"] == "active"
    fleet.revoke_vehicle(d)
    assert _v("51C-1")["status"] == "ready"
    fleet.set_vehicle_status(v, "active")
    assert _v("51C-1")["status"] == "ready"
    fleet.set_vehicle_status(v, "maintenance")                    # a stop is picked by hand as before
    assert _v("51C-1")["status"] == "maintenance"


def test_a_trailer_is_in_use_when_hitched_and_ready_when_free():
    v = fleet.create_vehicle({"plate": "51C-1"})
    t = tr.create_trailer({"plate": "51R-1"})
    assert next(x for x in tr.list_trailers() if x["id"] == t)["status"] == "ready"
    tr.hitch_vehicle(v, t)
    assert next(x for x in tr.list_trailers() if x["id"] == t)["status"] == "active"
    tr.update_trailer(t, {"status": "ready"})
    assert next(x for x in tr.list_trailers() if x["id"] == t)["status"] == "active"
    tr.hitch_vehicle(v, None)
    assert next(x for x in tr.list_trailers() if x["id"] == t)["status"] == "ready"


def test_statuses_picked_by_hand_before_are_put_right_on_start():
    fleet.create_vehicle({"plate": "51C-1"})
    tr.create_trailer({"plate": "51R-1"})
    with db.get_connection() as conn:
        conn.execute("UPDATE fleet_vehicles SET status = 'active';")
        conn.execute("UPDATE fleet_trailers SET status = 'active';")
    db.init_db()
    assert _v("51C-1")["status"] == "ready"
    assert tr.list_trailers()[0]["status"] == "ready"


# ---------------------------------------------------------------------------
# Xe tải: the classes follow its khối lượng toàn bộ (gross weight) and tải trọng (payload)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("gross,payload,allowed,refused", [
    (3400, "1.9 tấn", {"B", "B2", "C1", "C", "FC"}, {"D"}),           # small van: B up to 3,500 kg
    (4990, "2,4 tấn", {"B2", "C1", "C"}, {"B"}),                       # Kia K250: B2 (payload under 3.5 t), C1
    (7500, "3.5 tấn", {"C1", "C"}, {"B", "B2"}),                       # C1 up to 7,500 kg; B2 needs under 3.5 t
    (9500, "5.5 tấn", {"C", "FC", "CE", "E"}, {"C1", "B2", "B"}),      # over 7,500 kg: C only
    (0, "2 tấn", {"B2", "C"}, {"C1", "B"}),                            # weight not entered: no B / C1
])
def test_a_trucks_weight_decides_the_licence(gross, payload, allowed, refused):
    truck = {"category": "truck", "gross_weight": gross, "payload": payload}
    for c in allowed:
        assert fleet.license_allows(c, truck), c
    for c in refused:
        assert not fleet.license_allows(c, truck), c


@pytest.mark.parametrize("text,kg", [("8 tấn", 8000), ("2,4 tấn", 2400), ("2.4t", 2400), ("7500 kg", 7500),
                                     ("3.5", 3500), ("7500", 7500), ("", None), ("không rõ", None)])
def test_payload_is_read_in_kg(text, kg):
    assert fleet.payload_kg(text) == kg


def test_gross_weight_is_saved_in_kg_and_checked():
    v = fleet.create_vehicle({"plate": "51D-1", "category": "truck", "gross_weight": "7.500"})
    assert _v("51D-1")["gross_weight"] == 7500
    fleet.update_vehicle(v, {"gross_weight": ""})
    assert _v("51D-1")["gross_weight"] == 0
    for bad in ("7,5", "abc", "50", "200000"):
        with pytest.raises(fleet.FleetError):
            fleet.update_vehicle(v, {"gross_weight": bad})


def test_giao_xe_names_the_classes_this_truck_needs():
    heavy = fleet.create_vehicle({"plate": "51D-9", "category": "truck", "gross_weight": 9500, "payload": "5.5 tấn"})
    light = fleet.create_vehicle({"plate": "51D-2", "category": "truck", "gross_weight": 4990, "payload": "2.4 tấn"})
    d = fleet.create_driver({"name": "Cường", "license_class": "C1"})
    with pytest.raises(fleet.FleetError) as e:
        fleet.assign_vehicle(d, heavy)
    assert e.value.status == 409 and "cần bằng C/FC" in e.value.message
    fleet.assign_vehicle(d, light)
    b2 = fleet.create_driver({"name": "Dũng", "license_class": "B2"})
    with pytest.raises(fleet.FleetError) as e:
        fleet.assign_vehicle(b2, fleet.create_vehicle({"plate": "51D-3", "category": "truck", "payload": "4 tấn"}))
    assert "cần bằng C/FC" in e.value.message and "khối lượng toàn bộ" in e.value.message
    fleet.assign_vehicle(b2, fleet.create_vehicle({"plate": "51D-4", "category": "truck", "payload": "3 tấn"}))


def test_the_api_takes_and_lists_gross_weight():
    res = client.post("/api/v1/fleet/vehicles", json={"plate": "51D-1", "category": "truck", "gross_weight": "4990"})
    assert res.status_code == 200 and res.json()["gross_weight"] == 4990
    d = fleet.create_driver({"name": "An", "license_class": "C1"})
    fleet.assign_vehicle(d, res.json()["id"])
    cv = next(x for x in fleet.list_drivers() if x["id"] == d)["current_vehicle"]
    assert (cv["gross_weight"], cv["category"]) == (4990, "truck")
    assert client.put(f"/api/v1/fleet/vehicles/{res.json()['id']}", json={"gross_weight": "7,5"}).status_code == 400
