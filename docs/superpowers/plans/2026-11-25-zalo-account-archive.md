# Kế hoạch: Lưu trữ tin nhắn, ảnh, file Zalo theo tài khoản

**Ngày lập:** 2026-11-25
**Nhánh Git:** `zalo-message`
**Mục tiêu:** Mọi tin nhắn, ảnh và file của từng tài khoản Zalo được lưu lại trên máy, không mất khi đăng xuất, đổi tài khoản hay khi link Zalo hết hạn; mỗi tài khoản chỉ thấy dữ liệu của mình.

---

## 1. Hiện trạng (đã kiểm tra trong code)

| Vấn đề | Chỗ trong code | Hậu quả |
|---|---|---|
| **Đăng xuất xóa sạch dữ liệu** | `POST /zalo/logout` → `clear_zalo_data()` xóa `zalo_messages`, `zalo_conversations`, `zalo_reactions`, `zalo_booking_scans` | Mất toàn bộ lịch sử chat sau mỗi lần đăng xuất |
| **Dữ liệu không gắn với tài khoản** | `zalo_conversations.thread_id` là khóa chính, `zalo_messages.msg_id` UNIQUE toàn bảng, `zalo_sessions` chỉ có 1 dòng (`id = 1`) | Đăng nhập tài khoản khác sẽ trộn hội thoại 2 tài khoản; cùng 1 nhóm chung bị ghi đè |
| **Ảnh chỉ là link Zalo** | `zalo_messages.media_url` trỏ CDN Zalo; bản xem được cache trong thư mục tạm của hệ điều hành (`/tmp/auto_read_pdf_zalo_media`, ~2 MB hiện tại) | Link Zalo hết hạn sau một thời gian → ảnh cũ không xem được; macOS/Windows dọn thư mục tạm là mất |
| **File chỉ lưu khi là booking** | Chỉ `zalo_booking_scans.local_path` (thư mục `zalo-files/`) giữ bản trên máy, và chỉ với hội thoại bật "Theo dõi" | File thường (Excel, Word, PDF không phải booking, video, ghi âm) chỉ còn link |
| **File mình gửi đi không giữ bản gốc** | `zalo_bridge.js` gửi file rồi chỉ lưu `media_url` trả về | Không mở lại được file đã gửi khi link hết hạn |
| **Sao lưu không có Zalo** | `export_backup.py` không xuất gì của Zalo | Cài lại máy là mất |

Dữ liệu hiện có: 128 hội thoại, 947 tin (778 chữ, 145 ảnh, 16 file, 8 sticker), 1 tài khoản đang đăng nhập (có `uid`).

---

## 2. Thiết kế

### 2.1. Tài khoản Zalo là "chủ" của dữ liệu

- Bảng mới **`zalo_accounts`**: `uid` (PK), `display_name`, `phone`, `avatar`, `first_login_at`, `last_login_at`, `last_sync_at`.
  Mỗi lần đăng nhập thành công: upsert dòng của `uid` đó.
- `zalo_sessions` giữ vai trò "tài khoản đang kết nối" (`uid` hiện tại) như bây giờ.
- Thêm cột **`account_uid`** vào: `zalo_conversations`, `zalo_messages`, `zalo_reactions`, `zalo_booking_scans`.
- Đổi khóa:
  - `zalo_conversations`: khóa chính thành `(account_uid, thread_id)` (SQLite không sửa được PK → dựng lại bảng trong migration).
  - `zalo_messages`: `UNIQUE(account_uid, msg_id)` thay cho `msg_id UNIQUE` (một tin trong nhóm chung có thể được 2 tài khoản cùng nhận).
  - `zalo_reactions`: PK `(account_uid, msg_id, sender_id)`.
- **Giữ chung, không tách theo tài khoản:** mẫu tin nhắn nhanh (`zalo_templates`), cài đặt quét booking, danh sách tài xế. Việc gắn hội thoại ↔ tài xế (`driver_id`) nằm trên từng hội thoại nên tự tách theo tài khoản.

### 2.2. Đăng xuất không còn xóa dữ liệu

- `POST /zalo/logout` chỉ: xóa phiên đăng nhập (credentials trong `userData/zalo-session.json`), đặt `zalo_sessions.status = disconnected`. **Không xóa tin nhắn, ảnh, file.**
- Thêm thao tác riêng, có hỏi xác nhận: **"Xóa dữ liệu của tài khoản này"** (trong menu tài khoản) → xóa tin + ảnh/file trên đĩa của đúng `uid` đó, báo trước dung lượng sẽ giải phóng.
- Câu thông báo sau đăng xuất đổi từ "Đã đăng xuất và xóa dữ liệu Zalo cũ" thành "Đã đăng xuất. Đăng nhập lại tài khoản này để xem tin nhắn".

### 2.3. Mọi truy vấn lọc theo tài khoản

- Backend lấy `account_uid` = **tài khoản đang đăng nhập** cho tất cả API: danh sách hội thoại, tin nhắn, ảnh/file, đếm chưa đọc, hàng chờ booking, tìm kiếm.
- Bridge Electron gửi kèm `account_uid` (= `api.getOwnId()`) trong mọi `POST /messages/incoming`, `/outgoing`, `/reactions`, đồng bộ danh bạ/lịch sử. Backend từ chối ghi khi thiếu `account_uid` (tránh ghi lạc).
- **Chưa đăng nhập = không thấy gì.** Sau khi đăng xuất, tab Zalo chỉ còn màn hình đăng nhập (QR): không danh sách hội thoại, không tin nhắn, không ảnh/file, không số "Chờ duyệt", không số tin chưa đọc trên tab Zalo, không thông báo Zalo. Dữ liệu vẫn nằm trên máy; đăng nhập lại **đúng tài khoản đó** là hiện lại đầy đủ. Đăng nhập tài khoản khác chỉ thấy dữ liệu của tài khoản kia.
- **Chặn ở backend, không chỉ ẩn ở giao diện:** khi `zalo_sessions` không có tài khoản đăng nhập, mọi API đọc dữ liệu Zalo trả rỗng (danh sách, đếm) hoặc 403 (tin nhắn, ảnh/file theo id). Ảnh/file chỉ trả khi thuộc tài khoản đang đăng nhập.
- **"Đăng nhập" khác "mất kết nối":** rớt mạng hay Zalo tạm ngắt (còn thông tin đăng nhập, chưa bấm Đăng xuất) vẫn tính là đang đăng nhập → vẫn xem được dữ liệu, chỉ khóa gửi tin như hiện nay. Chỉ khi bấm **Đăng xuất** (hoặc Zalo báo phiên hết hạn và phải quét QR lại) mới ẩn dữ liệu.
- Không có ô chọn tài khoản: muốn xem tài khoản nào thì đăng nhập tài khoản đó.

### 2.4. Lưu ảnh và file về máy

- Thư mục: `<thư mục DB>/zalo-media/<uid>/<yyyy-mm>/<sha256>.<đuôi>` (cùng chỗ với `booking_data.db`, đi theo DB khi đóng gói: bản cài đặt dùng `userData`).
- Cột mới trên `zalo_messages`: `local_path`, `media_sha256`, `media_size`, `media_mime`, `media_status` (`pending` | `saved` | `expired` | `failed` | `paused_disk`), `media_saved_at`.
- **Tin đến:** sau khi lưu tin, đưa vào hàng đợi tải nền (luồng riêng trong backend, tối đa 2 tải song song, thử lại 3 lần cách nhau 1 / 5 / 30 phút). Tải xong: tính sha256, ghi file, cập nhật cột. Cùng nội dung (forward, gửi lại) chỉ lưu 1 bản.
- **Tin mình gửi:** bridge đã có file gốc trong tay → gửi kèm nội dung file cho backend lưu ngay (không cần tải lại từ Zalo).
- **Ảnh dạng JXL** (Zalo dùng cho ảnh gốc): lưu bản gốc + bản JPG để xem (dùng lại bộ chuyển đổi đang có ở `/zalo/media`).
- **Sticker:** không lưu file (chỉ là mã sticker, Zalo luôn hiển thị được).
- **Quét booking dùng chung bản lưu:** `zalo_booking.py` lấy file từ `local_path` của tin nhắn thay vì tải riêng vào `zalo-files/`; gộp `zalo-files/` cũ vào `zalo-media/` trong migration.
- **Xem ảnh/tải file:** endpoint mới `GET /zalo/messages/{id}/media` trả file trên máy; chỉ khi chưa có mới rơi về link Zalo (rồi lưu luôn). Giao diện chuyển sang dùng endpoint này.
- **Lưu tất cả, không giới hạn dung lượng:** ảnh, file, video, ghi âm đều tải về, bất kể kích thước.
  - Tải **ghi thẳng ra đĩa từng phần** (không giữ cả file trong RAM), ghi vào `*.part` rồi đổi tên khi xong — tắt app giữa chừng không để lại file hỏng; lần sau tải tiếp.
  - File lớn (> 50 MB) xếp sau file nhỏ trong hàng đợi để ảnh/chứng từ luôn về trước.
  - **Bảo vệ ổ đĩa:** khi ổ còn trống dưới 2 GB thì tạm dừng tải (`paused_disk`), hiện cảnh báo trong tab Zalo; tự tải tiếp khi ổ có chỗ.
- **Hiển thị dung lượng:** trong cài đặt Zalo, mỗi tài khoản hiện "N tin · M ảnh/file · X MB".

### 2.5. Lưu bù dữ liệu cũ

- Migration gán mọi hội thoại/tin hiện có cho `uid` đang có trong `zalo_sessions` (hiện là 1 tài khoản, đã có `uid`). Nếu không có `uid` → gán vào tài khoản tạm `legacy`, gộp vào tài khoản thật ở lần đăng nhập đầu tiên.
- Sau migration, chạy nền "Lưu bù ảnh/file cũ" cho 160 tin có `media_url` (145 ảnh, 15 file): link còn sống thì lưu; link hết hạn → `expired`, giao diện hiện "Ảnh đã hết hạn trên Zalo" thay vì ô vỡ.
- Ảnh đang nằm trong cache thư mục tạm cũng được chép sang trước khi tải lại (tiết kiệm mạng, cứu được ảnh có link đã chết).

### 2.6. Sao lưu

- `export_backup.py`: thêm tùy chọn "Kèm dữ liệu Zalo" → nén các bảng `zalo_*` + thư mục `zalo-media/`. Khôi phục: giải nén lại đúng chỗ.
- Không bao giờ đưa `zalo-session.json` (thông tin đăng nhập) vào bản sao lưu.

---

## 3. Các bước triển khai

| # | Việc | Phạm vi | Kiểm tra |
|---|---|---|---|
| 1 | Bảng `zalo_accounts`, cột `account_uid`, dựng lại `zalo_conversations` với PK mới, `UNIQUE(account_uid, msg_id)`; migration gán dữ liệu cũ; **sao lưu DB tự động trước khi chạy migration** | `core/zalo.py`, `core/database.py` | pytest: DB cũ → migration → đủ 128 hội thoại / 947 tin, đúng `uid`; chạy migration 2 lần không đổi gì |
| 2 | Toàn bộ hàm đọc/ghi trong `core/zalo.py`, `services/zalo_booking.py` nhận `account_uid`; API lấy tài khoản đang đăng nhập, chưa đăng nhập thì trả rỗng / 403 | backend | pytest: 2 tài khoản cùng `thread_id`/`msg_id` không ghi đè nhau; danh sách, đếm chưa đọc, hàng chờ tách đúng; đăng xuất → mọi API không lộ dữ liệu |
| 3 | Bridge gửi `account_uid` ở mọi lệnh; upsert `zalo_accounts` khi đăng nhập; đăng xuất không gọi xóa dữ liệu | `electron/zalo_bridge.js` | test bridge; đăng xuất → đăng nhập lại thấy đủ lịch sử |
| 4 | Hàng đợi tải media nền, cột `media_*`, endpoint `/zalo/messages/{id}/media`, lưu file mình gửi, gộp `zalo-files/` | backend + bridge | pytest với server giả: tải, trùng sha, link chết → `expired`, file lớn ghi từng phần + tải tiếp sau khi dừng, ổ đầy → `paused_disk`, thử lại |
| 5 | Giao diện: ảnh/file đọc từ endpoint mới; nhãn "hết hạn"; chưa đăng nhập chỉ hiện màn hình đăng nhập (xóa sạch state, số chưa đọc, Chờ duyệt); xóa dữ liệu theo tài khoản; dung lượng trong cài đặt | `ZaloTab.tsx` + component mới | vitest + chạy app: đăng xuất → không còn gì trên màn hình; đăng nhập lại → đủ lịch sử; đổi tài khoản không lẫn |
| 6 | Lưu bù dữ liệu cũ (chép từ cache tạm, tải lại link còn sống) | backend | chạy trên bản sao DB thật, đếm `saved` / `expired` |
| 7 | Sao lưu / khôi phục kèm Zalo | `export_backup.py` | pytest xuất → xóa → khôi phục |

**Tiến độ:** bước 1 xong (2026-11-25). Ngoài đổi cấu trúc bảng, bước 1 làm luôn phần *ghi*: mọi lệnh ghi (thêm/sửa hội thoại, tin, reaction, lượt quét booking, kiểm tra trùng) đã theo tài khoản đang đăng nhập. Bước 2 còn lại phần *đọc* (danh sách, tin nhắn, đếm, hàng chờ) và chặn khi chưa đăng nhập. Hội thoại cũ không có tài khoản nằm ở `account_uid = ''`, bước 3 nhận về cho tài khoản đăng nhập kế tiếp.

Bước 1–3 là phần "lưu theo tài khoản, không mất khi đăng xuất"; bước 4–6 là phần "ảnh/file lưu về máy"; bước 7 làm sau cùng. Mỗi bước một commit, có thể dừng sau bước 3 hoặc bước 6 mà app vẫn chạy đúng.

---

## 4. Rủi ro và cách xử lý

- **Migration đổi khóa chính trên dữ liệu thật:** chép `booking_data.db` sang `.bak-<ngày>` trước khi chạy, làm trong 1 transaction, kiểm tra số dòng trước/sau; lỗi thì rollback và giữ bảng cũ.
- **Dung lượng đĩa tăng dần (không giới hạn kích thước, giữ mãi):** dedupe theo sha256, dừng tải khi ổ còn < 2 GB, hiện dung lượng từng tài khoản, cho xóa theo tài khoản. (Ước lượng: 145 ảnh hiện tại ≈ 20–40 MB; video là phần tốn chỗ nhất.)
- **Tải media làm chậm nhận tin:** tải chạy nền, tách khỏi luồng nhận tin; tin hiện ngay, ảnh dùng link Zalo cho tới khi lưu xong.
- **Bảo mật:** chỉ lưu nội dung tin trên máy của bạn; thông tin đăng nhập vẫn chỉ ở `zalo-session.json`, không vào DB và không vào bản sao lưu.

---

## 5. Đã chốt (2026-11-25)

1. **Tài khoản lần lượt:** mỗi lúc một tài khoản đăng nhập. Đăng nhập song song nhiều tài khoản: không làm trong kế hoạch này.
2. **Đăng xuất là không thấy gì:** chưa đăng nhập thì màn hình Zalo chỉ có đăng nhập; dữ liệu vẫn giữ trên máy và hiện lại khi đăng nhập đúng tài khoản đó (mục 2.3).
3. **Lưu tất cả, không giới hạn:** ảnh, file, video, ghi âm, mọi kích thước (có bảo vệ ổ đĩa ở mục 2.4).
4. **Giữ mãi:** không tự xóa; chỉ xóa khi bấm "Xóa dữ liệu của tài khoản này".
