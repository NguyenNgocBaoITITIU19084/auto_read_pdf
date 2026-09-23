# Dashboard Resource Monitor (RAM/CPU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm khu vực "Tài nguyên hệ thống" vào tab Tổng quan: hiển thị realtime CPU/RAM của **app** (Electron + backend Python + tiến trình con OCR) và **cả máy**, có sparkline ~5 phút, cảnh báo khi vượt ngưỡng, và nút giải phóng bộ nhớ / khởi động lại dịch vụ nền.

**Architecture:**
- Backend: router mới `GET /api/v1/system/resources` (dùng `psutil`) trả về CPU/RAM cả máy + tiến trình backend và toàn bộ tiến trình con. Tách riêng khỏi `/dashboard/summary` vì summary chạy SQL + phụ thuộc phạm vi collection — không được chạy lại mỗi 3s. Thêm `POST /api/v1/system/free-memory` (gc; malloc_trim trên Linux — connection SQLite mở/đóng theo từng lệnh nên không có gì để shrink).
- Electron: IPC `get-app-metrics` tổng hợp `app.getAppMetrics()` (main, renderer, GPU, utility); IPC `restart-backend` gọi `BackendManager.restart()` mới (không đi qua luồng crash/auto-restart). IPC `clear-renderer-cache`.
- Frontend: component độc lập `ResourceMonitor` có vòng poll riêng (3s), ring buffer 100 mẫu, sparkline SVG thuần, logic ngưỡng thuần (pure function, test được). Chạy ngoài Electron (vite dev trên trình duyệt) thì chỉ hiện số liệu backend + máy.

**Tech Stack:** FastAPI, psutil, Electron (`app.getAppMetrics`, `ipcMain`), React + TypeScript, Tailwind, Lucide, Pytest, Vitest.

## Global Constraints
- Không thêm thư viện chart (bundle size do `frontend/scripts/check-bundle-size.mjs` kiểm soát) — sparkline là SVG `<polyline>`.
- Poll 3s, **chỉ khi** tab Dashboard đang mở (`App.tsx` unmount tab không active → gắn poll vào mount là đủ) **và** `document.visibilityState === 'visible'` (cửa sổ ẩn xuống tray khi auto-sync thì dừng poll).
- Không spam log: thêm `/api/v1/system/resources` vào `_QUIET` trong `backend/app/core/request_logging.py` (hạ xuống DEBUG). Khi poll lỗi liên tục, frontend chỉ log/toast **một lần** cho mỗi chuỗi lỗi.
- Chuẩn hoá đơn vị ở MỘT chỗ (frontend `resourceMath.ts`): bytes cho RAM, % trên tổng năng lực máy (0–100) cho CPU. Electron `workingSetSize` là **KB**; psutil `rss` là **bytes**; psutil `Process.cpu_percent()` là %/1 core (có thể > 100) → chia `psutil.cpu_count()`.
- Ngưỡng là hằng số: cảnh báo ≥ 80%, nguy hiểm ≥ 90%, phải vượt **3 mẫu liên tiếp** (~9s) mới báo — tránh nháy đỏ khi OCR spike ngắn.
- i18n đầy đủ `vi` + `en`, hỗ trợ Dark Mode.
- Kỳ vọng thực tế: backend không giữ cache lớn trong RAM (OCR chạy bằng subprocess Swift/tesseract), nên "Giải phóng bộ nhớ" thường chỉ giảm vài MB. **Khởi động lại dịch vụ nền** mới là thao tác giải phóng RAM thật sự. Toast phải hiện số trước/sau để người dùng thấy rõ.

---

### Task 1: Backend — service thu thập số liệu + dependency psutil

**Files:**
- Modify: `requirements.txt`, `backend/requirements.txt` (thêm `psutil==<bản mới nhất có wheel cho py3.14 win/mac>`)
- Create: `backend/app/services/resource_monitor.py`
- Test: `backend/tests/test_resource_monitor.py`

**Interfaces:**
- Produces: `get_resource_snapshot() -> dict`, `free_backend_memory() -> dict`

- [ ] **Step 1: Test thất bại** — monkeypatch `psutil.virtual_memory`, `psutil.cpu_percent`, `psutil.cpu_count`, và `Process` giả (có `memory_info().rss`, `cpu_percent()`, `children()`), assert:
  - `system.cpu_percent`, `system.ram_total`, `system.ram_used`, `system.ram_percent` đúng.
  - `backend.rss` = rss tiến trình chính + tổng rss con; `backend.cpu_percent` = tổng / `cpu_count` (vd 2 process 150% + 50% trên 4 core → 50.0).
  - Tiến trình con biến mất giữa chừng (`psutil.NoSuchProcess`) bị bỏ qua, không raise.
- [ ] **Step 2: Cài đặt `resource_monitor.py`**
  - `_SELF = psutil.Process()` ở module level; gọi `_SELF.cpu_percent(None)` và `psutil.cpu_percent(None)` một lần lúc import để "mồi" (lần gọi đầu luôn trả 0).
  - `_children_cache: dict[int, psutil.Process]` — tái sử dụng object theo pid (object mới luôn đọc CPU = 0); dọn pid không còn tồn tại mỗi lần gọi.
  - Tất cả truy cập tiến trình con bọc `try/except (psutil.NoSuchProcess, psutil.AccessDenied)`.
  - Trả về: `{"sampled_at": iso, "system": {...}, "backend": {"pid", "rss", "cpu_percent", "child_count"}}`.
  - `free_backend_memory()`: đo rss trước → `gc.collect()` → `PRAGMA shrink_memory` trên connection SQLite (xem helper connection trong `backend/app/core/database.py`) → đo rss sau; trả `{"rss_before", "rss_after"}`.
- [ ] **Step 3: Chạy test** `pytest backend/tests/test_resource_monitor.py -v` → PASS.
- [ ] **Step 4: Kiểm tra đóng gói** — `backend_app.spec`: thêm `'psutil'` vào `hiddenimports` nếu hook của pyinstaller-hooks-contrib không đủ. CI (`.github/workflows/build.yml`) cài từ `requirements.txt` gốc → đảm bảo đã thêm ở file gốc.

### Task 2: Backend — API router + tắt log poll

**Files:**
- Create: `backend/app/api/system.py`
- Modify: `backend/app/main.py` (include router), `backend/app/schemas/models.py` (`SystemResourcesResponse`, `FreeMemoryResponse`), `backend/app/core/request_logging.py` (thêm path vào `_QUIET`)
- Test: `backend/tests/test_system_api.py` (theo mẫu `test_dashboard_api.py`)

**Interfaces:**
- Produces: `GET /api/v1/system/resources`, `POST /api/v1/system/free-memory`

- [ ] **Step 1: Test thất bại** — TestClient gọi 2 endpoint (monkeypatch service), assert schema; test middleware: request tới `/api/v1/system/resources` log ở DEBUG, không phải INFO (theo mẫu `test_request_logging.py`).
- [ ] **Step 2: Cài đặt router** (`prefix="/system"`, tag `System`), endpoint đồng bộ `def` (psutil là blocking, FastAPI tự đẩy sang threadpool).
- [ ] **Step 3: Chạy** `pytest backend/tests -q` → toàn bộ PASS.

### Task 3: Electron — metrics, xoá cache renderer, restart backend an toàn

**Files:**
- Modify: `electron/py_manager.js` (thêm `restart()`, getter `pid`, `owned`)
- Modify: `electron/main.js` (3 IPC handler)
- Modify: `electron/preload.js` (expose `getAppMetrics`, `clearRendererCache`, `restartBackend`)
- Modify: `frontend/src/types/index.ts` (thêm field **optional** vào `ElectronAPI`)

**Interfaces:**
- Produces:
  - `getAppMetrics(): Promise<{ processes: {type, pid, cpuPercent, workingSetKB}[], totalCpuPercent, totalWorkingSetBytes, cpuCount }>`
  - `clearRendererCache(): Promise<{ before: number, after: number }>`
  - `restartBackend(): Promise<{ ok: boolean, reason?: 'not_owned' | 'busy' | 'failed' }>`

- [ ] **Step 1: `get-app-metrics`** — `app.getAppMetrics()`; cộng `memory.workingSetSize * 1024` (KB → bytes) và `cpu.percentCPUUsage`.
  - ✅ Đã đo (Electron 33, Mac 8 nhân): 1 nhân chạy full ở main → `percentCPUUsage` ≈ 12% ⇒ **đã chuẩn hoá theo cả máy, KHÔNG chia thêm**.
  - (gốc) ⚠️ **Xác minh trên máy thật trước khi viết phép chia**: `percentCPUUsage` của Electron đã chuẩn hoá theo số core hay chưa (so sánh với Activity Monitor / Task Manager khi app đang render nặng). Ghi kết quả vào comment và chuẩn hoá tương ứng trong `resourceMath.ts`.
- [ ] **Step 2: `clear-renderer-cache`** — `session.defaultSession.clearCache()` + `webContents.session.clearCodeCaches({})`; đo `getAppMetrics` trước/sau.
- [ ] **Step 3: `BackendManager.restart()`** — KHÔNG dùng kill thường: mọi exit hiện bị coi là crash → vào auto-restart, tính vào `MAX_RESTARTS` (3 lần/5 phút) và hiện màn "Dịch vụ nền bị dừng". Thay vào đó:
  - Nếu `!this.owned` (dev reuse backend của `npm run dev`) → trả `{ ok: false, reason: 'not_owned' }`.
  - Hỏi `GET /api/v1/scheduler/status` qua `backendRequest`; nếu job đang chạy → `{ ok: false, reason: 'busy' }`.
  - `await this.stop()` → reset `this.stopping = false`, `this.restartTimes = []` → `await this.start()`; trả `ok` theo kết quả `_waitHealthy`.
  - Renderer vẫn nhận `backend-status` như bình thường (splash/banner hiện đang khởi động).
- [ ] **Step 4: Kiểm tra thủ công bằng `npm run dev`** — gọi `window.electronAPI.getAppMetrics()` trong DevTools, so với Activity Monitor.

### Task 4: Frontend — logic thuần (ring buffer, chuẩn hoá, ngưỡng)

**Files:**
- Create: `frontend/src/components/dashboard/resourceMath.ts`
- Test: `frontend/src/components/dashboard/resourceMath.test.ts`

**Interfaces:**
- Produces:
  - `type ResourceSample = { t: number; sysCpu: number; sysRamPct: number; appCpu: number; appRamBytes: number }`
  - `mergeSample(backend: SystemResources, electron?: AppMetrics): ResourceSample`
  - `pushSample(buf: ResourceSample[], s: ResourceSample, max = 100): ResourceSample[]`
  - `evaluateLevel(values: number[], warn = 80, crit = 90, consecutive = 3): 'ok' | 'warn' | 'crit'`
  - `formatBytes(n: number): string`

- [ ] **Step 1: Test thất bại** — buffer không vượt 100 phần tử; `evaluateLevel([95, 50, 95])` → `ok`, `[85, 85, 85]` → `warn`, `[91, 92, 95]` → `crit`; `mergeSample` không có electron → `appRamBytes` chỉ gồm backend; đơn vị KB/bytes đúng.
- [ ] **Step 2: Cài đặt**, chạy `npm test --prefix frontend -- resourceMath` → PASS.

### Task 5: Frontend — component `ResourceMonitor` + tích hợp Dashboard

**Files:**
- Create: `frontend/src/components/dashboard/ResourceMonitor.tsx`, `frontend/src/components/dashboard/Sparkline.tsx`
- Modify: `frontend/src/services/api.ts` (`getSystemResourcesApi`, `freeBackendMemoryApi`), `frontend/src/types/index.ts` (`SystemResources`), `frontend/src/components/dashboard/DashboardTab.tsx`, `frontend/src/i18n/translations.ts` (khối `dashboard.resources` cho `vi` + `en`)
- Test: `frontend/src/components/dashboard/ResourceMonitor.test.tsx`

- [ ] **Step 1: Test thất bại** (vitest + fake timers, mock api/electronAPI):
  - Poll mỗi 3s; dừng khi `document.visibilityState = 'hidden'`, chạy lại khi visible; clearInterval khi unmount.
  - Lỗi poll 5 lần liên tiếp chỉ gọi `addToast`/`clientLogger` **1 lần**; hồi phục thì reset.
  - Không có `window.electronAPI` → ẩn dòng Electron và nút "Xoá cache giao diện"/"Khởi động lại", vẫn hiện số backend + máy.
- [ ] **Step 2: Giao diện** (đặt giữa KPI Cards và Alerts trong `DashboardTab`, thêm `data-tour="dashboard-resources"`):
  - 2 thẻ: **CPU** và **RAM**. Mỗi thẻ: số lớn của app, thanh phụ "Cả máy: xx%", sparkline 5 phút (2 đường: app + máy), màu viền/icon theo `evaluateLevel` (slate/amber/rose).
  - Chi tiết mở rộng (collapse): bảng tiến trình — Giao diện (renderer), Electron main, GPU, Dịch vụ nền (backend), Tiến trình con OCR (số lượng).
  - Khi `crit`: dòng cảnh báo gợi ý "Khởi động lại dịch vụ nền để giải phóng RAM".
- [ ] **Step 3: Hành động "Quản lý"**
  - **Giải phóng bộ nhớ**: gọi song song `freeBackendMemoryApi()` + `electronAPI.clearRendererCache?.()` → toast "Đã giải phóng X MB (trước A → sau B)". Nếu giảm < 1 MB thì toast nói rõ "Không có nhiều bộ nhớ để giải phóng — thử khởi động lại dịch vụ nền".
  - **Khởi động lại dịch vụ nền**: dùng `useConfirm`; nội dung cảnh báo: sẽ ngắt phiên chụp ảnh bằng điện thoại (LAN/QR) và các thao tác đang chạy. Disable nút khi: không trong Electron, `autoSyncEnabled` đang có job chạy, hoặc IPC trả `not_owned` (hiện tooltip lý do). Sau restart: toast kết quả + làm mới `fetchSummary`.
- [ ] **Step 4: i18n** — thêm key vi/en: tiêu đề, "Ứng dụng", "Cả máy", tên tiến trình, 2 nút, nội dung confirm, toast, lý do disable, bước tour.
- [ ] **Step 5: Chạy** `npm test --prefix frontend`, `npm run build --prefix frontend` + `check-bundle-size` → PASS.

### Task 6: Kiểm thử thủ công & đóng gói

- [ ] Dev (`npm run dev`): số liệu CPU/RAM khớp tương đối với Activity Monitor (macOS) / Task Manager (Windows).
- [ ] Chụp ảnh OCR offline (macOS Vision) → CPU app tăng, "Tiến trình con OCR" hiện ≥ 1, không nháy đỏ nếu spike < 9s.
- [ ] Ẩn cửa sổ xuống tray / chuyển tab khác → Network không còn request `/system/resources`.
- [ ] `app.log` không có dòng INFO cho `/system/resources`.
- [ ] Nút Giải phóng bộ nhớ: toast có số trước/sau.
- [ ] Nút Khởi động lại (bản đóng gói): backend restart 4 lần liên tiếp **không** rơi vào trạng thái "failed" (xác nhận không tính vào `MAX_RESTARTS`); trong dev hiện lý do `not_owned`.
- [ ] Build Windows + macOS: backend đóng gói import được `psutil` (endpoint trả 200).
- [ ] Dark mode + tiếng Anh hiển thị đúng; màn hình hẹp (grid 1 cột) không vỡ layout.
