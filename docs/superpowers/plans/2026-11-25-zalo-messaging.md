# Kế hoạch triển khai: Quản lý Tin nhắn Zalo trong App (`zalo-message`)

**Ngày lập:** 2026-11-25  
**Nhánh Git:** `zalo-message`  
**Phương án kỹ thuật:** Hướng A — Tích hợp `zca-js` trong Electron + Lưu trữ & Quản lý tập trung bằng SQLite/FastAPI + Giao diện 3 cột trong React.

---

## 1. Mục tiêu
1. **Nhận & theo dõi tin nhắn tài xế gửi tới:** Lắng nghe tin nhắn Zalo real-time, tự động đối chiếu SĐT / Zalo UID với bảng `fleet_drivers`, lưu vào SQLite, đếm tin chưa đọc, đánh dấu *Chờ xử lý* và hiện thông báo Desktop khi có tin mới từ tài xế.
2. **Gửi tin nhắn trực tiếp từ App:** Nhắn tin 2 chiều (text, ảnh) ngay trong tab `Zalo`, hỗ trợ gửi theo mẫu (`/dieu-xe`, `/cutoff`, `/doi-lich`, ...) và gửi cho 2–3 tài xế cùng lúc với **giãn cách an toàn 1.5–3 giây/người**.
3. **Quản lý tập trung & Gắn kết nghiệp vụ:**
   - Lọc hội thoại theo *Tất cả / Tài xế / Chưa đọc / Chờ xử lý*.
   - Xem thông tin tài xế, xe đang chạy và Booking liên quan ngay bên cạnh khung chat để chèn nhanh vào tin nhắn.
   - Nút **Gửi qua Zalo** từ `TasksTab`, `NotificationDetailModal`, và **Nhắn Zalo** từ `FleetTab` (Tài xế).

---

## 2. Cơ sở dữ liệu & Backend (`backend/`)

### 2.1. Bảng SQLite mới (`backend/app/core/zalo.py`, gọi từ `database.py::init_db()`)
- `zalo_sessions`: Lưu trạng thái tài khoản Zalo đang kết nối (`id`, `uid`, `display_name`, `phone`, `avatar`, `status`, `updated_at`). *(Credentials nhạy cảm chỉ lưu trong `userData/zalo-session.json` của Electron, không lưu vào DB).*
- `zalo_conversations`: `thread_id` (PK), `thread_type` (`user` | `group`), `display_name`, `phone`, `avatar`, `driver_id` (FK → `fleet_drivers.id`), `unread_count`, `needs_attention`, `last_message_preview`, `last_message_at`, `last_direction`, `updated_at`.
- `zalo_messages`: `id` (PK), `msg_id` (UNIQUE), `thread_id`, `direction` (`in` | `out`), `sender_id`, `sender_name`, `msg_type` (`text` | `image` | `file` | `other`), `content`, `media_url`, `booking_no`, `status` (`received` | `sent` | `failed`), `created_at`.
- `zalo_templates`: `id` (PK), `name`, `shortcut`, `category`, `content`, `created_at`, `updated_at`. Seed sẵn 4 mẫu điều vận mặc định.

### 2.2. API Endpoints (`backend/app/api/zalo.py`, prefix `/api/v1/zalo`)
- `GET /zalo/session` & `POST /zalo/session` — đọc/cập nhật trạng thái kết nối tài khoản Zalo.
- `GET /zalo/conversations` — lọc theo `filter` (`all`, `drivers`, `unread`, `pending`), `q`, trả kèm thông tin tài xế & biển số xe đang phụ trách + tổng số tin chưa đọc.
- `POST /zalo/conversations/{thread_id}/read` — đặt `unread_count = 0`.
- `PATCH /zalo/conversations/{thread_id}` — cập nhật `needs_attention`, liên kết `driver_id`, `phone`, `display_name`.
- `GET /zalo/conversations/{thread_id}/messages` — lấy danh sách tin nhắn phân trang.
- `POST /zalo/messages/incoming` — tiếp nhận tin nhắn đến từ Electron bridge, tự động chuẩn hóa SĐT (`0...`) để khớp với `fleet_drivers`, chống trùng theo `msg_id`.
- `POST /zalo/messages/outgoing` — lưu tin nhắn đã gửi từ app.
- `GET /zalo/drivers/unlinked` — danh sách tài xế đang làm việc chưa có hội thoại Zalo để tìm nhanh theo SĐT.
- `GET/POST/PUT/DELETE /zalo/templates` — quản lý mẫu tin nhắn nhanh.

---

## 3. Electron Zalo Bridge (`electron/zalo_bridge.js`)
- Cài đặt `zca-js` trong `package.json`.
- Quản lý đăng nhập QR Code (`zalo:login-qr`), khôi phục phiên 1 lần khi mở app (`zalo-session.json` trong `app.getPath('userData')`), **không tự retry vòng lặp** nếu phiên hết hạn để tránh cảnh báo bảo mật.
- Lắng nghe `api.listener.on('message', ...)` → đẩy về Backend `/api/v1/zalo/messages/incoming`, phát sự kiện IPC `zalo-message-received` lên React, và hiện Desktop Notification nếu tin đến từ tài xế khi cửa sổ app không focus.
- Hỗ trợ `zalo:send-message`, `zalo:send-batch` (delay ngẫu nhiên 1.5–3s giữa mỗi người nhận), `zalo:find-user` (tìm tài xế theo SĐT).
- Expose API an toàn qua `electron/preload.js`.

---

## 4. Giao diện Frontend (`frontend/src/components/zalo/`)
1. **Tab `Zalo` (`ZaloTab.tsx`):**
   - Header trạng thái kết nối + Modal quét mã QR đăng nhập Zalo.
   - Bố cục 3 cột: Danh sách hội thoại & bộ lọc | Khung chat 2 chiều + Mẫu tin + Gửi nhóm 2–3 tài xế | Panel ngữ cảnh Tài xế & Booking/Việc hôm nay.
2. **Tích hợp đa tab:**
   - `Tabs.tsx`: Thêm tab `Zalo` kèm badge số tin chưa đọc.
   - `TasksTab.tsx` & `NotificationDetailModal.tsx`: Thêm nút **Gửi qua Zalo** chuyển thẳng nội dung sang tab Zalo / modal chọn tài xế.
   - `FleetTab.tsx` (Tài xế): Thêm nút **Nhắn Zalo** mở thẳng hội thoại của tài xế đó.

---

## 5. Kiểm thử & Xác minh
- **Backend (`pytest`):** Test CRUD hội thoại, tin nhắn, mẫu tin, chống trùng `msg_id`, tự động khớp tài xế theo SĐT (`+84`/`0`).
- **Frontend (`vitest` & `tsc && vite build`):** Kiểm tra typecheck, build production không lỗi.
- **Electron:** Kiểm tra IPC bridge và khởi động app không lỗi.
