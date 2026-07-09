import pytest
import sqlite3
import os
from unittest.mock import patch, MagicMock
from src.eport_client import search_vessels
from src.database import (
    init_db,
    insert_vessel_schedules,
    get_vessel_schedules,
    delete_vessel_schedule,
    clear_vessel_schedules,
    export_backup_data,
    import_backup_data
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
