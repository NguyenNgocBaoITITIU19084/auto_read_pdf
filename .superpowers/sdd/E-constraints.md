## Phụ thuộc thứ tự
- **Kế hoạch C Task 1:** Vitest và `backend/app/core/timezone.py`.
- **Kế hoạch C Task 3:** `_booking_row_to_api`, `get_bookings_by_ids`, `BOOKING_SEARCH_COLUMNS`.
- **Kế hoạch C Task 7:** BookingTab dùng `useServerTable` (`table.reload`, `total`, `setCurrentPage`).
- Task 1–4 (log) và Task 5 (thanh hàng loạt) làm được ngay sau C Task 1.

## Quyết định sản phẩm (cần xác nhận)
1. **Sửa booking:** mỗi dòng có nút bút chì mở form sửa (trong modal chi tiết cũng có nút "Sửa"). Không sửa trực tiếp trong ô, để tránh sửa nhầm khi double-click (double-click vẫn mở chi tiết).
2. **Thêm thủ công:** nút "Thêm booking" trên thanh công cụ tab Booking.
   - Bắt buộc có **Booking No hoặc Tàu**.
   - ETD / Cut-off phải là ngày hợp lệ `DD/MM/YYYY[ HH:mm]`.
   - Trùng Booking No trong cùng bộ sưu tập chỉ **cảnh báo**, vẫn cho lưu.
3. **Thanh hàng loạt:** một dòng cố định dưới giữa màn hình. Tối đa 3 thao tác chính hiện kèm nhãn ngắn; còn lại vào menu "Thêm"; nút Xoá dạng icon đỏ ở cuối.
4. **Bộ sưu tập:**
   - Header còn **1 nút** hiện tên bộ sưu tập đang dùng. Bấm vào mở popover gồm: tìm kiếm, danh sách kèm số booking/tàu/cont, ô tạo mới, link "Quản lý…".
   - Modal quản lý có đổi tên và xoá (hộp xác nhận nêu rõ số dữ liệu sẽ mất).
5. **Log:**
   - Lưu tại `<userData>/logs/`. `app.log` giữ 5MB × 5 file; `errors.log` (chỉ WARNING trở lên) giữ 2MB × 3 file.
   - **Không** ghi nội dung request/booking, chỉ ghi phương thức, đường dẫn, mã trạng thái, thời gian.
   - Gemini key và tham số `api_key`/`key` luôn bị che.

## Global Constraints
- Giờ trong log: `YYYY-MM-DD HH:MM:SS` theo `Asia/Ho_Chi_Minh` (dùng `backend.app.core.timezone.VN_TZ`).
- Không bao giờ ghi giá trị Gemini key vào log hoặc file zip xuất ra (test bắt buộc).
- Thư mục log lấy từ env `LOG_DIR`. Nếu không có: `<thư mục chứa DB_PATH>/logs`.
- Mọi chuỗi UI mới thêm vào `translations.ts` cả `vi` và `en`. Chuỗi tiếng Việt đang viết cứng trong file sửa thì chuyển sang key.
- API cũ giữ tương thích: `GET /collections` không tham số trả như cũ; `POST /bookings/manual-save` giữ dạng response và thêm `warnings`.
- Test: `pytest backend/tests tests -q`; `cd frontend && npm test && npm run build`.
- Commit message kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

