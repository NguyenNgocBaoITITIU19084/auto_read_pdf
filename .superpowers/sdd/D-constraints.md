## Quyết định sản phẩm (cần anh/chị xác nhận trước khi làm)

1. **Khôi phục "Gộp" (mặc định):** bộ sưu tập trùng tên được gộp vào bộ sưu tập sẵn có (không tạo bản `_imported_…` nữa); dòng trùng thì **bản backup thắng** (tàu/cont theo khoá UNIQUE sẵn có, booking theo cặp `booking_no + pdf_name`, color rule theo `target_table + column_key + match_value + match_type`). **"Thay thế":** xoá toàn bộ bộ sưu tập (kèm booking/tàu/cont/watchlist) và color rules rồi nạp đúng nội dung backup; cài đặt hệ thống (Gemini key, auto-sync) giữ nguyên; có hộp xác nhận nguy hiểm.
2. **Chạy bù giờ cố định:** chỉ chạy bù khi mốc giờ gần nhất đã qua **sau** lần chạy cuối (`last_run_at` được lưu DB). Chưa từng chạy → coi là đã lỡ. Chế độ chu kỳ giữ nguyên hành vi chạy sau 30s.
3. **Tra lại container:** mặc định chỉ lưu sự kiện cùng `event_type` với các dòng đã chọn; thêm hành động hàng loạt riêng "Tra lại (mọi sự kiện)".
4. **Khớp voyage gần đúng:** chỉ tự nhận khi có đúng 1 chuyến ePort khớp gần đúng; ≥ 2 chuyến → vẫn báo "không khớp" kèm danh sách.
5. **Tra tàu nhanh:** không tự lưu; nút "Lưu vào tab Tàu" từng kết quả; "Theo dõi" đồng thời lưu kết quả đó. Hành động hàng loạt "Tra tàu" ở tab Booking vẫn lưu như cũ.

## Global Constraints

- OCR: máy Windows **không có key** đọc đúng **≥ 90% trường chính** trên bộ 10 ảnh booking thật. Trường chính: `Booking No`, `Carrier`, `Vessel`, `ETD`, `Port of Discharging`, `Equipment Type`, `Q'ty`, `Empty Pick Up CY`, `Full return CY`, `Port Cargo Cut-off` (10 trường × 10 ảnh = 100 ô, cần ≥ 90 ô đúng).
- Spike OCR tối đa **0.5 ngày**, so sánh đúng 3 phương án: `rapidocr`, `paddleocr`, Windows OCR API.
- Bộ cài tăng thêm do OCR: nếu > 100MB → báo lại trước khi tích hợp (phương án tải model lần đầu).
- OCR import lười: không làm chậm khởi động backend (đo `/health` sẵn sàng trước/sau chênh < 1s).
- Ảnh booking thật của khách **không commit vào git** (thư mục `scripts/ocr_spike/samples/` nằm trong `.gitignore`).
- API giữ tương thích ngược: `/vessels/search` mặc định vẫn lưu (`save=true`); `/restore` không có `mode` = `merge`; `/containers/resync` không có `all_events` = lọc theo sự kiện.
- Giờ lưu DB: `"%Y-%m-%d %H:%M:%S"` theo `Asia/Ho_Chi_Minh`.
- Chuỗi UI thêm vào `translations.ts` cả `vi` và `en`, chỉ thêm key trong section liên quan.
- Test: `pytest backend/tests tests -q`; `cd frontend && npm test && npm run build`.
- Commit message kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

