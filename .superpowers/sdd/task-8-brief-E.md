### Task 8: Gắn nút "Thêm booking" và "Sửa" vào tab Booking

**Files:**
- Modify: `frontend/src/components/booking/BookingTab.tsx`
  - `BookingRowProps` L57-66
  - cột thao tác L125-166
  - state modal L199-208
  - thanh công cụ L667-680
  - render modal cuối file
- Modify: `frontend/src/components/booking/BookingDetailModal.tsx` (props + nút "Sửa" ở banner)

**Interfaces:**
- Consumes: `BookingFormModal` (Task 7); `table.reload`, `table.setCurrentPage`, `total`, `pageSize` (kế hoạch C Task 7)
- Produces:
  - `BookingRowProps.onEdit: (booking: Booking) => void`
  - `BookingDetailModalProps.onEdit?: (booking: Booking) => void`

- [ ] **Step 1: State + handler trong `BookingTab`**

Import `Pencil, Plus` từ `lucide-react` và `BookingFormModal` từ `./BookingFormModal`. Thêm cạnh các state modal:
```tsx
  const [bookingForm, setBookingForm] = useState<{ mode: 'create' | 'edit'; booking: Booking | null } | null>(null);

  const openCreateBooking = useCallback(() => setBookingForm({ mode: 'create', booking: null }), []);
  const openEditBooking = useStableCallback((booking: Booking) => setBookingForm({ mode: 'edit', booking }));

  const handleBookingSaved = useStableCallback(async (item: Booking, mode: 'create' | 'edit') => {
    if (mode === 'create') {
      // new rows are appended (ORDER BY id ASC) -> jump to the last page so the user sees it
      setCurrentPage(Math.max(1, Math.ceil((total + 1) / pageSize)));
    }
    if (selectedBooking?.id === item.id) setSelectedBooking(item);
    await loadData('refresh');
  });
```

- [ ] **Step 2: Nút trên thanh công cụ** — chèn **trước** khối `data-tour="booking-ai-ocr"`:
```tsx
          <Tooltip content={t.booking.form.addTooltip}>
            <button
              type="button"
              onClick={openCreateBooking}
              disabled={!activeCollection}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.booking.form.addButton}</span>
            </button>
          </Tooltip>
```

- [ ] **Step 3: Nút sửa trên từng dòng**
- `BookingRowProps` thêm `onEdit: (booking: Booking) => void;` và destructure `onEdit`.
- Trong ô thao tác, chèn **trước** nút `Eye`:
```tsx
          <Tooltip content={t.booking.form.editTooltip}>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(booking); }}
              aria-label={t.booking.form.editTooltip}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
```
- `BookingRow` hiện chưa nhận `t`. Nếu component dùng chuỗi cứng, thêm prop `editLabel: string` và truyền `t.booking.form.editTooltip` từ tab, để giữ `React.memo` ổn định (không gọi `useApp()` trong mỗi dòng).
- Cột thao tác: đổi `w-24` thành `w-28` ở cả `<td>` của dòng và `<th>` tương ứng.
- Chỗ render `<BookingRow ...>` (L783) thêm `onEdit={openEditBooking}`.

- [ ] **Step 4: Nút "Sửa" trong modal chi tiết**

`BookingDetailModal.tsx`:
- props thêm `onEdit?: (booking: Booking) => void;`
- import `Pencil`
- trong banner đầu modal, cạnh khu vực nút hiện có (bên phải tên hãng/booking), thêm:
```tsx
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(booking)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t.booking.form.editButton}
            </button>
          )}
```
Trong `BookingTab`, chỗ render `<BookingDetailModal ...>` thêm `onEdit={openEditBooking}`. Form sửa mở chồng lên modal chi tiết; sau khi lưu, `handleBookingSaved` cập nhật `selectedBooking` nên modal chi tiết hiện dữ liệu mới.

- [ ] **Step 4b: Esc chỉ đóng modal trên cùng** — `frontend/src/components/common/Modal.tsx`

Hiện mỗi `Modal` nghe `keydown` trên `window`, nên mở form sửa chồng lên modal chi tiết rồi nhấn Esc sẽ đóng **cả hai**. Thay effect Escape (L20-28) bằng:
```tsx
// Stack of open modals: only the topmost one reacts to Escape.
const openModalStack: symbol[] = [];

// trong component:
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = Symbol('modal');
    openModalStack.push(id);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModalStack[openModalStack.length - 1] === id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = openModalStack.lastIndexOf(id);
      if (idx !== -1) openModalStack.splice(idx, 1);
    };
  }, [isOpen]);
```
(`openModalStack` đặt ở mức module, ngoài component.)

Test — `frontend/src/components/common/Modal.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('Escape closes only the topmost modal', () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Modal isOpen title="bottom" onClose={closeBottom}>a</Modal>
        <Modal isOpen title="top" onClose={closeTop}>b</Modal>
      </>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });
});
```
Run: `cd frontend && npm test -- Modal` → trước khi sửa FAIL (`closeBottom` được gọi), sau khi sửa PASS. Thêm `frontend/src/components/common/Modal.tsx frontend/src/components/common/Modal.test.tsx` vào lệnh `git add` của Step 7.

- [ ] **Step 5: Render form** — cuối JSX của tab (cạnh các modal khác):
```tsx
      <BookingFormModal
        isOpen={!!bookingForm}
        mode={bookingForm?.mode ?? 'create'}
        booking={bookingForm?.booking}
        onClose={() => setBookingForm(null)}
        onSaved={handleBookingSaved}
      />
```
`Modal` luôn render `fixed inset-0 z-50`, và modal render sau nằm trên. Đặt `BookingFormModal` **sau** `BookingDetailModal` trong JSX để form nổi lên trên.

- [ ] **Step 6: Build + thủ công**

Run: `cd frontend && npm test && npm run build`
Thủ công (`npm run dev`):
1. "Thêm booking" → để trống, bấm Lưu (đang khoá). Nhập Số Booking `TEST001`, ETD `31/04/2026` → báo lỗi; sửa `30/04/2026`, Ctrl+Enter → toast "Đã thêm booking", bảng nhảy tới trang cuối có dòng mới với ETD `30/04/2026`.
2. Thêm lại `test001` → toast cảnh báo trùng, vẫn lưu.
3. Bút chì trên dòng → đổi Tàu → Lưu → dòng cập nhật, trang không đổi, cột khác giữ nguyên.
4. Mở chi tiết → "Sửa" → đổi Cut-off `18/09/2026 17:00` → modal chi tiết hiện giá trị mới.
5. Mở form sửa, gõ vài ký tự rồi Esc → hỏi "Bỏ thay đổi?"; Huỷ giữ form; Đồng ý đóng.
6. Nhật ký (Task 4) có dòng `Manual booking saved` và `Booking updated` nhưng không có nội dung booking.
Expected: đạt cả 6.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/booking/BookingTab.tsx frontend/src/components/booking/BookingDetailModal.tsx frontend/src/components/common/Modal.tsx frontend/src/components/common/Modal.test.tsx
git commit -m "feat(booking-tab): add booking manually and edit any row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

