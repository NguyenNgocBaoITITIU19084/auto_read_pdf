import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def _add(col, no, **extra):
    return db.insert_booking(col, {"Booking No": no, "Vessel": "EVER MEMO", **extra})


def _live_ids(col):
    return sorted(b["id"] for b in db.get_bookings(col))


def _trash_ids(col):
    return sorted(db.get_booking_trash_ids(col))


def test_every_delete_path_moves_bookings_to_trash(fresh_db):
    col = db.create_collection("trash")
    a, b, c, d = (_add(col, n) for n in ("A1", "B2", "C3", "D4"))
    db.delete_booking(a)
    assert db.delete_bookings_batch([b, c]) == 2
    assert _live_ids(col) == [d] and _trash_ids(col) == [a, b, c]
    assert db.clear_bookings(col) == 1
    assert _live_ids(col) == [] and _trash_ids(col) == [a, b, c, d]
    assert db.count_booking_trash(col) == 4
    item = db.get_booking_trash(col)["items"][0]
    assert item["days_left"] == db.BOOKING_TRASH_KEEP_DAYS and item["deleted_at"] and item["purge_at"]


def test_restore_brings_back_the_same_row(fresh_db):
    col = db.create_collection("restore")
    bid = _add(col, "KEEP1", **{"Ghi chú": "giao gấp"})
    before = db.get_bookings_by_ids([bid])[0]
    db.delete_booking(bid)
    assert db.restore_bookings([bid, 999999]) == 1
    assert db.get_bookings_by_ids([bid]) == [before]  # same id, added time and note
    assert _trash_ids(col) == []
    assert db.restore_bookings([bid]) == 0  # already restored


def test_trash_older_than_keep_days_is_purged(fresh_db):
    col = db.create_collection("purge")
    old, recent = _add(col, "OLD"), _add(col, "NEW")
    db.delete_bookings_batch([old, recent])
    with db.get_connection() as conn:
        conn.execute("UPDATE booking_trash SET deleted_at = '2000-01-01 00:00:00' WHERE id = ?;", (old,))
    assert db.purge_expired_booking_trash() == 1
    assert _trash_ids(col) == [recent]
    assert db.restore_bookings([old]) == 0


def test_deleting_a_collection_drops_its_trash(fresh_db):
    col = db.create_collection("gone")
    db.delete_booking(_add(col, "X"))
    db.delete_collection(col)
    with db.get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM booking_trash;").fetchone()[0] == 0


def test_trash_endpoints(client):
    col = db.create_collection("api-trash")
    ids = [_add(col, n) for n in ("T1", "T2")]
    assert client.post(f"{API}/bookings/batch-delete", json={"ids": ids}).json() == {"status": "success", "deleted": 2}
    res = client.get(f"{API}/bookings/trash", params={"collection_id": col}).json()
    assert res["keep_days"] == db.BOOKING_TRASH_KEEP_DAYS and res["total"] == 2
    assert sorted(i["Booking No"] for i in res["items"]) == ["T1", "T2"]
    assert sorted(client.get(f"{API}/bookings/trash/ids", params={"collection_id": col}).json()["ids"]) == sorted(ids)
    assert client.get(f"{API}/bookings/trash/count", params={"collection_id": col}).json() == {"count": 2}
    res = client.post(f"{API}/bookings/trash/restore", json={"ids": ids})
    assert res.json() == {"status": "success", "restored": 2}
    assert _live_ids(col) == sorted(ids)


def test_trash_is_paginated_newest_deleted_first(fresh_db):
    col = db.create_collection("pages")
    ids = [_add(col, f"P{i}") for i in range(5)]
    db.delete_bookings_batch(ids)
    with db.get_connection() as conn:  # deleted one minute apart, the last id most recently
        for n, i in enumerate(ids):
            conn.execute("UPDATE booking_trash SET deleted_at = ? WHERE id = ?;", (f"2099-01-01 00:0{n}:00", i))
    pages = [db.get_booking_trash(col, limit=2, offset=off) for off in (0, 2, 4)]
    assert [p["total"] for p in pages] == [5, 5, 5]
    assert [[b["id"] for b in p["items"]] for p in pages] == [ids[:2:-1][:2], ids[2:0:-1], ids[:1]]


def test_delete_from_trash_now(client):
    col = db.create_collection("purge-now")
    keep, drop = _add(col, "KEEP"), _add(col, "DROP")
    db.delete_bookings_batch([keep, drop])
    res = client.post(f"{API}/bookings/trash/delete", json={"ids": [drop, 424242]})
    assert res.json() == {"status": "success", "deleted": 1}
    assert _trash_ids(col) == [keep]
    assert db.restore_bookings([drop]) == 0  # gone for good
