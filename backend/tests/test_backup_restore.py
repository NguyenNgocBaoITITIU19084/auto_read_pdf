import pytest
from backend.app.core import database as db


def test_backup_restore_includes_color_rules():
    db.init_db()
    # Create custom rule
    rule_id = db.create_color_rule({
        "target_table": "booking",
        "column_key": "Carrier",
        "match_value": "COSCO_SPECIAL",
        "match_type": "exact",
        "preset_id": "purple",
        "is_enabled": 1
    })
    
    # Export backup
    backup = db.export_backup_data()
    assert "color_rules" in backup
    assert any(r["match_value"] == "COSCO_SPECIAL" for r in backup["color_rules"])
    
    # Simulate restoring
    db.import_backup_data(backup)
    restored_rules = db.get_color_rules()
    assert any(r["match_value"] == "COSCO_SPECIAL" for r in restored_rules)


def _counts(col_name):
    col = next(c for c in db.get_collections() if c["name"] == col_name)
    return len(db.get_bookings(col["id"])), len(db.get_vessel_schedules(col["id"])), len(db.get_containers(col["id"]))


def _backup_with_one_collection(name="KHO A", booking_vessel="KOTA NEW"):
    return {
        "collections": [{
            "name": name, "created_at": "2026-01-01 00:00:00", "settings": None,
            "bookings": [{"booking_no": "SGN1", "pdf_name": "a.pdf", "vessel": booking_vessel}],
            "vessel_schedules": [{"site_id": "CTL", "vessel_name": "EVER", "in_out_voyage": "001N", "remarks": "from backup"}],
            "containers": [{"site_id": "CTL", "containerno": "ABCU1234567", "event_time": "t1", "event_type": "LOAD"}],
            "vessel_watchlists": [], "container_watchlists": [],
        }],
        "color_rules": [{"target_table": "booking", "column_key": "Carrier", "match_value": "PIL-TEST",
                         "match_type": "exact", "preset_id": "red", "is_enabled": 1}],
    }


def test_merge_into_same_name_collection_backup_wins(fresh_db):
    col = db.create_collection("KHO A")
    db.insert_booking(col, {"booking_no": "SGN1", "pdf_name": "a.pdf", "vessel": "KOTA OLD"})
    db.insert_booking(col, {"booking_no": "SGN2", "pdf_name": "b.pdf"})
    db.insert_vessel_schedules(col, [{"SITE_ID": "CTL", "VESSELNAME": "EVER", "IN_OUT_VOYAGE": "001N", "REMARKS": "local"}])
    db.create_color_rule({"target_table": "booking", "column_key": "Carrier", "match_value": "PIL-TEST",
                          "match_type": "exact", "preset_id": "blue"})

    db.import_backup_data(_backup_with_one_collection(), mode="merge")

    assert [c["name"] for c in db.get_collections()].count("KHO A") == 1
    bookings = db.get_bookings(col)
    assert sorted(b["Booking No"] for b in bookings) == ["SGN1", "SGN2"]
    assert next(b for b in bookings if b["Booking No"] == "SGN1")["Vessel"] == "KOTA NEW"
    assert db.get_vessel_schedules(col)[0]["remarks"] == "from backup"
    pil = [r for r in db.get_color_rules() if r["match_value"] == "PIL-TEST"]
    assert len(pil) == 1 and pil[0]["preset_id"] == "red"
    assert any(r["match_value"] == "CTL" for r in db.get_color_rules())  # untouched default rules survive merge


def test_merge_twice_is_idempotent(fresh_db):
    backup = _backup_with_one_collection()
    db.import_backup_data(backup, mode="merge")
    db.import_backup_data(backup, mode="merge")
    assert _counts("KHO A") == (1, 1, 1)


def test_replace_wipes_existing_data(fresh_db):
    other = db.create_collection("KHO CU")
    db.insert_booking(other, {"booking_no": "OLD"})
    db.import_backup_data(_backup_with_one_collection(), mode="replace")
    assert [c["name"] for c in db.get_collections()] == ["KHO A"]
    assert _counts("KHO A") == (1, 1, 1)
    assert [r["match_value"] for r in db.get_color_rules()] == ["PIL-TEST"]


def test_invalid_mode_rejected(fresh_db):
    with pytest.raises(ValueError):
        db.import_backup_data(_backup_with_one_collection(), mode="nuke")


def test_restore_endpoint_mode(fresh_db):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    client = TestClient(app)
    assert client.post("/api/v1/restore?mode=nuke", json=_backup_with_one_collection()).status_code == 400
    res = client.post("/api/v1/restore?mode=replace", json=_backup_with_one_collection())
    assert res.status_code == 200 and res.json()["mode"] == "replace"
    assert client.post("/api/v1/restore", json=_backup_with_one_collection()).json()["mode"] == "merge"

