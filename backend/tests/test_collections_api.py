import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def test_list_with_counts(client):
    col = db.create_collection("Kho HCM")
    db.insert_booking(col, {"Booking No": "A"})
    db.insert_booking(col, {"Booking No": "B"})
    db.insert_vessel_schedules(col, [{"SITE_ID": "CTL", "VESSELNAME": "EVER", "IN_OUT_VOYAGE": "1N"}])
    db.insert_containers(col, [{"SITE": "CTL", "CONTAINERNO": "ABCU1234567", "EVENT_TIME": "t", "EVENT_TYPE": "LOAD"}])
    db.add_to_watchlist(col, "CTL", "EVER", "1N")
    rows = client.get(f"{API}/collections", params={"with_counts": "true"}).json()
    row = next(r for r in rows if r["id"] == col)
    assert (row["booking_count"], row["vessel_count"], row["container_count"], row["watchlist_count"]) == (2, 1, 1, 1)
    plain = client.get(f"{API}/collections").json()
    assert "booking_count" not in next(r for r in plain if r["id"] == col)


def test_rename_collection(client):
    a = db.create_collection("Alpha")
    db.create_collection("Beta")
    res = client.put(f"{API}/collections/{a}", json={"name": "  Alpha 2026 "})
    assert res.status_code == 200 and res.json()["name"] == "Alpha 2026"
    assert client.put(f"{API}/collections/{a}", json={"name": "beta"}).status_code == 409
    assert client.put(f"{API}/collections/{a}", json={"name": "   "}).status_code == 400
    assert client.put(f"{API}/collections/{a}", json={"name": "x" * 101}).status_code == 400
    assert client.put(f"{API}/collections/999999", json={"name": "Gamma"}).status_code == 404
    assert client.put(f"{API}/collections/{a}", json={"name": "ALPHA 2026"}).status_code == 200  # own name, other case


def test_create_duplicate_returns_409(client):
    db.create_collection("Dup")
    assert client.post(f"{API}/collections", json={"name": "dup"}).status_code == 409
