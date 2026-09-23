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
        "cust": "N",  # customs status depends only on the Giam sat HQ flag (9ff0319)
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


def test_dashboard_cust_prefilter_matches_exact_customs_sql(fresh_db):
    """The dashboard's cheaper LIKE-prefiltered customs expressions must count exactly like the shared ones."""
    from backend.app.core import database as db
    col = db.create_collection("Oracle")
    values = ["N", "n", " n ", "(N)", "Chưa (N) ", "Chưa duyệt (N)", "NO", "Y", "y", " (Y)", "(Y)", "Đã (y)", "", None, "null", "X"]
    db.insert_containers(col, [{"SITE": "CTL", "CONTAINERNO": f"ORCL{i:07d}", "EVENT_TYPE": "INGATE", "CUST": v}
                               for i, v in enumerate(values)])
    with db.get_connection() as conn:
        exact = conn.execute(f"SELECT SUM({db.CUST_N_SQL}), SUM({db.CUST_Y_SQL}) FROM containers WHERE collection_id = ?;",
                             (col,)).fetchone()
        fast = conn.execute(f"SELECT SUM({db._DASH_CUST_N_SQL}), SUM({db._DASH_CUST_Y_SQL}) FROM containers WHERE collection_id = ?;",
                            (col,)).fetchone()
        stored = conn.execute("SELECT COUNT(*) FROM containers WHERE collection_id = ?;", (col,)).fetchone()[0]
    assert stored == len(values)
    assert tuple(fast) == tuple(exact)
    assert exact[0] >= 4 and exact[1] >= 4  # the edge values really exercise both branches


def test_dashboard_alerts_are_upcoming_sorted_and_deduped(fresh_db):
    from datetime import datetime
    from backend.app.core import database as db
    col = db.create_collection("Alerts")
    now = datetime(2026, 9, 23, 12, 0)
    for no, cutoff in [
        ("PAST1", "22/09/2026 10:00"),        # past -> hidden
        ("LATE", "29/09/2026 08:00"),         # within 7 days
        ("SOON", "2026-09-23 18:00"),         # ISO format, today
        ("SOON", "24/09/2026 18:00"),         # duplicate booking no -> only the earliest kept
        ("DATEONLY", "25/09/2026"),           # date only = end of day
        ("FAR", "15/10/2026 10:00"),          # beyond the window
        ("BAD", "not a date"),                # unparseable -> ignored, no crash
        ("EARLYDAY", "03/10/2026 10:00"),     # string-sorts before 22/09 but is later than LATE
    ]:
        db.insert_booking(col, {"Booking No": no, "Port Cargo Cut-off": cutoff})
    db.insert_vessel_schedules(col, [
        {"site_id": "CTL", "vessel_name": "SHIP A", "in_out_voyage": "001N", "actual_berth_time": "08:00 25/09/2026"},
        {"site_id": "CTL", "vessel_name": "SHIP A", "in_out_voyage": "001N", "actual_berth_time": "09:00 25/09/2026"},
        {"site_id": "CTL", "vessel_name": "SHIP B", "in_out_voyage": "002S", "actual_berth_time": "23:00 23/09/2026"},
        {"site_id": "CTL", "vessel_name": "OLD", "in_out_voyage": "003", "actual_berth_time": "10:00 20/08/2026"},
    ])

    alerts = db.get_dashboard_summary(collection_id=col, now=now)["alerts"]

    assert [b["booking_no"] for b in alerts["critical_cutoffs"]] == ["SOON", "DATEONLY", "LATE"]
    assert alerts["critical_cutoffs"][0]["alert_at"] == "2026-09-23T18:00"
    assert [v["vessel_name"] for v in alerts["upcoming_vessels"]] == ["SHIP B", "SHIP A"]
    assert alerts["totals"] == {"critical_cutoffs": 3, "uncleared_containers": 0, "upcoming_vessels": 2}
    assert alerts["window_days"] == 7


def test_dashboard_api_exposes_alert_totals(fresh_db):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    data = TestClient(app).get("/api/v1/dashboard/summary").json()
    assert set(data["alerts"]["totals"]) == {"critical_cutoffs", "uncleared_containers", "upcoming_vessels"}


def test_parse_alert_datetime_formats():
    from datetime import datetime
    from backend.app.core.database import _parse_alert_datetime as p
    assert p("13/07/2026 02:00") == datetime(2026, 7, 13, 2, 0)
    assert p("25/09/2026") == datetime(2026, 9, 25, 23, 59)
    assert p("2026-07-13 10:00") == datetime(2026, 7, 13, 10, 0)
    assert p("2026-07-13T10:00:30") == datetime(2026, 7, 13, 10, 0)
    assert p("00:27  21/08/2026") == datetime(2026, 8, 21, 0, 27)
    for bad in ("30/02/2026 10:00", "25:00 21/08/2026", "null", "", None, "abc"):
        assert p(bad) is None
