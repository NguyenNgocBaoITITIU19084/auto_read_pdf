"""Fleet: trucks, drivers, home trucks, temporary moves when a truck breaks down, and document expiry reminders."""
import json
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.core import fleet
from backend.app.core.timezone import VN_TZ
from backend.app.main import app
from backend.app.services import change_detection as cd

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "fleet.db"))
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")


def _truck(plate, **extra):
    return fleet.create_vehicle({"plate": plate, **extra})


def _driver(name, **extra):
    return fleet.create_driver({"name": name, **extra})


def _drivers():
    return {d["name"]: d for d in fleet.list_drivers()}


def _trucks():
    return {v["plate"]: v for v in fleet.list_vehicles()}


def _open_rows():
    with db.get_connection() as conn:
        return conn.execute("SELECT driver_name, vehicle_plate, kind FROM fleet_assignments "
                            "WHERE ended_at IS NULL ORDER BY driver_name;").fetchall()


# --- trucks / drivers ------------------------------------------------------
def test_plates_are_unique_whatever_the_spelling():
    _truck("51C-123.45", trailer_plate="51R-001.11")
    with pytest.raises(fleet.FleetError) as e:
        _truck("51c 12345")
    assert e.value.status == 409
    with pytest.raises(fleet.FleetError) as e:
        _truck("51C-999.99", trailer_plate="51r00111")
    assert "51C-123.45" in e.value.message
    assert _trucks()["51C-123.45"]["trailer_plate"] == "51R-001.11"


def test_dates_are_checked():
    with pytest.raises(fleet.FleetError):
        _truck("51C-1", registration_expiry="31/12/2026")
    with pytest.raises(fleet.FleetError):
        _driver("A", license_expiry="2026-02-30")
    with pytest.raises(fleet.FleetError):
        _driver("   ")


def test_a_driver_created_with_a_home_truck_drives_it():
    t = _truck("51C-1")
    _driver("Nguyễn Văn An", home_vehicle_id=t)
    d = _drivers()["Nguyễn Văn An"]
    assert d["home_vehicle"]["plate"] == "51C-1"
    assert d["current_vehicle"]["plate"] == "51C-1" and d["current_vehicle"]["kind"] == "primary"
    assert _trucks()["51C-1"]["current_driver"]["name"] == "Nguyễn Văn An"


def test_a_truck_is_one_drivers_home_unless_forced():
    t = _truck("51C-1")
    a = _driver("An", home_vehicle_id=t)
    b = _driver("Bình")
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_home_vehicle(b, t)
    assert e.value.status == 409 and "An" in e.value.message
    fleet.set_home_vehicle(b, t, force=True)
    ds = _drivers()
    assert ds["An"]["home_vehicle"] is None and ds["An"]["current_vehicle"] is None
    assert ds["Bình"]["current_vehicle"]["plate"] == "51C-1"
    assert a  # the old home driver still exists


# --- the breakdown flow -----------------------------------------------------
def test_broken_truck_moves_its_driver_to_a_spare_and_back():
    home = _truck("51C-1")
    spare = _truck("51C-9")
    a = _driver("An", home_vehicle_id=home)

    res = fleet.set_vehicle_status(home, "broken", "Hư hộp số", move_to_vehicle_id=spare)
    assert res["moved_driver"] == {"id": a, "name": "An", "to_vehicle_id": spare, "to_plate": "51C-9"}
    d = _drivers()["An"]
    assert d["current_vehicle"]["plate"] == "51C-9" and d["current_vehicle"]["kind"] == "temporary"
    assert d["home_vehicle"]["plate"] == "51C-1"
    trucks = _trucks()
    assert trucks["51C-1"]["status"] == "broken" and trucks["51C-1"]["current_driver"] is None
    assert trucks["51C-1"]["home_driver"]["driving_plate"] == "51C-9"

    # going back while the home truck is still broken is refused
    with pytest.raises(fleet.FleetError) as e:
        fleet.return_home(a)
    assert "hư hỏng" in e.value.message

    # repaired: the driver is away on the spare, so it is only reported
    res = fleet.set_vehicle_status(home, "active")
    assert res["home_driver_away"] == {"id": a, "name": "An", "plate": "51C-9"}
    fleet.return_home(a)
    assert _open_rows() == [("An", "51C-1", "primary")]

    history = fleet.list_history(driver_id=a)
    assert [(h["vehicle_plate"], h["kind"], h["ended_at"] is None) for h in history] == [
        ("51C-1", "primary", True), ("51C-9", "temporary", False), ("51C-1", "primary", False)]
    assert history[1]["home_vehicle_plate"] == "51C-1"
    assert "Hư hộp số" in history[2]["end_reason"]


def test_broken_truck_without_spare_leaves_driver_idle_and_repair_puts_them_back():
    home = _truck("51C-1")
    a = _driver("An", home_vehicle_id=home)
    res = fleet.set_vehicle_status(home, "maintenance")
    assert res["moved_driver"]["to_vehicle_id"] is None
    assert _drivers()["An"]["current_vehicle"] is None
    res = fleet.set_vehicle_status(home, "active")
    assert res["home_driver_away"] is None
    assert _drivers()["An"]["current_vehicle"]["plate"] == "51C-1"
    assert a


def test_spare_must_be_running_and_free():
    home, busy, down = _truck("51C-1"), _truck("51C-2"), _truck("51C-3", status="broken")
    _driver("An", home_vehicle_id=home)
    _driver("Bình", home_vehicle_id=busy)
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_vehicle_status(home, "broken", move_to_vehicle_id=busy)
    assert e.value.status == 409 and "Bình" in e.value.message
    with pytest.raises(fleet.FleetError):
        fleet.set_vehicle_status(home, "broken", move_to_vehicle_id=down)
    # nothing changed: the whole step is refused
    assert _trucks()["51C-1"]["status"] == "active"
    assert _drivers()["An"]["current_vehicle"]["plate"] == "51C-1"


def test_return_home_refused_while_someone_else_drives_it():
    home, spare = _truck("51C-1"), _truck("51C-9")
    a = _driver("An", home_vehicle_id=home)
    b = _driver("Bình")
    fleet.move_temporary(a, spare, "Đổi tạm")
    fleet.move_temporary(b, home, "Xe An đang trống")
    with pytest.raises(fleet.FleetError) as e:
        fleet.return_home(a)
    assert e.value.status == 409 and "Bình" in e.value.message
    fleet.unassign(b)
    fleet.return_home(a)
    assert _open_rows() == [("An", "51C-1", "primary")]


def test_leave_and_quit():
    home = _truck("51C-1")
    a = _driver("An", home_vehicle_id=home)
    fleet.update_driver(a, {"status": "leave"})
    d = _drivers()["An"]
    assert d["current_vehicle"] is None and d["home_vehicle"]["plate"] == "51C-1"
    fleet.update_driver(a, {"status": "active"})
    assert _drivers()["An"]["current_vehicle"]["plate"] == "51C-1"
    fleet.update_driver(a, {"status": "left"})
    d = _drivers()["An"]
    assert d["current_vehicle"] is None and d["home_vehicle"] is None
    with pytest.raises(fleet.FleetError):
        fleet.move_temporary(a, home)


def test_deleting_keeps_history():
    home = _truck("51C-1")
    a = _driver("An", home_vehicle_id=home)
    fleet.delete_vehicle(home)
    assert _drivers()["An"]["home_vehicle"] is None
    fleet.delete_driver(a)
    rows = fleet.list_history()
    assert len(rows) == 1 and rows[0]["vehicle_plate"] == "51C-1" and rows[0]["driver_name"] == "An"
    assert rows[0]["ended_at"] is not None


# --- API ----------------------------------------------------------------------
def test_api_flow_and_errors():
    home = client.post("/api/v1/fleet/vehicles", json={"plate": "51c-123.45", "trailer_plate": "51R-1"}).json()
    spare = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-678.90"}).json()
    assert home["plate"] == "51C-123.45"
    assert client.post("/api/v1/fleet/vehicles", json={"plate": "51C12345"}).status_code == 409
    drv = client.post("/api/v1/fleet/drivers", json={"name": "An", "home_vehicle_id": home["id"]}).json()
    assert drv["current_vehicle"]["id"] == home["id"]

    res = client.post(f"/api/v1/fleet/vehicles/{home['id']}/status",
                      json={"status": "broken", "reason": "Nổ lốp", "move_to_vehicle_id": spare["id"]})
    assert res.status_code == 200 and res.json()["moved_driver"]["to_plate"] == "51C-678.90"
    bad = client.post(f"/api/v1/fleet/drivers/{drv['id']}/return-home")
    assert bad.status_code == 409 and "51C-123.45" in bad.json()["detail"]
    client.post(f"/api/v1/fleet/vehicles/{home['id']}/status", json={"status": "active"})
    back = client.post(f"/api/v1/fleet/drivers/{drv['id']}/return-home").json()
    assert back["current_vehicle"]["kind"] == "primary"
    assert len(client.get("/api/v1/fleet/history", params={"driver_id": drv["id"]}).json()) == 3
    assert client.put("/api/v1/fleet/drivers/999", json={"name": "X"}).status_code == 404


# --- expiry reminders -------------------------------------------------------------
def _fleet_notes():
    with db.get_connection() as conn:
        rows = db._select_dicts(conn, "SELECT * FROM notifications WHERE kind = ? ORDER BY id;", (cd.FLEET_EXPIRY,))
    for r in rows:
        r["detail"] = json.loads(r["detail"] or "{}")
    return rows


def at(day, hour=8):
    return datetime(2026, 11, day, hour, 0, tzinfo=VN_TZ)


def test_expiry_reminders_group_once_per_threshold():
    _truck("51C-1", registration_expiry="2026-12-10", insurance_expiry="2026-11-20")
    _truck("51C-2", registration_expiry="2027-06-01")
    _truck("51C-3", registration_expiry="2026-11-01", status="inactive")
    _driver("An", license_expiry="2026-11-10")

    assert fleet.scan_expiry_reminders(at(15)) == 1
    notes = _fleet_notes()
    assert len(notes) == 1
    n = notes[0]
    assert n["collection_id"] is None and n["nav_tab"] == "fleet"
    assert n["detail"]["count"] == 3 and n["detail"]["expired"] == 1
    assert [(i["kind"], i["subject"], i["days_left"]) for i in n["detail"]["documents"]] == [
        ("license", "An", -5), ("insurance", "51C-1", 5), ("registration", "51C-1", 25)]
    assert n["detail"]["documents"][0]["expiry"] == "10/11/2026"

    # same day again: nothing new
    assert fleet.scan_expiry_reminders(at(15, 9)) == 0
    # 3/12: the registration crosses 7 days and the insurance has expired — one more notification for both
    assert fleet.scan_expiry_reminders(datetime(2026, 12, 3, 8, tzinfo=VN_TZ)) == 1
    last = _fleet_notes()[-1]
    assert [(i["kind"], i["days_left"]) for i in last["detail"]["documents"]] == [("insurance", -13), ("registration", 7)]
    # 5/12: nothing crossed a new threshold
    assert fleet.scan_expiry_reminders(datetime(2026, 12, 5, 8, tzinfo=VN_TZ)) == 0


def test_single_document_title_names_it():
    _truck("51C-1", registration_expiry="2026-11-20")
    assert fleet.scan_expiry_reminders(at(15)) == 1
    assert _fleet_notes()[-1]["title"] == "Đăng kiểm 51C-1 còn 5 ngày"


def test_renewed_date_rearms_and_setting_off_silences():
    t = _truck("51C-1", registration_expiry="2026-11-20")
    assert fleet.scan_expiry_reminders(at(15)) == 1
    fleet.update_vehicle(t, {"registration_expiry": "2026-12-01"})
    assert fleet.scan_expiry_reminders(at(15)) == 1
    db.set_notification_settings([k for k in cd.ALL_KINDS if k != cd.FLEET_EXPIRY], True)
    fleet.update_vehicle(t, {"registration_expiry": "2026-11-25"})
    assert fleet.scan_expiry_reminders(at(15)) == 0


def test_run_reminders_includes_fleet():
    _driver("An", license_expiry="2026-11-16")
    assert db.run_reminders(at(15, 3))["fleet"] == 1


def test_fleet_kind_defaults_on_for_existing_settings():
    known = [k for k in cd.ALL_KINDS if k != cd.FLEET_EXPIRY]
    db.set_system_setting("notify_kinds", json.dumps(known))
    db.set_system_setting("notify_kinds_known", json.dumps(known))
    assert cd.FLEET_EXPIRY in db.get_notification_settings()["kinds"]


# --- photos ---------------------------------------------------------------------
def _png(color=(200, 30, 30, 255), size=(2400, 1600)):
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, "PNG")
    return buf.getvalue()


def test_photo_is_stored_as_small_jpeg_and_replaced():
    from PIL import Image
    t = _truck("51C-1")
    first = fleet.set_photo("vehicle", t, _png())
    path = fleet.photo_path(first)
    assert path and path.parent == fleet.photo_dir()
    with Image.open(path) as img:
        assert img.format == "JPEG" and max(img.size) == fleet.PHOTO_MAX_SIDE
    assert _trucks()["51C-1"]["photo"] == first

    second = fleet.set_photo("vehicle", t, _png((0, 0, 255, 255), (300, 300)))
    assert second != first and fleet.photo_path(first) is None and fleet.photo_path(second)
    fleet.remove_photo("vehicle", t)
    assert _trucks()["51C-1"]["photo"] == "" and fleet.photo_path(second) is None


def test_bad_photos_are_refused():
    a = _driver("An")
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_photo("driver", a, b"not an image")
    assert "không phải ảnh" in e.value.message
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_photo("driver", a, b"\x00\x00\x00\x18ftypheic" + b"\x00" * 40)
    assert "HEIC" in e.value.message
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_photo("driver", 999, _png(size=(10, 10)))
    assert e.value.status == 404


def test_photo_is_kept_in_the_trash_and_removed_when_deleted_for_good():
    a = _driver("An")
    name = fleet.set_photo("driver", a, _png(size=(50, 50)))
    fleet.delete_driver(a)
    assert fleet.photo_path(name) is not None
    assert fleet.delete_from_trash("driver", [a]) == 1
    assert fleet.photo_path(name) is None


def test_photo_api_upload_serve_and_reject_odd_names():
    t = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-1"}).json()
    res = client.post(f"/api/v1/fleet/vehicles/{t['id']}/photo", files={"file": ("x.png", _png(size=(64, 64)), "image/png")})
    assert res.status_code == 200
    name = res.json()["photo"]
    got = client.get(f"/api/v1/fleet/photos/{name}")
    assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg"
    assert "immutable" in got.headers["cache-control"]
    assert client.get("/api/v1/fleet/photos/..%2Ffleet.db").status_code == 404
    assert client.get("/api/v1/fleet/photos/vehicle_1_zzzzzzzz.jpg").status_code == 404
    bad = client.post(f"/api/v1/fleet/vehicles/{t['id']}/photo", files={"file": ("x.txt", b"hello", "text/plain")})
    assert bad.status_code == 400
    assert client.delete(f"/api/v1/fleet/vehicles/{t['id']}/photo").json()["photo"] == ""


# --- "Đã sửa xong": repaired, and its driver comes back in the same step -----------------
def test_repaired_brings_home_driver_back_in_one_step():
    home, spare = _truck("51C-1"), _truck("51C-9")
    a = _driver("An", home_vehicle_id=home)
    fleet.set_vehicle_status(home, "broken", move_to_vehicle_id=spare)
    res = fleet.set_vehicle_status(home, "active", bring_home_driver=True)
    assert res["returned_driver"] == {"id": a, "name": "An", "from_plate": "51C-9", "plate": "51C-1"}
    assert res["home_driver_away"] is None
    assert _open_rows() == [("An", "51C-1", "primary")]
    assert _trucks()["51C-9"]["current_driver"] is None


def test_repaired_leaves_driver_away_when_someone_else_is_on_the_truck():
    home, spare = _truck("51C-1"), _truck("51C-9")
    a = _driver("An", home_vehicle_id=home)
    b = _driver("Bình")
    fleet.move_temporary(a, spare)          # An left his truck while it still ran
    fleet.move_temporary(b, home)           # and Bình took it
    res = fleet.set_vehicle_status(home, "active", bring_home_driver=True)
    assert res["returned_driver"] is None
    assert res["home_driver_away"] == {"id": a, "name": "An", "plate": "51C-9"}
    assert _open_rows() == [("An", "51C-9", "temporary"), ("Bình", "51C-1", "temporary")]


def test_repair_api_flag():
    home = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-1"}).json()
    spare = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-9"}).json()
    client.post("/api/v1/fleet/drivers", json={"name": "An", "home_vehicle_id": home["id"]})
    client.post(f"/api/v1/fleet/vehicles/{home['id']}/status", json={"status": "broken", "move_to_vehicle_id": spare["id"]})
    res = client.post(f"/api/v1/fleet/vehicles/{home['id']}/status", json={"status": "active", "bring_home_driver": True}).json()
    assert res["returned_driver"]["plate"] == "51C-1"


# --- history: paged, sorted, filtered -------------------------------------------------
def _history_fixture():
    home, spare, other = _truck("51C-1"), _truck("51C-9"), _truck("51C-5")
    a = _driver("Nguyễn Văn Ân", home_vehicle_id=home)
    b = _driver("Bình", home_vehicle_id=other)
    fleet.set_vehicle_status(home, "broken", "Hư hộp số", move_to_vehicle_id=spare)
    fleet.set_vehicle_status(home, "active", bring_home_driver=True)
    return home, spare, a, b


def test_history_page_filters_sorts_and_pages():
    home, spare, a, b = _history_fixture()
    everything = fleet.history_page(limit=100)
    assert everything["total"] == 4                   # An x3, Bình x1
    open_rows = fleet.history_page(states=["open"])
    assert {(r["driver_name"], r["vehicle_plate"]) for r in open_rows["items"]} == {("Nguyễn Văn Ân", "51C-1"), ("Bình", "51C-5")}
    temp = fleet.history_page(kinds=["temporary"])
    assert [r["vehicle_plate"] for r in temp["items"]] == ["51C-9"]
    assert fleet.history_page(kinds=["primary", "temporary"], states=["open", "closed"])["total"] == 4

    # accent-insensitive search over names, plates and reasons
    assert fleet.history_page(query="nguyen van an")["total"] == 3
    assert fleet.history_page(query="hop so")["total"] >= 1

    by_driver = fleet.history_page(sort_by="driver_name", sort_dir="asc")["items"]
    assert by_driver[0]["driver_name"] == "Bình"
    by_plate = fleet.history_page(sort_by="vehicle_plate", sort_dir="desc")["items"]
    assert by_plate[0]["vehicle_plate"] == "51C-9"

    page2 = fleet.history_page(limit=3, offset=3)
    assert page2["total"] == 4 and len(page2["items"]) == 1
    assert fleet.history_page(sort_by="'; DROP TABLE fleet_assignments; --")["total"] == 4   # unknown column: default order


def test_history_page_api():
    _history_fixture()
    res = client.get("/api/v1/fleet/history/page", params=[("kinds", "temporary"), ("limit", "10")]).json()
    assert res["total"] == 1 and res["items"][0]["vehicle_plate"] == "51C-9"
    res = client.get("/api/v1/fleet/history/page", params={"q": "binh", "sort_by": "started_at", "sort_dir": "asc"}).json()
    assert res["total"] == 1


def test_history_sorts_vietnamese_names_like_people_expect():
    t = _truck("51C-1")
    for name in ("Nguyễn Văn An", "Ngô Văn Khoa", "Đặng Văn Em", "Dương Văn Bé", "Bùi Thị Giang"):
        d = _driver(name)
        fleet.move_temporary(d, t)
        fleet.unassign(d)
    names = [r["driver_name"] for r in fleet.history_page(sort_by="driver_name", sort_dir="asc")["items"]]
    assert names == ["Bùi Thị Giang", "Đặng Văn Em", "Dương Văn Bé", "Ngô Văn Khoa", "Nguyễn Văn An"]
    desc = [r["driver_name"] for r in fleet.history_page(sort_by="driver_name", sort_dir="desc")["items"]]
    assert desc == list(reversed(names))


# --- trash -------------------------------------------------------------------------------
def test_deleted_truck_goes_to_trash_and_comes_back():
    t = _truck("51C-1", trailer_plate="51R-1")
    a = _driver("An", home_vehicle_id=t)
    fleet.delete_vehicle(t)
    assert "51C-1" not in _trucks()
    assert _drivers()["An"]["home_vehicle"] is None and _drivers()["An"]["current_vehicle"] is None
    page = fleet.trash_page("vehicle")
    assert page["total"] == 1 and page["keep_days"] == 30
    item = page["items"][0]
    assert item["plate"] == "51C-1" and item["days_left"] in (29, 30) and item["purge_at"] > item["deleted_at"]
    assert fleet.trash_count() == {"vehicle": 1, "driver": 0, "trailer": 0}

    # its plate stays taken, with a message that says where it is
    with pytest.raises(fleet.FleetError) as e:
        _truck("51C 1")
    assert "thùng rác" in e.value.message
    # its trailer came off and is free for another tractor
    _truck("51C-2", trailer_plate="51R-1")
    # a truck in the trash can't be used
    with pytest.raises(fleet.FleetError) as e:
        fleet.set_home_vehicle(a, t)
    assert e.value.status == 404

    assert fleet.restore_from_trash("vehicle", [t, 999]) == 1
    assert _trucks()["51C-1"]["trailer_plate"] == ""
    assert fleet.trash_page("vehicle")["total"] == 0


def test_deleted_driver_frees_their_truck_and_is_left_out_of_reminders():
    t = _truck("51C-1")
    a = _driver("An", home_vehicle_id=t, license_expiry="2026-11-20")
    fleet.delete_driver(a)
    assert _trucks()["51C-1"]["home_driver"] is None and _trucks()["51C-1"]["current_driver"] is None
    assert fleet.expiring_documents(date(2026, 11, 15)) == []
    b = _driver("Bình")
    fleet.set_home_vehicle(b, t)                       # the truck is free for someone else
    fleet.restore_from_trash("driver", [a])
    d = _drivers()["An"]
    assert d["home_vehicle"] is None and d["current_vehicle"] is None
    assert len(fleet.list_history(driver_id=a)) == 1  # their history is still there


def test_trash_is_purged_after_keep_days(monkeypatch):
    from datetime import timedelta
    t = _truck("51C-1")
    name = fleet.set_photo("vehicle", t, _png(size=(20, 20)))
    fleet.delete_vehicle(t)
    with db.get_connection() as conn:
        conn.execute("UPDATE fleet_vehicles SET deleted_at = '2000-01-01 00:00:00' WHERE id = ?;", (t,))
    assert db.purge_expired_trash() >= 1
    assert fleet.trash_page("vehicle")["total"] == 0 and fleet.photo_path(name) is None
    _truck("51C-1")                                     # the plate is free again


def test_trash_api():
    t = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-1"}).json()
    d = client.post("/api/v1/fleet/drivers", json={"name": "An"}).json()
    client.delete(f"/api/v1/fleet/vehicles/{t['id']}")
    client.delete(f"/api/v1/fleet/drivers/{d['id']}")
    assert client.get("/api/v1/fleet/trash/count").json() == {"vehicle": 1, "driver": 1, "trailer": 0}
    assert client.get("/api/v1/fleet/trash", params={"kind": "driver"}).json()["items"][0]["name"] == "An"
    assert client.get("/api/v1/fleet/trash/ids", params={"kind": "vehicle"}).json() == {"ids": [t["id"]]}
    assert client.get("/api/v1/fleet/trash", params={"kind": "boat"}).status_code == 400
    assert client.post("/api/v1/fleet/trash/restore", json={"kind": "vehicle", "ids": [t["id"]]}).json()["restored"] == 1
    assert client.post("/api/v1/fleet/trash/delete", json={"kind": "driver", "ids": [d["id"]]}).json()["deleted"] == 1
    assert client.get("/api/v1/fleet/trash/count").json() == {"vehicle": 0, "driver": 0, "trailer": 0}
    assert client.put(f"/api/v1/fleet/drivers/{d['id']}", json={"name": "X"}).status_code == 404


# --- Excel export -----------------------------------------------------------------------
def test_fleet_tables_have_their_own_export_templates_and_export():
    import io
    from openpyxl import load_workbook
    cols = [{"key": "plate", "header": "Biển số"}, {"key": "status", "header": "Trạng thái", "color": "green"}]
    res = client.post("/api/v1/export/templates", json={"tab": "fleet_vehicle", "name": "Xe đang chạy", "columns": cols})
    assert res.status_code == 200, res.text
    assert [t["name"] for t in client.get("/api/v1/export/templates", params={"tab": "fleet_vehicle"}).json()] == ["Xe đang chạy"]
    assert client.get("/api/v1/export/templates", params={"tab": "fleet_driver"}).json() == []
    out = client.post("/api/v1/export/excel", json={"data": [{"plate": "51C-123.45", "status": "Đang chạy"}],
                                                     "columns": cols, "filename": "doi_xe.xlsx"})
    assert out.status_code == 200
    ws = load_workbook(io.BytesIO(out.content)).active
    assert [c.value for c in ws[1]] == ["Biển số", "Trạng thái"]
    assert [c.value for c in ws[2]] == ["51C-123.45", "Đang chạy"]
    assert "doi_xe.xlsx" in out.headers["content-disposition"]


# --- driver papers (licence / CCCD scans) ------------------------------------------------
def test_driver_documents_are_stored_larger_replaced_and_purged():
    from PIL import Image
    import io
    a = _driver("An")
    name = fleet.set_driver_document(a, "license_front", _png(size=(3000, 1900)))
    assert name.startswith(f"driver_{a}_license_front_") and fleet.photo_path(name) is not None
    assert max(Image.open(fleet.photo_path(name)).size) == fleet.DOCUMENT_MAX_SIDE
    back = fleet.set_driver_document(a, "id_back", _png(size=(200, 120)))
    d = _drivers()["An"]
    assert d["license_front"] == name and d["id_back"] == back and d["license_back"] == "" and d["photo"] == ""

    again = fleet.set_driver_document(a, "license_front", _png(size=(200, 120)))
    assert again != name and fleet.photo_path(name) is None          # the old scan is gone
    fleet.remove_driver_document(a, "id_back")
    assert fleet.photo_path(back) is None and _drivers()["An"]["id_back"] == ""
    with pytest.raises(fleet.FleetError):
        fleet.set_driver_document(a, "passport", _png(size=(20, 20)))

    fleet.delete_driver(a)                                             # trash keeps the scans...
    assert fleet.photo_path(again) is not None
    assert fleet.delete_from_trash("driver", [a]) == 1                 # ...deleting for good removes them
    assert fleet.photo_path(again) is None


def test_driver_documents_api():
    d = client.post("/api/v1/fleet/drivers", json={"name": "An"}).json()
    res = client.post(f"/api/v1/fleet/drivers/{d['id']}/documents/id_front",
                      files={"file": ("cccd.png", _png(size=(400, 250)), "image/png")})
    assert res.status_code == 200, res.text
    name = res.json()["id_front"]
    assert client.get(f"/api/v1/fleet/photos/{name}").status_code == 200
    assert client.post(f"/api/v1/fleet/drivers/{d['id']}/documents/nope",
                       files={"file": ("x.png", _png(size=(20, 20)), "image/png")}).status_code == 400
    assert client.delete(f"/api/v1/fleet/drivers/{d['id']}/documents/id_front").json()["id_front"] == ""


def test_truck_documents_are_stored_and_purged():
    t = _truck("51C-1")
    name = fleet.set_document("vehicle", t, "registration_front", _png(size=(300, 200)))
    assert name.startswith(f"vehicle_{t}_registration_front_") and fleet.photo_path(name) is not None
    own = fleet.set_document("vehicle", t, "ownership_back", _png(size=(300, 200)))
    v = _trucks()["51C-1"]
    assert v["registration_front"] == name and v["ownership_back"] == own and v["insurance_front"] == ""
    with pytest.raises(fleet.FleetError):
        fleet.set_document("vehicle", t, "license_front", _png(size=(20, 20)))   # a driver's paper, not a truck's
    fleet.remove_document("vehicle", t, "ownership_back")
    assert fleet.photo_path(own) is None
    fleet.delete_vehicle(t)
    fleet.delete_from_trash("vehicle", [t])
    assert fleet.photo_path(name) is None


def test_truck_documents_api():
    t = client.post("/api/v1/fleet/vehicles", json={"plate": "51C-1"}).json()
    res = client.post(f"/api/v1/fleet/vehicles/{t['id']}/documents/insurance_front",
                      files={"file": ("bh.png", _png(size=(300, 200)), "image/png")})
    assert res.status_code == 200, res.text
    assert client.get(f"/api/v1/fleet/photos/{res.json()['insurance_front']}").status_code == 200
    assert client.delete(f"/api/v1/fleet/vehicles/{t['id']}/documents/insurance_front").json()["insurance_front"] == ""
    assert client.delete(f"/api/v1/fleet/vehicles/{t['id']}/documents/id_front").status_code == 400
