import pytest
import sqlite3
import os
from unittest.mock import patch, MagicMock
from src.eport_client import search_vessels, search_containers
from src.database import (
    init_db,
    insert_vessel_schedules,
    get_vessel_schedules,
    delete_vessel_schedule,
    clear_vessel_schedules,
    export_backup_data,
    import_backup_data,
    get_watchlist,
    add_to_watchlist,
    remove_from_watchlist,
    insert_containers,
    get_containers,
    delete_container,
    clear_containers,
    get_container_watchlist,
    add_to_container_watchlist,
    remove_from_container_watchlist
)

@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    with sqlite3.connect("booking_data.db") as conn:
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("DELETE FROM collections;")
        conn.commit()
    yield

def test_vessel_schedule_database_operations():
    # Arrange: sample vessel schedules
    schedules = [
        {
            "SITE_ID": "CTL",
            "AGENT": "EMC",
            "VESSELNAME": "EVER MEMO",
            "IN_OUT_VOYAGE": "1461-012E",
            "ACTUAL_BERTH_TIME": "EST (dự kiến): 04:00 27/06/2026",
            "ACTUAL_DEPATURE_TIME": "EST (dự kiến): 02:00 28/06/2026",
            "CLOSING_TIME": "22:00 25/06/2026",
            "CLOSING_TIME_ICD": "22:00 25/06/2026",
            "IN_GATE": "Gate E",
            "OPEN_TS": "00:00 12/06/2026",
            "REEFER_OPEN_TS": "00:00 24/06/2026",
            "OOG_OPEN_TS": "00:00 24/06/2026",
            "HAZ_OPEN_TS": "00:00 27/06/2026",
            "REMARKS": "[ETB gốc 26/06]"
        },
        {
            "SITE_ID": "GNL",
            "AGENT": "ONE",
            "VESSELNAME": "ONE FOREVER",
            "IN_OUT_VOYAGE": "009E",
            "ACTUAL_BERTH_TIME": "16:59 05/07/2026",
            "ACTUAL_DEPATURE_TIME": "04:00 07/07/2026",
            "CLOSING_TIME": "16:59 04/07/2026",
            "CLOSING_TIME_ICD": "16:59 04/07/2026",
            "IN_GATE": "Gate E",
            "OPEN_TS": "00:00 20/06/2026",
            "REEFER_OPEN_TS": "00:00 02/07/2026",
            "OOG_OPEN_TS": "00:00 02/07/2026",
            "HAZ_OPEN_TS": "00:00 05/07/2026",
            "REMARKS": "None"
        }
    ]

    # Act & Assert: Create a collection first
    from src.database import create_collection
    col_id = create_collection("Test Vessel Collection")

    insert_vessel_schedules(col_id, schedules)
    
    # Retrieve
    stored = get_vessel_schedules(col_id)
    assert len(stored) == 2
    
    # Verify values
    vessel_names = [s["vessel_name"] for s in stored]
    assert "EVER MEMO" in vessel_names
    assert "ONE FOREVER" in vessel_names
    
    # Test duplicate override (UNIQUE constraint ON CONFLICT REPLACE)
    updated_schedules = [
        {
            "SITE_ID": "CTL",
            "AGENT": "EMC",
            "VESSELNAME": "EVER MEMO",
            "IN_OUT_VOYAGE": "1461-012E",
            "ACTUAL_BERTH_TIME": "EST (dự kiến): 04:00 27/06/2026",
            "ACTUAL_DEPATURE_TIME": "EST (dự kiến): 02:00 28/06/2026",
            "CLOSING_TIME": "22:00 25/06/2026",
            "CLOSING_TIME_ICD": "22:00 25/06/2026",
            "IN_GATE": "Gate E",
            "OPEN_TS": "00:00 12/06/2026",
            "REEFER_OPEN_TS": "00:00 24/06/2026",
            "OOG_OPEN_TS": "00:00 24/06/2026",
            "HAZ_OPEN_TS": "00:00 27/06/2026",
            "REMARKS": "UPDATED REMARK"
        }
    ]
    insert_vessel_schedules(col_id, updated_schedules)
    stored = get_vessel_schedules(col_id)
    assert len(stored) == 2  # Still 2 records due to replace
    
    ever_memo = [s for s in stored if s["vessel_name"] == "EVER MEMO"][0]
    assert ever_memo["remarks"] == "UPDATED REMARK"
    
    # Test query search
    search_results = get_vessel_schedules(col_id, "ONE FOREVER")
    assert len(search_results) == 1
    assert search_results[0]["vessel_name"] == "ONE FOREVER"

    # Test query search with specific field match
    search_results_field = get_vessel_schedules(col_id, "ONE FOREVER", "vessel_name")
    assert len(search_results_field) == 1
    assert search_results_field[0]["vessel_name"] == "ONE FOREVER"

    # Test query search with specific field mismatch
    search_results_mismatch = get_vessel_schedules(col_id, "ONE FOREVER", "agent")
    assert len(search_results_mismatch) == 0

    # Test delete
    vessel_id = stored[0]["id"]
    delete_vessel_schedule(vessel_id)
    assert len(get_vessel_schedules(col_id)) == 1

    # Test clear
    clear_vessel_schedules(col_id)
    assert len(get_vessel_schedules(col_id)) == 0

@patch("requests.post")
def test_search_vessels_client_success(mock_post):
    # Arrange
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "type": "success",
        "content": "",
        "model": [
            {
                "SITE_ID": "GML   ",
                "AGENT": "EMC",
                "VESSELNAME": "EVER MEMO                     ",
                "IN_OUT_VOYAGE": "1461-012E",
                "ACTUAL_BERTH_TIME": "04:00 27/06/2026",
                "ACTUAL_DEPATURE_TIME": "02:00 28/06/2026",
                "CLOSING_TIME": "22:00 25/06/2026"
            }
        ]
    }
    mock_post.return_value = mock_response

    # Act
    results = search_vessels("GNL", "EVER MEMO", "1461-012E")

    # Assert
    assert len(results) == 1
    # Check that strings are stripped of whitespace
    assert results[0]["VESSELNAME"] == "EVER MEMO"
    assert results[0]["SITE_ID"] == "GML"
    assert results[0]["AGENT"] == "EMC"
    assert results[0]["CLOSING_TIME"] == "22:00 25/06/2026"
    
    # Verify post arguments
    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert kwargs["json"]["siteId"] == "GNL"
    assert kwargs["json"]["vesselName"] == "EVER MEMO/1461-012E"

@patch("requests.post")
def test_search_vessels_client_failures(mock_post):
    # Test network failure
    mock_post.side_effect = ConnectionError("Connection refused")
    with pytest.raises(ConnectionError):
        search_vessels("GNL", "EVER MEMO")

    # Test API error response
    mock_post.side_effect = None
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "type": "error",
        "content": "Invalid request parameters"
    }
    mock_post.return_value = mock_response
    with pytest.raises(ValueError, match="Invalid request parameters"):
        search_vessels("GNL", "EVER MEMO")

def test_vessel_watchlist_operations():
    from src.database import create_collection
    col_id = create_collection("Watchlist Collection")
    
    # Empty at first
    assert len(get_watchlist(col_id)) == 0
    
    # Add items
    add_to_watchlist(col_id, "CTL", "SPIL NIKEN", "24003N")
    add_to_watchlist(col_id, "GNL", "EVER MEMO", "1461-012E")
    
    # Check retrieval
    watchlist = get_watchlist(col_id)
    assert len(watchlist) == 2
    
    # Check fields
    niken = [w for w in watchlist if w["vessel_name"] == "SPIL NIKEN"][0]
    assert niken["site_id"] == "CTL"
    assert niken["voyage"] == "24003N"
    
    # Test UNIQUE constraint IGNORE
    add_to_watchlist(col_id, "CTL", "SPIL NIKEN", "24003N")
    assert len(get_watchlist(col_id)) == 2
    
    # Test delete
    remove_from_watchlist(niken["id"])
    assert len(get_watchlist(col_id)) == 1
    assert get_watchlist(col_id)[0]["vessel_name"] == "EVER MEMO"

def test_collection_settings_operations():
    from src.database import create_collection, get_collections, update_collection_settings, export_backup_data, import_backup_data
    
    col_id = create_collection("Settings Test Collection")
    
    # Check default settings is None/empty
    collections = get_collections()
    test_col = [c for c in collections if c["id"] == col_id][0]
    assert test_col["settings"] is None
    
    # Update settings
    settings_data = '{"booking_columns": ["STT", "ETD"], "booking_visibility": {"STT": true}}'
    update_collection_settings(col_id, settings_data)
    
    # Verify settings updated
    collections = get_collections()
    test_col = [c for c in collections if c["id"] == col_id][0]
    assert test_col["settings"] == settings_data
    
    # Test Backup & Restore of Settings
    backup = export_backup_data()
    backed_col = [c for c in backup["collections"] if c["name"] == "Settings Test Collection"][0]
    assert backed_col["settings"] == settings_data
    
    # Delete collections to restore
    with sqlite3.connect("booking_data.db") as conn:
        conn.execute("DELETE FROM collections;")
        conn.commit()
        
    assert len(get_collections()) == 0
    
    # Restore
    import_backup_data(backup)
    
    # Verify restored collections have settings
    restored = get_collections()
    assert len(restored) == 1
    assert restored[0]["settings"] == settings_data

def test_container_database_operations():
    from src.database import create_collection
    col_id = create_collection("Container Test Collection")
    
    # Arrange container data
    containers = [
        {
            "SITE": "CTL",
            "CONTAINERNO": "EMCU9914560",
            "EVENT_TIME": "2026-07-17 04:11:02",
            "EVENT_TYPE": "UNLOAD",
            "FEL": "F",
            "ISO": "4500",
            "GROSS": 26.6,
            "VGM": "Y",
            "CATEGORY": "I",
            "CUST": "Y",
            "LOCATION": "006.01.02",
            "TRUCK_VESSEL": "SPIL NIRMALA - 108W",
            "TRANS_IN": "2026-07-17 02:00:00",
            "TRANS_OUT": "2026-07-17 06:00:00",
            "GATE_WT": 0.0,
            "LINE_OPER": "EMC",
            "IM_EXP": "Import",
            "BILL_BOOK": "EGLV001600173631",
            "CUST_APPROVAL_DATE": "2026-07-17 08:00:00",
            "NOTE": "Cont chưa đóng phí",
            "ITEM_SEAL_NO": "EMCTTU7694",
            "CUSTOM_CLEARANCE_STATUS": "N",
            "INFRAS_FEE_STATUS": "3"
        },
        {
            "SITE": "CTL",
            "CONTAINERNO": "EGSU6257353",
            "EVENT_TIME": "2026-07-17 04:11:02",
            "EVENT_TYPE": "OUTGATE",
            "FEL": "F",
            "ISO": "4500",
            "GROSS": 28.89,
            "VGM": "Y",
            "CATEGORY": "Q",
            "CUST": "Y",
            "LOCATION": " ",
            "TRUCK_VESSEL": "50E53291-50RM15440",
            "TRANS_IN": "2026-07-17 01:00:00",
            "TRANS_OUT": "2026-07-17 03:00:00",
            "GATE_WT": 28.89,
            "LINE_OPER": "EMC",
            "IM_EXP": "Transit container",
            "BILL_BOOK": "560600053306",
            "CUST_APPROVAL_DATE": "2026-07-17 07:00:00",
            "NOTE": "Ok",
            "ITEM_SEAL_NO": "0403212,VN418424",
            "CUSTOM_CLEARANCE_STATUS": "N",
            "INFRAS_FEE_STATUS": "3"
        }
    ]
    
    # Act: insert containers
    inserted_ids = insert_containers(col_id, containers)
    assert len(inserted_ids) == 2
    
    # Fetch containers
    fetched = get_containers(col_id)
    assert len(fetched) == 2
    assert fetched[0]["containerno"] in ["EMCU9914560", "EGSU6257353"]
    assert fetched[0]["site_id"] == "CTL"
    
    # Test watchlist operations
    add_to_container_watchlist(col_id, "CTL", "EMCU9914560")
    add_to_container_watchlist(col_id, "GNL", "EGSU6257353")
    
    watchlist = get_container_watchlist(col_id)
    assert len(watchlist) == 2
    assert watchlist[0]["container_no"] == "EMCU9914560"
    assert watchlist[0]["site_id"] == "CTL"
    
    # Test duplicate ignore
    add_to_container_watchlist(col_id, "CTL", "EMCU9914560")
    assert len(get_container_watchlist(col_id)) == 2
    
    # Delete from watchlist
    remove_from_container_watchlist(watchlist[0]["id"])
    assert len(get_container_watchlist(col_id)) == 1
    
    # Delete container
    delete_container(fetched[0]["id"])
    assert len(get_containers(col_id)) == 1
    
    # Clear containers
    clear_containers(col_id)
    assert len(get_containers(col_id)) == 0

def test_container_backup_restore():
    from src.database import create_collection, get_collections
    col_id = create_collection("Container Backup Test")
    
    # Insert container and watchlist
    containers = [
        {"SITE": "CTL", "CONTAINERNO": "EMCU9914560", "EVENT_TIME": "2026-07-17 04:11:02", "EVENT_TYPE": "UNLOAD"}
    ]
    insert_containers(col_id, containers)
    add_to_container_watchlist(col_id, "CTL", "EMCU9914560")
    
    backup = export_backup_data()
    
    # Delete to restore
    with sqlite3.connect("booking_data.db") as conn:
        conn.execute("DELETE FROM collections;")
        conn.commit()
        
    assert len(get_collections()) == 0
    
    # Restore
    import_backup_data(backup)
    
    # Verify
    restored_cols = get_collections()
    assert len(restored_cols) == 1
    new_col_id = restored_cols[0]["id"]
    
    fetched = get_containers(new_col_id)
    assert len(fetched) == 1
    assert fetched[0]["containerno"] == "EMCU9914560"
    
    watchlist = get_container_watchlist(new_col_id)
    assert len(watchlist) == 1
    assert watchlist[0]["container_no"] == "EMCU9914560"

@patch("src.eport_client.requests.post")
def test_search_containers_client(mock_post):
    # Mocking API response
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "ContentType": "success",
        "Message": "Tìm thấy 1 container.",
        "Data": [
            {
                "SITE": "CTL",
                "CONTAINERNO": "EMCU9914560",
                "EVENT_TIME": "/Date(1782769311000)/",
                "EVENT_TYPE": "UNLOAD"
            }
        ]
    }
    mock_post.return_value = mock_resp
    
    results = search_containers("CTL", "EMCU9914560")
    assert len(results) == 1
    assert results[0]["CONTAINERNO"] == "EMCU9914560"
    # Verify date is formatted properly
    assert results[0]["EVENT_TIME"] == "2026-06-30 04:41:51"
