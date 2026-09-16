# Kế hoạch phần việc còn lại — sau đợt tối ưu theo feedback (2026-09-15)

Tiếp nối `2026-09-15-customer-feedback-optimization.md`. Code đã nằm trên nhánh
`feat/customer-feedback-optimization` (8 commit, chưa push). Mục tiêu: đưa bản **v2.0.1** tới khách an toàn,
sau đó xử lý các hạng mục hiệu năng/tính năng còn lại trong **v2.1.0**.

Ký hiệu người làm: 🤖 Claude làm được · 👤 anh/chị (cần máy Windows / quyền repo) · 🧑‍💼 khách hàng

---

## Giai đoạn A — Dọn dẹp & chuẩn bị release (≈ 0.5 ngày)

### A1. Gỡ file sinh tự động khỏi git 🤖
- `git rm --cached booking_data.db tests/__pycache__/*.pyc`; thêm `*.db`, `*.db-wal`, `*.db-shm` vào `.gitignore` (`__pycache__/` đã có)
- **Xong khi:** `git status` sạch sau khi chạy test + chạy app

### A2. Một nguồn phiên bản duy nhất 🤖
- Hiện `"2.0.0"` ghi cứng ở 4 chỗ: `package.json`, `frontend/package.json`, `backend/app/main.py` (FastAPI `version` + `/health`)
- Tạo `backend/app/core/version.py` (`APP_VERSION`), `main.py` dùng hằng này; PyInstaller build đọc từ `package.json` hoặc script `scripts/bump_version.py` cập nhật cả 3 file
- Bump lên **2.0.1**
- **Xong khi:** `/health` trả đúng version của `package.json`; Electron không log cảnh báo lệch version

### A3. CI chạy đủ test 🤖
- `.github/workflows/build.yml`: `pytest tests/` → `pytest tests backend/tests` (2 job mac + win)
- Kiểm tra `requirements.txt` gốc có đủ `httpx` (TestClient), `tzdata`, `apscheduler`
- ⚠️ Workflow chạy **release** khi push lên `main` → chỉ merge khi A–B xong
- **Xong khi:** CI xanh trên PR

### A4. Push nhánh + mở PR 🤖 (cần anh/chị đồng ý)
- PR vào `main` sẽ kích hoạt CI build **cả macOS và Windows** → dùng làm bước build thử cho B2 mà không cần máy Windows ngay

---

## Giai đoạn B — Kiểm thử thực tế (≈ 1–1.5 ngày) — chặn release

### B1. End-to-end trên macOS dev 🤖 + 👤
Chuẩn bị: tắt `npm run dev` cũ → chạy lại (backend mới tự dọn 24MB color rules của DB dev).

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| 1 | Mở app | Splash hiện ngay, UI < 3s; `color_rules` còn ~24 dòng |
| 2 | Gõ liên tục trong ô tìm kiếm khi bảng 500 dòng, sau khi xoá 1 dòng (hộp xác nhận) | Không đơ, không mất focus |
| 3 | Bật auto-sync chế độ giờ cố định (giờ hiện tại + 2 phút), theo dõi 1 tàu + 1 cont thật | Chạy đúng giờ; watchlist hiện trạng thái ok/not_found; header "lần chạy tiếp theo" đúng |
| 4 | Tắt hẳn app → mở lại | Lịch còn nguyên, chạy bù sau 30s |
| 5 | Đóng cửa sổ khi auto-sync bật | Ẩn xuống tray; menu tray "Đồng bộ ngay" / "Thoát" hoạt động |
| 6 | Kill tiến trình backend | Tự khởi động lại ≤ 2s, UI không trắng |
| 7 | Dán ảnh booking ở tab Dashboard (Cmd+V), chuột phải → Dán, nút "Dán ảnh từ clipboard" | Mở modal, preview, 1 request; key Gemini hợp lệ → có dữ liệu |
| 8 | Dán PDF PIL/CUL từ Finder | Upload đúng hãng, CY/ETD đúng |
| 9 | Tra tàu nhanh từ booking | Kết quả ePort, "Theo dõi tàu này" hoạt động |
| 10 | Tra cont thật có IMDG + trạng thái HQ | Cột "Tình trạng thông quan" + nút "Tra cứu IMDG ↗" mở trình duyệt |
| 11 | Bulk trên cả 3 tab: chọn shift-click → xoá / xuất Excel / theo dõi / tra lại / chuyển bộ sưu tập | Đúng số dòng, toast tổng kết |
| 12 | Backup → restore 3 lần | Số color rules & watchlist không đổi |

- Ghi lỗi phát hiện vào `docs/superpowers/plans/2026-09-xx-e2e-findings.md`, sửa trước khi sang B2

### B2. Build & chạy thử bộ cài Windows 👤 (CI build sẵn từ A4)
- Tải artifact `AutoReadPDF-Windows` từ CI, cài trên máy Windows sạch (tốt nhất có Windows Defender bật)
- Chạy lại kịch bản 1, 2, 5, 6, 7, 11 của B1 + kiểm tra:
  - Thoát app → Task Manager không còn `backend_app.exe`
  - Log tiếng Việt không làm crash backend (`backend.log` xoay vòng ở 5MB)
  - Scheduler chạy được trong bản đóng gói (`tzdata`, cron trigger) — xem `backend.log`
  - Mở app lần 2 → focus cửa sổ cũ, không sinh backend thứ 2
- **Xong khi:** toàn bộ kịch bản pass trên Windows

### B3. Kiểm tra DB khách trước khi phát hành 👤 / 🧑‍💼
- Xin khách file `booking_data.db` (hoặc chạy `SELECT COUNT(*) FROM color_rules;`) → xác nhận nguyên nhân đơ
- Chạy `init_db` trên **bản sao** DB khách bằng code mới: đo thời gian migration, kiểm tra dữ liệu booking/tàu/cont còn đủ
- **Xong khi:** migration < 5s, không mất dữ liệu

### B4. Xác nhận nghiệp vụ 🧑‍💼
- Ảnh chụp web ePort phần "Tình trạng thông quan" cho các case: chưa khai / đang giám sát / đã thông quan → chỉnh `compute_customs_status` (backend `database.py`) + `container/customs.tsx` nếu khác
- Khách chọn mặc định: chu kỳ hay giờ cố định; có muốn chạy nền ở tray không
- **Xong khi:** có ảnh + câu trả lời, logic được cập nhật và test lại

➡️ **Phát hành v2.0.1** sau khi B1–B4 xong: merge PR → CI release.

---

## Giai đoạn C — Hiệu năng dữ liệu lớn (v2.1.0, ≈ 3–4 ngày)

### C1. Phân trang + tìm kiếm phía server 🤖
- Backend: `get_bookings / get_vessel_schedules / get_containers` nhận `limit, offset, sort_by, sort_dir, search_*`, trả `{items, total}` (endpoint mới `/…/page` để giữ tương thích endpoint cũ)
- Index phục vụ sort/tìm kiếm phổ biến (`containers(collection_id, containerno)`, `vessel_schedules(collection_id, vessel_name)`)
- Frontend: 3 tab chuyển sang fetch theo trang; "Chọn tất cả N kết quả" dùng endpoint `…/ids?filters` để lấy id
- Polling chỉ tải lại trang hiện tại + `total`
- **Xong khi:** collection 50.000 dòng container mở tab < 1s, cuộn/đổi trang < 300ms

### C2. Virtualization bảng 🤖
- Thêm `@tanstack/react-virtual` (~5KB) cho body bảng khi page size > 100; bỏ giới hạn 500 dòng/trang
- Giữ sticky header, cột resize, shift-click selection hoạt động với hàng ảo
- **Xong khi:** hiển thị 5.000 dòng/trang không giật (React Profiler commit < 16ms khi cuộn)

### C3. Lazy-load tab & chia bundle 🤖
- `React.lazy` cho `VesselTab`, `ContainerTab`, `BookingTab`, `ColorConfigModal`, `driver.js` tour
- **Xong khi:** chunk khởi động < 300KB, không còn cảnh báo 500KB của Vite

### C4. Giờ `queried_at` theo múi giờ Việt Nam 🤖
- `database.py` `_now_str()` dùng `ZoneInfo("Asia/Ho_Chi_Minh")`; frontend `formatTimeAgo` parse theo +07:00
- **Xong khi:** đổi múi giờ máy sang UTC, "cập nhật x phút trước" vẫn đúng

---

## Giai đoạn D — Đọc ảnh không cần Gemini & tinh chỉnh (v2.1.0, ≈ 2–3 ngày)

### D1. OCR offline đóng gói sẵn 🤖 (cần 👤 build thử Windows)
- Spike 0.5 ngày: so sánh `rapidocr-onnxruntime` vs `paddleocr` vs Windows OCR API (`winrt`) về: độ chính xác trên 10 ảnh booking thật, dung lượng tăng thêm cho bộ cài, thời gian đọc
- Chọn phương án (dự kiến rapidocr: +~60MB, đọc 2–4s/ảnh) → tích hợp vào `image_extractor.py` thay swift/tesseract, thêm vào `backend_app.spec`
- Lazy import để không làm chậm khởi động
- **Xong khi:** máy Windows không có Gemini key đọc được ảnh booking PIL/CUL với ≥ 90% trường chính đúng

### D2. So khớp voyage gần đúng 🤖
- `eport_client.search_vessels_detailed`: nếu không khớp chính xác, thử khớp chuẩn hoá (bỏ hậu tố N/S/E/W, số 0 đầu, dấu gạch) → đánh dấu `status="fuzzy"` + message "Đã khớp gần đúng với chuyến …"
- **Xong khi:** test với các cặp voyage thực tế từ log ePort

### D3. Các hạn chế nhỏ đã biết 🤖
| Hạng mục | Việc làm |
|---|---|
| Restore thay toàn bộ color rules | Thêm lựa chọn trong BackupModal: "Gộp" (mặc định, bản backup thắng khi trùng) / "Thay thế" |
| Chế độ giờ cố định chạy bù lúc khởi động | Chỉ chạy bù nếu đã lỡ một mốc giờ kể từ `last_run_at` |
| Tra tàu nhanh tự lưu vào tab Tàu | Thêm tham số `save=false` cho `/vessels/search`; chỉ lưu khi bấm "Lưu"/"Theo dõi" |
| Tra lại container lưu mọi event | Lọc theo `event_type` của dòng đã chọn (tuỳ chọn "Tất cả sự kiện") |
| Ngày không hợp lệ (`2026-02-30`) | Validate trong `normalize_date`, giữ nguyên chuỗi gốc nếu sai |

---

## Giai đoạn E — Giao diện gọn & nhật ký hệ thống (v2.1.0, ≈ 3–4 ngày)

Chi tiết từng bước: `2026-09-15-v2.1-ux-and-logging.md` (kế hoạch C: `2026-09-15-v2.1-large-data-performance.md`, kế hoạch D: `2026-09-15-v2.1-offline-ocr-and-fixes.md`).

| # | Hạng mục | Kết quả |
|---|---|---|
| E1 | Nhật ký hệ thống 🤖 | `app.log` / `errors.log` xoay vòng trong thư mục dữ liệu, giờ VN, che key; mã tra cứu cho lỗi 500; lỗi frontend gửi về backend; màn hình xem log + xuất `.zip` + mở thư mục log |
| E2 | Thanh thao tác hàng loạt gọn 🤖 | 1 dòng: 3 thao tác chính + menu "Thêm" + nút xoá dạng icon |
| E3 | Thêm / sửa booking thủ công 🤖 | Nút "Thêm booking", bút chì trên mỗi dòng, validate ngày & số lượng, cảnh báo trùng Booking No |
| E4 | Quản lý bộ sưu tập gọn 🤖 | Một nút chọn dạng popover (tìm, số lượng, tạo nhanh); modal quản lý có đổi tên và xoá kèm số dữ liệu sẽ mất |

---

## Thứ tự & mốc thời gian đề xuất

| Tuần | Việc | Kết quả |
|---|---|---|
| 1 (đầu tuần) | A1–A4, B1 | PR + CI xanh, e2e mac pass |
| 1 (cuối tuần) | B2–B4, sửa lỗi phát sinh | **Release v2.0.1** |
| 2 | C1, C2, C4 | Bảng lớn mượt |
| 3 | C3, D1 spike + tích hợp, D2, D3, E1 | OCR offline, log hệ thống |
| 4 | E2–E4, kiểm thử tổng | **Release v2.1.0** |

## Rủi ro
- **Build Windows lỗi hidden import** (tzdata/apscheduler metadata) → phát hiện sớm nhờ CI ở A4
- **Migration trên DB khách lớn/cũ** → luôn test trên bản sao (B3); backup DB tự động trước migration (thêm vào A nếu B3 cho thấy cần)
- **OCR offline làm bộ cài nặng** → nếu > 100MB, cân nhắc tải model khi dùng lần đầu
- **Khách chậm phản hồi B4** → phát hành v2.0.1 với logic hiện tại, ghi chú có thể điều chỉnh
