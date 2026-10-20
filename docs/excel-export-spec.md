# Đặc tả tính năng Xuất Excel (có Mẫu xuất)

Tài liệu mô tả tính năng xuất Excel của Auto Read PDF Pro để áp dụng sang project khác.
Viết theo hướng "làm lại được": hành vi, hợp đồng API, thuật toán, quy tắc kiểm tra — không phụ thuộc vào nghiệp vụ booking/tàu/container.

Stack gốc: **FastAPI + openpyxl + SQLite** (backend), **React + TypeScript + Tailwind** (frontend). Có thể thay stack, miễn giữ hợp đồng bên dưới.

---

## 1. Tóm tắt

Người dùng bấm **Xuất Excel** trên một bảng dữ liệu → mở hộp thoại:

1. **Chọn mẫu xuất** (bên trái): mẫu có sẵn "Tất cả cột" hoặc các mẫu đã lưu của tab đó.
2. **Xem trước file** (bên phải): 10 dòng đầu, đúng thứ tự cột, đúng tên tiêu đề, đúng màu.
3. **Đặt tên file** có biến `{date}` / `{collection}`, xem ngay tên file cuối cùng.
4. Bấm **Xuất** → backend dựng file `.xlsx` có định dạng → trình duyệt tải về.

**Mẫu xuất** (export template) = danh sách cột đã chọn, theo thứ tự, mỗi cột có: tiêu đề đổi tên, màu, kiểu tô màu; kèm mẫu tên file. Mẫu lưu trên server, tách riêng theo từng tab (mỗi bảng dữ liệu một bộ mẫu).

---

## 2. Mô hình dữ liệu

### 2.1 Cột xuất (`ExportColumn`)

```ts
type ExportFill = 'header' | 'column';
type PaletteColor = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray';
type ExportColor = PaletteColor | `#${string}`;   // id bảng màu, hoặc màu tự chọn '#RRGGBB'

interface ExportColumn {
  key: string;               // khoá của trường trong dòng dữ liệu (KHÔNG phải nhãn hiển thị)
  header: string;            // tiêu đề ghi vào Excel; rỗng = dùng nhãn của bảng
  color: ExportColor | null; // null = màu tiêu đề mặc định
  fill: ExportFill;          // 'header': chỉ tô ô tiêu đề; 'column': tô nhạt cả cột
}
```

Nguyên tắc quan trọng: **mọi thứ gắn theo `key`, không theo nhãn**. Đổi tên tiêu đề hay đổi ngôn ngữ giao diện không làm hỏng mẫu, căn giữa, v.v.

### 2.2 Mẫu xuất (`ExportTemplate`)

```ts
interface ExportTemplate {
  id: number;
  tab: string;         // bảng mà mẫu thuộc về, vd 'booking' | 'vessel' | 'container'
  name: string;        // duy nhất trong cùng tab (không phân biệt hoa thường, kể cả chữ có dấu)
  filename: string;    // mẫu tên file, vd 'ke_hoach_{collection}_{date}'; rỗng = mặc định
  columns: ExportColumn[]; // chỉ các cột được chọn, đúng thứ tự xuất
  created_at: string;
  updated_at: string;
}
```

### 2.3 Bảng DB

```sql
CREATE TABLE IF NOT EXISTS export_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab TEXT NOT NULL,
  name TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  columns TEXT NOT NULL,          -- JSON của ExportColumn[] (ensure_ascii=False)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 3. API

| Method | Path | Body / Query | Kết quả |
|---|---|---|---|
| POST | `/export/excel` | `{ data, columns, filename }` | file `.xlsx` (stream) |
| GET | `/export/palette` | — | `[{id, header, tint, text}]` |
| GET | `/export/templates?tab=…` | `tab` bắt buộc, phải thuộc danh sách tab hợp lệ | `ExportTemplate[]` sắp theo tên |
| POST | `/export/templates` | `{ tab, name, filename, columns }` | mẫu vừa tạo |
| PUT | `/export/templates/{id}` | `{ name, filename, columns }` (không đổi được tab) | mẫu sau khi sửa / 404 |
| DELETE | `/export/templates/{id}` | — | `{status, deleted_id}` / 404 |

### 3.1 `POST /export/excel`

```json
{
  "data": [{ "STT": 1, "booking_no": "ABC123", "etd": "16/10/2026" }],
  "columns": [
    { "key": "STT", "header": "STT", "color": null, "fill": "header" },
    { "key": "booking_no", "header": "Số Booking", "color": "blue", "fill": "column" },
    { "key": "etd", "header": "Ngày tàu chạy", "color": "#1E88E5", "fill": "header" }
  ],
  "filename": "bookings_16-10-2026.xlsx"
}
```

- `data`: các dòng **đã được frontend chuẩn bị**, khoá theo `column.key` (xem 6.4).
- `columns[].header`: frontend gửi tiêu đề đã điền sẵn (rỗng → nhãn bảng), backend chỉ fallback về `key` nếu vẫn rỗng.
- Lỗi (dữ liệu/cột rỗng…) → `400` với `detail`.
- Response:
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename=export.xlsx; filename*=UTF-8''<tên đã URL-encode>`
    (`filename*` để giữ tên tiếng Việt; `filename=` ASCII là phương án dự phòng).
- Frontend gọi với `responseType: 'blob'` và timeout dài (file lớn).

---

## 4. Định dạng file Excel (backend)

Một sheet, dòng 1 là tiêu đề, dữ liệu từ dòng 2.

| Thành phần | Quy tắc |
|---|---|
| Font | `Segoe UI`; tiêu đề cỡ 11 **đậm**, thân cỡ 10 |
| Tiêu đề | nền = màu tiêu đề của cột (mặc định `#2C3E50`), chữ = màu chữ tương ứng (mặc định trắng), căn giữa 2 chiều, xuống dòng (wrap), cao 28 |
| Thân | cao 20, căn giữa dọc; viền mảnh `#CCCCCC` mọi ô |
| Nền thân | nếu cột có màu **và** `fill = 'column'` → màu nhạt (tint) của cột; nếu không → sọc theo **cột**: cột chẵn `#F2F7FA`, cột lẻ trắng |
| Căn ngang | căn giữa với các cột "mã ngắn / số" (tập `key` cấu hình sẵn, vd `STT`, số lượng, mã, ngày); còn lại căn trái |
| Ô trống | `None` hoặc `""` ghi thành chữ `"null"` (giống bảng trên giao diện — tuỳ project có thể đổi thành ô trống) |
| Độ rộng cột | `max(độ dài dài nhất của tiêu đề và các dòng (tách theo \n), …) + 4`, tối thiểu 12 |

Ghi chú triển khai: import `openpyxl` **bên trong hàm** để không làm chậm khởi động server.

### 4.1 Bảng màu

Mỗi màu gồm 3 sắc: (tiêu đề, nền nhạt cho thân, màu chữ tiêu đề). Frontend và backend phải giữ **cùng một bảng**.

| id | header | tint | text |
|---|---|---|---|
| red | `#C0392B` | `#FDECEA` | `#FFFFFF` |
| orange | `#E67E22` | `#FDF2E6` | `#FFFFFF` |
| yellow | `#F1C40F` | `#FEF9E3` | `#1F2937` |
| green | `#27AE60` | `#E8F6EE` | `#FFFFFF` |
| teal | `#16A085` | `#E6F5F2` | `#FFFFFF` |
| blue | `#2980B9` | `#E8F1F9` | `#FFFFFF` |
| purple | `#8E44AD` | `#F3EAF7` | `#FFFFFF` |
| pink | `#D63384` | `#FBE9F2` | `#FFFFFF` |
| gray | `#7F8C8D` | `#F1F3F4` | `#FFFFFF` |

### 4.2 Màu tự chọn `#RRGGBB`

```
chuẩn hoá: chấp nhận '#1e88e5' hoặc '1E88E5' → '#1E88E5'; sai định dạng → không có màu
tint      = mỗi kênh c → round(c + (255 - c) * 0.85)        // pha 85% với trắng
luminance = (0.299*R + 0.587*G + 0.114*B) / 255
text      = luminance > 0.6 ? '#1F2937' : '#FFFFFF'          // nền sáng chữ tối, nền tối chữ trắng
```

Thuật toán này phải giống hệt ở frontend (để xem trước đúng màu) và backend (để file đúng màu).

---

## 5. Lưu và kiểm tra mẫu (backend)

Khi tạo/sửa mẫu:

1. `tab` phải thuộc danh sách tab hợp lệ → nếu không: "Tab không hợp lệ".
2. `name`: gộp khoảng trắng thừa, cắt tối đa 80 ký tự; rỗng → "Cần đặt tên cho mẫu xuất".
3. Làm sạch `columns`:
   - bỏ phần tử không phải object, bỏ `key` rỗng, bỏ `key` trùng (giữ lần đầu);
   - `header` trim, tối đa 120 ký tự;
   - `color` chuẩn hoá; **màu không đọc được → báo lỗi** (`Màu không hợp lệ ở cột "<key>"`), không lặng lẽ bỏ đi — nếu bỏ, người dùng sẽ thấy thay đổi của mình biến mất sau khi lưu;
   - `fill` khác `'column'` → `'header'`.
4. Sau khi làm sạch phải còn ≥ 1 cột → "Mẫu xuất cần ít nhất một cột".
5. Tên trùng trong cùng tab (bỏ qua chính nó khi sửa) → "Đã có mẫu xuất tên …". So sánh bằng `casefold()` **trong code**, không dùng `LOWER()` của SQLite (SQLite không hạ chữ có dấu tiếng Việt).
6. `filename`: trim, tối đa 200 ký tự.
7. Danh sách trả về sắp theo tên (casefold), rồi theo id.

Lỗi kiểm tra trả `400` kèm thông báo để frontend hiện toast.

---

## 6. Frontend

### 6.1 Điểm gọi

Mỗi bảng dữ liệu truyền vào hộp thoại:

```tsx
<ExportModal
  isOpen={isExportOpen}
  onClose={() => setIsExportOpen(false)}
  data={exportRows}                 // các dòng sẽ xuất
  allColumns={exportColumns}        // [{ key, label }] — toàn bộ cột của bảng, theo thứ tự bảng
  tab="booking"                     // bộ mẫu nào
  filenamePrefix="bookings"         // tên file của mẫu "Tất cả cột"
  collectionName={activeCollection?.name} // giá trị cho {collection}
/>
```

- Hai phạm vi xuất: **tất cả** (tải lại toàn bộ theo bộ lọc/tìm kiếm hiện tại từ server, không chỉ trang đang xem) hoặc **các dòng đã chọn**; `filenamePrefix` đổi theo (`bookings` / `bookings_selected`).
- `allColumns` thêm cột `STT` ở đầu, và thường lấy theo cấu hình cột hiện tại của bảng.
- Giá trị hiển thị (vd nhãn trạng thái đã dịch) được gắn vào dòng **trước** khi truyền vào.

### 6.2 Hộp thoại xuất (`ExportModal`)

- Trái: danh sách mẫu (radio). Mục đầu luôn là **"Tất cả cột"** (mẫu có sẵn, không sửa/xoá được), hiển thị số cột. Mỗi mẫu đã lưu hiện tên, tối đa 6 chấm màu, dòng tóm tắt tên các tiêu đề (cắt ngắn, tooltip đầy đủ), nút sửa / xoá.
- Nút **Quản lý** và **+ Mẫu mới** mở trình quản lý mẫu (6.3).
- Chưa có mẫu nào → gợi ý tạo mẫu.
- Phải: bảng **xem trước** 10 dòng đầu, kèm "đang hiện X / Y dòng · Z cột".
- Trường **tên file** (6.5); chọn mẫu sẽ đặt tên file theo mẫu, mẫu không có tên file → `<filenamePrefix>_{date}`.
- Nút **Xuất** bị khoá khi đang xuất, không có cột hoặc không có dòng.
- Ghi nhớ mẫu dùng lần cuối theo từng tab trong `localStorage` (`export_template_<tab>`), bọc try/catch; mẫu đã bị xoá → quay về "Tất cả cột".
- Tải danh sách mẫu lỗi → toast lỗi, vẫn xuất được bằng "Tất cả cột".
- Xoá mẫu có hộp xác nhận.
- Sau khi xuất thành công: tạo blob URL → `<a download>` → click → revoke; toast "Đã xuất <tên file>"; đóng hộp thoại.

### 6.3 Trình quản lý mẫu (`ExportTemplateManager`)

Cửa sổ riêng (thay hộp thoại xuất khi mở). Trái: danh sách mẫu (sửa / nhân bản / xoá) + nút tạo mới. Phải: trình chỉnh sửa:

- **Tên mẫu** và **tên file** (6.5).
- Danh sách **mọi** cột của bảng; mỗi dòng: tay kéo, ô tick chọn, tên gốc, ô nhập **tiêu đề mới** (placeholder = tên gốc), **chọn màu**, công tắc **Tô: Tiêu đề / Cả cột** (khoá khi cột chưa tick hoặc chưa có màu).
- Nút chọn tất cả / bỏ tất cả.
- **Sắp xếp**: kéo thả bằng Pointer Events (chạy với chuột, bút, cảm ứng; bỏ qua chuột phải/giữa; `setPointerCapture` trong try/catch), và bằng phím ↑/↓ trên tay kéo.
- **Tick một cột → cột nhảy xuống ngay sau cột đã tick cuối cùng**; bỏ tick → xuống cuối danh sách. Nhờ vậy các cột được xuất luôn nằm trên cùng, đúng thứ tự xuất.
- **Chọn màu**: nút ô màu mở popover gồm 9 màu bảng, thanh trượt màu (hue) và ô nhập mã hex; có lựa chọn "không màu". Popover định vị theo nút, tự lật lên trên nếu thiếu chỗ.
- **Xem trước** trực tiếp theo bản nháp.
- **Nhân bản**: tạo bản nháp mới từ mẫu với tên `<tên> (bản sao)`, chọn sẵn ô tên để sửa.
- **Thay đổi chưa lưu**: so sánh "chữ ký" bản nháp (`JSON` của tên, tên file, cột đã chọn) với bản đã lưu; chuyển mẫu / tạo mới / đóng khi có thay đổi → hỏi xác nhận bỏ thay đổi. Hiện nhãn "chưa lưu".
- Nút **Lưu** bị khoá khi: đang bận, không có thay đổi, không có cột nào được tick, hoặc tên rỗng.
- Sau khi lưu: so sánh cột đã gửi với cột server trả về (so màu không phân biệt hoa thường); nếu khác (vd backend cũ bỏ màu tự chọn) → **giữ nguyên bản nháp trên màn hình** và báo "chỉ lưu được một phần", thay vì để người dùng mất chỉnh sửa.
- Mẫu cũ chứa cột mà bảng không còn → bỏ qua khi nạp; cột mới của bảng → thêm vào cuối ở trạng thái chưa tick.

### 6.4 Các hàm thuần (nên có test)

```ts
// Bản nháp của trình chỉnh sửa: cột của mẫu (còn tồn tại) theo thứ tự mẫu, rồi các cột còn lại chưa tick.
// template = null → mọi cột, đều tick, không màu ("Tất cả cột").
buildDraft(template, allColumns, defaults): Draft

draftToColumns(draft): ExportColumn[]      // chỉ cột đã tick, theo thứ tự, header đã trim
draftSignature(draft): string              // để phát hiện thay đổi chưa lưu
moveColumnTo(cols, from, to)               // kéo thả; chỉ số sai → trả nguyên mảng
moveColumn(cols, index, ±1)                // phím ↑/↓
toggleIncluded(cols, key)                  // quy tắc tick ở 6.3

// Dòng gửi lên backend: khoá theo column.key, STT = vị trí dòng (1-based),
// undefined/null/'' → "null".
buildExportRows(data, columns)
```

Trước khi xuất, tiêu đề rỗng được thay bằng `label` của bảng (fallback `key`).

### 6.5 Tên file

- Ô nhập có hậu tố `.xlsx` cố định; người dùng không cần gõ đuôi.
- Nút chèn biến hiển thị luôn giá trị thật: `{date}` → `Ngày: 16-10-2026`, `{collection}` → `Bộ sưu tập: <tên>` (hoặc `—`).
- Chèn tại vị trí con trỏ (thay vùng đang chọn); tự thêm `" - "` hai bên nếu biến sẽ dính vào chữ (không thêm khi bên cạnh đã là khoảng trắng, `_`, `-`, `.`, `(` / `)`); đặt con trỏ ngay sau biến.
- Dòng "Tên file:" hiển thị kết quả cuối cùng theo thời gian thực.

```ts
resolveFilename(pattern, { collection, fallback }, now = new Date()):
  1. {date} (không phân biệt hoa thường) → 'DD-MM-YYYY'
  2. {collection} → tên bộ sưu tập (hoặc rỗng)
  3. bỏ đuôi .xlsx nếu người dùng tự gõ
  4. ký tự Windows cấm  \ / : * ? " < > |  → '-'
  5. gộp khoảng trắng, trim
  6. rỗng → `${fallback}_${date}`
  7. + '.xlsx'
```

### 6.6 Chuỗi giao diện (i18n)

Toàn bộ chữ nằm trong nhóm `exportManager` của file dịch (vi/en). Các khoá cần có: tiêu đề hộp thoại, chọn mẫu, quản lý, mẫu mới, tất cả cột, số cột, số dòng, xem trước file, thông tin xem trước, tên file, gợi ý biến, nhãn biến ngày/bộ sưu tập, tên file kết quả, xuất / đang xuất, đã xuất, không có dữ liệu, không có cột, tải mẫu lỗi, lưu / đã lưu / lưu một phần, xoá / xác nhận xoá / đã xoá, nhân bản / hậu tố bản sao, bỏ thay đổi / xác nhận bỏ, chưa lưu, gợi ý kéo thả, tay kéo, tô tiêu đề / tô cả cột / gợi ý tô, chọn màu / không màu / mã hex.

---

## 7. Tình huống biên cần xử lý

| Tình huống | Hành vi |
|---|---|
| Không có dòng / không có cột | Khoá nút xuất; backend vẫn trả 400 nếu bị gọi |
| Mẫu tham chiếu cột đã bị xoá khỏi bảng | Bỏ qua cột đó khi nạp/xuất |
| Bảng có cột mới | Hiện trong trình chỉnh sửa, chưa tick |
| Tên mẫu trùng khác hoa thường / có dấu | Báo trùng |
| Màu sai định dạng khi lưu | Báo lỗi, không bỏ âm thầm |
| Tên file có ký tự cấm / rỗng | Thay bằng `-` / dùng tên mặc định |
| Tên file tiếng Việt | `filename*=UTF-8''…` trong header; frontend dùng chính tên đã tính cho `a.download` |
| `localStorage` bị chặn | try/catch, coi như chọn "Tất cả cột" |
| Mẫu đang chọn bị xoá (ở đây hoặc trong trình quản lý) | Quay về "Tất cả cột" |
| Giá trị nhiều dòng (`\n`) | Độ rộng cột tính theo dòng dài nhất |

---

## 8. Kiểm thử (đã có trong project gốc)

- `tests/test_exporter.py`: kiểu gọi cũ (cột theo nhãn), dữ liệu rỗng báo lỗi, thiếu trường.
- `tests/test_export_templates.py`: thứ tự cột + tiêu đề + màu, chữ tối trên nền vàng, hai cột đổi tên giống nhau vẫn giữ giá trị riêng, endpoint xuất với tên file, CRUD + làm sạch cột, kiểm tra hợp lệ (tên trùng, tab sai…), API mẫu, màu hex tự chọn, màu không đọc được bị từ chối chứ không bị bỏ.
- `frontend/src/components/common/exportTemplates.test.ts`: `buildDraft`, di chuyển cột, quy tắc tick, chữ ký thay đổi, `resolveFilename`, `insertPlaceholder`, `buildExportRows`, đọc màu hex giống backend, kéo thả.
- `frontend/src/components/common/ExportModal.test.tsx`: mở đúng mẫu dùng lần cuối, xuất theo mẫu (tiêu đề fallback về nhãn bảng), xuất "Tất cả cột", xoá mẫu có xác nhận, mở trình quản lý, chèn biến tên file, ngày dạng DD-MM-YYYY, xem trước, tóm tắt cột.

---

## 9. Bản đồ file trong project gốc

| File | Vai trò |
|---|---|
| `backend/app/services/exporter.py` | Bảng màu, chuẩn hoá màu, dựng file openpyxl |
| `backend/app/api/export_backup.py` | Các endpoint `/export/*` |
| `backend/app/schemas/models.py` | `ExportColumn`, `ExportExcelRequest`, `ExportTemplateRequest` |
| `backend/app/core/database.py` | Bảng `export_templates`, kiểm tra & CRUD mẫu |
| `frontend/src/components/common/exportTemplates.ts` | Bảng màu FE + toàn bộ hàm thuần |
| `frontend/src/components/common/ExportModal.tsx` | Hộp thoại xuất |
| `frontend/src/components/common/ExportTemplateManager.tsx` | Trình quản lý mẫu, chọn màu, kéo thả, xem trước |
| `frontend/src/components/common/FilenameField.tsx` | Ô tên file có biến |
| `frontend/src/services/api.ts` | `exportColumnsExcelApi`, `exportTemplatesApi` |
| `frontend/src/types/index.ts` | Kiểu `ExportColumn`, `ExportTemplate`, … |

---

## 10. Các bước áp dụng sang project mới

1. Cài `openpyxl` (backend). Chép `exporter.py`; sửa tập `_CENTER_KEYS` theo các cột của project.
2. Tạo bảng `export_templates`, chép hàm kiểm tra/CRUD; đổi `EXPORT_TABS` thành danh sách bảng của project.
3. Thêm 6 endpoint ở mục 3.
4. Chép `exportTemplates.ts`, `ExportModal.tsx`, `ExportTemplateManager.tsx`, `FilenameField.tsx`, các kiểu và hàm API; thay các phụ thuộc riêng (`Modal`, `useApp` → toast + i18n, `useConfirm`) bằng component tương ứng của project.
5. Thay biến `{collection}` bằng khái niệm tương đương của project (dự án, khách hàng…) hoặc bỏ đi.
6. Ở mỗi bảng: dựng `allColumns` (`[{key, label}]`, có `STT` ở đầu), lấy dòng cho phạm vi "tất cả"/"đã chọn", mở `ExportModal`.
7. Thêm chuỗi dịch nhóm `exportManager`.
8. Chép và chỉnh các test ở mục 8.

Muốn đơn giản hơn (không cần mẫu lưu trên server)? Có thể bỏ mục 2.2–2.3, 5, 6.3 và chỉ giữ: `POST /export/excel` + hộp thoại với "Tất cả cột" + tên file. Hợp đồng `columns` vẫn giữ nguyên nên có thể thêm mẫu xuất về sau mà không phải sửa backend xuất file.
