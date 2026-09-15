### Task 13: Chọn cảng khi tra cứu lịch tàu hàng loạt (bulk action)

## Bối cảnh

Trong tab Booking (`frontend/src/components/booking/BookingTab.tsx`), thanh hành động hàng loạt (bulk action bar) có nút "Tra tàu" (`handleBulkVesselLookup`, khoảng dòng 540-590 — verify số dòng thực tế). Hiện tại hàm này **tự đoán cảng (site)** cho từng dòng bằng `guessSiteFromDepot(b["Full return CY"])`, fallback về site đã lưu lần trước (`localStorage['last_vessel_site_id']`) hoặc mặc định `'CTL'`. Người dùng **không có cách nào tự chọn cảng** trước khi chạy tra cứu hàng loạt — nếu đoán sai hoặc thiếu dữ liệu "Full return CY", tất cả rơi vào cảng mặc định mà không được hỏi.

Modal tra tàu đơn lẻ `frontend/src/components/booking/QuickVesselSearch.tsx` đã có sẵn dropdown chọn cảng dùng `PORT_OPTIONS` từ `frontend/src/utils/ports.ts` (import `{ PORT_OPTIONS } from '../../utils/ports'`, mỗi phần tử `{ siteId, nameVi, nameEn }`).

## Yêu cầu

Thêm bước chọn cảng TRƯỚC KHI chạy tra cứu hàng loạt:

1. Tạo `frontend/src/components/booking/BulkVesselLookupModal.tsx` — modal nhỏ (dùng component `Modal` sẵn có ở `frontend/src/components/common/Modal.tsx`, theo đúng pattern các modal khác trong `booking/`) với:
   - Radio/select 2 chế độ:
     - **"Tự động theo bãi trả rỗng"** (mặc định, giữ đúng hành vi cũ: mỗi dòng tự đoán cảng theo `Full return CY`, fallback cảng đã chọn lần trước hoặc CTL).
     - **"Chọn 1 cảng cho tất cả"** — hiện dropdown `PORT_OPTIONS` (giống `QuickVesselSearch.tsx`), khi chọn chế độ này thì TẤT CẢ các dòng được chọn dùng đúng 1 site_id này, bỏ qua việc đoán theo depot.
   - Hiển thị số booking đang được chọn (dùng số đã có sẵn trong bulk action bar, truyền vào qua props).
   - Nút "Bắt đầu tra cứu" (đóng modal, gọi callback thực thi tra cứu với chế độ + site đã chọn) và nút huỷ.
2. Sửa `BookingTab.tsx`:
   - Bulk action "Tra tàu" (`key: 'lookup-vessels'`) đổi từ gọi thẳng `handleBulkVesselLookup()` sang MỞ modal `BulkVesselLookupModal` trước (thêm state `isBulkVesselLookupOpen`).
   - `handleBulkVesselLookup` nhận thêm tham số chế độ, ví dụ `handleBulkVesselLookup(mode: 'auto' | { site: string })`:
     - `mode === 'auto'`: giữ nguyên logic đoán theo depot như hiện tại.
     - `mode = { site }`: dùng đúng `site` này cho MỌI dòng đã chọn (bỏ qua `guessSiteFromDepot`), vẫn gộp trùng theo `vesselLookupKey` như cũ để tránh tra cùng 1 tàu nhiều lần.
   - Khi chọn "Chọn 1 cảng cho tất cả" và tra cứu, lưu `site` đó vào `localStorage['last_vessel_site_id']` (giữ đúng key hiện có) để lần sau modal/QuickVesselSearch nhớ lựa chọn gần nhất — CHỈ áp dụng khi user chủ động chọn cảng cụ thể (không ghi đè localStorage khi dùng chế độ "Tự động").
3. `frontend/src/i18n/translations.ts`: thêm các chuỗi cần thiết cho modal mới trong section `booking.bulkActions` hoặc section con mới `booking.bulkVesselLookup` (xem cấu trúc `t.booking.bulkActions` hiện có để theo đúng convention), cho cả `vi` và `en`. Ví dụ khoá cần: tiêu đề modal, mô tả 2 chế độ, nhãn "Cảng:", nút bắt đầu/huỷ.

## Ràng buộc
- KHÔNG đổi hành vi mặc định khi người dùng không mở modal chọn cảng theo cách cũ — nghĩa là chế độ mặc định trong modal PHẢI là "Tự động theo bãi trả rỗng" giống hệt hành vi hiện tại, để không phá luồng quen thuộc của người dùng cũ, chỉ thêm lựa chọn mới.
- Giữ nguyên cơ chế delay giữa các lần gọi API (`VESSEL_LOOKUP_DELAY_MS`), progress bar (`vesselLookupProgress`), toast tổng kết sau khi chạy xong — không đổi phần này.
- Chuỗi UI mới phải thêm vào `translations.ts` cả `vi` và `en`, không hardcode tiếng Việt trong component.

## Việc cần làm

1. Đọc kỹ `BookingTab.tsx` (toàn bộ vùng liên quan tới `handleBulkVesselLookup`, `bulkActions`, state hiện có), `QuickVesselSearch.tsx` (để tái dùng đúng style/pattern chọn cảng), `utils/ports.ts`, `translations.ts` (section `booking.bulkActions`) trước khi sửa.
2. Viết test nếu hợp lý (test hành vi chọn mode 'auto' vs site cụ thể trong `handleBulkVesselLookup`, hoặc test render/tương tác của `BulkVesselLookupModal`) theo TDD.
3. Chạy `cd frontend && npm test` và `npm run build` đảm bảo pass.
4. Tự review lại.
5. Commit với message kết thúc bằng:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

## Báo cáo

Viết báo cáo đầy đủ vào: `/Users/baonguyen/Developer/auto_read_pdf/.superpowers/sdd/task-13-report-bulk-vessel-port.md`
Rồi trả lời NGẮN GỌN (dưới 15 dòng): Status, commit (short SHA + subject), tóm tắt test 1 dòng (vitest + build), mối lo ngại, đường dẫn báo cáo.
