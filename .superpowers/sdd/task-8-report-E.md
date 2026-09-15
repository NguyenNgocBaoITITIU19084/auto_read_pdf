# Task 8 Report: Gắn nút "Thêm booking" và "Sửa" vào tab Booking

## Status: DONE

## Tóm tắt thay đổi

- `frontend/src/components/booking/BookingTab.tsx`:
  - Import `Pencil, Plus` từ `lucide-react` và `BookingFormModal` từ `./BookingFormModal`.
  - Thêm state `bookingForm` cạnh các state modal hiện có (`quickVesselBooking`, `isMoveOpen`).
  - Thêm `openCreateBooking`, `openEditBooking` (`useStableCallback`, giữ `React.memo` của `BookingRow` ổn định)
    và `handleBookingSaved` cạnh `openBooking`/`openQuickVessel`/`closeDetail` (sau khi `loadData`, `total`,
    `pageSize`, `setCurrentPage` đã có sẵn).
  - Nút "Thêm booking" trên thanh công cụ, chèn trước khối `data-tour="booking-ai-ocr"`.
  - `BookingRowProps` thêm `onEdit: (booking: Booking) => void` và `editLabel: string` (theo đúng mẫu prop
    `vesselTooltip` đã có — không gọi `useApp()` trong row để giữ `React.memo` hiệu quả).
  - Nút bút chì "Sửa" chèn trước nút `Eye` trong ô thao tác; đổi `w-24` → `w-28` ở `<td>` action, `<th>` action,
    và `TableSkeleton actionColClass` (brief chỉ nêu 2 chỗ, thực tế có 3 chỗ `w-24` liên quan cột thao tác).
  - Truyền `onEdit={openEditBooking}` và `editLabel={t.booking.form.editTooltip}` khi render `<BookingRow>`.
  - `<BookingDetailModal>` thêm `onEdit={openEditBooking}`.
  - Render `<BookingFormModal>` ở cuối JSX (sau `ImageBookingModal`) để nổi lên trên `BookingDetailModal` (`Modal`
    dùng `fixed inset-0 z-50`, modal render sau nằm trên DOM nên đè lên).

- `frontend/src/components/booking/BookingDetailModal.tsx`:
  - Props thêm `onEdit?: (booking: Booking) => void`; import `Pencil`.
  - Nút "Sửa" thêm vào banner, bọc cùng nút tra cứu tàu nhanh trong `<div className="flex items-center gap-1.5">`
    để 2 nút nằm ngang hàng thay vì bị xếp chồng dọc bởi container cha `flex-col items-end`.

- `frontend/src/components/common/Modal.tsx`:
  - Escape hiện dùng module-level `openModalStack: symbol[]`; mỗi `Modal` đang mở push một `symbol` khi
    `isOpen`, chỉ modal ở đỉnh stack mới đóng khi nhấn Esc (`e.stopPropagation()` + `onCloseRef` để tránh stale
    closure).
  - Test mới `frontend/src/components/common/Modal.test.tsx` — chạy đỏ trước khi sửa (xác nhận `closeBottom` bị
    gọi khi có 2 modal chồng nhau), xanh sau khi sửa.

## Phát hiện khác brief

1. Cột thao tác có **3** chỗ `w-24` liên quan (brief chỉ liệt kê `<td>` L134 và `<th>` L790), còn
   `TableSkeleton ... actionColClass="w-24"` (dùng khi `loading`) cũng cần đổi thành `w-28`, nếu không skeleton
   sẽ lệch với hàng dữ liệu thật sau khi thêm nút bút chì.
2. Ô thao tác `<td>` (không như ô checkbox `<td>` đầu dòng) chưa có `onDoubleClick={(e) => e.stopPropagation()}`.
   Double-click nhanh vào nút (Eye/Copy/Trash/Ship và giờ cả Pencil) trước đây có thể vừa kích hoạt `onClick` của
   nút vừa để sự kiện dblclick nổi bọt lên `<tr>` mở luôn modal chi tiết. Đã thêm `onDoubleClick` chặn nổi bọt
   trên `<td>` thao tác (giống `<td>` checkbox) để nút Sửa không vô tình mở cả 2 modal khi double-click nhanh.
3. Commit message dùng `Co-Authored-By: Claude Sonnet 5` theo yêu cầu nhiệm vụ, khác với brief ghi
   `Claude Opus 5`.
4. `.pyc` bị sửa trong `tests/__pycache__/` (không liên quan Task 8) — không đưa vào staging/commit.

## Test

- `cd frontend && npm test -- Modal` → trước khi sửa `Modal.tsx`: FAIL (`closeBottom` bị gọi); sau khi sửa: PASS.
- `cd frontend && npm test` (toàn bộ) → 9 test files, 30 passed, không có test nào bị phá vỡ.
- `cd frontend && npm run build` → `tsc && vite build` thành công, không lỗi TypeScript.

## Kiểm tra thủ công (tự review theo Step 6)

Không chạy `npm run dev` tương tác trong phiên này (agent không thao tác UI trực tiếp); đã đọc lại code path để
xác nhận:
- Double-click dòng vẫn gọi `onOpen(booking)` qua `<tr onDoubleClick>`, không bị đổi.
- Nút bút chì `onClick` có `e.stopPropagation()` nên click đơn không mở modal chi tiết; `<td>` thao tác giờ chặn
  `onDoubleClick` nổi bọt (mục Phát hiện khác brief #2) nên double-click nhanh vào nút không mở đồng thời cả 2
  modal.
- `BookingFormModal` render sau `BookingDetailModal` trong DOM nên form sửa (mở từ modal chi tiết) nổi lên trên.
- `handleBookingSaved` cập nhật `selectedBooking` khi `id` trùng, nên sau khi lưu từ form (mở từ modal chi tiết),
  modal chi tiết hiển thị dữ liệu mới nhờ re-render với `selectedBooking` đã cập nhật.

Khuyến nghị: người dùng nên tự chạy `npm run dev` và làm theo 6 bước thủ công trong brief để xác nhận trải
nghiệm UI trực tiếp (đặc biệt bước 5: gõ vài ký tự trong form sửa rồi Esc → phải hỏi "Bỏ thay đổi?" chỉ với modal
form, giữ modal chi tiết bên dưới mở).

## Files thay đổi

- `frontend/src/components/booking/BookingTab.tsx`
- `frontend/src/components/booking/BookingDetailModal.tsx`
- `frontend/src/components/common/Modal.tsx`
- `frontend/src/components/common/Modal.test.tsx` (mới)
