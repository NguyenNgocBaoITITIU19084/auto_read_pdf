"""The paper lock: a truck / trailer whose đăng ký, đăng kiểm or bảo hiểm has expired is "not_ready" (Không sẵn sàng),
and comes back to "ready" once renewed when the lock had put it there."""
from datetime import date, datetime, timedelta

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
PAST = (TODAY - timedelta(days=1)).isoformat()
SOON = (TODAY + timedelta(days=3)).isoformat()
LATER = (TODAY + timedelta(days=400)).isoformat()


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "fleet.db"))
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")


def _v(plate):
    return next(v for v in fleet.list_vehicles() if v["plate"] == plate)


def _d(name):
    return next(d for d in fleet.list_drivers() if d["name"] == name)


def _t(plate):
    return next(t for t in tr.list_trailers() if t["plate"] == plate)


def test_six_statuses_and_two_of_them_run():
    assert fleet.VEHICLE_STATUSES == ("ready", "active", "not_ready", "broken", "maintenance", "inactive")
    v = fleet.create_vehicle({"plate": "51C-1", "status": "ready"})
    a = fleet.create_driver({"name": "An", "home_vehicle_id": v})
    assert _d("An")["current_vehicle"]["id"] == v           # "ready" runs: the home driver is on it
    fleet.set_vehicle_status(v, "not_ready", "Chờ giấy tờ")
    assert _d("An")["current_vehicle"] is None              # not ready: the driver gets off
    fleet.set_vehicle_status(v, "active")
    assert _d("An")["current_vehicle"]["id"] == v and a


def test_a_new_one_with_an_expired_paper_starts_not_ready():
    fleet.create_vehicle({"plate": "51C-1", "ownership_expiry": PAST})
    assert (_v("51C-1")["status"], _v("51C-1")["status_forced"]) == ("not_ready", 1)
    fleet.create_vehicle({"plate": "51C-2", "registration_expiry": TODAY.isoformat()})   # still valid on its last day
    assert _v("51C-2")["status"] == "active"
    fleet.create_vehicle({"plate": "51C-3", "insurance_expiry": PAST, "status": "inactive"})
    assert _v("51C-3")["status"] == "inactive"              # out of service is never forced
    tr.create_trailer({"plate": "51R-1", "insurance_expiry": PAST})
    assert (_t("51R-1")["status"], _t("51R-1")["status_forced"]) == ("not_ready", 1)


def test_while_expired_only_not_ready_or_inactive_can_be_picked():
    v = fleet.create_vehicle({"plate": "51C-1", "registration_expiry": PAST})
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_vehicle_status(v, "ready")
    assert e.value.status == 409 and "Đăng kiểm" in e.value.message
    res = client.post(f"/api/v1/fleet/vehicles/{v}/status", json={"status": "active"})
    assert res.status_code == 409
    fleet.set_vehicle_status(v, "inactive")
    assert _v("51C-1")["status"] == "inactive"
    t = tr.create_trailer({"plate": "51R-1", "ownership_expiry": PAST})
    with pytest.raises(fleet.FleetError):
        tr.update_trailer(t, {"status": "ready"})


def test_papers_running_out_lock_it_and_take_the_driver_off():
    v = fleet.create_vehicle({"plate": "51C-1", "insurance_expiry": SOON})
    fleet.create_driver({"name": "An", "home_vehicle_id": v})
    assert fleet.enforce_papers() == 0
    assert fleet.enforce_papers(TODAY + timedelta(days=10)) == 1
    assert (_v("51C-1")["status"], _v("51C-1")["status_forced"]) == ("not_ready", 1)
    assert _d("An")["current_vehicle"] is None
    closed = fleet.history_page(vehicle_id=v)["items"][0]
    assert closed["ended_at"] and "Bảo hiểm hết hạn" in closed["end_reason"]


def test_renewed_papers_bring_it_back_to_ready_with_its_driver():
    v = fleet.create_vehicle({"plate": "51C-1", "registration_expiry": PAST})
    fleet.create_driver({"name": "An", "home_vehicle_id": v})
    assert _d("An")["current_vehicle"] is None
    fleet.update_vehicle(v, {"registration_expiry": LATER})
    assert (_v("51C-1")["status"], _v("51C-1")["status_forced"]) == ("ready", 0)
    assert _d("An")["current_vehicle"]["id"] == v


def test_a_not_ready_picked_by_hand_stays():
    v = fleet.create_vehicle({"plate": "51C-1"})
    fleet.set_vehicle_status(v, "not_ready", "Chờ lắp định vị")
    assert fleet.enforce_papers() == 0
    fleet.update_vehicle(v, {"registration_expiry": LATER})
    assert _v("51C-1")["status"] == "not_ready"


def test_a_forced_trailer_comes_off_its_tractor_and_back_to_ready_when_renewed():
    tractor = fleet.create_vehicle({"plate": "51C-1"})
    t = tr.create_trailer({"plate": "51R-1", "registration_expiry": SOON, "vehicle_id": tractor})
    assert _t("51R-1")["vehicle"]["id"] == tractor
    assert tr.enforce_trailer_papers(t, TODAY + timedelta(days=10)) == "not_ready"
    assert _t("51R-1")["vehicle"] is None and _t("51R-1")["status"] == "not_ready"
    with pytest.raises(fleet.FleetError) as e:
        tr.hitch(t, tractor)
    assert "không sẵn sàng" in e.value.message
    # the form sends the same status with the new date: renewed, it is ready again
    tr.update_trailer(t, {"status": "not_ready", "registration_expiry": LATER})
    assert (_t("51R-1")["status"], _t("51R-1")["status_forced"]) == ("ready", 0)


def test_the_form_saving_the_same_status_keeps_a_forced_trailer_locked():
    t = tr.create_trailer({"plate": "51R-1", "insurance_expiry": PAST})
    tr.update_trailer(t, {"status": "not_ready", "note": "chờ gia hạn"})
    assert (_t("51R-1")["status"], _t("51R-1")["status_forced"], _t("51R-1")["note"]) == ("not_ready", 1, "chờ gia hạn")


def test_hạn_đăng_ký_through_the_api_and_reminders():
    res = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-1", "ownership_expiry": SOON})
    assert res.status_code == 200 and res.json()["ownership_expiry"] == SOON
    res = client.post("/api/v1/fleet/trailers", json={"plate": "51R-1", "ownership_expiry": SOON})
    assert res.status_code == 200 and res.json()["ownership_expiry"] == SOON
    kinds = {d["kind"] for d in fleet.expiring_documents(TODAY)}
    assert {"ownership", "trailer_ownership"} <= kinds


def test_the_reminder_pass_runs_the_lock():
    fleet.create_vehicle({"plate": "51C-1", "insurance_expiry": SOON})
    later = datetime.combine(TODAY + timedelta(days=10), datetime.min.time(), tzinfo=VN_TZ).replace(hour=9)
    assert db.run_reminders(later)["paper_lock"] == 1
    assert _v("51C-1")["status"] == "not_ready"


def test_a_restored_one_is_locked_if_its_papers_ran_out():
    v = fleet.create_vehicle({"plate": "51C-1"})
    fleet.delete_vehicle(v)
    with db.get_connection() as conn:
        conn.execute("UPDATE fleet_vehicles SET registration_expiry = ? WHERE id = ?;", (PAST, v))
    fleet.restore_from_trash("vehicle", [v])
    assert _v("51C-1")["status"] == "not_ready"


# --- drivers: an expired licence makes them "not_ready" -------------------------------------
def test_a_new_driver_with_an_expired_licence_starts_not_ready():
    fleet.create_driver({"name": "An", "license_expiry": PAST})
    assert (_d("An")["status"], _d("An")["status_forced"]) == ("not_ready", 1)
    fleet.create_driver({"name": "Bình", "license_expiry": TODAY.isoformat()})     # still valid on its last day
    assert _d("Bình")["status"] == "active"
    fleet.create_driver({"name": "Cường", "license_expiry": PAST, "status": "leave"})
    assert _d("Cường")["status"] == "leave"                                      # on leave: never forced


def test_a_licence_running_out_takes_the_driver_off_and_renewing_brings_them_back():
    v = fleet.create_vehicle({"plate": "51C-1"})
    a = fleet.create_driver({"name": "An", "license_expiry": SOON, "home_vehicle_id": v})
    assert _d("An")["current_vehicle"]["id"] == v
    assert fleet.enforce_papers(TODAY + timedelta(days=10)) == 1
    assert (_d("An")["status"], _d("An")["status_forced"]) == ("not_ready", 1)
    assert _d("An")["current_vehicle"] is None and _d("An")["home_vehicle"]["id"] == v     # keeps their own truck
    closed = fleet.history_page(driver_id=a)["items"][0]
    assert closed["end_reason"] == "Bằng lái hết hạn"
    fleet.update_driver(a, {"license_expiry": LATER})
    assert (_d("An")["status"], _d("An")["status_forced"]) == ("active", 0)
    assert _d("An")["current_vehicle"]["id"] == v


def test_while_the_licence_is_expired_only_not_ready_leave_or_left():
    a = fleet.create_driver({"name": "An", "license_expiry": PAST})
    with pytest.raises(fleet.FleetError) as e:
        fleet.update_driver(a, {"status": "active"})
    assert e.value.status == 409 and "bằng lái đã hết hạn" in e.value.message
    assert client.put(f"/api/v1/fleet/drivers/{a}", json={"status": "active"}).status_code == 409
    fleet.update_driver(a, {"status": "leave"})
    assert (_d("An")["status"], _d("An")["status_forced"]) == ("leave", 0)
    # the same status again (a form saving other fields) is no change
    fleet.update_driver(a, {"status": "leave", "phone": "0909"})
    assert _d("An")["phone"] == "0909"
    # renewing and coming back to work in one save
    fleet.update_driver(a, {"status": "active", "license_expiry": LATER})
    assert _d("An")["status"] == "active"


def test_a_not_ready_driver_picked_by_hand_stays():
    a = fleet.create_driver({"name": "An"})
    fleet.update_driver(a, {"status": "not_ready"})
    fleet.update_driver(a, {"license_expiry": LATER})
    assert fleet.enforce_papers() == 0
    assert _d("An")["status"] == "not_ready"
