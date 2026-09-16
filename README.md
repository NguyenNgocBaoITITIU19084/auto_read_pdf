# Auto Read PDF Pro v2.0 🚀

Ứng dụng Desktop hiện đại chuyên dụng cho Logistics & Xuất nhập khẩu:
- **Trích xuất thông tin Booking PDF đa hãng tàu** (Dongjin, PIL, ONE, SITC, Cosco,...) với độ chính xác tuyệt đối.
- **Tra cứu Lịch tàu ePort Saigon Newport** (Cát Lái `CTL`, Giang Nam `GNL`, Tân Cảng Hiệp Phước `THP`, CMS ICD Nhơn Trạch `CMS`, ICD Tân Cảng Sóng Thần `IST`, ICD Tân Cảng Nhơn Trạch `TNT`), quản lý danh sách theo dõi (Watchlist) và tự động đồng bộ (Auto Sync).
- **Tra cứu thông tin bãi & trạng thái hải quan (HQGS, Phí hạ tầng) của Container**.
- **Quản lý phân vùng dữ liệu theo Bộ sưu tập (Collections)**.
- **Xuất dữ liệu ra file Excel chuyên nghiệp (Style chuẩn giao diện bảng biểu)** & Sao lưu/Khôi phục toàn bộ dữ liệu dưới dạng JSON.

---

## 🛠️ Công nghệ sử dụng (Tech Stack)

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Vite.
- **Backend API**: Python 3.10+, FastAPI, Uvicorn, SQLite, pdfplumber, openpyxl, pandas, APScheduler.
- **Desktop Container**: Electron 33 (Quản lý tiến trình Python sidecar, IPC an toàn, đa nền tảng macOS & Windows).

---

## 🚀 Hướng dẫn phát triển & Khởi chạy (Development)

### 1. Cài đặt môi trường

```bash
# Cài đặt thư viện Python (Virtual Environment)
source .venv/bin/activate
pip install -r backend/requirements.txt

# Cài đặt thư viện Frontend & Electron
npm install
cd frontend && npm install && cd ..
```

### 2. Chạy ứng dụng ở môi trường phát triển (Hot-reload)

```bash
npm run dev
```
Lệnh này sẽ tự động khởi chạy đồng thời:
1. React Frontend Dev Server (`http://localhost:5173`)
2. Python FastAPI Backend Server (`http://127.0.0.1:8000`)
3. Electron Window tải giao diện với tính năng Hot-reload tức thì.

---

## 🧪 Kiểm thử (Testing)

Chạy bộ kiểm thử tự động toàn diện (PDF parser tests cho Dongjin, PIL, ePort mock, Excel export, REST API endpoints):

```bash
npm run test:py
# hoặc
.venv/bin/pytest tests/
```

---

## 📦 Đóng gói ứng dụng (Production Packaging)

### Build cho macOS (.dmg, .app)
```bash
npm run build:mac
```

### Build cho Windows (.exe installer)
```bash
npm run build:win
```

---

## 📱 Chụp booking bằng điện thoại (quét mã QR)

Không cần cài app trên điện thoại — chụp ảnh booking trực tiếp bằng camera điện thoại và gửi thẳng vào máy tính để đọc OCR.

### Cách dùng

1. Ở tab **Booking**, bấm nút **"Chụp từ điện thoại"** (icon 📱) cạnh nút "Đọc ảnh AI".
2. Máy tính hiện mã QR. Dùng camera hoặc trình quét QR trên điện thoại quét mã đó (**điện thoại và máy tính phải ở chung một mạng WiFi**).
3. Trình duyệt trên điện thoại tự mở một trang chụp ảnh — không cần cài gì thêm.
4. Bấm **"📷 Chụp ảnh booking"**: camera hệ thống mở ra, chụp xong ảnh tự gửi về máy tính.
5. Trên máy tính, ảnh tự động mở màn hình xem trước + trích xuất OCR (giống hệt khi dán ảnh) để kiểm tra, sửa và lưu vào bộ sưu tập đang chọn.
6. Chụp liên tiếp nhiều ảnh: máy tính sẽ mở lần lượt từng ảnh một, không mất ảnh nào; điện thoại hiện dấu ✓ khi máy tính đã nhận.
7. Đóng cửa sổ mã QR **không** ngắt kết nối — điện thoại vẫn gửi ảnh tiếp được. Bấm **"Ngắt kết nối"** khi dùng xong, hoặc để yên 30 phút hệ thống tự ngắt.

### Xử lý sự cố kết nối

- **Điện thoại không quét được / không kết nối được máy tính**: kiểm tra lại điện thoại và máy tính đang **cùng một mạng WiFi** (không phải WiFi khách — nhiều WiFi khách/công ty chặn các thiết bị nói chuyện với nhau).
- **Đang dùng WiFi khách**: bật hotspot (phát WiFi) riêng trên điện thoại, rồi cho máy tính kết nối vào hotspot đó thay vì WiFi khách.
- **Windows hiện hộp thoại tường lửa lần đầu bật tính năng này**: chọn cho phép ở mạng **"Private"** (mạng riêng tư) để tính năng hoạt động.
- **Đang dùng VPN**: tắt VPN trên cả điện thoại và máy tính rồi thử lại.
- **Mã QR báo lỗi "đã dùng hoặc hết hạn"**: mỗi mã chỉ dùng được một lần và tự hết hạn sau vài phút — quét lại mã QR mới đang hiện trên màn hình máy tính.
- **Máy tính có nhiều mạng (VPN, Ethernet + WiFi,...)**: chọn đúng địa chỉ IP ở khung chọn IP trong cửa sổ mã QR.

### Lưu ý bảo mật

Ảnh chỉ được truyền trong mạng nội bộ (không qua internet, không có máy chủ trung gian), không lưu vào cơ sở dữ liệu và bị xoá ngay khi ngắt kết nối. API chính của ứng dụng (cổng `8000`) luôn chỉ chạy trên máy (`127.0.0.1`), không bao giờ lộ ra mạng WiFi — chỉ có tính năng chụp ảnh này mở một cổng riêng (`8765`) khi đang sử dụng.

---

## 📑 Các hãng tàu và mẫu trích xuất PDF hỗ trợ

- **Hãng DONGJIN**: Nhận diện chuyến Direct, lấy tàu Trunk Vessel, bãi hạ CAT LAI TERMINAL, quy cách cont (`20'DRY ST.-1` $\rightarrow$ `20'DRY ST` + Qty `1`), ngày cắt máng và ETD.
- **Hãng PIL**: Nhận diện chuyến Non-direct, bóc tách `Pre Carrier`, cảng chuyển tải `T/S Port: SINGAPORE`, bãi cấp rỗng đa dòng (`TAN CANG HIEP LUC...`), nơi hạ `CATLAI TERMINAL`, chuẩn hóa ngày dạng `14Jul26` $\rightarrow$ `14/07/2026`.
- **Các hãng khác**: ONE, SITC, Cosco,... tự động fallback và nhận diện thông minh.
