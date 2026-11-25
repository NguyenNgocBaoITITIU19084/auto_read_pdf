# Kế hoạch: Theo dõi hội thoại Zalo và tự quét booking (`zalo-message`)

**Ngày lập:** 2026-11-25
**Nhánh:** `zalo-message`
**Dựa trên:**
- tab Zalo hiện có;
- luồng "Tự nhập từ thư mục" (`backend/app/services/auto_import.py`);
- trình đọc booking (`extract_booking_from_pdf_bytes`, `extract_booking_from_image`);
- hàng chờ ảnh và cửa sổ duyệt của tab Booking (`ImageQueueList`, `ImageBookingModal`).

---

## 1. Mục tiêu

1. Người dùng **đánh dấu theo dõi** một hội thoại (cá nhân hoặc nhóm khách hàng).
2. Khi có **file booking (PDF)** hoặc **ảnh booking** được gửi vào hội thoại đó, app tự quét, kể cả tệp do chính người dùng gửi.
3. Kết quả quét vào **hàng chờ duyệt**. Người dùng xem, sửa nếu cần, rồi xác nhận lưu vào bộ sưu tập.
4. Tin nhắn có tệp đã quét được **gắn nhãn trạng thái**: đang quét, chờ duyệt, đã lưu, trùng, hoặc không đọc được.

## 2. Đã kiểm tra trong code và dữ liệu

| Phát hiện | Ảnh hưởng đến thiết kế |
|---|---|
| Link tệp Zalo (`*.dlfl.vn`) **hết hạn**: một PDF gửi ngày 17/10 trả 404, tệp ngày 11/11 vẫn tải được. Ảnh (`*.zdn.vn`) từ tháng 9 vẫn tải được. | **Tải tệp về máy ngay khi tin đến** và giữ lại bản trên máy. Quét lịch sử cũ có thể gặp link chết, nên app phải báo rõ khi tệp đã hết hạn. |
| "Tự nhập từ thư mục" có các quy tắc: chỉ đọc lớp chữ PDF, Booking No đã có thì bỏ qua, mỗi nội dung (SHA-256) chỉ đọc một lần. | Dùng lại cách chống trùng theo SHA-256. Một tệp gửi lại hoặc chuyển tiếp sang nhóm khác chỉ quét một lần. |
| Đọc ảnh dùng Gemini. Quy tắc trước đây là không gửi Gemini từ tác vụ nền. | Với ảnh Zalo, anh chọn **cho người dùng tự chọn chế độ** (mục 3.2). Mặc định vẫn giữ quy tắc cũ: không tự gửi Gemini. |
| Tab Booking đã có hàng chờ ảnh và cửa sổ duyệt, sửa rồi lưu. | Bấm "Duyệt" ở hàng chờ Zalo sẽ mở đúng cửa sổ này với dữ liệu đã đọc sẵn, không đọc lại. **Cần kiểm tra** `ImageBookingModal` có nhận dữ liệu điền sẵn được không; nếu không thì thêm prop. |

## 3. Thiết kế

### 3.1. Dữ liệu (backend)

- `zalo_conversations.watch_booking INTEGER DEFAULT 0`: cờ theo dõi, tự thêm cột khi khởi động.
- Các cài đặt (`system_settings`):
  - `zalo_booking_collection_id`: bộ sưu tập mặc định khi duyệt. Mặc định lấy bộ sưu tập của "Tự nhập từ thư mục" nếu có.
  - `zalo_booking_image_mode`: `manual` (mặc định) | `caption` | `auto`.
- Bảng mới `zalo_booking_scans`, mỗi tệp trong một tin là một dòng:
  - `msg_id` (khoá chính), `thread_id`, `file_name`, `kind` (`pdf`/`image`), `sha256`, `local_path`
  - `status`: `downloading` | `scanning` | `pending_review` | `saved` | `duplicate` | `no_data` | `not_booking` | `expired` | `error` | `dismissed`
  - `data_json`: dữ liệu booking đã đọc, để duyệt
  - `booking_no`, `booking_id`, `collection_id`, `engine_used`, `message`, `created_at`, `updated_at`
- Tệp tải về lưu trong `<thư mục dữ liệu app>/zalo-files/<sha256>.<ext>`. Nhờ vậy vẫn duyệt và mở lại được sau khi link Zalo hết hạn.

### 3.2. Luồng quét

```
Tin có tệp (đến, hoặc do mình gửi) → record_message
  └─ hội thoại đang theo dõi + PDF hoặc ảnh
       → zalo_booking_scans(status=downloading)
       → luồng nền: tải media_url (chỉ host Zalo, tối đa 30 MB) → SHA-256 → lưu tệp
            ├─ SHA đã quét trước đó        → duplicate (dẫn tới kết quả cũ)
            ├─ PDF có lớp chữ là booking   → pending_review (+ cờ "Booking No đã có" nếu trùng)
            ├─ PDF không phải booking      → not_booking (không làm phiền)
            ├─ PDF scan không có chữ       → xử lý như ảnh, theo chế độ ảnh
            └─ Ảnh, theo zalo_booking_image_mode:
                  manual  → chờ bấm "Quét booking" (không gửi Gemini)
                  caption → tự đọc bằng Gemini nếu lời nhắn kèm theo có "booking", "bkg"
                            hoặc dạng số booking; còn lại chờ bấm
                  auto    → tự đọc bằng Gemini mọi ảnh
              → đọc ra booking: pending_review; không ra: no_data
       → thông báo ở chuông: "Zalo · Nhóm KH ABC: 2 booking chờ duyệt"
       → báo giao diện cập nhật nhãn tin và số "chờ duyệt"
```

- Chế độ `caption` và `auto` gửi ảnh lên Gemini từ nền. Phần cài đặt phải ghi rõ điều này, và mặc định là `manual`.
- Không bao giờ tự lưu booking: mọi kết quả đều qua hàng chờ duyệt.
- Mỗi lần chỉ quét một tệp, có giới hạn tốc độ, để một nhóm gửi dồn 20 ảnh không làm tràn quota.

### 3.3. Bật theo dõi và quét lịch sử

- Khi bật theo dõi, app hiện hộp hỏi: **"Quét các tệp đã gửi trước đó không?"** với các lựa chọn: Không · 7 ngày · 30 ngày · Tất cả tệp đã lưu.
  - Hộp hỏi báo trước số tệp PDF và ảnh trong khoảng đã chọn.
  - Ảnh trong lịch sử cũng tuân theo chế độ ảnh. Ở chế độ `manual`, ảnh chỉ được liệt kê chờ bấm.
  - Tệp có link đã hết hạn được đánh dấu `expired`: "Link Zalo đã hết hạn, nhờ người gửi gửi lại".
- Sau này vẫn quét lại được bằng nút "Quét tệp trong hội thoại…" ở menu chuột phải hoặc trên đầu khung chat.

### 3.4. Giao diện

- **Bật/tắt theo dõi:** có trong menu chuột phải và trên đầu khung chat. Dòng của hội thoại đang theo dõi có biểu tượng 📋.
- **Bộ lọc "Theo dõi":** thêm cạnh các bộ lọc hiện có.
- **Hàng chờ duyệt:** nút **"Booking chờ duyệt (n)"** trên thanh đầu tab Zalo mở danh sách. Mỗi mục có:
  - ảnh thu nhỏ hoặc tên PDF, Booking No, hãng tàu, hội thoại gửi, giờ gửi;
  - cờ ⚠️ "Booking No đã có trong bộ sưu tập" nếu trùng;
  - nút **Duyệt**: mở cửa sổ duyệt của tab Booking với dữ liệu đã đọc. Ở đó có thể sửa, chọn bộ sưu tập rồi lưu, và mục chuyển sang `saved`;
  - nút **Bỏ qua**: chuyển sang `dismissed`;
  - nút **Mở tin**: nhảy tới tin nhắn gốc.
- **Nhãn dưới tin có tệp:**
  - ⏳ Đang quét…
  - 📋 Chờ duyệt · BK123 (bấm để duyệt)
  - ✅ Đã lưu · BK123 (bấm để mở booking)
  - ⚠️ Trùng · đã quét ngày …
  - ❗ Không đọc được, kèm nút "Mở ở tab Booking" để nhập tay
  - ⌛ Link đã hết hạn
  - Ảnh ở chế độ `manual` có nút nổi bật **"Quét booking"**.
- **Quét tay:** mọi tin PDF hoặc ảnh, kể cả ở hội thoại không theo dõi, đều có nút "Quét booking" khi rê chuột.
- **Cài đặt** (biểu tượng bánh răng trong tab Zalo):
  - bộ sưu tập mặc định;
  - chế độ quét ảnh (3 lựa chọn, kèm mô tả, và cảnh báo Gemini cho `caption`/`auto`);
  - bật/tắt thông báo.
- **Badge tab Zalo:** cộng thêm số booking chờ duyệt, hoặc dùng một chấm riêng màu khác (sẽ chốt khi làm).

### 3.5. Kiểm thử

- Backend (`pytest`):
  - PDF booking vào hội thoại đang theo dõi thì ra `pending_review` với dữ liệu đúng.
  - Gửi lại cùng tệp thì ra `duplicate`.
  - Booking No đã có trong bộ sưu tập thì gắn cờ trùng.
  - PDF không phải booking thì ra `not_booking`.
  - Hội thoại không theo dõi thì không quét.
  - Tệp mình gửi cũng được quét.
  - Ba chế độ ảnh đúng hành vi, với Gemini giả lập.
  - Link 404 thì ra `expired`.
  - Host lạ bị chặn, tệp quá 30 MB bị bỏ qua.
  - Duyệt thì lưu đúng bộ sưu tập; bỏ qua thì không lưu.
  - Quét lịch sử theo số ngày.
- Giao diện: `tsc`, cùng kiểm tra trên app bằng PDF và ảnh booking mẫu gửi vào nhóm test.

## 4. Thứ tự làm

1. Backend: cột `watch_booking`, bảng `zalo_booking_scans`, cài đặt, API bật/tắt theo dõi và đọc hàng chờ.
2. Backend: hàng đợi quét nền gồm tải, SHA, PDF và 3 chế độ ảnh, kèm thông báo.
3. Backend: API duyệt / bỏ qua / quét tay / quét lịch sử (đếm trước số tệp).
4. Giao diện: bật theo dõi, hộp hỏi quét lịch sử, bộ lọc "Theo dõi", nhãn dưới tin, nút "Quét booking".
5. Giao diện: hàng chờ duyệt, nối với cửa sổ duyệt của tab Booking.
6. Giao diện: cài đặt (bộ sưu tập, chế độ ảnh).
7. Kiểm tra trên app.

## 5. Ngoài phạm vi (đề xuất làm sau)

- Đọc booking từ Excel hoặc Word: app hiện chỉ đọc được PDF và ảnh.
- Tự trả lời khách sau khi lưu booking, ví dụ "Đã nhận booking BK…": đây là gửi tin thay người dùng, cần cân nhắc riêng.
- Gắn booking với tài xế hoặc chuyến xe từ hội thoại.

## 6. Quyết định đã chốt (2026-11-25)

| Câu hỏi | Chọn |
|---|---|
| Ảnh booking | Người dùng tự chọn 1 trong 3 chế độ: bấm tay / tự quét khi lời nhắn có chữ booking / tự quét mọi ảnh. Mặc định: bấm tay. |
| Booking quét được | Vào **hàng chờ duyệt**, không tự lưu. |
| Lịch sử khi bật theo dõi | **Hỏi người dùng** có muốn quét không, và quét bao nhiêu ngày. |
| Ai gửi thì quét | **Cả tệp người dùng tự gửi.** |
