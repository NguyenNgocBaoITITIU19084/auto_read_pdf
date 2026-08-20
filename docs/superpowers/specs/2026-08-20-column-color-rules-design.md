# Thiết Kế Chi Tiết: Tùy Chỉnh Màu Sắc Giá Trị Cột (Column Value Color Rules)

**Ngày tạo**: 2026-08-20  
**Tác giả**: Antigravity  
**Mục tiêu**: Cung cấp giao diện và hệ thống quản lý luật màu sắc cho giá trị các cột trong bảng (Booking, Container, Lịch tàu), với bộ 12 màu preset cao cấp dạng badge bo tròn (như mẫu `Chưa duyệt (N)`), hỗ trợ tùy biến mã màu HEX riêng (Color Picker), lưu trữ trực tiếp và bền vững trong SQLite Database và đồng bộ tức thì lên giao diện.

---

## 1. Yêu cầu Người Dùng & Tính năng Chính

1. **Nút cấu hình trên Header**:
   - Thêm nút `🎨 Cấu hình màu sắc` (Icon `Palette`) trên thanh Header, ngay cạnh nút `Cài đặt & Sao lưu`.
   - Bấm vào mở modal `ColorConfigModal`.

2. **Giao diện Modal Quản lý Màu sắc (`ColorConfigModal`)**:
   - **Bộ lọc theo Bảng**: Tab chọn xem luật của *Tất cả*, *Booking (PDF)*, *ePort (Lịch tàu)*, hoặc *ePort (Container)*.
   - **Form thêm / chỉnh sửa luật**:
     - **Chọn Bảng**: Booking / Container / Lịch tàu / Tất cả.
     - **Chọn Cột**: Lấy danh sách cột tương ứng theo bảng hoặc chọn *Tất cả các cột*.
     - **Giá trị cần khớp (`match_value`)**: Chuỗi ký tự (vd: `Chưa duyệt (N)`, `Y`, `N`, `UNLOAD`, `ONE`, `F`, `40HC`,...).
     - **Kiểu so khớp (`match_type`)**: *Khớp chính xác (exact)* hoặc *Chứa từ khóa (contains)*.
     - **Bộ màu thiết kế sẵn (12 presets)**: Click chọn 1 chạm từ bảng màu (Rose, Emerald, Sky, Blue, Amber, Purple, Indigo, Teal, Orange, Pink, Slate, Lime).
     - **Tùy chọn màu tùy biến (Custom Color Picker)**: Checkbox/toggle cho phép mở 3 ô chọn màu HEX kèm input `<input type="color" />`:
       - *Màu nền (Background)*
       - *Màu viền (Border)*
       - *Màu chữ (Text)*
     - **Xem trước trực tiếp (Live Preview)**: Hiển thị ngay 1 badge mẫu bo góc với chữ và màu sắc vừa chọn.
     - **Nút Lưu / Cập nhật**.
   - **Danh sách luật hiện tại**:
     - Hiển thị danh sách luật dạng card/table.
     - Mỗi dòng có: Badge mẫu, Tên bảng & Cột, Giá trị khớp & Kiểu khớp, Nút bật/tắt (Toggle `is_enabled`), Nút sửa, Nút xóa.
   - **Nút "Khôi phục mặc định"**: Đưa toàn bộ luật về bộ luật chuẩn hệ thống ban đầu.

3. **Lưu trữ Database SQLite**:
   - Dữ liệu luật màu được lưu trực tiếp vào bảng `color_rules` trong SQLite database (`booking_data.db`).
   - Khi khởi động ứng dụng hoặc khi người dùng thay đổi, hệ thống đọc/ghi từ API backend `/api/v1/color-rules`.
   - Dữ liệu luật màu được bao gồm trong file JSON khi thực hiện **Sao lưu DB (Backup)** và phục hồi khi **Khôi phục DB (Restore)**.

4. **Hiển thị Badge trên các bảng dữ liệu**:
   - Các ô trong bảng `BookingTab`, `ContainerTab`, `VesselTab` khi render sẽ kiểm tra giá trị ô với danh sách `color_rules` đang được kích hoạt (`is_enabled`).
   - Nếu khớp: Hiển thị badge bo tròn (`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border shadow-2xs`), phối màu viền, nền và chữ chuẩn xác theo preset hoặc mã HEX tùy biến.
   - Hỗ trợ đầy đủ cả Light Mode và Dark Mode.

---

## 2. Thiết kế Bộ Màu Sẵn Có (12 Curated Presets)

Mỗi preset được thiết kế tỉ mỉ với độ tương phản cao, nền nhạt êm dịu, viền mỏng và chữ đậm:

| ID Preset | Tên Hiển Thị | Light Mode Style | Dark Mode Style | Mã Hex Preview |
|---|---|---|---|---|
| `rose` | Đỏ hồng (Rose) | `bg-rose-100 text-rose-800 border-rose-200` | `dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800` | `#f43f5e` |
| `emerald` | Xanh lá (Emerald) | `bg-emerald-100 text-emerald-800 border-emerald-200` | `dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800` | `#10b981` |
| `sky` | Xanh trời (Sky) | `bg-sky-100 text-sky-800 border-sky-200` | `dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800` | `#0ea5e9` |
| `blue` | Xanh dương (Blue) | `bg-blue-100 text-blue-800 border-blue-200` | `dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800` | `#3b82f6` |
| `amber` | Vàng hổ phách (Amber) | `bg-amber-100 text-amber-800 border-amber-200` | `dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800` | `#f59e0b` |
| `purple` | Tím thạch anh (Purple) | `bg-purple-100 text-purple-800 border-purple-200` | `dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800` | `#a855f7` |
| `indigo` | Chàm hiện đại (Indigo) | `bg-indigo-100 text-indigo-800 border-indigo-200` | `dark:bg-indigo-950/80 dark:text-indigo-300 dark:border-indigo-800` | `#6366f1` |
| `teal` | Xanh ngọc (Teal) | `bg-teal-100 text-teal-800 border-teal-200` | `dark:bg-teal-950/80 dark:text-teal-300 dark:border-teal-800` | `#14b8a6` |
| `orange` | Cam tươi (Orange) | `bg-orange-100 text-orange-800 border-orange-200` | `dark:bg-orange-950/80 dark:text-orange-300 dark:border-orange-800` | `#f97316` |
| `pink` | Hồng phấn (Pink) | `bg-pink-100 text-pink-800 border-pink-200` | `dark:bg-pink-950/80 dark:text-pink-300 dark:border-pink-800` | `#ec4899` |
| `slate` | Xám hiện đại (Slate) | `bg-slate-100 text-slate-700 border-slate-200` | `dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700` | `#64748b` |
| `lime` | Xanh cốm (Lime) | `bg-lime-100 text-lime-800 border-lime-200` | `dark:bg-lime-950/80 dark:text-lime-300 dark:border-lime-800` | `#84cc16` |

---

## 3. Bộ Luật Mặc Định Sẵn Có (Default Rules)

Hệ thống tự động khởi tạo các luật mặc định:
1. `container` / `custom_clearance_status` = `Chưa duyệt (N)` hoặc `N` $\rightarrow$ Preset `rose`
2. `container` / `custom_clearance_status` = `Đã duyệt (Y)` hoặc `Y` $\rightarrow$ Preset `emerald`
3. `container` / `infras_fee_status` = `Chưa đóng (3)` hoặc `3` $\rightarrow$ Preset `amber`
4. `container` / `fel` = `F` $\rightarrow$ Preset `blue`
5. `container` / `fel` = `E` $\rightarrow$ Preset `slate`
6. `container` / `vgm` = `Y` $\rightarrow$ Preset `emerald`
7. `container` / `event_type` contains `UNLOAD` $\rightarrow$ Preset `sky`
8. `container` / `event_type` contains `INGATE` $\rightarrow$ Preset `emerald`
9. `container` / `event_type` contains `OUTGATE` $\rightarrow$ Preset `amber`
10. `container` / `event_type` contains `STACK` $\rightarrow$ Preset `purple`
11. `container` / `event_type` contains `LOAD` $\rightarrow$ Preset `teal`

---

## 4. Thiết Kế Kỹ Thuật (Architecture & Implementation)

### 4.1. Backend Database (`backend/app/core/database.py`)
Tạo bảng `color_rules`:
```sql
CREATE TABLE IF NOT EXISTS color_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_table TEXT NOT NULL DEFAULT 'all',
    column_key TEXT NOT NULL DEFAULT 'all',
    match_value TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'exact',
    preset_id TEXT,
    custom_bg TEXT,
    custom_border TEXT,
    custom_text TEXT,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
```

Các hàm CRUD:
- `init_color_rules()`: Khởi tạo bảng và chèn các luật mặc định nếu bảng trống.
- `get_color_rules() -> list[dict]`
- `create_color_rule(data: dict) -> int`
- `update_color_rule(rule_id: int, data: dict)`
- `delete_color_rule(rule_id: int)`
- `reset_color_rules_to_default()`
- Cập nhật `export_backup_data()` và `import_backup_data()` để sao lưu / khôi phục `color_rules`.

### 4.2. Backend API Router (`backend/app/api/color_rules.py` & `backend/app/main.py`)
- `GET /api/v1/color-rules`: Lấy danh sách luật màu.
- `POST /api/v1/color-rules`: Tạo luật màu mới.
- `PUT /api/v1/color-rules/{id}`: Cập nhật luật màu.
- `DELETE /api/v1/color-rules/{id}`: Xóa luật màu.
- `POST /api/v1/color-rules/reset`: Khôi phục luật mặc định.

### 4.3. Frontend Types & API Client (`frontend/src/types/index.ts` & `frontend/src/services/api.ts`)
- Khai báo kiểu `ColorRule`, `ColorPreset`, `MatchType`, `TargetTable`.
- Các hàm gọi API tương ứng: `getColorRules()`, `createColorRule()`, `updateColorRule()`, `deleteColorRule()`, `resetColorRules()`.

### 4.4. Frontend Context (`frontend/src/context/AppContext.tsx`)
- Quản lý state `colorRules: ColorRule[]`.
- Cung cấp hàm `refreshColorRules()`, `findMatchingColorRule(table, colKey, value)`.

### 4.5. Frontend UI Components
- Component `ColorConfigModal.tsx`: Modal giao diện cấu hình màu sắc, lọc theo bảng, chọn 12 preset, chọn màu HEX tùy biến, preview trực tiếp.
- Helper render badge: Tích hợp logic tìm luật màu vào `BookingTab.tsx`, `ContainerTab.tsx`, `VesselTab.tsx`.

---

## 5. Kế hoạch Kiểm Thử (Verification Plan)

1. **Backend Tests**:
   - Chạy test khởi tạo database và CRUD color rules.
   - Kiểm tra backup JSON xuất ra chứa `color_rules` và restore thành công.
2. **Frontend UI Tests**:
   - Mở modal `🎨 Cấu hình màu sắc` trên Header.
   - Thêm một luật mới (vd: Hãng tàu "ONE" -> Preset Pink).
   - Tắt app / F5 tải lại trang: Kiểm tra luật vẫn tồn tại từ SQLite.
   - Kiểm tra bảng Booking / Container / Vessel hiển thị badge đúng màu sắc.
   - Thử nghiệm tùy biến mã màu HEX (Color Picker) và kiểm tra màu render chính xác.
