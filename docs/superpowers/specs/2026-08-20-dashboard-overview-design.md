# Thiết Kế Chi Tiết: Bảng Dashboard Quản Lý Tổng Quan Chỉ Số Logistics

**Ngày tạo**: 2026-08-20  
**Tác giả**: Antigravity  
**Mục tiêu**: Bổ sung Tab "Tổng quan (Dashboard)" chuyên nghiệp, tập trung toàn bộ các chỉ số vận hành logistics cốt lõi từ 3 phân hệ (Booking PDF, Lịch tàu ePort, Tra cứu Container), cung cấp cảnh báo hạn chót khẩn cấp (Cut-off, Hải quan, Phí hạ tầng) và biểu đồ phân bổ trực quan với tốc độ tải tức thì.

---

## 1. Kiến Trúc & Bố Cục Tổng Quan

Dashboard được tích hợp dưới dạng một **Tab chính đầu tiên** trong thanh điều hướng:
`[📊 Tổng quan]` | `[📄 Danh sách Booking (PDF)]` | `[🚢 ePort SNP (Lịch tàu)]` | `[📦 ePort SNP (Tra cứu Cont)]`

Giao diện Dashboard gồm 4 khu vực chính:
1. **Header Điều Khiển**:
   - Bộ chọn phạm vi: *Bộ sưu tập hiện tại* hoặc *Toàn bộ hệ thống*.
   - Nút *Làm mới dữ liệu* kèm nhãn thời gian cập nhật gần nhất.
   - Trạng thái Auto-Sync tự động và nút đồng bộ nhanh.
2. **Khối Thẻ Chỉ Số KPI Nhanh (Top Metric Cards)**:
   - **Tổng Sản Lượng & Booking**: Tổng số file booking, ước tính tổng số vỏ/TEU.
   - **Cảnh Báo Hải Quan (HQ)**: Số lượng cont **Chưa thanh lý (N)** vs **Đã duyệt (Y)**.
   - **Phí Hạ Tầng Cảng Biển**: Số cont **Chưa đóng (3)** vs **Đã đóng**.
   - **Tồn Bãi (In-Yard)**: Tỷ lệ cont đang nằm trong bãi cảng/ICD.
   - **Giám Sát Watchlist**: Số tàu và số container đang được theo dõi tự động.
3. **Khối Cảnh Báo Khẩn Cấp & Hành Động (Actionable Urgency Alerts)**:
   - **Hạn chót Cut-off (< 24h & < 48h)**: Danh sách booking sắp hết hạn đóng hàng/giao bãi.
   - **Cont Tồn Bãi Chưa Thông Quan / Chưa Nộp Phí**: Cảnh báo rủi ro giữ hàng, kèm nút bấm nhảy ngay sang Tab Cont đã lọc sẵn.
   - **Lịch Tàu Cập/Rời Bến Gần Nhất**: Danh sách tàu trong watchlist sắp cập bến trong 24h-48h.
4. **Khối Phân Tích & Biểu Đồ Trực Quan (Visual Distribution Panels)**:
   - **Phân bổ theo Cảng/ICD (Port Sites)**: Tỷ lệ tại Cát Lái (CTL), Nhơn Trạch (TNT), Hiệp Phước (THP), Sóng Thần (IST)...
   - **Top Hãng Tàu (Carriers)**: Sản lượng theo hãng (ONE, Cosco, SITC, PIL, Maersk, Dongjin...).
   - **Cơ Cấu Vỏ Container**: Tỷ lệ loại cont 20GP, 40HC, 45HC, cont lạnh (Reefer)...
   - **Trạng Thái Sự Kiện Vận Hành**: Tiến độ phân bổ (UNLOAD, INGATE, STACK, LOAD, OUTGATE).

---

## 2. Thiết Kế Backend API (`/api/v1/dashboard`)

### 2.1 Endpoint
- `GET /api/v1/dashboard/summary?collection_id={optional_id}`

### 2.2 Phản hồi JSON Schema (`DashboardSummaryResponse`)
```json
{
  "updated_at": "2026-08-20 15:58:00",
  "scope": {
    "collection_id": 1,
    "collection_name": "Default Collection"
  },
  "kpis": {
    "total_bookings": 24,
    "total_estimated_teus": 58,
    "customs_uncleared": 8,
    "customs_cleared": 42,
    "infras_unpaid": 5,
    "infras_paid": 45,
    "containers_in_yard": 35,
    "containers_out_yard": 15,
    "total_vessels": 12,
    "watchlist_vessels": 4,
    "total_containers": 50,
    "watchlist_containers": 10
  },
  "alerts": {
    "critical_cutoffs": [
      {
        "id": 1,
        "booking_no": "BKG001",
        "carrier": "ONE",
        "cutoff_time": "2026-08-21 08:00",
        "hours_left": 16.5,
        "vessel": "ONE APUS"
      }
    ],
    "uncleared_containers": [
      {
        "id": 10,
        "containerno": "TCNU1234567",
        "site_id": "CTL",
        "in_yard": "Y",
        "custom_clearance_status": "Chưa duyệt (N)",
        "infras_fee_status": "Chưa đóng (3)",
        "event_type": "INGATE",
        "event_time": "2026-08-20 10:30"
      }
    ],
    "upcoming_vessels": [
      {
        "id": 3,
        "site_id": "CTL",
        "vessel_name": "DONGJIN ENTERPRISE",
        "in_out_voyage": "0145N",
        "actual_berth_time": "2026-08-21 06:00",
        "closing_time": "2026-08-20 22:00"
      }
    ]
  },
  "distributions": {
    "carriers": [
      { "name": "ONE", "count": 10, "percentage": 41.7 },
      { "name": "COSCO", "count": 6, "percentage": 25.0 }
    ],
    "sites": [
      { "name": "CTL (Cát Lái)", "count": 30, "percentage": 60.0 },
      { "name": "TNT (Nhơn Trạch)", "count": 12, "percentage": 24.0 }
    ],
    "equipment_types": [
      { "name": "40HC", "count": 22, "percentage": 55.0 },
      { "name": "20GP", "count": 14, "percentage": 35.0 }
    ],
    "container_events": [
      { "name": "INGATE", "count": 20, "percentage": 40.0 },
      { "name": "STACK", "count": 15, "percentage": 30.0 }
    ]
  }
}
```

### 2.3 Tối ưu hóa Truy vấn SQLite
- Viết hàm `get_dashboard_summary(collection_id=None)` trong `backend/app/core/database.py`.
- Sử dụng các câu lệnh `SELECT COUNT(*)`, `SUM(CASE WHEN ...)`, `GROUP BY` trực tiếp trong SQLite để tính toán tức thì mà không cần load toàn bộ rows vào RAM.

---

## 3. Thiết Kế Frontend UI (`frontend/src/components/dashboard`)

### 3.1 Cấu trúc Component
- `DashboardTab.tsx`: Component trang chính, quản lý state load dữ liệu, chọn Collection, auto-refresh.
- `KPICards.tsx`: Grid 4-5 thẻ chỉ số chính với màu sắc trực quan (Badge cảnh báo đỏ khi có hàng chưa thông quan hoặc quá hạn).
- `AlertsSection.tsx`: Bảng cảnh báo hạn gấp với tính năng **1-click navigation** (click vào container sẽ tự chuyển sang Tab Container và search đúng mã container đó).
- `BreakdownCharts.tsx`: Các khối tiến độ/phân bổ (Progress bar tỷ lệ %) hiển thị phân bổ hãng tàu, cảng biển, chủng loại cont và trạng thái bãi.

### 3.2 Tương Tác & Điều Hướng Nhanh (Drilldown Navigation)
- Thêm callback điều hướng từ `App.tsx` hoặc Context:
  - Bấm vào cảnh báo Container -> Chuyển sang `TabId: 'container'`, tự điền mã cont vào ô tìm kiếm.
  - Bấm vào cảnh báo Booking -> Chuyển sang `TabId: 'booking'`, tự điền số booking vào ô tìm kiếm.
  - Bấm vào cảnh báo Tàu -> Chuyển sang `TabId: 'vessel'`, tự lọc theo tên tàu.

### 3.3 Hỗ Trợ Đa Ngôn Ngữ & Dark Mode
- Bổ sung trọn bộ từ khóa trong `frontend/src/i18n/translations.ts` cho cả tiếng Việt (`vi`) và tiếng Anh (`en`).
- Áp dụng các class Tailwind `dark:bg-...`, `dark:text-...`, `dark:border-...` chuẩn xác đồng bộ với toàn bộ ứng dụng.

---

## 4. Kế Hoạch Kiểm Thử (Testing & Verification)

1. **Backend Unit Tests**:
   - `backend/tests/test_dashboard_api.py`:
     - Test truy vấn summary khi database rỗng.
     - Test truy vấn summary theo từng `collection_id` cụ thể và toàn bộ hệ thống (`collection_id=None`).
     - Kiểm tra tính chính xác của các chỉ số KPI, logic phân loại cảnh báo cut-off và phân bổ hãng tàu/cảng.
2. **Frontend Verification**:
   - Build kiểm tra TypeScript (`npm run build`).
   - Kiểm tra hiển thị giao diện ở cả Light Mode và Dark Mode.
   - Kiểm tra tương tác chuyển tab nhanh khi click vào các dòng cảnh báo.
