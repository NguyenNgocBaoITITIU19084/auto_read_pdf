# Task 11 Report: Tab "Nhật ký" riêng ở thanh điều hướng chính

## Status: DONE

Commit: `1af6973` — feat(logs-tab): add standalone Logs tab in main navigation

## Tóm tắt thay đổi

1. **`frontend/src/components/logs/LogViewerPanel.tsx`** (mới): tách toàn bộ
   logic + UI lọc/danh sách log từ `LogViewerModal.tsx` (nguồn app/errors,
   mức WARNING+/ERROR+, tìm kiếm debounce, mở rộng dòng nhiều dòng, copy dòng)
   thành component thuần không có `isOpen/onClose`, tự `load()` khi mount
   (thay vì khi `isOpen` đổi). Dùng chung cho cả tab mới.

2. **`frontend/src/components/logs/LogsTab.tsx`** (mới): trang tab đầy đủ,
   theo khung layout ngoài giống `VesselTab` (flex-col h-full overflow-hidden
   p-3.5), có header nhỏ (icon `ScrollText` + tiêu đề `t.logs.modalTitle` +
   mô tả `t.logs.cardDesc`) và nội dung cuộn chứa `LogViewerPanel`.

3. **`frontend/src/components/common/Tabs.tsx`**: thêm `'logs'` vào type
   `TabId`, thêm mục tab mới với icon `ScrollText` và label `t.tabs.logs`.

4. **`frontend/src/App.tsx`**: lazy import `LogsTab`, thêm nhánh render khi
   `activeTab === 'logs'`, thêm vào `preloadTab` (hover prefetch).

5. **`frontend/src/i18n/translations.ts`**: thêm `tabs.logs` cho cả `vi`
   ("Nhật ký") và `en` ("Logs") trong 2 section `tabs` hiện có.

6. **`frontend/src/components/common/BackupModal.tsx`**: nút "Xem nhật ký"
   không còn mở `LogViewerModal` — nhận prop mới `onNavigateToLogs?: () =>
   void` và gọi nó thay vào đó (nút bị disable nếu prop không được truyền).
   Bỏ state `isLogViewerOpen` và import `LogViewerModal`.

7. **`frontend/src/components/common/Header.tsx`**: truyền
   `onNavigateToLogs` xuống `BackupModal`, implement bằng cách đóng
   `isBackupOpen` rồi gọi `onNavigateTab('logs')` — tái dùng đúng cơ chế
   `onNavigateTab` đã có sẵn (không tạo cơ chế điều hướng mới). Nếu
   `onNavigateTab` không được truyền vào `Header` (không xảy ra trong thực
   tế vì `App.tsx` luôn truyền), prop sẽ là `undefined` và nút tự disable.

8. **`frontend/src/components/common/LogViewerModal.tsx`**: đã xoá (không
   còn nơi nào sử dụng sau khi refactor; không có test cũ cho file này).

9. **`.gitignore`**: rule `logs/` (dùng cho `backend/logs/` runtime log
   output) đang vô tình ignore luôn thư mục mới
   `frontend/src/components/logs/`. Đã thêm dòng negate
   `!frontend/src/components/logs/` ngay sau để không ảnh hưởng đến rule
   gốc ở nơi khác trong repo.

## Test mới (TDD)

- `frontend/src/components/logs/LogViewerPanel.test.tsx`: mock `getLogsApi`
  + `useApp`, kiểm tra load khi mount, refetch khi đổi filter
  (source/level), empty state, toast lỗi khi API fail, mở rộng dòng nhiều
  dòng + copy vào clipboard.
- `frontend/src/components/logs/LogsTab.test.tsx`: render header đúng +
  mount `LogViewerPanel` (mock).
- `frontend/src/components/common/Tabs.test.tsx`: kiểm tra tab Logs xuất
  hiện cạnh các tab khác và `onChange('logs')` khi click.

Không viết lại test cho phần UI đã có sẵn không đổi hành vi (đúng theo yêu
cầu brief).

## Kết quả kiểm tra

- `npm test -- --run`: **42/42 tests pass** (13 test files), bao gồm 3 file
  test mới nói trên.
- `npm run build` (`tsc && vite build`): **pass**, không lỗi TypeScript,
  không import chết tới `LogViewerModal` đã xoá. Chunk mới
  `LogsTab-*.js` (~5.1kB gzip 1.78kB) được code-split như các tab khác.

## Mối lo ngại / lưu ý

- `.gitignore` fix cho `logs/` rule: dùng negate pattern thay vì sửa rule
  gốc, để tránh ảnh hưởng ngoài phạm vi nếu `LOG_DIR`/`DB_PATH` runtime trỏ
  tới thư mục khác `backend/logs/`. Nên rà soát thêm nếu sau này có thư mục
  `logs/` khác cần track trong repo.
- `BackupModal`'s "Xem nhật ký" button giờ phụ thuộc `onNavigateToLogs`
  được truyền từ `Header` → `App`. Nút tự disable nếu prop thiếu (an toàn
  về mặt type), nhưng trên thực tế `App.tsx` luôn truyền `onNavigateTab`
  xuống `Header` nên trường hợp này không xảy ra trong ứng dụng thật.
- Không sửa gì ở backend; các thay đổi backend (`logging_setup.py`,
  `main.py`, `background_tasks.py`) thấy trong `git status` là của tác vụ
  khác (Task 12 — log retention) đang chạy song song, không thuộc phạm vi
  Task 11 nên không đụng tới / không commit cùng.
