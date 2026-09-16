### Task 12: Tự động dọn log cũ hơn 3 ngày

## Bối cảnh

`backend/app/core/logging_setup.py` (`configure_logging()`) hiện dùng `RotatingFileHandler` theo dung lượng: `app.log` giữ 5MB × 5 file, `errors.log` (WARNING+) giữ 2MB × 3 file (xem hằng số `APP_LOG`, `ERROR_LOG`, `get_log_dir()`). Đây là rotation theo DUNG LƯỢNG, không theo THỜI GIAN — nếu app ít traffic, log có thể tồn tại rất lâu (nhiều tháng) trước khi đầy 5MB và bị rotate. Người dùng muốn: **log tự động bị xoá/dọn sau 3 ngày** để tránh app nặng dần theo thời gian, bất kể dung lượng.

`backend/app/services/background_tasks.py` đã có sẵn `AsyncIOScheduler` (biến `scheduler`, xem cách `restore_auto_sync()` và các job khác được đăng ký bằng `scheduler.add_job(...)`) — dùng lại hạ tầng này để chạy dọn log định kỳ, KHÔNG tạo scheduler mới.

## Yêu cầu

1. Thêm hàm `purge_old_logs(max_age_days: int = 3) -> dict` vào `backend/app/core/logging_setup.py` (cạnh các hàm hiện có), làm 2 việc:
   a. **Xoá file backup đã rotate cũ:** với mỗi file log gốc (`app.log`, `errors.log`) trong thư mục `get_log_dir()`, tìm các file rotate của `RotatingFileHandler` (dạng `app.log.1`, `app.log.2`, ...), xoá file nào có `mtime` cũ hơn `max_age_days` ngày (so với giờ hiện tại theo `Asia/Ho_Chi_Minh`, dùng `backend.app.core.timezone.VN_TZ`/hàm giờ VN đã có sẵn trong codebase — đọc `backend/app/core/timezone.py` để dùng đúng hàm).
   b. **Cắt bớt nội dung cũ trong file log ĐANG HOẠT ĐỘNG** (`app.log`, `errors.log`): đọc từng dòng, mỗi dòng log mới bắt đầu bằng timestamp dạng `YYYY-MM-DD HH:MM:SS` (theo định dạng `VnTimeFormatter` đang dùng — xem cách dòng log được format trong `logging_setup.py`); các dòng KHÔNG khớp định dạng timestamp ở đầu (ví dụ dòng traceback nhiều dòng) được coi là PHẦN NỐI TIẾP của dòng log gần nhất trước đó — giữ/xoá theo dòng log cha của nó. Xoá các "khối dòng" (dòng log + phần nối tiếp) có timestamp cũ hơn `max_age_days` ngày, giữ lại phần còn lại, ghi đè file.
      - Vì handler đang giữ file mở ở chế độ append, phải làm an toàn: lấy handler tương ứng từ `logging.getLogger().handlers` (so khớp theo `baseFilename`), gọi `handler.acquire()` trước khi thao tác, `handler.stream.close()`, ghi đè nội dung mới vào file, sau đó gọi lại cơ chế mở stream của handler để nó tiếp tục ghi đúng (ví dụ `handler.stream = handler._open()` — đây là API nội bộ chuẩn của `logging.FileHandler`, được dùng phổ biến), rồi `handler.release()`. Nếu không tìm thấy handler đang mở ứng với file đó (ví dụ trong test không qua `configure_logging()`), vẫn cho phép ghi đè file bình thường (không bắt buộc phải có handler).
   c. Trả về dict tóm tắt, ví dụ `{"deleted_backups": [...], "trimmed_files": {"app.log": <số dòng xoá>, "errors.log": <số dòng xoá>}}` — để test có thể assert và để log lại kết quả (dùng `logger.info` ghi 1 dòng tóm tắt sau khi chạy xong, không ghi nội dung log đã xoá).
2. **Đăng ký job định kỳ** trong `backend/app/services/background_tasks.py`: chạy `purge_old_logs()` MỖI NGÀY 1 LẦN (dùng `IntervalTrigger(hours=24)` hoặc tương tự, theo đúng pattern các job khác trong file này — xem `JOB_OPTIONS`, cách `scheduler.add_job` được gọi cho các job hiện có), VÀ chạy 1 lần ngay khi khởi động app (không cần đợi 24h đầu tiên) nhưng KHÔNG được làm chậm khởi động (không block event loop lúc `/health` sẵn sàng — lên lịch chạy sau vài giây bằng `DateTrigger`/delay, giống cách `restore_auto_sync` dùng `startup_delay_seconds`, xem kỹ hàm này để theo đúng pattern trì hoãn khởi động đã có).
   - Đặt tên job cố định, ví dụ `id="log_retention"`, để tránh đăng ký trùng nếu hàm khởi tạo được gọi lại.
3. Viết test theo TDD trong `backend/tests/test_log_retention.py`:
   - Test `purge_old_logs`: tạo file log giả trong `tmp_path` với các dòng có timestamp cũ (>3 ngày) và mới (<3 ngày) xen kẽ, gồm cả dòng traceback nhiều dòng gắn với 1 dòng log cũ, xác nhận sau khi chạy chỉ còn dòng mới + traceback thuộc dòng mới, dòng cũ + traceback của nó bị xoá hết.
   - Test file rotate cũ (`app.log.1`) bị xoá khi mtime cũ hơn 3 ngày (dùng `os.utime` để giả lập mtime cũ), file rotate mới hơn 3 ngày thì được giữ.
   - Test job được đăng ký trong scheduler sau khi gọi hàm khởi tạo tương ứng trong `background_tasks.py` (kiểm tra `scheduler.get_job("log_retention")` tồn tại), không cần test scheduler thực sự chạy job (dùng cách test tương tự các job khác đã có trong `backend/tests/`, tìm file test hiện có cho `background_tasks.py` để theo đúng pattern, ví dụ mock/mờ thời gian hoặc gọi trực tiếp hàm khởi tạo).

## Ràng buộc chung (từ kế hoạch E)
- Giờ trong log: `YYYY-MM-DD HH:MM:SS` theo `Asia/Ho_Chi_Minh` — dùng `backend.app.core.timezone.VN_TZ`.
- KHÔNG BAO GIỜ ghi giá trị Gemini key vào log — hàm dọn log không được vô tình in nội dung dòng log bị xoá ra log khác.
- Test: `pytest backend/tests -q` (và `pytest tests -q` nếu có) phải pass toàn bộ, không phá vỡ gì.

## Việc cần làm

1. Đọc kỹ `backend/app/core/logging_setup.py`, `backend/app/core/timezone.py`, `backend/app/services/background_tasks.py` (đặc biệt `restore_auto_sync`, `JOB_OPTIONS`, cách các job khác dùng `IntervalTrigger`/`DateTrigger`) trước khi code.
2. TDD: viết test trước → chạy fail → implement → pass.
3. Chạy `pytest backend/tests -q` (và `pytest tests -q` nếu có).
4. Tự review lại — đặc biệt an toàn khi thao tác file log đang mở (không làm hỏng handler đang ghi).
5. Commit với message kết thúc bằng:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

## Báo cáo

Viết báo cáo đầy đủ vào: `/Users/baonguyen/Developer/auto_read_pdf/.superpowers/sdd/task-12-report-log-retention.md`
Rồi trả lời NGẮN GỌN (dưới 15 dòng): Status, commit (short SHA + subject), tóm tắt test 1 dòng, mối lo ngại, đường dẫn báo cáo.
