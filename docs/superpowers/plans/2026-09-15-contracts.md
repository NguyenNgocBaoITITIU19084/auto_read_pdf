# Interface contracts — customer feedback optimization (2026-09-15)

Companion to `2026-09-15-customer-feedback-optimization.md`. All agents MUST follow these
signatures exactly so parallel work integrates. Base URL `http://127.0.0.1:8000/api/v1`.

Product decisions (made without customer answers yet — keep flexible):
- Auto-sync supports BOTH modes: `interval` (every N minutes) and `times` (fixed HH:MM list, Asia/Ho_Chi_Minh).
- When auto-sync is ON, closing the window hides to tray; backend keeps running. When OFF, closing quits as before.
- Merged customs status logic (computed, not stored):
  - `custom_clearance_status == 'Y'` → `"Đã thông quan"`
  - else `cust == 'Y'` → `"Đang giám sát HQ"`
  - else `custom_clearance_status == 'N'` → `"Chưa thông quan"`
  - else `""`
- `haz` from ePort can be raw HTML like `<a target='_blank' href='http://imdg.saigonnewport.com.vn/?siteId=CTL&itemNo=ZGLU2008173'></a>`.

---

## 1. Database layer (`backend/app/core/database.py`) — owner: backend-core

New/changed functions (other agents import these):
```python
def delete_bookings_batch(booking_ids: list[int]) -> int            # returns rows deleted
def add_vessel_watchlist_batch(col_id: int, items: list[dict]) -> int      # items: {site_id, vessel_name, voyage}; ignores duplicates; returns added count
def remove_vessel_watchlist_batch(watchlist_ids: list[int]) -> int
def add_container_watchlist_batch(col_id: int, items: list[dict]) -> int   # items: {site_id, container_no, event_type}
def remove_container_watchlist_batch(watchlist_ids: list[int]) -> int
def move_items_to_collection(entity: str, ids: list[int], target_col_id: int, copy: bool = False) -> int
    # entity in {"bookings","vessels","containers"}
def get_vessel_schedules_by_ids(ids: list[int]) -> list[dict]
def get_containers_by_ids(ids: list[int]) -> list[dict]
def update_watchlist_sync_status(kind: str, watchlist_id: int, status: str, message: str = "") -> None
    # kind in {"vessel","container"}; status in {"ok","not_found","error"}; also sets last_sync_at (local time "%Y-%m-%d %H:%M:%S")
```
Watchlist tables gain columns: `last_sync_at TEXT, last_sync_status TEXT, last_sync_message TEXT`
(returned by `get_watchlist`, `get_all_watchlists`, `get_container_watchlist`, `get_all_container_watchlists`).

`get_containers(...)` and `get_containers_by_ids(...)` rows gain computed keys:
- `customs_status: str` (logic above)
- `imdg_url: str` (href extracted from `haz`, else "")
- `haz: str` → HTML stripped to its text content ("" if anchor has no text)

System settings keys (via `get_system_setting`/`set_system_setting`):
`auto_sync_enabled` ("1"/"0"), `auto_sync_mode` ("interval"/"times"), `auto_sync_interval` (int str), `auto_sync_times` (JSON list of "HH:MM").

## 2. HTTP API

### Bookings — owner: booking-extraction (`api/bookings.py`)
- `POST /bookings/batch-delete` body `{ids: number[]}` → `{status:"success", deleted:number}`
- `POST /bookings/extract-image` response now `{status, data: Partial<Booking>, engine_used: "gemini"|"ocr"|"none", warnings: string[]}`
- `POST /bookings/upload` unchanged shape; non-blocking.
- `GET /settings/ai/models?api_key=...` (owner: booking-extraction, `api/settings.py`) → `{models: string[]}` (falls back to a static list on error)

### Vessels / Containers bulk — owner: backend-core (`api/vessels.py`, `api/containers.py`)
- `POST /vessels/watchlist/batch-add` body `{collection_id, items:[{site_id, vessel_name, voyage}]}` → `{status, added}`
- `POST /vessels/watchlist/batch-remove` body `{ids}` → `{status, removed}`
- `POST /vessels/resync` body `{ids: number[]}` (vessel_schedules ids) → `{status, updated, not_found: string[], errors: string[]}`
- `POST /containers/watchlist/batch-add` body `{collection_id, items:[{site_id, container_no, event_type}]}` → `{status, added}`
- `POST /containers/watchlist/batch-remove` body `{ids}` → `{status, removed}`
- `POST /containers/resync` body `{ids: number[]}` → `{status, updated, not_found: string[], errors: string[]}`
- `POST /collections/move` (owner: backend-core, `api/collections.py`) body `{entity:"bookings"|"vessels"|"containers", ids, target_collection_id, copy?: boolean}` → `{status, moved}`

### Scheduler — owner: scheduler (`api/export_backup.py`, `services/background_tasks.py`)
- `GET /scheduler/status` →
  ```json
  {"enabled": bool, "mode": "interval"|"times", "interval_minutes": int, "times": ["08:00"],
   "running": bool, "last_run_at": str|null, "last_run_result": {"vessels_ok":int,"vessels_not_found":int,"containers_ok":int,"errors":int}|null,
   "next_run_at": str|null}
  ```
- `POST /scheduler/toggle` body `{enable, interval_minutes?, mode?, times?}` → same shape as status (backward compatible: old body still works)
- `POST /scheduler/run-now` → `{status:"started"|"already_running"}`

## 3. Electron preload (`window.electronAPI`) — owner: electron
```ts
interface ElectronAPI {
  platform: string; version: string;
  openExternal(url: string): Promise<void>;
  readClipboardImage(): Promise<string | null>;   // PNG data URL or null
  setAutoSyncActive(active: boolean): void;       // tells main process whether to hide-to-tray on close
}
```
Main process also: `setWindowOpenHandler` + `will-navigate` send http(s) links to `shell.openExternal`.

## 4. Frontend shared pieces — owner: frontend-foundation
- `services/api.ts`: add one function per new endpoint above:
  `deleteBookingsBatch(ids)`, `addVesselWatchlistBatch(collectionId, items)`, `removeVesselWatchlistBatch(ids)`,
  `resyncVesselsApi(ids)`, `addContainerWatchlistBatch(collectionId, items)`, `removeContainerWatchlistBatch(ids)`,
  `resyncContainersApi(ids)`, `moveItemsToCollection(entity, ids, targetCollectionId, copy?)`, `runSyncNowApi()`,
  `getAIModelsApi(apiKey?)`; `extractBookingImageApi` returns `{data, engine_used, warnings}`; `getAutoSyncStatus` returns full `AutoSyncStatus`.
  Long-running calls (resync, upload, extract-image) use `timeout: 180000`.
- `types/index.ts`: `AutoSyncStatus`, `ImageExtractResult`, watchlist `last_sync_*` fields, `ContainerInfo.customs_status`, `ContainerInfo.imdg_url`, `window.electronAPI` global typing.
- `components/common/ConfirmDialog.tsx` + `hooks/useConfirm.tsx`:
  `const confirm = useConfirm(); const ok = await confirm({title, message, confirmText?, cancelText?, danger?: boolean});`
  (provider mounted in `main.tsx`/`App` root by foundation).
- `hooks/useRowSelection.ts`:
  ```ts
  useRowSelection<T>(rows: T[], getId: (r: T) => number, resetKeys: unknown[]) => {
    selectedIds: Set<number>; isSelected(id): boolean; toggle(id, shiftKey?: boolean): void;
    selectPage(pageRows: T[], checked: boolean): void; selectAll(checked: boolean): void;
    clear(): void; count: number; selectedRows: T[]; isPageAllSelected(pageRows: T[]): boolean; isPagePartiallySelected(pageRows: T[]): boolean;
  }
  ```
- `components/common/BulkActionBar.tsx`:
  `<BulkActionBar count={n} onClear={fn} actions={[{key, label, icon: LucideIcon, onClick, danger?, disabled?, loading?}]} />` (sticky bar shown when count>0)
- `components/common/MoveToCollectionModal.tsx`:
  `<MoveToCollectionModal isOpen onClose entity ids onDone />` (lists collections except active, move/copy toggle, calls `moveItemsToCollection`).
- Contexts: `useApp()` keeps its current fields (toasts API `addToast/removeToast` stays available via `useApp()` but toasts state lives in a separate `ToastContext` so toast changes don't re-render tables). `useApp()` adds `autoSyncStatus: AutoSyncStatus | null`, `refreshAutoSyncStatus()`, `updateAutoSyncSchedule({mode, interval_minutes, times})`, `runSyncNow()`, and `getRulesFor(table: string, column: string): ColorRule[]` (Map-based lookup).
- `ValueBadge` must use the Map lookup (no full scan).

## 5. File ownership (do NOT edit files owned by another agent)
| Agent | Files |
|---|---|
| backend-core | `backend/app/core/database.py`, `backend/app/api/{vessels,containers,collections,color_rules,dashboard}.py`, `backend/app/schemas/models.py`, `backend/tests/**` |
| scheduler | `backend/app/services/background_tasks.py`, `backend/app/services/eport_client.py`, `backend/app/services/exporter.py`, `backend/app/api/export_backup.py`, `backend/app/main.py`, `backend/app/core/config.py`, `requirements.txt`, `backend/requirements.txt`, `tests/test_eport.py`, `tests/test_exporter.py`, `tests/test_api.py` |
| booking-extraction | `backend/app/api/bookings.py`, `backend/app/api/settings.py`, `backend/app/services/extractor.py`, `backend/app/services/image_extractor.py`, `src/**`, `tests/test_extractor.py`, `tests/test_image_extractor.py`, `tests/conftest.py`, `pytest.ini` |
| electron | `electron/**`, `backend_app.spec`, root `package.json`, `build_mac.py`, `build_win.py` |
| frontend-foundation | `frontend/src/{main.tsx,context/**,services/**,types/**,hooks/**,utils/colorPresets.ts}`, `frontend/src/components/common/**` |
| frontend-booking | `frontend/src/App.tsx`, `frontend/src/components/booking/**`, `frontend/src/utils/{formatters.ts,vessel.ts}` |
| frontend-tables | `frontend/src/components/{vessel,container,dashboard}/**` |
| translations | `frontend/src/i18n/translations.ts` — shared; re-read immediately before each edit, only add keys inside your own section, never reformat |
