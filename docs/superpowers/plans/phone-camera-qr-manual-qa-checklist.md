# Checklist kiểm thử thực tế — Chụp booking bằng điện thoại (v1)

Đây là checklist thủ công của Task 9 trong [2026-09-15-phone-camera-qr.md](2026-09-15-phone-camera-qr.md). Các mục này **cần thiết bị thật** (điện thoại iPhone/Android, máy Windows) nên không thể tự động chạy trong phiên làm việc này — anh/chị chạy qua trước khi coi tính năng là hoàn thiện để phát hành.

Đã tự động xác nhận trước (không cần lặp lại):
- ✅ `backend_app.spec` build thành công bằng PyInstaller (`npm run build:py:mac` tương đương), thêm đủ `hiddenimports` cho `backend.app.mobile.*`, `backend.app.api.mobile`, `backend.app.services.{lan_ip,lan_server,mobile_bridge}`, `PIL`/`PIL.ImageOps`.
- ✅ Chạy bản đóng gói (`dist/backend_app/backend_app`): `/health` trả 200 ngay lập tức, `POST /api/v1/mobile/session` → phiên bật, `GET /api/v1/mobile/session` → đọc đúng trạng thái, `DELETE /api/v1/mobile/session` → 204 và log không có token nào (chỉ có `POST/GET/DELETE ... -> 200/204`).
- ✅ `pytest backend/tests tests -q` (381+) và `cd frontend && npm test && npm run build` đều xanh sau khi merge toàn bộ 8 task.

## Checklist cần chạy tay (Mac + Windows, iPhone + Android)

- [ ] Quét QR → trang mở, trạng thái "Đã kết nối" trong ≤ 3s.
- [ ] Chụp ảnh dọc/ngang → máy tính mở xem trước, ảnh đúng chiều, OCR ra ≥ số trường như khi dán cùng ảnh đó.
- [ ] Chụp 5 ảnh liên tiếp → xử lý lần lượt, không mất ảnh nào, điện thoại hiện "máy tính đã nhận" cho cả 5.
- [ ] Quét lại mã QR cũ (đã dùng) → báo lỗi rõ ràng; mã mới trên màn hình vẫn dùng được.
- [ ] Hai điện thoại cùng kết nối và gửi ảnh.
- [ ] Ngắt kết nối → điện thoại báo hết phiên; `http://IP:8765` không còn truy cập được.
- [ ] Để yên 30 phút → tự ngắt. Thoát app → cổng đóng, thư mục tạm bị xoá.
- [ ] Từ điện thoại gọi `http://IP:8000/api/v1/settings/ai` → **không kết nối được** (xác nhận API chính không lộ ra LAN).
- [ ] Windows: hộp thoại tường lửa lần đầu, cho phép "Private" là chạy; hướng dẫn trong modal đúng.
- [ ] Thời gian khởi động backend (`/health`) không đổi so với trước.

## Cách chạy nhanh từng mục

1. Mở app, vào tab Booking, bấm "Chụp từ điện thoại".
2. Dùng camera điện thoại quét mã QR hiện trên màn hình.
3. Theo các bước hướng dẫn trong mục README "📱 Chụp booking bằng điện thoại".
4. Ghi kết quả (pass/fail + ghi chú) vào file này hoặc báo lại trực tiếp.

## Nếu có mục fail

Báo lại kèm: bước nào, thiết bị/OS nào, ảnh chụp màn hình lỗi (nếu có), và log backend (`Xem nhật ký` trong app hoặc thư mục log của Electron) — sẽ xử lý tiếp theo plan's rủi ro đã liệt kê.
