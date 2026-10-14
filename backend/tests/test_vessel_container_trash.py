import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def _vessel(col, name, voyage="001N", closing="2026-10-20 10:00"):
    return db.insert_vessel_schedules(col, [{"SITE_ID": "CTL", "VESSELNAME": name, "IN_OUT_VOYAGE": voyage,
                                             "CLOSING_TIME": closing}])[0]


def _container(col, no, event="GATE-IN", haz=""):
    return db.insert_containers(col, [{"SITE": "CTL", "CONTAINERNO": no, "EVENT_TIME": "2026-10-10 08:00",
                                       "EVENT_TYPE": event, "HAZ": haz}])[0]


def _live(kind, col):
    rows = db.get_vessel_schedules(col) if kind == "vessel" else db.get_containers(col)
    return sorted(r["id"] for r in rows)


def _raw(table, row_id):
    with db.get_connection() as conn:
        return db._select_dicts(conn, f"SELECT * FROM {table} WHERE id = ?;", (row_id,))


def test_every_vessel_delete_path_moves_rows_to_trash(fresh_db):
    col = db.create_collection("v")
    a, b, c, d = (_vessel(col, n) for n in ("A", "B", "C", "D"))
    db.delete_vessel_schedule(a)
    assert db.delete_vessel_schedules_batch([b, c]) == 2
    assert _live("vessel", col) == [d] and sorted(db.get_trash_ids("vessel", col)) == [a, b, c]
    assert db.clear_vessel_schedules(col) == 1
    assert sorted(db.get_trash_ids("vessel", col)) == [a, b, c, d] and db.count_trash("vessel", col) == 4
    item = db.get_trash_page("vessel", col)["items"][0]
    assert item["vessel_name"] and item["days_left"] == db.TRASH_KEEP_DAYS and item["purge_at"]


def test_every_container_delete_path_moves_rows_to_trash(fresh_db):
    col = db.create_collection("c")
    a, b, c = (_container(col, n) for n in ("AAAU1111111", "BBBU2222222", "CCCU3333333"))
    db.delete_container(a)
    assert db.delete_containers_batch([b]) == 1
    assert db.clear_containers(col) == 1
    assert _live("container", col) == [] and sorted(db.get_trash_ids("container", col)) == [a, b, c]
    assert db.get_booking_trash_ids(col) == [] and db.get_trash_ids("vessel", col) == []


def test_restore_keeps_the_raw_row(fresh_db):
    col = db.create_collection("raw")
    haz = '<a href="https://imdg.example/3">3</a>'
    cid = _container(col, "HAZU1234567", haz=haz)
    before = _raw("containers", cid)
    db.delete_containers_batch([cid])
    item = db.get_trash_page("container", col)["items"][0]
    assert item["haz"] == "3" and item["imdg_url"] == "https://imdg.example/3"  # listed like the live table
    assert db.restore_trashed("container", [cid, 999999]) == {"restored": 1, "superseded": 0}
    assert _raw("containers", cid) == before  # same id, queried_at and the haz link
    assert db.get_trash_ids("container", col) == []

    vid = _vessel(col, "EVER MEMO")
    before = _raw("vessel_schedules", vid)
    db.delete_vessel_schedule(vid)
    assert db.restore_trashed("vessel", [vid])["restored"] == 1
    assert _raw("vessel_schedules", vid) == before


def test_restore_never_replaces_a_row_looked_up_again(fresh_db):
    col = db.create_collection("requery")
    old = _vessel(col, "EVER MEMO", closing="old")
    db.delete_vessel_schedule(old)
    new = _vessel(col, "EVER MEMO", closing="new")  # looked up again while the old copy is in the trash
    assert db.restore_trashed("vessel", [old]) == {"restored": 0, "superseded": 1}
    assert [(r["id"], r["closing_time"]) for r in db.get_vessel_schedules(col)] == [(new, "new")]
    assert db.get_trash_ids("vessel", col) == []

    old_c = _container(col, "TEMU7654321")
    db.delete_container(old_c)
    new_c = _container(col, "TEMU7654321")
    assert db.restore_trashed("container", [old_c]) == {"restored": 0, "superseded": 1}
    assert _live("container", col) == [new_c]


def test_two_trashed_copies_restore_the_latest(fresh_db):
    col = db.create_collection("twice")
    first = _vessel(col, "MSC ANNA", closing="first")
    db.delete_vessel_schedule(first)
    second = _vessel(col, "MSC ANNA", closing="second")
    db.delete_vessel_schedule(second)
    with db.get_connection() as conn:
        conn.execute("UPDATE vessel_trash SET deleted_at = '2099-01-01 00:00:00' WHERE id = ?;", (second,))
    assert db.restore_trashed("vessel", [first, second]) == {"restored": 1, "superseded": 1}
    assert [r["closing_time"] for r in db.get_vessel_schedules(col)] == ["second"]


def test_restoring_a_vessel_refreshes_booking_cutoff(fresh_db):
    col = db.create_collection("cutoff")
    vid = db.insert_vessel_schedules(col, [{"site_id": "CTL", "vessel_name": "HMM HOPE", "in_out_voyage": "062E-062E",
                                            "closing_time": "2026-09-23 11:00:00"}])[0]
    db.delete_vessel_schedule(vid)
    bid = db.insert_booking(col, {"Booking No": "BK1", "Vessel": "HMM HOPE 062E(EC2)"})
    assert db.get_bookings_by_ids([bid])[0]["Cut-off ePort"] == ""  # the vessel is in the trash
    db.restore_trashed("vessel", [vid])
    assert db.get_bookings_by_ids([bid])[0]["Cut-off ePort"] == "23/09/2026 11:00"


def test_old_trash_is_purged_and_collection_delete_drops_it(fresh_db):
    col = db.create_collection("purge")
    old, recent = _vessel(col, "OLD"), _vessel(col, "NEW")
    cont = _container(col, "OLDU0000000")
    db.delete_vessel_schedules_batch([old, recent])
    db.delete_container(cont)
    with db.get_connection() as conn:
        conn.execute("UPDATE vessel_trash SET deleted_at = '2000-01-01 00:00:00' WHERE id = ?;", (old,))
        conn.execute("UPDATE container_trash SET deleted_at = '2000-01-01 00:00:00';")
    assert db.purge_expired_trash() == 2
    assert db.get_trash_ids("vessel", col) == [recent] and db.get_trash_ids("container", col) == []
    db.delete_collection(col)
    with db.get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM vessel_trash;").fetchone()[0] == 0


@pytest.mark.parametrize("kind,path", [("vessel", "vessels"), ("container", "containers")])
def test_trash_endpoints(client, kind, path):
    col = db.create_collection(f"api-{kind}")
    add = (lambda n: _vessel(col, n)) if kind == "vessel" else (lambda n: _container(col, n))
    ids = [add(n) for n in ("TTTU1000001", "TTTU1000002", "TTTU1000003")]
    assert client.post(f"{API}/{path}/batch-delete", json={"ids": ids[:2]}).json() == \
        {"status": "success", "deleted_count": 2}
    res = client.delete(f"{API}/{path}/clear/{col}").json()
    assert res["deleted"] == 1
    res = client.get(f"{API}/{path}/trash", params={"collection_id": col}).json()
    assert res["keep_days"] == db.TRASH_KEEP_DAYS and res["total"] == 3 and len(res["items"]) == 3
    assert sorted(client.get(f"{API}/{path}/trash/ids", params={"collection_id": col}).json()["ids"]) == sorted(ids)
    assert client.get(f"{API}/{path}/trash/count", params={"collection_id": col}).json() == {"count": 3}
    assert client.post(f"{API}/{path}/trash/restore", json={"ids": ids[:2]}).json() == \
        {"status": "success", "restored": 2, "superseded": 0}
    assert client.post(f"{API}/{path}/trash/delete", json={"ids": [ids[2]]}).json() == \
        {"status": "success", "deleted": 1}
    assert _live(kind, col) == sorted(ids[:2]) and db.get_trash_ids(kind, col) == []
