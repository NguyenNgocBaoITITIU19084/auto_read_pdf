### Task 11: Tab "Nhật ký" riêng (thay vì chỉ có modal)

## Bối cảnh

Hiện tại xem log chỉ qua `LogViewerModal.tsx`, mở từ nút "Xem nhật ký" trong `BackupModal.tsx` (mục "Nhật ký hệ thống"). Backend đã có sẵn API `GET /api/v1/logs`, `GET /api/v1/logs/export`, `POST /api/v1/logs/client` (xem `backend/app/api/logs.py`). Frontend đã có `getLogsApi` trong `frontend/src/services/api.ts` và type `LogEntry`.

Người dùng muốn có **một tab riêng ở thanh điều hướng chính** (ngang hàng Dashboard/Booking/Vessel/Container) để xem log, thay vì phải mở modal Cài đặt trước.

## Yêu cầu

1. Đọc `frontend/src/components/common/LogViewerModal.tsx` — đây là component hiện có chứa toàn bộ logic lọc (nguồn app/errors, mức WARNING+/ERROR+, tìm kiếm, danh sách dòng log, copy dòng, mở rộng dòng nhiều dòng).
2. **Tách phần nội dung (bộ lọc + danh sách log) thành một component dùng chung** — ví dụ `frontend/src/components/logs/LogViewerPanel.tsx` — nhận không có prop `isOpen/onClose` (không phải modal), chỉ là nội dung thuần render trực tiếp. `LogViewerModal.tsx` (giữ nguyên, vẫn dùng ở đâu đó nếu cần) và tab mới đều dùng chung component này để không trùng lặp logic. Nếu sau khi tách, `LogViewerModal.tsx` không còn được dùng ở đâu (đọc kỹ `BackupModal.tsx` xem còn cần giữ nút mở modal cũ không — theo yêu cầu dưới đây thì nút "Xem nhật ký" trong `BackupModal.tsx` sẽ được đổi hành vi để CHUYỂN SANG TAB MỚI thay vì mở modal), có thể xoá hẳn `LogViewerModal.tsx` và test của nó — không để lại code chết. Quyết định giữ hay xoá tuỳ bạn miễn không có code không dùng tới.
3. Tạo `frontend/src/components/logs/LogsTab.tsx` — trang đầy đủ (full height, giống cấu trúc các Tab khác như `frontend/src/components/vessel/VesselTab.tsx` về khung layout ngoài: header nhỏ + nội dung cuộn được), bên trong render `LogViewerPanel`.
4. Thêm tab mới vào thanh điều hướng chính:
   - `frontend/src/components/common/Tabs.tsx`: thêm `'logs'` vào type `TabId`, thêm `tabItems` mới với icon phù hợp (ví dụ `ScrollText` từ `lucide-react`) và label từ `t.tabs.logs`.
   - `frontend/src/App.tsx`: thêm lazy import `LogsTab`, thêm nhánh render khi `activeTab === 'logs'`, thêm vào `preloadTab`.
5. `frontend/src/i18n/translations.ts`: thêm `tabs.logs` (cả `vi` và `en`) trong section `tabs` hiện có (tìm section `tabs` ở khoảng 2 chỗ cho `vi`/`en`, xem cấu trúc `t.tabs.dashboard/booking/vessel/container` hiện tại để thêm đúng vị trí, không format lại file).
6. Sửa `frontend/src/components/common/BackupModal.tsx`: nút "Xem nhật ký" hiện mở `LogViewerModal` — đổi thành điều hướng sang tab Logs mới (đóng modal Cài đặt & Sao lưu, rồi chuyển tab). Cần một prop kiểu `onNavigateToLogs?: () => void` hoặc dùng cơ chế điều hướng tab đã có (`onNavigateTab` pattern dùng ở `DashboardTab`/`Header` — xem `App.tsx`'s `handleNavigateTab` và cách nó được truyền xuống các nơi khác để theo đúng convention hiện tại, KHÔNG tự sáng tạo cơ chế mới nếu đã có sẵn). Đọc kỹ `frontend/src/components/common/Header.tsx` xem `BackupModal` được mở từ đâu, và cách truyền `onNavigateTab` xuống nếu cần xuyên qua Header.
   - Nút "Xuất file log (.zip)" giữ nguyên hành vi cũ (tải file trực tiếp), không cần chuyển.
7. Nếu có test hiện tại cho `LogViewerModal.test.tsx` (kiểm tra file `frontend/src/components/common/LogViewerModal.test.tsx` hoặc tương tự nếu tồn tại) hoặc bạn viết test mới cho `LogViewerPanel`/`LogsTab`, ưu tiên theo TDD: viết test cho hành vi lọc/tải log của `LogViewerPanel` (mock `getLogsApi`), rồi test `LogsTab` render đúng và `Tabs.tsx` có mục logs mới.

## Việc cần làm

1. Implement theo TDD nếu hợp lý (test trước cho phần logic mới, không bắt buộc test lại toàn bộ UI đã có sẵn nếu không đổi hành vi).
2. Chạy `cd frontend && npm test` và `npm run build` — đảm bảo không phá vỡ gì, không còn import chết tới file đã xoá.
3. Tự review: đảm bảo double-check `Header.tsx`/`App.tsx` không còn any/`@ts-ignore`, không còn code không dùng.
4. Commit với message kết thúc bằng dòng:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

## Báo cáo

Viết báo cáo đầy đủ vào: `/Users/baonguyen/Developer/auto_read_pdf/.superpowers/sdd/task-11-report-logs-tab.md`
Rồi trả lời NGẮN GỌN (dưới 15 dòng): Status, commit (short SHA + subject), tóm tắt test 1 dòng (vitest + build), mối lo ngại, đường dẫn báo cáo.
