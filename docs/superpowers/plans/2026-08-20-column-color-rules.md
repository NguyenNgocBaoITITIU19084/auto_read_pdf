# Column Value Color Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an intuitive column value color customization system with 12 curated presets, custom HEX color picker, direct SQLite database persistence, and dynamic badge rendering across Booking, Container, and Vessel tables.

**Architecture:** 
- SQLite database persistence with `color_rules` table and default rules initialization.
- FastAPI endpoints for CRUD and reset operations.
- Frontend React context managing active color rules.
- Dedicated `ColorConfigModal` accessed from the Header with live preview and preset palette.
- Reusable `ValueBadge` component rendering stylish badges in table cells according to active rules.

**Tech Stack:** FastAPI, SQLite3, React 18, TypeScript, Tailwind CSS, Lucide React, Vite.

## Global Constraints
- Database file: `backend/booking_data.db` (and root `booking_data.db` as symlink/path configured in config)
- API endpoint prefix: `/api/v1/color-rules`
- Styling: Tailwind CSS with full light & dark mode support
- Curated presets: 12 high-contrast palettes (Rose, Emerald, Sky, Blue, Amber, Purple, Indigo, Teal, Orange, Pink, Slate, Lime)

---

### Task 1: Backend Database Schema & CRUD for Color Rules

**Files:**
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/schemas/models.py`
- Test: `backend/tests/test_color_rules_db.py`

**Interfaces:**
- Produces: `get_color_rules() -> list[dict]`, `create_color_rule(data: dict) -> int`, `update_color_rule(rule_id: int, data: dict) -> bool`, `delete_color_rule(rule_id: int) -> bool`, `reset_color_rules_to_default() -> list[dict]`
- Models: `ColorRuleCreate`, `ColorRuleUpdate`, `ColorRuleResponse`

- [ ] **Step 1: Write test for SQLite color_rules database operations**

```python
# backend/tests/test_color_rules_db.py
import pytest
from backend.app.core.database import (
    init_db, get_color_rules, create_color_rule, 
    update_color_rule, delete_color_rule, reset_color_rules_to_default,
    export_backup_data, import_backup_data
)

def test_color_rules_crud():
    init_db()
    rules = get_color_rules()
    assert isinstance(rules, list)
    assert len(rules) > 0  # Defaults should be loaded
    
    # Test create
    new_id = create_color_rule({
        "target_table": "booking",
        "column_key": "Carrier",
        "match_value": "ONE",
        "match_type": "exact",
        "preset_id": "pink",
        "is_enabled": 1
    })
    assert new_id > 0
    
    # Test update
    update_color_rule(new_id, {"match_value": "ONEY", "is_enabled": 0})
    updated_rules = get_color_rules()
    found = next((r for r in updated_rules if r["id"] == new_id), None)
    assert found is not None
    assert found["match_value"] == "ONEY"
    assert found["is_enabled"] == 0
    
    # Test delete
    delete_color_rule(new_id)
    after_del = get_color_rules()
    assert not any(r["id"] == new_id for r in after_del)
```

- [ ] **Step 2: Run test to verify it fails before implementation**

Run: `python3 -m pytest backend/tests/test_color_rules_db.py`
Expected: FAIL (missing imports / tables)

- [ ] **Step 3: Implement database schema, CRUD functions, and backup/restore integration in `backend/app/core/database.py` and `backend/app/schemas/models.py`**

Add `color_rules` table creation and default seed data in `init_db()`.
Add `get_color_rules`, `create_color_rule`, `update_color_rule`, `delete_color_rule`, `reset_color_rules_to_default`.
Include `color_rules` in `export_backup_data` and `import_backup_data`.
Define Pydantic models `ColorRuleCreate`, `ColorRuleUpdate`, `ColorRuleResponse` in `backend/app/schemas/models.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/tests/test_color_rules_db.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/database.py backend/app/schemas/models.py backend/tests/test_color_rules_db.py
git commit -m "feat(backend): add color_rules database schema, CRUD and backup integration"
```

---

### Task 2: Backend API Endpoints for Color Rules

**Files:**
- Create: `backend/app/api/color_rules.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_color_rules_api.py`

**Interfaces:**
- Endpoints:
  - `GET /api/v1/color-rules` -> `list[ColorRuleResponse]`
  - `POST /api/v1/color-rules` -> `ColorRuleResponse`
  - `PUT /api/v1/color-rules/{id}` -> `ColorRuleResponse`
  - `DELETE /api/v1/color-rules/{id}` -> `{"status": "success"}`
  - `POST /api/v1/color-rules/reset` -> `list[ColorRuleResponse]`

- [ ] **Step 1: Write API tests**

```python
# backend/tests/test_color_rules_api.py
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_color_rules_api():
    res = client.get("/api/v1/color-rules")
    assert res.status_code == 200
    rules = res.json()
    assert isinstance(rules, list)
    
    # Create rule
    create_res = client.post("/api/v1/color-rules", json={
        "target_table": "container",
        "column_key": "custom_clearance_status",
        "match_value": "Chưa duyệt (N)",
        "match_type": "exact",
        "preset_id": "rose",
        "is_enabled": True
    })
    assert create_res.status_code == 200
    created = create_res.json()
    rule_id = created["id"]
    
    # Update rule
    put_res = client.put(f"/api/v1/color-rules/{rule_id}", json={
        "match_value": "Chưa duyệt",
        "is_enabled": False
    })
    assert put_res.status_code == 200
    
    # Delete rule
    del_res = client.delete(f"/api/v1/color-rules/{rule_id}")
    assert del_res.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_color_rules_api.py`
Expected: FAIL 404 Not Found

- [ ] **Step 3: Implement `backend/app/api/color_rules.py` and register router in `backend/app/main.py`**

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/tests/test_color_rules_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/color_rules.py backend/app/main.py backend/tests/test_color_rules_api.py
git commit -m "feat(backend): add color rules API router and endpoints"
```

---

### Task 3: Frontend Types, Curated Color Presets & API Client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/utils/colorPresets.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Types: `ColorRule`, `ColorPreset`, `MatchType`, `TargetTable`
- Exports: `COLOR_PRESETS: ColorPreset[]`, `findMatchingColorRule(rules: ColorRule[], table: TargetTable, columnKey: string, cellValue: string): ColorRule | null`, `getColorPreset(presetId?: string): ColorPreset | undefined`
- API methods: `getColorRules()`, `createColorRule()`, `updateColorRule()`, `deleteColorRule()`, `resetColorRules()`

- [ ] **Step 1: Update `frontend/src/types/index.ts` with color rule types**
- [ ] **Step 2: Create `frontend/src/utils/colorPresets.ts` with 12 presets and match evaluation logic**
- [ ] **Step 3: Update `frontend/src/services/api.ts` with color rules API functions**
- [ ] **Step 4: Add i18n keys for color settings in `frontend/src/i18n/translations.ts`**
- [ ] **Step 5: Verify types with `npx tsc --noEmit` in `frontend/`**
- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/utils/colorPresets.ts frontend/src/services/api.ts frontend/src/i18n/translations.ts
git commit -m "feat(frontend): define color rules types, 12 presets, and API client"
```

---

### Task 4: AppContext Integration & `ColorConfigModal` Component

**Files:**
- Modify: `frontend/src/context/AppContext.tsx`
- Create: `frontend/src/components/common/ColorConfigModal.tsx`
- Modify: `frontend/src/components/common/Header.tsx`

**Interfaces:**
- AppContext adds: `colorRules: ColorRule[]`, `refreshColorRules: () => Promise<void>`, `saveColorRule: (rule: Partial<ColorRule>) => Promise<void>`, `deleteColorRuleById: (id: number) => Promise<void>`, `toggleColorRule: (id: number, enabled: boolean) => Promise<void>`, `resetColorRulesDefault: () => Promise<void>`
- Component: `ColorConfigModal` with table tabs, rule creation/editing form, preset palette selector, custom HEX color picker, live preview badge, and rule management list.
- Header: Adds button with Palette icon to open `ColorConfigModal`.

- [ ] **Step 1: Enhance `frontend/src/context/AppContext.tsx` with color rules state and CRUD handlers**
- [ ] **Step 2: Build `frontend/src/components/common/ColorConfigModal.tsx`**
- [ ] **Step 3: Add `🎨 Cấu hình màu sắc` button to `frontend/src/components/common/Header.tsx`**
- [ ] **Step 4: Verify compilation with `npm run build` in `frontend/`**
- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AppContext.tsx frontend/src/components/common/ColorConfigModal.tsx frontend/src/components/common/Header.tsx
git commit -m "feat(frontend): add ColorConfigModal and Header trigger button"
```

---

### Task 5: Dynamic `ValueBadge` Rendering in Tables

**Files:**
- Create: `frontend/src/components/common/ValueBadge.tsx`
- Modify: `frontend/src/components/booking/BookingTab.tsx`
- Modify: `frontend/src/components/container/ContainerTab.tsx`
- Modify: `frontend/src/components/vessel/VesselTab.tsx`

**Interfaces:**
- Component `ValueBadge`:
  `props: { table: TargetTable; columnKey: string; value: any; fallbackText?: string; customClass?: string }`
  Finds matching rule from active `colorRules` and renders either styled badge or formatted text.

- [ ] **Step 1: Create `frontend/src/components/common/ValueBadge.tsx`**
- [ ] **Step 2: Update `BookingTab.tsx` cell rendering with `ValueBadge`**
- [ ] **Step 3: Update `ContainerTab.tsx` cell rendering with `ValueBadge` (replacing hardcoded badges with dynamic rules)**
- [ ] **Step 4: Update `VesselTab.tsx` cell rendering with `ValueBadge`**
- [ ] **Step 5: Verify build with `npm run build` in `frontend/`**
- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/common/ValueBadge.tsx frontend/src/components/booking/BookingTab.tsx frontend/src/components/container/ContainerTab.tsx frontend/src/components/vessel/VesselTab.tsx
git commit -m "feat(frontend): apply dynamic ValueBadge with color rules to all data tables"
```

---

### Task 6: Full Verification & E2E Sanity Testing

- [ ] **Step 1: Run all backend tests (`pytest backend/tests`)**
- [ ] **Step 2: Run frontend production build (`npm run build`)**
- [ ] **Step 3: Verify SQLite database schema, default rules, and API responses**
- [ ] **Step 4: Test backup and restore functionality to ensure color rules are properly preserved**
- [ ] **Step 5: Final commit and summary walkthrough**
