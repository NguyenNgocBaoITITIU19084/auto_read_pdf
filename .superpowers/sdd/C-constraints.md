## Global Constraints

- Mục tiêu đo được: collection **50.000 container** mở tab **< 1s**; đổi trang **< 300ms**; 5.000 dòng/trang cuộn không giật (commit React < 16ms); chunk khởi động **< 300KB** (JS tải lúc mở app, chưa gzip); không còn cảnh báo 500KB của Vite.
- Giữ tương thích ngược: `GET /bookings`, `GET /vessels`, `GET /containers` giữ nguyên tham số và kết quả.
- Base URL API: `http://127.0.0.1:8000/api/v1`.
- Chuỗi thời gian lưu DB: `"%Y-%m-%d %H:%M:%S"` theo `Asia/Ho_Chi_Minh` (không kèm offset).
- Giới hạn trang: `limit` 1–5000 (hằng `PAGE_MAX_LIMIT = 5000` backend, `MAX_ROWS_PER_PAGE = 5000` frontend). Mặc định 50.
- Dependency mới được phép: `@tanstack/react-virtual` (dependency); `vitest`, `jsdom`, `@testing-library/react` (devDependency). Không thêm dependency Python.
- Chuỗi hiển thị: thêm vào `frontend/src/i18n/translations.ts` cả `vi` và `en`, chỉ thêm key trong section của mình, không format lại file.
- Test backend chạy từ gốc repo: `pytest backend/tests -q` và `pytest tests -q`. Test frontend: `cd frontend && npm test`.
- Không làm: sắp xếp theo cột (UI hiện không có sort) — nằm ngoài phạm vi.
- Commit message kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

