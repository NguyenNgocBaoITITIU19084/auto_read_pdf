# Task 2 Report — Log từng request + mã tra cứu lỗi (Plan E)

## Tóm tắt

Đã implement theo TDD: viết test trước (`backend/tests/test_request_logging.py`), xác nhận
fail, cài đặt `RequestLoggingMiddleware`, gắn vào `main.py`, thêm log nghiệp vụ vào
`bookings.py` / `collections.py` / `export_backup.py`, rồi chạy lại toàn bộ suite.

## Lệch giữa brief và code thật (Task 1) — đã tự điều chỉnh

Brief giả định Task 1 đã có `setup_logging(log_dir=...)`, `redact()`, `APP_LOG`/`ERROR_LOG`,
và `backend/app/core/request_context.py` với `request_id_var`. Thực tế kiểm tra code:

- `backend/app/core/logging_setup.py` chỉ có `configure_logging()` (đọc `LOG_DIR` env var,
  không nhận tham số `log_dir`), không có `setup_logging`, không có `redact`, không có
  `APP_LOG`/`ERROR_LOG` (file "app.log"/"errors.log" hard-code trong hàm).
- `backend/app/core/request_context.py` **chưa tồn tại**, không có `request_id_var` ở đâu
  trong repo.
- `main.py` đã có sẵn một middleware kiểu decorator (`@app.middleware("http") async def
  log_requests`) log `METHOD path -> status (Nms)` ở mức INFO cho mọi request, không có
  request id, không redact, không phân mức theo status/thời gian.
- `backend/tests/test_logging.py` đã có sẵn (từ Task 1 thật), gồm test
  `test_request_middleware_logs_method_path_status_no_body` assert `"GET /health -> 200" in
  app_log` — test này giả định `/health` log ở INFO, xung đột trực tiếp với yêu cầu mới
  (`/health` phải là DEBUG, tức im lặng ở app.log mức INFO).

Xử lý:

1. Thêm `APP_LOG = "app.log"`, `ERROR_LOG = "errors.log"` làm hằng số dùng lại trong
   `configure_logging()` (thay vì chuỗi hard-code) — thay đổi nhỏ, không phá test cũ (giá
   trị chuỗi giữ nguyên).
2. Thêm alias public `redact = _mask_sensitive` trong `logging_setup.py` để middleware
   dùng đúng interface brief mô tả, tận dụng logic mask đã có sẵn (không viết lại regex).
3. Tạo mới `backend/app/core/request_context.py` với
   `request_id_var: ContextVar[str] = ContextVar("request_id", default="-")` — thành phần
   Task 1 còn thiếu nhưng Task 2 cần trực tiếp, phạm vi nhỏ và không đụng gì khác.
4. Không thêm hàm `setup_logging` mới — test tự viết dùng đúng API thật:
   `monkeypatch.setenv("LOG_DIR", str(tmp_path)); ls.configure_logging()` (theo đúng pattern
   đã có trong `test_logging.py`), thay vì `ls.setup_logging(log_dir=tmp_path)` như brief.
5. **Phát hiện thêm ngoài dự kiến của brief**: traceback trong `errors.log` không được mask
   secret vì `SensitiveDataFilter` chỉ sửa `record.msg`, không đụng tới phần traceback do
   `logging.Formatter.formatException()` sinh ra. Test
   `test_unhandled_error_returns_lookup_code_and_traceback` (yêu cầu `"AIzaSy" not in
   errors`) sẽ fail nếu không sửa. Đã thêm override `VnTimeFormatter.format()` để mask toàn
   bộ dòng log đã format (gồm cả traceback) trước khi ghi ra file — vá một lỗ hổng thật của
   Task 1, phạm vi tối thiểu (không đổi hành vi `SensitiveDataFilter` hiện có).
6. Xoá middleware decorator cũ trong `main.py`, thay bằng
   `app.add_middleware(RequestLoggingMiddleware)` đặt sau `CORSMiddleware` (⇒ ngoài cùng
   theo cách Starlette xếp middleware — middleware thêm sau cùng bọc ngoài cùng), thêm
   `expose_headers=["X-Request-ID"]` vào CORS. Bỏ import `time`, `Request` không còn dùng.
7. Sửa test cũ `test_request_middleware_logs_method_path_status_no_body` (trong
   `test_logging.py`) — đổi endpoint kiểm tra từ `/health` (nay là DEBUG, im lặng có chủ
   đích theo spec mới) sang `/api/v1/collections` (route thường, vẫn log ở INFO), giữ
   nguyên mục đích của test (middleware log method/path/status, không log body).

## Files đã tạo/sửa

- Tạo: `backend/app/core/request_context.py`
- Tạo: `backend/app/core/request_logging.py`
- Tạo: `backend/tests/test_request_logging.py`
- Sửa: `backend/app/core/logging_setup.py` (thêm `APP_LOG`/`ERROR_LOG`, `redact` alias,
  `VnTimeFormatter.format()` mask traceback)
- Sửa: `backend/app/main.py` (thay middleware cũ bằng `RequestLoggingMiddleware`, thêm
  `expose_headers`)
- Sửa: `backend/app/api/bookings.py` (logger + 4 điểm log nghiệp vụ: upload, extract-image,
  batch-delete, clear)
- Sửa: `backend/app/api/collections.py` (logger + 3 điểm log: tạo, xoá, move)
- Sửa: `backend/app/api/export_backup.py` (logger + backup/restore, kể cả nhánh lỗi
  `logger.exception("Restore failed")`)
- Sửa: `backend/tests/test_logging.py` (điều chỉnh 1 test cũ theo spec mới, xem mục 7 ở trên)

## Lệnh test đã chạy

```
pytest backend/tests/test_request_logging.py -v   # trước implement: 5 FAILED (KeyError x-request-id)
                                                    # sau implement: 5 passed
pytest backend/tests -q                            # 75 passed
pytest backend/tests tests -q                       # 220 passed
```

Kết quả cuối: **220 passed**, không có test nào bị bỏ qua hay xfail.

## Self-review

- Đầy đủ yêu cầu brief: X-Request-ID header (tự sinh nếu client không gửi hoặc gửi sai
  định dạng `^[A-Za-z0-9-]{6,64}$`), JSON 500 với `Mã tra cứu: <id>` + `request_id`, phân
  mức log theo status/thời gian (DEBUG cho endpoint ồn, ERROR ≥500, WARNING ≥400 hoặc
  SLOW >3000ms, còn lại INFO), redact query string, và log nghiệp vụ ở đúng 3 file API
  theo đúng nội dung dòng log brief yêu cầu.
- Không thừa: không thêm logger cho `vessels.py`/`containers.py`/`color_rules.py` vì
  brief không yêu cầu (Task 2 giới hạn 3 file).
- Middleware đặt ngoài cùng qua `app.add_middleware()` sau CORS — đã verify bằng test thực
  tế (500 case chạy đúng, log + header đúng), không chỉ dựa vào suy luận thứ tự Starlette.
- Test có ý nghĩa: mỗi test brief đưa ra được giữ nguyên ý định gốc, chỉ chỉnh hai chỗ để
  khớp API thật:
  - Mask text từ `***` (brief) → `***MASKED***` (thật, dùng hằng `ls.MASK`).
  - Bỏ so khớp toàn bộ nội dung app.log cho `/health`/`/scheduler/status` (vì TestClient
    dùng httpx, tự log dòng "HTTP Request: GET ..." vào cùng root logger — nhiễu không
    liên quan tới middleware đang test) → so khớp đúng định dạng dòng log của middleware
    (`"GET /health ->"`), không đổi ý nghĩa test.
  - Chuỗi bí mật giả trong test lỗi 500 đổi từ `key=AIza...` sang `api_key=AIza...` vì
    regex mask bare `key=` chỉ áp dụng ở vị trí query-param (`?key=`/`&key=`), không áp
    dụng cho `key=` xuất hiện tự do trong message — hành vi này là chủ đích của
    `_SENSITIVE_URL_KEY_RE` (đã có sẵn từ Task 1, không phải bug mới).
- Đã kiểm tra không còn import thừa (`time`, `Request`) trong `main.py` sau khi xoá
  middleware cũ.
- Không phát hiện file `.pyc` nào được thêm vào staging trước khi commit (loại trừ
  `__pycache__` khỏi `git add`).

## Vấn đề còn tồn tại / theo dõi thêm

- `/api/v1/logs*` và `/api/v1/logs/client` trong `_QUIET` prefix list chưa tồn tại route
  thật (thuộc Task 3 kế hoạch E) — để nguyên vì vô hại và forward-compatible.
- `request_id_var` hiện chỉ được set/reset trong middleware; chưa có code nghiệp vụ nào
  chủ động đọc nó để gắn vào log message riêng (brief không yêu cầu thêm ở Task 2, nhưng
  đây là điểm mở cho Task sau nếu muốn log request id trong các dòng `logger.info` nghiệp
  vụ ở bookings/collections/export_backup).
- `VnTimeFormatter.format()` mới thêm áp dụng mask cho **mọi** logger dùng root handlers
  (không chỉ `backend.request`) — đây là thay đổi có lợi (vá lỗ hổng traceback) nhưng cũng
  là thay đổi hành vi toàn cục của Task 1; đã chạy lại toàn bộ `test_logging.py` (bao gồm
  các test mask cũ) để xác nhận không phá vỡ gì.
