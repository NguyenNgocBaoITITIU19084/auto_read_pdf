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

## 📑 Các hãng tàu và mẫu trích xuất PDF hỗ trợ

- **Hãng DONGJIN**: Nhận diện chuyến Direct, lấy tàu Trunk Vessel, bãi hạ CAT LAI TERMINAL, quy cách cont (`20'DRY ST.-1` $\rightarrow$ `20'DRY ST` + Qty `1`), ngày cắt máng và ETD.
- **Hãng PIL**: Nhận diện chuyến Non-direct, bóc tách `Pre Carrier`, cảng chuyển tải `T/S Port: SINGAPORE`, bãi cấp rỗng đa dòng (`TAN CANG HIEP LUC...`), nơi hạ `CATLAI TERMINAL`, chuẩn hóa ngày dạng `14Jul26` $\rightarrow$ `14/07/2026`.
- **Các hãng khác**: ONE, SITC, Cosco,... tự động fallback và nhận diện thông minh.
