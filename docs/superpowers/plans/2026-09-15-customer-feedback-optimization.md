# Kế hoạch tối ưu app theo feedback khách hàng (2026-09-15)

> **Trạng thái (2026-09-15):** Đã triển khai Phase 0–6 (chưa commit). 174 test Python pass, `tsc` + `vite build` pass.
> Chưa làm: virtualization bảng (đang giới hạn 500 dòng/trang), OCR offline đóng gói sẵn, build PyInstaller/electron-builder thực tế.
> Chờ khách xác nhận: logic "Tình trạng thông quan" so với web ePort.

## Feedback gốc
- Đồng bộ theo dõi hãng tàu không chạy đúng thời gian đặt
- Khởi động chậm; app đôi lúc đơ, không nhập/thao tác được; dùng lâu thì lag
- Đọc booking: bổ sung PIL, CUL; tìm tàu nhanh sau khi đọc; dán ảnh không xem/không đọc được
- Tra số cont: gộp "Trạng thái thông quan" + "Giám sát HQ" → "Tình trạng thông quan"
- (Nội bộ) Chưa có bulk action cho từng tab

---

## Phase 0 — Hotfix đơ/lag (P0, làm trước tiên)

### 0.1 Bảng `color_rules` bị nhân đôi mỗi lần restore backup  ⚠️ nguyên nhân chính
- Bằng chứng: `backend/booking_data.db` có **327.808 dòng** color_rules nhưng chỉ **21 luật khác nhau** (DB 24MB, riêng bảng này 23MB).
- Nguyên nhân: `database.py:553-555` restore gọi `create_color_rule` cho từng rule, không xóa/không dedupe; không có UNIQUE constraint.
- Hệ quả: startup tải ~23MB JSON (`AppContext.tsx:252`); `colorPresets.ts:199` duyệt toàn bộ rules cho **mỗi ô** `ValueBadge` → block renderer → không gõ/click được.
- Việc cần làm:
  - [ ] Migration trong `init_db`: xóa trùng (giữ MIN(id) theo `target_table, column_key, match_value`), tạo UNIQUE index
  - [ ] `create_color_rule` dùng `INSERT OR IGNORE`; restore = xóa rules cũ + insert trong 1 transaction
  - [ ] Frontend: build `Map<table|column, rules[]>` bằng `useMemo` một lần, `ValueBadge` tra Map
  - [ ] Test: backup → restore 3 lần, số rule không đổi

### 0.2 Endpoint `async def` chạy code blocking → treo toàn bộ backend
- `api/bookings.py:32` (upload PDF), `:85` (extract-image) gọi pdfplumber, `requests.post` Gemini (45s), `subprocess swift` (15s) trực tiếp trong event loop.
- [ ] Đổi sang `def` hoặc bọc `await asyncio.to_thread(...)`
- [ ] `api/vessels.py:98` `time.sleep(2)` trong request → chuyển sang background job

### 0.3 `window.confirm` làm mất focus input trên Windows (bug Electron)
- 8 chỗ: `ContainerTab.tsx:339,398,411`, `VesselTab.tsx:253,300,313`, `BookingTab.tsx:228,240`
- [ ] Tạo `ConfirmDialog` dựa trên `common/Modal.tsx`, hook `useConfirm()` trả Promise, thay toàn bộ

### 0.4 SQLite
- [ ] `PRAGMA journal_mode=WAL`, `busy_timeout=5000`
- [ ] Đóng connection (`get_connection` hiện chỉ commit, không close)
- [ ] Index: `bookings(collection_id)`, `containers(collection_id, queried_at)`, `vessel_schedules(collection_id, queried_at)`
- [ ] Restore / insert hàng loạt trong 1 transaction

---

## Phase 1 — Đồng bộ tự động theo dõi hãng tàu (P0)

Hiện trạng: APScheduler `interval` N phút; trạng thái bật/tắt **chỉ lưu trong RAM** (`background_tasks.py:13-14`) → mỗi lần tắt app/khởi động lại máy là auto-sync bị tắt, trong khi UI (localStorage) vẫn hiển thị như đang bật.

- [ ] Lưu `auto_sync_enabled`, `auto_sync_interval` vào `system_settings`; `lifespan` (`main.py`) đọc lại và đăng ký job
- [ ] Job: `misfire_grace_time=3600`, `coalesce=True`, `max_instances=1`, `replace_existing=True`
- [ ] Chạy ngay qua scheduler (`next_run_time=now`) thay vì `asyncio.create_task`; thêm `asyncio.Lock` quanh `run_sync_all` (tránh chạy chồng khi bấm preset liên tục / sync tay)
- [ ] Electron: `powerMonitor.on('resume')` → gọi `POST /scheduler/run-now`; tự restart backend khi process chết (`py_manager.js`)
- [ ] Không kill backend khi đóng cửa sổ nếu auto-sync đang bật (tray icon) — **cần chốt với khách**
- [ ] `/scheduler/status` trả `last_run_at`, `last_result` (thành công/lỗi/bỏ qua), `next_run_time`; AppContext poll 30–60s; hiển thị trong `AutoSyncSettingsCard` + watchlist modal
- [ ] Voyage không khớp ePort (`eport_client.py:177-188`): ghi lý do lên dòng watchlist thay vì chỉ log
- [ ] (Tùy khách) Chế độ "theo giờ cố định" (VD 08:00, 14:00) bằng `CronTrigger(timezone=Asia/Ho_Chi_Minh)`, thêm `tzdata` vào requirements + hiddenimports
- [ ] Backup bổ sung `vessel_watchlists`; restore giữ `event_type`
- [ ] `logger.exception` thay `logger.error(f"...")`

---

## Phase 2 — Khởi động nhanh (P1)

- [ ] `electron/main.js`: hiện splash/UI ngay, frontend tự retry `/health` (hiện màn đen tới 40s)
- [ ] `py_manager.js`: poll health 200ms thay vì 1000ms; cảnh báo nếu port 8000 đang bị backend cũ chiếm
- [ ] `backend_app.spec`: `upx=False` (UPX làm chậm load DLL + dễ bị antivirus quét trên Windows)
- [ ] Lazy import `pandas`, `openpyxl` (exporter), `pdfplumber` (extractor), `PIL` (image_extractor)
- [ ] Log: xoay vòng `backend.log` (giới hạn dung lượng), `access_log=False`, bớt log nhiều dòng ở `eport_client.py`

---

## Phase 3 — Đọc booking (P1)

### 3.1 Dán ảnh không xem/không đọc được
Nguyên nhân (theo thứ tự khả năng):
1. Listener paste chỉ nằm trong `BookingTab.tsx:59-82` → dán ở tab khác (app mở mặc định Dashboard) không có tác dụng
2. Đọc ảnh thất bại **im lặng**: Gemini lỗi (key/model `gemini-2.0-flash` cũ) → fallback OCR `swift -e` (chỉ Mac có Xcode) hoặc `pytesseract` (không đóng gói) → text rỗng → toàn "null" nhưng vẫn toast thành công
3. Dán trong modal bắn 2 request (modal `onPaste` + window listener), kết quả sau đè kết quả trước
4. Modal chỉ đọc `clipboardData.files`, bỏ qua `items`; file PDF copy từ Explorer bị bỏ qua
5. Không có menu chuột phải → Paste

- [ ] Chuyển paste listener lên `App`: dán ảnh/PDF ở bất kỳ tab nào → chuyển sang tab Booking + mở modal; bỏ `onPaste` trong modal
- [ ] Đọc cả `items` (image/*, application/pdf); PDF dán vào → `uploadPDFs`
- [ ] Backend trả `engine_used`, `warnings`; frontend báo lỗi rõ ("API key không hợp lệ", "Model không khả dụng", "Không có OCR")
- [ ] Cập nhật danh sách model Gemini, nút "Kiểm tra key" trong `AISettingsCard`
- [ ] OCR offline đóng gói được trên Win/Mac (VD `rapidocr-onnxruntime`) hoặc bỏ fallback swift/tesseract
- [ ] Electron context menu (Cut/Copy/Paste); preload expose `clipboard.readImage()` cho nút "Dán ảnh"
- [ ] Revoke object URL cũ (`ImageBookingModal.tsx:115`)

### 3.2 Hãng tàu PIL & CUL
Hiện trạng: PIL đã có; CULINES đang ở thay đổi chưa commit. Test thử file thật: CUL đúng hết; PIL 1 sai `Empty Pick Up CY` = "COMPANY".
- [ ] Commit phần CUL đang dở
- [ ] `detect_carrier` (`extractor.py:51-96`) dùng regex có word boundary (`\bPIL\b`, `\bCU\s?LINES\b`, prefix số booking) — tránh "PILOT", "PARTICULARS" bị nhận nhầm
- [ ] Sửa regex Empty Pick Up CY (`extractor.py:195`); chuẩn hóa ETD về 1 định dạng (PIL `dd/mm/yyyy`, CUL `yyyy-mm-dd`)
- [ ] Bảng `CARRIERS` dùng chung, frontend lấy badge/màu từ đó (bỏ lặp ở `BookingDetailModal.tsx:32-51`, `ImageBookingModal.tsx:202-213`)
- [ ] Test với text từ file mẫu thật (CUL_CULVSGN2601792, PIL 1, PIL 2) chạy trên `backend.app.services.extractor`
- [ ] Xóa thư mục `src/` legacy (test hiện đang test bản cũ, không test backend)

### 3.3 Tìm tàu nhanh sau khi đọc booking
- [ ] Helper `splitVesselVoyage("KOTA NEKAD 0272S") → {name, voyage}`
- [ ] Map `Full return CY` → site ePort (Cát Lái → CTL, Hiệp Phước → THP…), fallback chọn site
- [ ] Nút "Tra tàu" ở `BookingDetailModal` (header Tàu/Số chuyến), icon trên từng dòng `BookingTab`, và trong `ImageBookingModal`
- [ ] Gọi `searchVesselsApi` → popover kết quả (ETA/ETD, cut-off, cầu bến) + nút "Mở tab Tàu" / "Thêm theo dõi"
- [ ] Truyền `onNavigateTab` từ `App.tsx` xuống `BookingTab`

---

## Phase 4 — Tra số cont: gộp tình trạng thông quan (P1)

Nguồn: `cust` (ePort `CUST`, "Giám sát HQ", đang ẩn mặc định) + `custom_clearance_status` ("Trạng thái thông quan") + `cust_approval_date`.
- [ ] **Cần xác nhận cách web ePort hiển thị** (chụp màn hình vài case Y/N) trước khi chốt logic
- [ ] Trường tính toán `customs_status` (không cần migration), đề xuất:
  - clearance = Y → "Đã thông quan" (+ ngày duyệt)
  - cust = Y, clearance ≠ Y → "Đang giám sát HQ"
  - clearance = N → "Chưa thông quan"
  - trống → "-"
- [ ] Tính ở backend `get_containers` để Excel export, dashboard dùng chung
- [ ] `ContainerTab` columns: thay 2 cột bằng `customs_status`, 2 cột gốc để ẩn; migrate localStorage `container_table_columns`
- [ ] Trường "Hàng nguy hiểm (IMDG)" đang hiện nguyên chuỗi HTML `<a href='http://imdg.saigonnewport.com.vn/?siteId=...&itemNo=...'></a>` → backend tách `imdg_url`, frontend hiện nút "Tra cứu IMDG ↗" mở trình duyệt ngoài
- [ ] `ContainerDetailModal`, search dropdown, "tìm tất cả" SQL, translations vi/en, color rules mặc định, `ColorConfigModal` (sửa label `cust` đang sai là "Khách hàng"), dashboard SQL `database.py:989-990,1036`

---

## Phase 5 — Bulk action cho từng tab (P2)

| Tab | Chọn nhiều | Xóa nhiều | Khác |
|---|---|---|---|
| Booking | ❌ | ❌ | ❌ |
| Tàu | ✅ | ✅ | ❌ |
| Container | ✅ | ✅ | ❌ |

- [ ] Hook `useRowSelection` (Set, chọn trang/chọn tất cả kết quả lọc, Shift+click) + component `BulkActionBar` dùng chung (tách từ code trùng ở VesselTab/ContainerTab)
- [ ] Backend mới:
  - `POST /bookings/batch-delete`
  - `POST /vessels|containers/watchlist/batch-add`, `batch-remove`
  - `POST /vessels|containers/resync` (ids đã chọn, chạy nền, trả job id)
  - `POST /{entity}/move` (chuyển/copy sang collection khác)
- [ ] Hành động theo tab:
  - Booking: xóa, export đã chọn, copy nhiều dòng, tra tàu hàng loạt
  - Tàu: xóa, export đã chọn, thêm/bỏ theo dõi, tra lại ePort, chuyển collection
  - Container: xóa, export đã chọn, thêm/bỏ theo dõi, tra lại ePort, chuyển collection, copy nhiều dòng
- [ ] Xóa selection khi đổi filter sự kiện

---

## Phase 6 — Hiệu năng render (P2)

- [ ] `AppContext`: `useMemo` cho value; tách `ToastContext` riêng (hiện mỗi toast re-render toàn bộ bảng)
- [ ] Polling 10s: bỏ qua nếu request trước chưa xong; chỉ setState khi dữ liệu đổi (so `max(updated_at)`/ETag); dừng khi cửa sổ ẩn
- [ ] Watchlist lookup + `selectedIds` dùng `Map/Set` thay `find/includes`
- [ ] Virtualize bảng khi chọn "tất cả" (`@tanstack/react-virtual`) hoặc giới hạn page size
- [ ] Throttle resize cột bằng `requestAnimationFrame`; `React.memo` cho row
- [ ] Bỏ fetch watchlist 2 lần (`ContainerTab.tsx:201,213`)
- [ ] (Tùy chọn) Pagination phía server khi dữ liệu > vài nghìn dòng

---

## Thứ tự release đề xuất
1. **v2.0.1 (hotfix, ~2–3 ngày):** Phase 0 + Phase 1 (phần persist/misfire/lock) + 3.1 (paste) + commit CUL
2. **v2.1.0 (~1 tuần):** Phase 2, 3.2, 3.3, 4
3. **v2.2.0 (~1–1.5 tuần):** Phase 5, 6, Phase 1 phần tray/cron

## Câu hỏi cần chốt với khách
1. "Thời gian đặt ra" là chu kỳ N phút hay giờ cố định trong ngày (VD 8h, 14h)?
2. Có cần app chạy nền (tray) để vẫn đồng bộ khi đóng cửa sổ?
3. Ảnh chụp màn hình web ePort phần "Tình trạng thông quan" cho vài trạng thái
4. Khách đã từng khôi phục backup bao nhiêu lần? (kiểm tra `SELECT COUNT(*) FROM color_rules` trên máy khách)
