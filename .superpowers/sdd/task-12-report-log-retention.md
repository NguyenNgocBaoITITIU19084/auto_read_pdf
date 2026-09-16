# Task 12 Report: Tự động dọn log cũ hơn 3 ngày

## Tóm tắt thay đổi

1. **`backend/app/core/logging_setup.py`**
   - Thêm `purge_old_logs(max_age_days: int = 3) -> dict`, cùng các helper nội bộ:
     - `_cutoff_timestamp()`: tính mốc epoch cắt dựa trên giờ VN (`VN_TZ`).
     - `_find_open_handler()`: tìm `FileHandler` đang mở trên root logger khớp `baseFilename`.
     - `_trim_active_log()`: đọc `app.log`/`errors.log`, tách thành các "khối" — dòng có
       timestamp `YYYY-MM-DD HH:MM:SS` ở đầu + các dòng tiếp theo không khớp định dạng đó
       (traceback, log nhiều dòng) được coi là phần nối tiếp của dòng log cha gần nhất — xoá
       khối nào cũ hơn `max_age_days`, ghi đè file. Nếu tìm thấy handler đang mở ứng với file
       đó: `handler.acquire()` → đóng `handler.stream` → ghi đè nội dung mới → mở lại bằng
       `handler.stream = handler._open()` → `handler.release()`. Nếu không có handler mở
       (ví dụ chạy test không qua `configure_logging()`), vẫn ghi đè file bình thường.
     - `_delete_stale_backups()`: xoá file rotate cũ dạng `app.log.1`, `app.log.2`, ... có
       `mtime` cũ hơn `max_age_days` (dùng `glob`).
   - `purge_old_logs()` gọi 2 bước trên cho cả `app.log` và `errors.log`, trả về
     `{"deleted_backups": [...], "trimmed_files": {"app.log": N, "errors.log": M}}`, và ghi
     1 dòng `logger.info` tóm tắt số lượng (không log nội dung dòng đã xoá — tránh rò rỉ dữ
     liệu nhạy cảm).

2. **`backend/app/services/background_tasks.py`**
   - Import `purge_old_logs` từ `logging_setup`.
   - Thêm hằng `LOG_RETENTION_JOB_ID = "log_retention"` và
     `LOG_RETENTION_STARTUP_DELAY_SECONDS = 10`.
   - Thêm `_run_log_retention()` (async wrapper chạy `purge_old_logs` qua
     `asyncio.to_thread`, bắt exception + log).
   - Thêm `register_log_retention_job(startup_delay_seconds=...)`:
     - Gọi `setup_scheduler()` (dùng lại `AsyncIOScheduler` sẵn có, không tạo scheduler mới).
     - Xoá job cũ (nếu có) bằng `_remove_job()` rồi đăng ký job định kỳ mỗi 24h
       (`IntervalTrigger(hours=24, timezone=VN_TZ)`, `id="log_retention"`, dùng chung
       `JOB_OPTIONS` như các job khác).
     - Đăng ký thêm 1 job chạy 1 lần sau `startup_delay_seconds` giây (mặc định 10s, theo
       đúng pattern `DateTrigger` + delay của `restore_auto_sync`/`_schedule_kick`) —
       `id="log_retention_kick"` — để không phải đợi 24h đầu tiên nhưng cũng không block
       khởi động app.
     - Idempotent: gọi lại nhiều lần không tạo job trùng (dùng `_remove_job` trước khi add,
       vì khi scheduler ở trạng thái STOPPED, `replace_existing=True` của APScheduler không
       dedupe các job đang ở hàng đợi "pending" — phải tự xoá trước khi thêm, giống cách
       `apply_schedule()` đã làm với `AUTO_SYNC_JOB_ID`).

3. **`backend/app/main.py`**
   - Trong `lifespan()`, sau `await restore_auto_sync()`, gọi thêm
     `register_log_retention_job()` (không `await` job thực thi, chỉ đăng ký — không làm
     chậm khởi động, `/health` vẫn sẵn sàng ngay).

4. **Test mới**
   - `backend/tests/test_log_retention.py` (6 test, TDD trước khi code):
     - Cắt bớt khối dòng cũ trong `app.log` (bao gồm traceback nhiều dòng gắn với dòng log
       cũ) trong khi giữ nguyên khối mới.
     - Giữ nguyên toàn bộ khi không có gì cũ.
     - An toàn khi file đang có handler mở (`configure_logging()` thật) — xoá xong vẫn ghi
       log tiếp bình thường qua handler cũ.
     - Xoá file rotate cũ (`app.log.1`, mtime giả lập qua `os.utime`) và giữ file rotate mới.
     - Xử lý gracefully khi file log chưa tồn tại.
     - Cắt bớt hoạt động đúng cho `errors.log`.
   - `backend/tests/test_log_retention_scheduler.py` (2 test):
     - `register_log_retention_job()` đăng ký job `id="log_retention"` vào `scheduler`.
     - Gọi lại 2 lần không tạo job trùng (idempotent).

## Kết quả test

```
pytest backend/tests -q   → 94 passed
pytest tests -q            → 145 passed
```

Không có test nào bị phá vỡ.

## Ghi chú / rủi ro đã cân nhắc

- **Không log nội dung dòng bị xoá**: `purge_old_logs` chỉ log số lượng (đếm), tuân thủ ràng
  buộc không được vô tình in ra dữ liệu nhạy cảm đã bị cắt.
- **An toàn với handler đang mở**: đã test thực tế với `configure_logging()` — sau khi trim,
  handler tiếp tục ghi log bình thường vào file mới (đã verify bằng cách ghi thêm dòng sau
  khi purge và đọc lại file).
- **Không tạo scheduler mới**: dùng lại biến `scheduler` module-level sẵn có trong
  `background_tasks.py`.
- **Job trùng khi gọi lại `register_log_retention_job()`**: phát hiện qua test — khi
  scheduler chưa `start()` (trạng thái STOPPED, phổ biến trong test), APScheduler chỉ gom
  các lệnh `add_job()` vào danh sách "pending" mà KHÔNG áp dụng `replace_existing` cho tới
  khi scheduler thật sự start — nên phải chủ động `_remove_job()` trước khi add (đã sửa,
  test xác nhận không còn trùng).
- **Mối lo còn lại (nhỏ)**: `_trim_active_log` đọc toàn bộ file vào bộ nhớ (`read_text`) rồi
  ghi đè — với file log giới hạn tối đa 5MB (app.log) / 2MB (errors.log) theo cấu hình rotation
  hiện tại, việc này chấp nhận được, nhưng nếu sau này tăng `maxBytes` đáng kể thì nên cân
  nhắc xử lý streaming thay vì đọc hết vào RAM.

## Commit

Xem log git: commit chứa các thay đổi trên với message bắt đầu bằng
`feat(logging): auto-purge logs older than 3 days` và kết thúc bằng dòng
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
