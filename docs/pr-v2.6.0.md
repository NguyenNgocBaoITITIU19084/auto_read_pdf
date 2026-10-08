## v2.6.0: Đọc ảnh container offline tốt hơn (OCR Windows, mã vạch) + tự chuyển model khi Gemini quá tải

### Vì sao
- Trên Windows, nếu không có Gemini thì app không đọc được ảnh container nào. Lý do là phần đọc chữ offline chỉ có macOS Vision (riêng Mac) và Tesseract (không có sẵn trên máy người dùng). Hễ Gemini lỗi là người dùng gặp ngay "Không có công cụ OCR offline".
- Gemini có những lúc quá tải (lỗi 503 "high demand" hoặc treo đến hết timeout), làm hàng đợi đọc ảnh liên tục tạm dừng.

### Thay đổi
**Đọc chữ offline (OCR)**
- Windows 10/11: dùng bộ đọc chữ có sẵn của Windows (`Windows.Media.Ocr`), gọi qua PowerShell 5.1, không cần cài thêm gì. Nếu chưa có ngôn ngữ OCR, app hướng dẫn thêm English bằng tiếng Việt.
- Số cont: tự sửa các ký tự hay đọc nhầm (O/0, I/1, S/5, B/8…), nhưng chỉ nhận bản sửa khi chữ số kiểm tra ISO 6346 xác nhận đúng. Ghép được chữ số kiểm tra in trong ô vuông khi OCR tách nó ra thành một dòng riêng. Nếu chưa ra số hợp lệ thì xoay ảnh 90°/270° và đọc lại.
- Tare / Max Gross đọc được cả khi nhãn và số nằm ở hai cột (dựa vào MAX GROSS = TARE + PAYLOAD). Lấy được số seal và hãng seal từ chữ.

**Mã vạch / QR**: quét ngay trên máy bằng `zxing-cpp` (khoảng 1 MB). Số trong mã vạch được ưu tiên hơn số đọc từ chữ, lệch nhau thì có cảnh báo.

**Gemini**: khi model quá tải hoặc treo, app tự chuyển sang tối đa 2 model flash khác còn hoạt động và bỏ qua model quá tải trong 5 phút. Mỗi lần gọi chờ tối đa 25 giây. Các lỗi key, quota, mất mạng thì vẫn dừng như cũ. Lỗi Gemini và kết quả đọc ảnh container được ghi vào log.

### Kiểm thử
- 1054 test qua trên macOS. 3 test logging (`test_log_retention_scheduler`, `test_get_log_dir_falls_back_to_db_path_parent`) cũng fail y hệt trên `main` trước khi sửa.
- Ảnh thật: OCR offline đọc đúng 5/6 ảnh mẫu (1 ảnh cửa cont, 4 ảnh seal). Ảnh còn lại là ảnh chụp màn hình nhóm Zalo. Phần chữ OCR đọc được từ các ảnh mẫu đã được đưa vào test.
- Gọi thử thật Gemini với ảnh cửa cont: đọc đúng `HPCU5330042`, tare 3700, max gross 32500.
- **Cần CI Windows xác nhận:** phần OCR của Windows chưa từng chạy trên Windows thật. Test `test_real_windows_ocr_reads_a_container_number` chỉ chạy trên Windows CI. Nó sẽ bị bỏ qua nếu máy CI chưa cài ngôn ngữ OCR, và bị bỏ qua thì chưa chứng minh được gì.

### Giới hạn
- Mã vạch chỉ đọc được khi đủ nét: vạch nhỏ nhất cần dày từ 2 pixel trở lên, tức mã vạch seal phải rộng khoảng 300–450 pixel. Ảnh đã nén qua Zalo thường quá nhỏ để quét.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
