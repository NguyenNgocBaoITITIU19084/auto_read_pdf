import io
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.database import init_db, get_collections, create_collection

@pytest.fixture(autouse=True)
def setup_database():
    init_db()
    if not get_collections():
        create_collection("Default Collection")

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_collections_crud():
    # 1. List collections
    res = client.get("/api/v1/collections")
    assert res.status_code == 200
    initial_cols = res.json()
    assert len(initial_cols) >= 1
    
    # 2. Create new collection
    test_col_name = "Test API Collection"
    res_create = client.post("/api/v1/collections", json={"name": test_col_name})
    assert res_create.status_code == 200
    col_id = res_create.json()["id"]
    
    # 3. Update settings
    res_settings = client.put(f"/api/v1/collections/{col_id}/settings", json={"settings": '{"lang": "vi"}'})
    assert res_settings.status_code == 200
    
    # 4. Delete collection
    res_del = client.delete(f"/api/v1/collections/{col_id}")
    assert res_del.status_code == 200
    assert res_del.json()["status"] == "success"

@patch("backend.app.api.bookings.extract_booking_data")
def test_bookings_upload_and_list(mock_extract):
    mock_extract.return_value = {
        "STT": "",
        "Tên file PDF": "sample.pdf",
        "Booking No": "DJSCSGN260002307",
        "Port of Discharging": "INCHEON",
        "Place of Delivery": "INCHEON",
        "Block": "null",
        "T/S Port": "null",
        "Equipment Type": "20'DRY ST",
        "Q'ty": "1",
        "Empty Pick Up CY": "null",
        "Full return CY": "CAT LAI TERMINAL",
        "Port Cargo Cut-off": "2026-05-03 13:00",
        "Pre Carrier": "null",
        "ETD_Pre": "null",
        "Trunk Vessel": "DONGJIN CONFIDENT 0145N",
        "ETD_Trunk": "2026-05-04",
        "Vessel": "DONGJIN CONFIDENT 0145N",
        "ETD": "2026-05-04"
    }

    cols = client.get("/api/v1/collections").json()
    col_id = cols[0]["id"]

    # Upload mock PDF file
    file_content = b"%PDF-1.4 test mock pdf content"
    files = [("files", ("dongjin_sample.pdf", io.BytesIO(file_content), "application/pdf"))]
    data = {"collection_id": col_id}
    
    res = client.post("/api/v1/bookings/upload", data=data, files=files)
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["count"] == 1
    booking_id = res_data["items"][0]["id"]
    
    # List bookings
    list_res = client.get(f"/api/v1/bookings?collection_id={col_id}")
    assert list_res.status_code == 200
    items = list_res.json()
    assert any(b["Booking No"] == "DJSCSGN260002307" for b in items)
    
    # Delete booking
    del_res = client.delete(f"/api/v1/bookings/{booking_id}")
    assert del_res.status_code == 200

@patch("backend.app.api.vessels.search_vessels")
def test_vessels_search_and_watchlist(mock_search):
    mock_search.return_value = [
        {
            "SITE_ID": "CTL",
            "AGENT": "PIL",
            "VESSELNAME": "KOTA NEKAD",
            "IN_OUT_VOYAGE": "0272S",
            "ACTUAL_BERTH_TIME": "2026-07-13 10:00",
            "ACTUAL_DEPATURE_TIME": "2026-07-14 12:00",
            "CLOSING_TIME": "2026-07-13 02:00",
            "CLOSING_TIME_ICD": "",
            "IN_GATE": "A1",
            "OPEN_TS": "2026-07-10",
            "REEFER_OPEN_TS": "",
            "OOG_OPEN_TS": "",
            "HAZ_OPEN_TS": "",
            "REMARKS": "Test vessel"
        }
    ]

    cols = client.get("/api/v1/collections").json()
    col_id = cols[0]["id"]

    # Search vessels
    res = client.post("/api/v1/vessels/search", json={
        "collection_id": col_id,
        "site_id": "CTL",
        "vessel_name": "KOTA NEKAD",
        "voyage": "0272S"
    })
    assert res.status_code == 200
    assert res.json()["count"] == 1
    
    # Add to watchlist
    res_wl = client.post("/api/v1/vessels/watchlist", json={
        "collection_id": col_id,
        "site_id": "CTL",
        "vessel_name": "KOTA NEKAD",
        "voyage": "0272S"
    })
    assert res_wl.status_code == 200
    
    # List watchlist
    wl_list = client.get(f"/api/v1/vessels/watchlist?collection_id={col_id}").json()
    assert any(w["vessel_name"] == "KOTA NEKAD" for w in wl_list)
    wl_id = wl_list[0]["id"]
    
    # Delete from watchlist
    del_wl = client.delete(f"/api/v1/vessels/watchlist/{wl_id}")
    assert del_wl.status_code == 200

def test_export_excel_endpoint():
    payload = {
        "data": [
            {"STT": 1, "Số Booking": "DJSCSGN260002307", "Cảng đích": "INCHEON", "Loại cont": "20'DRY ST"}
        ],
        "selected_columns": ["STT", "Số Booking", "Cảng đích", "Loại cont"]
    }
    res = client.post("/api/v1/export/excel", json=payload)
    assert res.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res.headers["content-type"]
    assert len(res.content) > 100

def test_backup_and_restore_endpoint():
    # Backup
    res_b = client.get("/api/v1/backup")
    assert res_b.status_code == 200
    backup_data = res_b.json()
    assert "collections" in backup_data
    
    # Restore
    res_r = client.post("/api/v1/restore", json=backup_data)
    assert res_r.status_code == 200
    assert res_r.json()["status"] == "success"

from unittest.mock import patch, AsyncMock

@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_scheduler_endpoints(mock_sync):
    res_toggle = client.post("/api/v1/scheduler/toggle", json={"enable": True, "interval_minutes": 15})
    assert res_toggle.status_code == 200
    assert res_toggle.json()["enabled"] is True
    
    res_status = client.get("/api/v1/scheduler/status")
    assert res_status.status_code == 200
    assert res_status.json()["enabled"] is True
    
    # Turn off
    client.post("/api/v1/scheduler/toggle", json={"enable": False})
