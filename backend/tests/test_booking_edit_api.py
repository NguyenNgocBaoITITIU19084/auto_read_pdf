import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services.booking_validation import normalize_manual_booking

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def test_normalize_manual_booking_rules():
    data, errors = normalize_manual_booking({"Booking No": "  SGN1 ", "ETD": "2026-09-20", "Q'ty": "2", "Block": "null"})
    assert errors == [] and data["Booking No"] == "SGN1" and data["ETD"] == "20/09/2026" and data["Block"] == ""
    _, errors = normalize_manual_booking({"Booking No": "X", "ETD": "30/02/2026", "Port Cargo Cut-off": "abc", "Q'ty": "0"})
    assert len(errors) == 3
    _, errors = normalize_manual_booking({"Carrier": "PIL"})
    assert errors and "Booking No" in errors[0]
    _, errors = normalize_manual_booking({"Carrier": "PIL"}, require_identity=False)
    assert errors == []


def test_normalize_manual_booking_uppercases_text_fields():
    data, errors = normalize_manual_booking({
        "Booking No": "sgn601021000",
        "Vessel": "Kota Azam 2505s",
        "Carrier": "pil",
        "Port of Discharging": "durban",
    })
    assert errors == []
    assert data["Booking No"] == "SGN601021000"
    assert data["Vessel"] == "KOTA AZAM 2505S"
    assert data["Carrier"] == "PIL"
    assert data["Port of Discharging"] == "DURBAN"


def test_manual_save_validates_and_warns_duplicates(client):
    col = db.create_collection("M")
    bad = client.post(f"{API}/bookings/manual-save", json={"collection_id": col, "booking": {"Carrier": "PIL"}})
    assert bad.status_code == 400
    first = client.post(f"{API}/bookings/manual-save", json={"collection_id": col, "booking": {"Booking No": "SGN9", "ETD": "2026-09-20"}})
    assert first.status_code == 200 and first.json()["warnings"] == []
    assert first.json()["item"]["ETD"] == "20/09/2026"
    dup = client.post(f"{API}/bookings/manual-save", json={"collection_id": col, "booking": {"Booking No": "sgn9 "}})
    assert dup.status_code == 200 and "SGN9" in dup.json()["warnings"][0].upper()


def test_update_booking_partial_and_not_found(client):
    col = db.create_collection("U")
    bid = db.insert_booking(col, {"Booking No": "A1", "Vessel": "OLD", "Carrier": "PIL"})
    res = client.put(f"{API}/bookings/{bid}", json={"booking": {"Vessel": "NEW SHIP", "Port Cargo Cut-off": "2026-09-18 17:00"}})
    assert res.status_code == 200
    item = res.json()["item"]
    assert item["Vessel"] == "NEW SHIP" and item["Carrier"] == "PIL" and item["Port Cargo Cut-off"] == "18/09/2026 17:00"
    assert db.get_bookings(col)[0]["Vessel"] == "NEW SHIP"
    assert client.put(f"{API}/bookings/999999", json={"booking": {"Vessel": "X"}}).status_code == 404
    assert client.put(f"{API}/bookings/{bid}", json={"booking": {"ETD": "31/04/2026"}}).status_code == 400


def test_update_does_not_warn_about_itself(client):
    col = db.create_collection("D")
    bid = db.insert_booking(col, {"Booking No": "SAME"})
    res = client.put(f"{API}/bookings/{bid}", json={"booking": {"Booking No": "SAME", "Vessel": "V"}})
    assert res.json()["warnings"] == []
    assert db.find_duplicate_booking_ids(col, " same ") == [bid]
    assert db.find_duplicate_booking_ids(col, "SAME", exclude_id=bid) == []
