# Dashboard Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng Tab "Tổng quan (Dashboard)" trung tâm hiển thị toàn bộ các chỉ số vận hành logistics, thẻ KPI, cảnh báo khẩn cấp (Cut-off, Hải quan, Phí hạ tầng) và biểu đồ phân bổ trực quan cho ứng dụng.

**Architecture:** Backend cung cấp endpoint tổng hợp `/api/v1/dashboard/summary` thực hiện truy vấn SQL SQLite tối ưu, trả về dữ liệu JSON trong 1 request duy nhất. Frontend xây dựng giao diện Dashboard tương tác với các component chuyên biệt: KPICards, AlertsSection (hỗ trợ 1-click drilldown chuyển tab), BreakdownCharts, và tích hợp i18n & Dark Mode.

**Tech Stack:** FastAPI (Python), SQLite, React (TypeScript), Tailwind CSS, Lucide Icons, Pytest, Vite.

## Global Constraints
- Backend endpoint: `GET /api/v1/dashboard/summary?collection_id={optional_id}`
- Response time target: < 50ms for SQLite aggregation
- Full i18n support: Tiếng Việt (`vi`) và Tiếng Anh (`en`)
- 100% Dark Mode compatibility
- Zero new heavy external chart dependencies (sử dụng Tailwind + SVG progress components)

---

### Task 1: Backend Database & Dashboard Aggregation Logic

**Files:**
- Modify: `backend/app/schemas/models.py`
- Modify: `backend/app/core/database.py`
- Test: `backend/tests/test_dashboard_db.py`

**Interfaces:**
- Produces: `get_dashboard_summary(collection_id: Optional[int] = None) -> dict`

- [ ] **Step 1: Write the failing unit test for database dashboard aggregation**

Create `backend/tests/test_dashboard_db.py`:
```python
import pytest
from backend.app.core.database import (
    init_db, create_collection, save_booking_items, 
    insert_or_update_vessel_schedule, insert_or_update_container,
    get_dashboard_summary
)

def test_get_dashboard_summary_empty_db():
    init_db()
    summary = get_dashboard_summary()
    assert "kpis" in summary
    assert "alerts" in summary
    assert "distributions" in summary
    assert summary["kpis"]["total_bookings"] == 0
    assert summary["kpis"]["customs_uncleared"] == 0

def test_get_dashboard_summary_with_data():
    init_db()
    col_id = create_collection("Test Dashboard Col")
    
    # Add booking
    save_booking_items(col_id, [{
        "booking_no": "BKG123",
        "carrier": "ONE",
        "equipment_type": "40HC",
        "qty": "2x40HC",
        "cutoff_time": "2026-08-25 12:00",
        "vessel": "ONE APUS",
        "port_of_discharging": "SINGAPORE"
    }])
    
    # Add container
    insert_or_update_container(col_id, {
        "site_id": "CTL",
        "containerno": "TCNU1234567",
        "event_time": "2026-08-20 10:00",
        "event_type": "INGATE",
        "in_yard": "Y",
        "custom_clearance_status": "Chưa duyệt (N)",
        "infras_fee_status": "Chưa đóng (3)",
        "fel": "F",
        "iso": "40HC"
    })
    
    # Add vessel
    insert_or_update_vessel_schedule(col_id, {
        "site_id": "CTL",
        "vessel_name": "ONE APUS",
        "in_out_voyage": "001N",
        "actual_berth_time": "2026-08-21 08:00",
        "closing_time": "2026-08-20 20:00"
    })
    
    summary = get_dashboard_summary(collection_id=col_id)
    assert summary["kpis"]["total_bookings"] == 1
    assert summary["kpis"]["customs_uncleared"] == 1
    assert summary["kpis"]["infras_unpaid"] == 1
    assert summary["kpis"]["containers_in_yard"] == 1
    assert len(summary["distributions"]["carriers"]) >= 1
    assert summary["distributions"]["carriers"][0]["name"] == "ONE"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_dashboard_db.py -v`
Expected: FAIL with `ImportError: cannot import name 'get_dashboard_summary'`

- [ ] **Step 3: Implement `get_dashboard_summary` in `database.py` and models in `models.py`**

In `backend/app/schemas/models.py`, add response models:
```python
class DashboardKPIs(BaseModel):
    total_bookings: int
    total_estimated_teus: int
    customs_uncleared: int
    customs_cleared: int
    infras_unpaid: int
    infras_paid: int
    containers_in_yard: int
    containers_out_yard: int
    total_vessels: int
    watchlist_vessels: int
    total_containers: int
    watchlist_containers: int

class DistributionItem(BaseModel):
    name: str
    count: int
    percentage: float

class DashboardAlerts(BaseModel):
    critical_cutoffs: List[dict]
    uncleared_containers: List[dict]
    upcoming_vessels: List[dict]

class DashboardDistributions(BaseModel):
    carriers: List[DistributionItem]
    sites: List[DistributionItem]
    equipment_types: List[DistributionItem]
    container_events: List[DistributionItem]

class DashboardSummaryResponse(BaseModel):
    updated_at: str
    scope: dict
    kpis: DashboardKPIs
    alerts: DashboardAlerts
    distributions: DashboardDistributions
```

In `backend/app/core/database.py`, implement `get_dashboard_summary(collection_id=None)`:
Compute counts, parsing `qty` for TEU estimation, grouping carriers, sites, container events, cutoffs within 48h, uncleared containers, and upcoming vessel berthing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_dashboard_db.py -v`
Expected: PASS

---

### Task 2: Backend API Route & End-to-End Tests

**Files:**
- Create: `backend/app/api/dashboard.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_dashboard_api.py`

**Interfaces:**
- Produces: `GET /api/v1/dashboard/summary`

- [ ] **Step 1: Write the failing API test**

Create `backend/tests/test_dashboard_api.py`:
```python
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_dashboard_summary_api():
    response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200
    data = response.json()
    assert "kpis" in data
    assert "alerts" in data
    assert "distributions" in data
    assert "updated_at" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_dashboard_api.py -v`
Expected: FAIL with 404 Not Found

- [ ] **Step 3: Implement `backend/app/api/dashboard.py` and register in `main.py`**

In `backend/app/api/dashboard.py`:
```python
from typing import Optional
from fastapi import APIRouter, Query
from backend.app.core.database import get_dashboard_summary
from backend.app.schemas.models import DashboardSummaryResponse

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/summary", response_model=DashboardSummaryResponse)
def get_summary(collection_id: Optional[int] = Query(None)):
    return get_dashboard_summary(collection_id=collection_id)
```

In `backend/app/main.py`:
Register `dashboard_router`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_dashboard_api.py -v`
Expected: PASS

---

### Task 3: Frontend API Services, Types & i18n Translations

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/i18n/translations.ts`

- [ ] **Step 1: Update TypeScript types in `frontend/src/types/index.ts`**

Add `DashboardSummary`, `DashboardKPIs`, `DashboardAlerts`, `DashboardDistributions`, `DistributionItem`.

- [ ] **Step 2: Update `frontend/src/services/api.ts`**

Add `getDashboardSummaryApi(collectionId?: number): Promise<DashboardSummary>`.

- [ ] **Step 3: Update `frontend/src/i18n/translations.ts`**

Add complete dictionary keys for `dashboard` in both `vi` and `en`.

---

### Task 4: Frontend Dashboard Sub-Components

**Files:**
- Create: `frontend/src/components/dashboard/KPICards.tsx`
- Create: `frontend/src/components/dashboard/AlertsSection.tsx`
- Create: `frontend/src/components/dashboard/BreakdownCharts.tsx`

- [ ] **Step 1: Implement `KPICards.tsx`**
Render 5 major cards:
1. Total Bookings & Estimated TEUs (Blue)
2. Customs Clearance Status (Rose/Emerald)
3. Port Infrastructure Fee (Amber/Emerald)
4. Yard Container Status (Sky/Indigo)
5. Active Watchlist Count (Purple)

- [ ] **Step 2: Implement `AlertsSection.tsx`**
Render tabs/sections:
- Critical Cut-off Time (< 24h & < 48h) with direct link to Booking Tab
- Uncleared Containers In Yard with 1-click drilldown to Container Tab
- Upcoming Vessel Berthing with 1-click drilldown to Vessel Tab

- [ ] **Step 3: Implement `BreakdownCharts.tsx`**
Render visual distribution widgets:
- Top Carriers (distribution bar + % count)
- Ports / ICD Sites distribution (CTL, TNT, THP, IST...)
- Equipment Type breakdown (20GP, 40HC, 45HC...)
- Container In-yard & Event status

---

### Task 5: Frontend Dashboard Tab Integration & Drilldown Navigation

**Files:**
- Create: `frontend/src/components/dashboard/DashboardTab.tsx`
- Modify: `frontend/src/components/common/Tabs.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Implement `DashboardTab.tsx`**
Main Dashboard container:
- Collection selector (Current Collection / All Collections)
- Auto-sync status & refresh button
- Integrates `KPICards`, `AlertsSection`, `BreakdownCharts`
- Accepts `onNavigateTab(tabId, searchKeyword)` to facilitate 1-click drilldown

- [ ] **Step 2: Update `frontend/src/components/common/Tabs.tsx`**
Add `dashboard` tab with `LayoutDashboard` icon as the first tab.

- [ ] **Step 3: Update `frontend/src/App.tsx`**
Handle `activeTab === 'dashboard'`, and pass drilldown navigation state to `BookingTab`, `VesselTab`, `ContainerTab`.

- [ ] **Step 4: Build and test frontend**
Run: `npm run build` inside `frontend/`
Expected: Build succeeds with 0 errors.

---

## Verification Plan

### Automated Tests
```bash
pytest backend/tests/test_dashboard_db.py -v
pytest backend/tests/test_dashboard_api.py -v
cd frontend && npm run build
```

### Manual Verification
1. Open the application, verify that the **Dashboard (Tổng quan)** tab appears first by default.
2. Check that KPI cards accurately reflect data across Bookings, Vessels, and Containers.
3. Test 1-click drilldown: Click on an uncleared container alert -> Verify it navigates to the Container Tab with the container search term applied.
4. Toggle between Light Mode and Dark Mode to verify visual contrast.
5. Toggle between Vietnamese and English to verify translation completeness.
