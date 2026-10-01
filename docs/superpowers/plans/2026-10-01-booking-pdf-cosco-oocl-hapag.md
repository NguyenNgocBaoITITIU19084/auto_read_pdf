# Kế hoạch bổ sung đọc PDF booking: COSCO, OOCL, Hapag-Lloyd (2026-10-01)

> **Trạng thái (2026-10-01):** Đã triển khai Phase 1–5, chưa commit. Câu hỏi ở mục 6 chốt theo đề xuất mặc định.
> - Code mới: `backend/app/services/carrier_parsers/`. Test: `tests/test_booking_carriers.py` (19 test).
> - Toàn bộ test: 581 pass. 4 test fail đã có từ trước, không liên quan: Gemini 500, log retention ×2, log dir.
> - So sánh trước/sau bằng PDF thật: Dongjin, CUL, ONE ×3, PIL ×2 **không đổi trường nào**.
> **Mẫu:** `cosco (1).pdf`, `OOCL 1 (1).pdf`, `OOCL 2 (1).pdf`, `HPL 1 (1).pdf` (trong ~/Downloads).

## 1. Hiện trạng: chạy parser hiện tại trên 4 mẫu

| Trường | COSCO | OOCL 1 | OOCL 2 | HPL |
|---|---|---|---|---|
| Booking No | ❌ `CONFIRMATION` | ❌ `ACKNOWLEDGEMENT` | ❌ `ACKNOWLEDGEMENT` | ❌ `CONTACT` |
| Carrier | ✅ COSCO | ✅ OOCL | ❌ **COSCO** (do tên tàu COSCO SHIPPING PANAMA) | ❌ **MAERSK** (do tàu MANILA MAERSK) |
| POD | ⚠️ `ISTANBUL / KUMPORT LIMAN` | ⚠️ `KEELUNG / CHINA CONTAINER` | ⚠️ `LONG BEACH / LONG BEACH CONTAINER` | ❌ null |
| Vessel / ETD | ❌ null | ❌ null | ❌ null | ❌ null |
| Loại / SL cont | ❌ null | ❌ null | ❌ null | ❌ `40' X 8' X 9'6` |
| Bãi rỗng / Hạ bãi | ❌ null | ❌ null | ❌ null | ❌ null |
| T/S, Block | ❌ | ❌ | ❌ | ❌ |
| CY cut-off | ✅ | ✅ | ✅ | (không có) |

Nguyên nhân: `extractor.py` chỉ có một parser chung, viết theo nhãn của CUL/PIL/Dongjin (`Booking No :`, `Pre Carrier :`, `Trunk Vessel :`, `Empty Pick UP CY :`…). Ba hãng mới dùng nhãn khác hẳn, và hai trong số đó đặt các trường thành cột song song, nên pdfplumber nối chúng vào cùng một dòng text.

## 2. Đặc điểm layout từng hãng

### COSCO và OOCL: cùng mẫu CargoSmart/IRIS (nhãn giống nhau)
```
BOOKING NUMBER: 6469390440
INTENDED VESSEL/VOYAGE: COSCO SHIPPING ALPS 049W ETD: 03 Oct 2026 14:00(ICT)
TRANSHIPMENT PORT: Singapore / Pasir Panjang Terminal ETA: ...      (chỉ có khi chuyển tải)
T/S INTENDED VESSEL VOYAGE: CSCL VENUS 090W ETD: ...
PORT OF DISCHARGE: Istanbul / Kumport Liman ETA: ...                (tên terminal có thể xuống dòng)
FINAL DESTINATION: Kumport,Istanbul, Turkey ETA: ...
BLOCK NUMBER: USLGB                                                  (OOCL; có thể để trống)
INTENDED CY CUT-OFF: 30 Sep 2026 14:00                               (OOCL)
INTENDED FCL CY CUT-OFF: 01 Oct 2026 23:59(ICT)                      (COSCO)
BOOKING QTY SIZE/TYPE: 2 X 40' Hi-Cube Container
```
- **Bãi rỗng / hạ bãi khác nhau giữa hai hãng:**
  - COSCO xếp **dọc**: `FULL RETURN LOCATION: Icd Phuoc Long 3`, rồi `EMPTY PICKUP LOCATION:` để trống, ngay sau đó là tiêu đề `REQUIRED DOCUMENT INFORMATION`.
  - OOCL xếp **2 cột song song**, nên text bị nối: `EMPTY PICKUP LOCATION: FULL RETURN LOCATION:` / `SINOVNL TAN VAN Cat Lai Terminal`. Regex không tách được, phải dùng **toạ độ x của từng word** (`page.extract_words()`).
- Text có thêm nhiều dòng rác của barcode (`AAAAAAAPPII…`, `PILLLIPAOCH…`). Phải lọc bỏ, nếu không regex hiện tại sẽ nhận nhầm `PIL` thành carrier.

### Hapag-Lloyd: layout bảng, bắt buộc dùng toạ độ
- Booking No = `Our Reference: 29297449`. **Không** lấy `BL/SWB No(s).: HLCUSGN…`.
- Loại/SL cont: `Summary: 1x45GP DG Temp. OOG SOW` → `45GP`, `1`. Bảng container `1 45GP N 26-Sep-2026 ANSON ICD` có thể dùng để đối chiếu.
- Bãi: hai cột `Export empty pick up depot(s)` (trái) và `Export terminal delivery address` (phải). Text bị trộn thành `ICD AN SON-BINH DUONG ICD TAY NAM`, nên phải tách theo x. Dòng đầu mỗi cột là tên bãi: ANSON ICD / ICD TANAMEXCO.
- Bảng lộ trình `From | To | By | ETD | ETA`, mỗi chặng chiếm nhiều dòng:
  - Bỏ chặng có By ≠ `Vessel` (Inland Waterway, Barge, Truck, Rail).
  - **Chặng tàu đầu tiên** → Vessel = tên tàu + `Voy. No` (`ULSAN EXPRESS 639E`), ETD = `02-Oct-2026 15:00` (giờ nằm ở dòng dưới).
  - T/S Port = cột To của chặng tàu đầu tiên (`TANJUNG PELEPAS`), **chỉ khi** còn chặng tàu sau đó.
  - POD = cột To của **chặng cuối** (`GDYNIA`).
- Lấy biên cột từ toạ độ của chính các header word trên trang (`From/To/By/ETD/ETA`, `Export empty…`/`Export terminal…`), **không hardcode** số x.
- Không có CY cut-off, nên để null. Không lấy VGM hay SI closing thay vào.

## 3. Kiến trúc đề xuất

```
extract_booking_data(pdf_path)            # có file PDF → có toạ độ word
  ├─ read_pdf_text + read_pdf_words (mới)
  ├─ issuer = detect_issuer(text)          # dựa vào header/FROM:, không dựa vào tên tàu
  ├─ COSCO / OOCL  → parse_cargosmart(text, words)
  ├─ HAPAG-LLOYD  → parse_hapag(text, words)
  └─ còn lại      → extract_booking_from_text(text)   (giữ nguyên, CUL/PIL/Dongjin)
```
- `extract_booking_from_text` **giữ nguyên chữ ký, chỉ nhận text**: `image_extractor.py:457` gọi nó với text OCR, không có toạ độ. Parser mới khi `words=None` (ảnh/OCR) phải lùi về regex text và không được crash.
- Tách ra module mới `backend/app/services/carrier_parsers/` (`layout.py`, `cargosmart.py`, `hapag.py`) để `extractor.py` (458 dòng) không phình thêm.
- Helper dùng chung `layout.py`:
  - `group_rows(words, y_tol)`: gom word thành dòng.
  - `column_text(words, x0, x1, y_from, y_to)`: lấy text trong một khung.
  - `find_word(words, text)`: lấy toạ độ một nhãn.

  Hapag và OOCL dùng chung các helper này.
- Kết quả trả về cùng dict `BOOKING_KEYS` như hiện tại, nên frontend, DB và Excel export không phải đổi. `normalize_field_case` vẫn chạy ở cuối.

## 4. Các việc cần làm

### Phase 1: Sửa lỗi chung trong `extractor.py`
- [ ] **Nhận diện hãng theo đơn vị phát hành trước.** Thêm `detect_issuer()`, kiểm tra theo thứ tự:
  1. dòng `FROM:` (`FROM: OOCL (Vietnam)`, `FROM: COSCO SHIPPING…`);
  2. dòng header `HAPAG-LLOYD (VIETNAM)`;
  3. `By OOCL App`;
  4. nếu chưa ra thì gọi `detect_carrier()` như cũ.

  **Không** đổi thứ tự `CARRIERS` toàn cục. Sửa được: OOCL 2 → OOCL, HPL → HAPAG-LLOYD.
- [ ] **Lọc dòng barcode** trước khi detect: dòng ≥ 20 ký tự chỉ gồm chữ hoa và không có khoảng trắng, hoặc dòng toàn chuỗi `A A AA…`. Tránh nhận nhầm `PIL` trong `PILLLIPAOCH…`.
- [ ] **Regex Booking No dự phòng phải có ít nhất một chữ số** (`(?=[A-Z0-9]*\d)`), hết bắt nhầm `CONFIRMATION` / `ACKNOWLEDGEMENT` / `CONTACT`.
- [ ] **`parse_date_str`** (đã chạy thử, hiện chưa hỗ trợ các dạng dưới):
  - `02-Oct-2026` và `02-Oct-2026 15:00`: thêm dấu `-` làm phân cách vào `_RE_DMONY`;
  - `01 Oct 2026 23:59(ICT)`: bỏ hậu tố múi giờ `(ICT)`, `(SGT)`, `(EET)` trước khi match.

### Phase 2: Parser COSCO/OOCL (`cargosmart.py`)
| Trường app | Nguồn |
|---|---|
| Booking No | `BOOKING NUMBER:` |
| Vessel / ETD | `INTENDED VESSEL/VOYAGE: <tàu> ETD: <ngày[ giờ]>` |
| T/S Port | `TRANSHIPMENT PORT:` lấy phần trước ` / `. Không có dòng này thì null |
| POD | `PORT OF DISCHARGE:` lấy phần trước ` / ` và `ETA:` |
| Place of Delivery | `FINAL DESTINATION:` lấy phần trước `ETA:` |
| Block | `BLOCK NUMBER:` trên cùng dòng. Để trống thì null, **không** nuốt dòng sau |
| Equipment / Q'ty | `BOOKING QTY SIZE/TYPE: N X <loại>`. Nhiều dòng (nhiều loại cont) thì ghép `2 X 20GP + 1 X 40HQ`, xem Câu hỏi 5 |
| Empty Pick Up CY / Full return CY | Có words: tách 2 cột theo x của nhãn `EMPTY PICKUP LOCATION:` / `FULL RETURN LOCATION:`, lấy dòng đầu dưới mỗi nhãn. Không có words hoặc layout dọc (COSCO): lấy text sau nhãn trên cùng dòng, dừng ở tiêu đề kế (`REQUIRED DOCUMENT…`, `EMPTY PICKUP TEL`, `Contact:`) |
| Port Cargo Cut-off | `INTENDED (FCL )?CY CUT-OFF:` |

### Phase 3: Parser Hapag-Lloyd (`hapag.py`)
- [ ] Booking No: `Our Reference:`. Equipment/Q'ty: `Summary: (\d+)x(\w+)`.
- [ ] Depot: cắt 2 cột theo x của header, mỗi cột lấy dòng tên bãi đầu tiên. Đối chiếu với cột "Empty pick up depot" của bảng container nếu có.
- [ ] Routing: tìm hàng header `From … By … ETD`, lấy biên cột theo x các header. Chia chặng theo các dòng có từ khoá ở cột By (`Vessel`, `Inland Waterway`, `Barge`, `Truck`, `Rail`).

  Mỗi chặng lấy: To (dòng đầu cột To), tên tàu (dòng thứ 2 cột By), `Voy. No:`, ETD (ngày + giờ ở dòng dưới). Áp dụng quy tắc ở mục 2.
- [ ] Không có words thì trả về các trường text-only (Booking No, Equipment) và để trống phần còn lại, không crash.

### Phase 4: Test
- [ ] Dữ liệu test: **serialize `extract_words()` ra JSON** (chỉ giữ text + bbox của vùng cần dùng), lưu ở `tests/fixtures/booking_layouts/`. Snippet text kiểu `test_booking_samples.py` không test được logic toạ độ.
- [ ] `tests/test_booking_carriers.py`: 4 case kỳ vọng như bảng mục 5. Thêm case "không có words" cho cả 2 parser, và case nhận diện hãng (OOCL chở tàu COSCO, Hapag chở tàu MAERSK).
- [ ] Unit test `parse_date_str` cho các dạng mới.
- [ ] Chạy **toàn bộ** `.venv/bin/pytest tests backend/tests` để chắc chắn CUL/PIL/Dongjin/ảnh OCR không bị hồi quy.
- [ ] Chạy thử end-to-end bằng 4 PDF thật qua `extract_booking_data`. Upload trên app, kiểm tra badge hãng và bảng booking.

### Phase 5: Hoàn thiện
- [ ] Frontend: `carriers.ts` **đã có** badge COSCO / OOCL / HAPAG-LLOYD, không cần sửa.
- [ ] Cập nhật README (danh sách hãng hỗ trợ).
- [ ] Prompt Gemini/OCR ảnh (`image_extractor.py`): bổ sung gợi ý nhãn `INTENDED VESSEL/VOYAGE`, `Our Reference` nếu cần. Việc này không bắt buộc, sẽ làm sau khi test ảnh chụp booking các hãng này.

## 5. Kết quả kỳ vọng (dùng làm test)

| Trường | COSCO | OOCL 1 | OOCL 2 | HPL |
|---|---|---|---|---|
| Booking No | 6469390440 | 2338872150 | 2172687506 | 29297449 |
| Carrier | COSCO | OOCL | OOCL | HAPAG-LLOYD |
| Vessel | COSCO SHIPPING ALPS 049W | YM CELEBRITY 107A | COSCO SHIPPING PANAMA 006E | ULSAN EXPRESS 639E |
| ETD | 03/10/2026 14:00 | 02/10/2026 | 28/08/2026 | 02/10/2026 15:00 |
| T/S Port | SINGAPORE | null | null *(xem Câu hỏi 1)* | TANJUNG PELEPAS |
| POD | ISTANBUL | KEELUNG | LONG BEACH | GDYNIA |
| Place of Delivery | KUMPORT,ISTANBUL, TURKEY | WUTU,NEW TAIPEI CITY, TAIWAN | *(Câu hỏi 2)* | *(Câu hỏi 3)* |
| Block | null | null | USLGB | null |
| Q'ty / Equipment | 2 / 40' HI-CUBE CONTAINER | 2 / 20' GENERAL PURPOSE CONTAINER | 1 / 40' HI-CUBE CONTAINER | 1 / 45GP |
| Empty Pick Up CY | null (PDF để trống) | SINOVNL TAN VAN | G-FORTUNE DONG AN DEPOT | ANSON ICD |
| Full return CY | ICD PHUOC LONG 3 | CAT LAI TERMINAL | DONG NAI PORT | ICD TANAMEXCO |
| CY cut-off | 01/10/2026 23:59 | 30/09/2026 14:00 | 25/08/2026 18:00 | null |

(Text được viết hoa theo `normalize_field_case` như các hãng hiện có.)

## 6. Câu hỏi cần anh/chị xác nhận
1. **OOCL 2 – Cảng chuyển tải "Long Beach"?** PDF không có dòng TRANSHIPMENT PORT; Long Beach là cảng đích, và booking YM (OOCL 1) cùng mẫu thì ghi "KHÔNG". Đề xuất: để trống.
2. **Điểm giao (Place of Delivery):** OOCL 2 ghi "Long Beach", nhưng OOCL 1 / COSCO lại lấy nguyên chuỗi FINAL DESTINATION (`Wutu,New Taipei City, Taiwan`). Đề xuất: luôn lấy nguyên chuỗi (`LONG BEACH,LOS ANGELES, CALIFORNIA, UNITED STATES`). Hay chỉ lấy phần trước dấu phẩy đầu tiên?
3. **Hapag – Điểm giao:** chưa có quy định. Đề xuất lấy POD (`GDYNIA`). Phương án khác là lấy "Import terminal pick up address" ở trang 2 (`GDYNIA CONTAINER TERMINAL`).
4. **Khi có tàu chuyển tải** (CSCL VENUS 090W, MANILA MAERSK 638W…): đề xuất theo quy ước CUL/PIL hiện có:
   - `Vessel`/`ETD` = tàu đầu tiên;
   - `Pre Carrier` = tàu đầu, `Trunk Vessel` = tàu sau T/S, để tìm tàu nhanh còn tra được cả hai.

   Đồng ý không?
5. **Booking có nhiều loại cont** (vd 2x20GP + 1x40HQ): ghi gộp vào một ô, hay chỉ lấy loại đầu?
6. **Commit PDF mẫu vào repo?** PDF chứa tên/email khách hàng (Forto, ITI, CN Logistics, Super Cargo). Đề xuất chỉ commit JSON toạ độ đã cắt bỏ phần thông tin bên giao dịch.

## 7. Rủi ro
- Hãng đổi mẫu PDF (Hapag đã là "6TH UPDATE"). Vì vậy biên cột lấy theo header chứ không hardcode, và có test cho trường hợp thiếu words.
- Thứ tự ưu tiên khi tên tàu chứa tên hãng khác (COSCO/MAERSK/EVER/KOTA): `detect_issuer` phải chạy trước và chỉ đọc header.
- File PDF scan (không có text layer) vẫn đi đường OCR ảnh như hiện tại, nằm ngoài phạm vi kế hoạch này.
