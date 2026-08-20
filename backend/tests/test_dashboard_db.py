import pytest
import time
from backend.app.core.database import (
    init_db, create_collection, insert_booking, 
    insert_vessel_schedules, insert_containers,
    get_dashboard_summary
)

def test_get_dashboard_summary_empty_db():
    init_db()
    summary = get_dashboard_summary()
    assert "kpis" in summary
    assert "alerts" in summary
    assert "distributions" in summary
    assert "updated_at" in summary
    assert summary["kpis"]["total_bookings"] >= 0
    assert summary["kpis"]["customs_uncleared"] >= 0

def test_get_dashboard_summary_with_data():
    init_db()
    col_id = create_collection(f"Test Dashboard Col {time.time()}")
    
    # Add booking
    insert_booking(col_id, {
        "booking_no": "BKG123",
        "carrier": "ONE",
        "equipment_type": "40HC",
        "qty": "2x40HC",
        "cutoff_time": "2026-08-25 12:00",
        "vessel": "ONE APUS",
        "port_of_discharging": "SINGAPORE"
    })
    
    # Add container
    insert_containers(col_id, [{
        "site_id": "CTL",
        "containerno": "TCNU1234567",
        "event_time": "2026-08-20 10:00",
        "event_type": "INGATE",
        "in_yard": "Y",
        "custom_clearance_status": "Chưa duyệt (N)",
        "infras_fee_status": "Chưa đóng (3)",
        "fel": "F",
        "iso": "40HC"
    }])
    
    # Add vessel
    insert_vessel_schedules(col_id, [{
        "site_id": "CTL",
        "vessel_name": "ONE APUS",
        "in_out_voyage": "001N",
        "actual_berth_time": "2026-08-21 08:00",
        "closing_time": "2026-08-20 20:00"
    }])
    
    summary = get_dashboard_summary(collection_id=col_id)
    assert summary["kpis"]["total_bookings"] == 1
    assert summary["kpis"]["customs_uncleared"] == 1
    assert summary["kpis"]["infras_unpaid"] == 1
    assert summary["kpis"]["containers_in_yard"] == 1
    assert len(summary["distributions"]["carriers"]) >= 1
    assert summary["distributions"]["carriers"][0]["name"] == "ONE"
