import time

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app

API = "/api/v1"


def _seed_containers(col_id: int, n: int, prefix: str = "TEST", event_types=("UNLOAD", "INGATE", "LOAD")):
    rows = []
    for i in range(n):
        rows.append((col_id, "CTL", f"{prefix}{i:07d}", f"2026-09-{(i % 28) + 1:02d} 10:00:00",
                     event_types[i % len(event_types)], f"2026-09-15 10:{i % 60:02d}:00"))
    with db.get_connection() as conn:
        conn.executemany(
            "INSERT INTO containers (collection_id, site_id, containerno, event_time, event_type, queried_at) "
            "VALUES (?, ?, ?, ?, ?, ?);", rows)


def test_containers_page_basic(fresh_db):
    col = db.create_collection("P1")
    _seed_containers(col, 7)
    page = db.get_containers_page(col, limit=3, offset=0)
    assert page["total"] == 7
    assert len(page["items"]) == 3
    assert page["event_type_counts"] == {"UNLOAD": 3, "INGATE": 2, "LOAD": 2}
    assert "customs_status" in page["items"][0]

    all_ids = db.get_container_ids(col)
    paged_ids = [r["id"] for off in (0, 3, 6) for r in db.get_containers_page(col, limit=3, offset=off)["items"]]
    assert paged_ids == all_ids
    assert [r["id"] for r in db.get_containers(col)] == all_ids


def test_containers_page_filters(fresh_db):
    col = db.create_collection("P2")
    _seed_containers(col, 9)
    page = db.get_containers_page(col, limit=50, event_type="load")
    assert page["total"] == 3
    assert page["event_type_counts"]["UNLOAD"] == 3  # counts ignore the event_type filter
    page = db.get_containers_page(col, limit=50, search_query="0000004", search_field="containerno")
    assert page["total"] == 1
    assert db.get_container_ids(col, event_type="LOAD") == [r["id"] for r in page_all(col, "LOAD")]


def page_all(col, ev):
    return db.get_containers_page(col, limit=5000, event_type=ev)["items"]


def test_page_bounds_are_clamped(fresh_db):
    assert db._page_bounds(0, -5) == (1, 0)
    assert db._page_bounds(10**9, 20) == (db.PAGE_MAX_LIMIT, 20)
    assert db._page_bounds(None, None) == (50, 0)


def test_containers_page_api(fresh_db):
    client = TestClient(app)
    col = db.create_collection("P3")
    _seed_containers(col, 5)
    res = client.get(f"{API}/containers/page", params={"collection_id": col, "limit": 2, "offset": 2})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 5 and len(body["items"]) == 2
    ids = client.get(f"{API}/containers/ids", params={"collection_id": col, "event_type": "UNLOAD"}).json()["ids"]
    assert len(ids) == 2
    rows = client.post(f"{API}/containers/by-ids", json={"ids": ids}).json()
    assert sorted(r["id"] for r in rows) == sorted(ids)


def test_containers_page_50k_under_budget(fresh_db):
    col = db.create_collection("BIG")
    _seed_containers(col, 50_000)
    db.init_db()  # make sure indexes exist on the fresh DB
    started = time.perf_counter()
    page = db.get_containers_page(col, limit=50, offset=0)
    first = time.perf_counter() - started
    started = time.perf_counter()
    db.get_containers_page(col, limit=50, offset=25_000, search_query="TEST00")
    searched = time.perf_counter() - started
    assert page["total"] == 50_000
    assert first < 0.5, f"first page took {first:.3f}s"
    assert searched < 1.0, f"search page took {searched:.3f}s"


def test_vessels_page_and_ids(fresh_db):
    col = db.create_collection("V")
    db.insert_vessel_schedules(col, [
        {"SITE_ID": "CTL", "VESSELNAME": f"SHIP {i}", "IN_OUT_VOYAGE": f"{i:03d}N"} for i in range(6)
    ])
    page = db.get_vessel_schedules_page(col, limit=4, offset=4)
    assert page["total"] == 6 and len(page["items"]) == 2
    assert db.get_vessel_schedule_ids(col) == [r["id"] for r in db.get_vessel_schedules(col)]
    assert db.get_vessel_schedules_page(col, search_query="SHIP 3", search_field="vessel_name")["total"] == 1


def test_bookings_page_ids_and_by_ids(fresh_db):
    client = TestClient(app)
    col = db.create_collection("B")
    for i in range(5):
        db.insert_booking(col, {"Booking No": f"SGN{i}", "Vessel": "KOTA", "Carrier": "PIL"})
    body = client.get(f"{API}/bookings/page", params={"collection_id": col, "limit": 2}).json()
    assert body["total"] == 5 and [b["Booking No"] for b in body["items"]] == ["SGN0", "SGN1"]
    ids = client.get(f"{API}/bookings/ids", params={"collection_id": col, "search_query": "SGN4"}).json()["ids"]
    assert len(ids) == 1
    rows = client.post(f"{API}/bookings/by-ids", json={"ids": ids}).json()
    assert rows[0]["Booking No"] == "SGN4" and rows[0]["id"] == ids[0]
    assert client.get(f"{API}/vessels/page", params={"collection_id": col}).json() == {"items": [], "total": 0}

