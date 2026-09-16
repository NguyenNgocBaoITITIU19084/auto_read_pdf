# Chụp ảnh booking bằng điện thoại qua mã QR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trên máy tính, người dùng bấm "Chụp từ điện thoại" → app hiện mã QR → quét bằng điện thoại (cùng WiFi) → mở trang chụp ảnh ngay trong trình duyệt, không cần cài app → mỗi ảnh chụp tự về máy tính, tự chạy OCR và mở màn hình xem trước `ImageBookingModal` để kiểm tra / sửa / lưu booking.

**Architecture:**
- **API chính giữ nguyên trên `127.0.0.1:8000`.** Thêm một **máy chủ LAN thứ hai** (uvicorn chạy trong thread riêng của cùng tiến trình backend), bind `0.0.0.0` trên cổng riêng (mặc định `8765`). Máy chủ này **chỉ bật khi có phiên kết nối**, chỉ gắn một FastAPI app nhỏ gồm 3 việc: trả trang chụp ảnh, đổi mã ghép nối lấy token thiết bị, nhận ảnh. Nó không đọc được booking, cài đặt hay Gemini key.
- **Phiên & ảnh chờ** nằm trong bộ nhớ (`services/mobile_bridge.py`), file ảnh lưu trong thư mục tạm, xoá khi ngắt kết nối. Không ghi DB.
- **Máy tính nhận ảnh** bằng cách poll `GET /api/v1/mobile/session` trên API loopback mỗi 2 giây khi phiên đang bật. Việc poll nằm ở tầng `App` (vì `BookingTab` bị unmount khi đổi tab). Ảnh mới được tải về thành `File`, xếp hàng đợi, rồi đưa vào `ImageBookingModal` qua `initialFile`, **dùng lại toàn bộ luồng OCR sẵn có** (`extractBookingImageDetailedApi` → Gemini / OCR local). Không viết thêm code trích xuất.
- **Mã QR** chứa `http://<IP-LAN>:<cổng>/#p=<pairing_token>`. Token nằm sau dấu `#` nên trình duyệt không gửi lên server, tức không xuất hiện trong log. Trang trên điện thoại đọc token, `POST /api/pair` để đổi lấy `device_token` (lưu `sessionStorage`) và gửi token này qua header ở mọi lần upload.
- **Chụp ảnh trên điện thoại** dùng `<input type="file" accept="image/*" capture="environment">`, tức mở camera hệ thống. Không dùng `getUserMedia` vì API này bắt buộc HTTPS mà địa chỉ `http://192.168.x.x` thì không phải HTTPS.

**Tech Stack:** FastAPI + uvicorn (đã có, dùng `uvicorn.Server` chạy thread thứ hai), `secrets`/`hmac` (thư viện chuẩn), Pillow (đã được `image_extractor` import lười, **thêm vào requirements**), React 18 + TypeScript, npm `qrcode` + `@types/qrcode` (tạo QR offline ở frontend), trang điện thoại là HTML + JS thuần nhúng dạng chuỗi trong module Python, nên không cần build và không phải sửa `datas` của `backend_app.spec`. Nhận ảnh bằng polling, không thêm WebSocket.

## Quyết định sản phẩm (đã chốt với anh/chị)

1. **Kết nối qua cùng mạng WiFi/LAN.** Không có server trung gian và ảnh không đi ra internet. Nếu WiFi công ty chặn thiết bị nói chuyện với nhau (WiFi khách / "AP isolation") thì dùng cách thay thế: cho máy tính kết nối vào hotspot của chính điện thoại.
2. **Phía điện thoại là trang web mở từ QR**, không cần cài app, chạy được trên Safari iOS và Chrome Android.
3. **Ảnh về máy tính mở màn hình xem trước OCR** (`ImageBookingModal`): tự trích xuất, người dùng kiểm tra rồi mới lưu vào bộ sưu tập đang chọn.

## Quyết định kỹ thuật cần anh/chị biết (mặc định, có thể đổi)

4. **Chụp bằng camera hệ thống, không có khung xem trực tiếp trong trang.** Bấm "Chụp" → camera của điện thoại mở → chụp → "Dùng ảnh" → ảnh tự gửi. Muốn khung camera ngay trong trang thì phải có HTTPS và chứng chỉ, khối lượng việc tăng khoảng gấp đôi, nên để lại cho phiên bản sau.
5. **Hàng đợi ảnh:** chụp liên tiếp nhiều ảnh thì máy tính xử lý **lần lượt từng ảnh**. Ảnh sau chỉ mở khi người dùng đã lưu hoặc đóng ảnh trước, để không đè lên phần đang sửa dở. Modal hiện "Còn N ảnh đang chờ".
6. **Ảnh về khi đang ở tab khác** thì app tự chuyển sang tab Booking, giống hành vi dán ảnh hiện nay, vì người dùng đang chủ động chụp.
7. **Nhiều điện thoại cùng lúc được phép.** Mã QR chỉ dùng được một lần; ngay khi có máy quét, app tự sinh mã mới trên màn hình.
8. **Phiên tự ngắt sau 30 phút không có hoạt động**, và ngắt khi thoát app. Đóng cửa sổ QR thì phiên **vẫn giữ**: nút ở toolbar hiện nhãn "Đang kết nối", bấm vào để mở lại hoặc ngắt.
9. **Điện thoại thấy trạng thái từng ảnh:** đang gửi (%) → đã gửi → máy tính đã nhận. Không hiển thị kết quả OCR trên điện thoại ở v1.

## Global Constraints

- **API chính không bao giờ bind `0.0.0.0`.** `BACKEND_HOST` giữ mặc định `127.0.0.1`, `py_manager.js` không truyền `HOST`. Có test khẳng định app chính không chứa route mobile và app LAN không chứa route `/api/v1/*`.
- Máy chủ LAN chỉ chạy khi có phiên, dừng khi `DELETE /mobile/session`, khi quá hạn không hoạt động, hoặc khi backend shutdown (lifespan).
- Token: `secrets.token_urlsafe(32)`, so sánh bằng `hmac.compare_digest`. `pairing_token` dùng một lần, sống tối đa 5 phút, nằm trong URL fragment. `device_token` gửi qua header `X-Device-Token`. **Không log token.**
- Giới hạn upload: ≤ 15 MB/ảnh (kiểm tra `Content-Length` và đếm byte khi đọc), ≤ 30 ảnh chờ/phiên, ≤ 300 MB/phiên, ≤ 60 ảnh/phút/thiết bị. Chỉ nhận JPEG/PNG/WEBP theo **magic bytes**. HEIC bị từ chối kèm thông báo rõ ràng (trang điện thoại đã chuyển sang JPEG trước khi gửi).
- Ảnh không ghi DB, không nằm trong thư mục repo. Thư mục tạm `tempfile.mkdtemp(prefix="arp_mobile_")` bị xoá khi phiên kết thúc.
- Chuẩn hoá ảnh: trên điện thoại, thu nhỏ cạnh dài ≤ 2400px, JPEG q=0.85, xoay theo EXIF. Trên server, nếu có Pillow thì chạy thêm `ImageOps.exif_transpose` (không có Pillow thì giữ nguyên ảnh).
- Không thay đổi `/bookings/extract-image`, `/bookings/manual-save`, luồng dán ảnh hay upload hàng loạt.
- Khởi động backend không chậm hơn: module mobile chỉ khởi tạo khi gọi `POST /mobile/session`.
- Chuỗi UI thêm vào `translations.ts` cả `vi` và `en`, trong section `booking.phone` mới. Trang điện thoại có sẵn tiếng Việt, tự dùng tiếng Anh khi `navigator.language` không phải `vi`.
- Test: `pytest backend/tests tests -q`; `cd frontend && npm test && npm run build`.
- Commit message kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/app/services/lan_ip.py` (mới) | Liệt kê IPv4 LAN hợp lệ, IP theo route mặc định đứng đầu |
| `backend/app/services/mobile_bridge.py` (mới) | Phiên, pairing/device token, hàng đợi ảnh, giới hạn, hết hạn, dọn thư mục tạm |
| `backend/app/services/lan_server.py` (mới) | Bật/tắt uvicorn thứ hai trong thread, chọn cổng |
| `backend/app/mobile/page.py` (mới) | Chuỗi HTML + JS + CSS của trang chụp ảnh |
| `backend/app/mobile/app.py` (mới) | FastAPI app chỉ dành cho LAN: `GET /`, `POST /api/pair`, `POST /api/photos`, `GET /api/status` |
| `backend/app/api/mobile.py` (mới) | API loopback cho desktop: `/api/v1/mobile/session`, `/api/v1/mobile/photos/{id}` |
| `backend/app/main.py` | Gắn router `mobile`, dừng LAN server khi shutdown |
| `requirements.txt`, `backend/requirements.txt` | Thêm `Pillow` |
| `backend_app.spec` | Kiểm tra hiddenimports (`backend.app.mobile.*`, PIL) |
| `frontend/package.json` | `qrcode`, `@types/qrcode` |
| `frontend/src/services/api.ts`, `frontend/src/types/index.ts` | Hàm API và kiểu `MobileSession`, `MobilePhoto` |
| `frontend/src/context/MobileBridgeContext.tsx` (mới) | Poll phiên, tải ảnh, hàng đợi, xác nhận đã nhận |
| `frontend/src/components/booking/PhoneCaptureModal.tsx` (mới) | Hiện QR, chọn IP, trạng thái thiết bị, ngắt kết nối, hướng dẫn xử lý lỗi |
| `frontend/src/components/booking/BookingTab.tsx` | Nút "Chụp từ điện thoại" + nhãn; lấy ảnh từ hàng đợi mở `ImageBookingModal` |
| `frontend/src/components/booking/ImageBookingModal.tsx` | Prop tùy chọn `pendingCount` để hiện "Còn N ảnh đang chờ" |
| `frontend/src/App.tsx` | Bọc `MobileBridgeProvider`, chuyển sang tab Booking khi có ảnh |
| `frontend/src/i18n/translations.ts` | Section `booking.phone` (vi + en) |
| `tests/test_mobile_bridge.py`, `tests/test_mobile_api.py`, `tests/test_lan_ip.py` (mới) | Test backend |
| `README.md` | Hướng dẫn sử dụng và xử lý sự cố kết nối |

## Luồng tổng quát

```
Desktop (React)                 Backend loopback :8000            LAN server :8765 (0.0.0.0)        Điện thoại
     │ POST /mobile/session ───────▶ tạo phiên, bật LAN server ─────────▶ start
     │ ◀── {pair_url, ips, ...}                                           
     │ hiện QR(pair_url)                                                                  quét QR ──▶ mở http://IP:8765/#p=TOKEN
     │                                                                    GET /  ◀──────────────────── trang HTML
     │                                                                    POST /api/pair ◀──────────── {pairing_token}
     │                                   rotate pairing token             ──▶ {device_token}
     │                                                                    POST /api/photos ◀────────── ảnh JPEG (X-Device-Token)
     │ GET /mobile/session (poll 2s) ──▶ pending:[{id,...}]
     │ GET /mobile/photos/{id} ────────▶ bytes ─▶ File ─▶ hàng đợi ─▶ ImageBookingModal(initialFile) ─▶ OCR sẵn có
     │ DELETE /mobile/photos/{id} ─────▶ xoá file, đánh dấu "đã nhận"     GET /api/status ◀─────────── điện thoại thấy "máy tính đã nhận"
```

---

### Task 0: Spike kiểm chứng trên thiết bị thật (tối đa 0.5 ngày, chặn mọi task sau)

**Mục tiêu:** trước khi viết code thật, xác nhận ba giả định kỹ thuật chính đều đúng.

**Files:** `scripts/phone_spike/spike_server.py` (tạm, không đóng gói)

- [ ] **Step 1:** Viết server FastAPI tối thiểu. Chạy uvicorn trong **thread phụ** bind `0.0.0.0:8765`, còn thread chính chạy app giả trên `127.0.0.1:8000`. Trang gồm `<input type="file" accept="image/*" capture="environment">`, resize bằng canvas rồi `fetch` POST ảnh. In ra kích thước và 12 byte đầu của file nhận được.
- [ ] **Step 2:** Kiểm tra trên **iPhone (Safari)** và **Android (Chrome)** cùng WiFi với máy Mac:
  - camera mở được;
  - ảnh nhận được là JPEG (không phải HEIC);
  - ảnh chụp dọc nhận về vẫn đúng chiều.
- [ ] **Step 3:** Lặp lại trên **Windows 10/11**. Ghi lại hộp thoại Windows Defender Firewall (lần đầu bind `0.0.0.0`) và việc chọn "Private networks" có đủ không. Thử thêm máy đang bật VPN để xem `lan_ip` chọn đúng IP không.
- [ ] **Step 4:** Xác nhận uvicorn 0.52 chạy trong thread phụ không cướp signal handler của server chính: Ctrl+C / tắt Electron vẫn dừng sạch, `should_exit = True` dừng được thread trong ≤ 3s.
- [ ] **Step 5:** Ghi kết quả vào `docs/superpowers/plans/phone-camera-spike-report.md`. **Nếu có giả định sai** (ví dụ iOS gửi HEIC, hoặc firewall chặn hẳn) → dừng lại, báo anh/chị trước khi làm tiếp.

---

### Task 1: Liệt kê IP LAN

**Files:**
- Create: `backend/app/services/lan_ip.py`
- Test: `tests/test_lan_ip.py`

- [ ] **Step 1: Viết test trước** cho hàm thuần `rank_ipv4(candidates: list[str], default_ip: str | None) -> list[str]`:
  - loại `127.*`, `169.254.*`, `0.0.0.0` và IPv6;
  - chỉ giữ dải private `10/8`, `172.16/12`, `192.168/16`;
  - `default_ip` đứng đầu, loại trùng, thứ tự còn lại ổn định.
- [ ] **Step 2:** Cài đặt:
  ```python
  def default_route_ip() -> str | None:
      # UDP connect không gửi gói tin nào, chỉ để OS chọn interface theo route mặc định
      with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
          try:
              s.connect(("10.255.255.255", 1)); return s.getsockname()[0]
          except OSError:
              return None

  def list_lan_ipv4() -> list[str]:
      candidates = [ai[4][0] for ai in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
      return rank_ipv4(candidates, default_route_ip())
  ```
- [ ] **Step 3:** `pytest tests/test_lan_ip.py -q` pass → commit `feat(mobile): detect LAN IPv4 candidates`.

---

### Task 2: Dịch vụ phiên & hàng đợi ảnh (`mobile_bridge`)

**Files:**
- Create: `backend/app/services/mobile_bridge.py`
- Test: `tests/test_mobile_bridge.py`

- [ ] **Step 1: Viết test trước.** Thời gian được tiêm qua `clock: Callable[[], float]` để test không cần `sleep`. Các trường hợp:
  - `start()` tạo phiên; gọi lại khi đang có phiên thì trả phiên cũ.
  - `pair(token)` đúng → trả `device_token` và **đổi** `pairing_token`; dùng lại token cũ → `PairingError`; quá 5 phút → `PairingError`.
  - `add_photo(device_token, data)`: token sai → `AuthError`; > 15 MB → `TooLarge`; không phải JPEG/PNG/WEBP → `BadType`; HEIC (`ftypheic`) → `BadType` với mã `heic`; > 30 ảnh chờ / > 300 MB → `QueueFull`; > 60 ảnh/phút → `RateLimited`.
  - `pending()` trả metadata theo thứ tự nhận; `read_photo(id)` trả bytes; `ack(id)` xoá file và `status(device)` báo `received`.
  - `expire_if_idle()` sau 30 phút không hoạt động → dừng phiên, thư mục tạm bị xoá, gọi callback `on_stop`.
  - `stop()` idempotent.
- [ ] **Step 2:** Cài đặt với các kiểu dữ liệu sau (một `threading.Lock` bảo vệ toàn bộ state, vì LAN server và API chính chạy khác thread):
  ```python
  @dataclass
  class MobilePhoto: id: str; device_id: str; filename: str; size: int; received_at: float; path: Path; acked: bool = False
  @dataclass
  class MobileDevice: id: str; token: str; label: str; paired_at: float; last_seen: float
  @dataclass
  class MobileSession: id: str; pairing_token: str; pairing_expires_at: float; created_at: float; last_activity: float; tmp_dir: Path

  class MobileBridge:
      def start(self) -> MobileSession: ...
      def stop(self) -> None: ...
      def pair(self, pairing_token: str, user_agent: str) -> MobileDevice: ...
      def add_photo(self, device_token: str, data: bytes) -> MobilePhoto: ...
      def pending(self) -> list[MobilePhoto]: ...
      def read_photo(self, photo_id: str) -> bytes: ...
      def ack(self, photo_id: str) -> None: ...
      def device_status(self, device_token: str) -> dict: ...
      def snapshot(self) -> dict: ...  # cho GET /mobile/session, KHÔNG chứa device token
  bridge = MobileBridge()  # singleton
  ```
  - Nhận dạng loại ảnh bằng magic bytes: JPEG `FF D8 FF`, PNG `89 50 4E 47`, WEBP `RIFF....WEBP`.
  - `label` là tên thiết bị rút gọn từ User-Agent ("iPhone", "Android", "Thiết bị").
  - Tên file ảnh: `phone_YYYYMMDD_HHMMSS_<n>.jpg` theo giờ `Asia/Ho_Chi_Minh`.
  - Có Pillow thì chuẩn hoá EXIF bằng `ImageOps.exif_transpose`, bọc try/except, lỗi thì giữ ảnh gốc.
- [ ] **Step 3:** Thêm `Pillow` vào `requirements.txt` và `backend/requirements.txt` (dùng đúng phiên bản đang có trong `.venv`: 12.3.0).
- [ ] **Step 4:** Test pass → commit `feat(mobile): pairing session and photo inbox service`.

---

### Task 3: App LAN cho điện thoại (route + trang tối thiểu)

**Files:**
- Create: `backend/app/mobile/__init__.py`, `backend/app/mobile/app.py`, `backend/app/mobile/page.py` (tạm thời chỉ có trang placeholder, Task 5 làm trang đầy đủ)
- Test: `tests/test_mobile_api.py` (phần LAN)

- [ ] **Step 1: Viết test trước** bằng `TestClient(mobile_app)`:
  - `GET /` trả `text/html` với header `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
  - `POST /api/pair` với token đúng → 200 `{device_token, session_id}`; sai hoặc hết hạn → 401 `{code:"pair_invalid"}`; không có phiên → 409 `{code:"no_session"}`.
  - `POST /api/photos` (multipart `file`) thiếu hoặc sai `X-Device-Token` → 401; quá cỡ → 413 `{code:"too_large"}`; sai loại → 415 `{code:"bad_type"|"heic"}`; hàng đợi đầy → 429 `{code:"queue_full"}`; hợp lệ → 201 `{photo_id}`.
  - `GET /api/status` → `{connected, photos:[{photo_id, state:"queued"|"received"}]}`.
  - `GET /api/v1/bookings` trên `mobile_app` → 404; không có CORS header.
- [ ] **Step 2:** Cài đặt `mobile_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`.
  - Middleware chặn body theo `Content-Length` > 16 MB và trả 413 trước khi đọc body.
  - Upload đọc theo chunk, dừng khi vượt 15 MB.
  - Lỗi dịch vụ được map sang mã HTTP như test ở Step 1.
- [ ] **Step 3:** Test pass → commit `feat(mobile): LAN-only app for pairing and photo upload`.

---

### Task 4: Vòng đời LAN server + API điều khiển cho desktop

**Files:**
- Create: `backend/app/services/lan_server.py`, `backend/app/api/mobile.py`
- Modify: `backend/app/main.py` (router + shutdown)
- Test: `tests/test_mobile_api.py` (phần loopback + bảo mật)

- [ ] **Step 1:** `lan_server.py`:
  ```python
  class LanServer:
      def start(self, app, host="0.0.0.0", preferred_port=8765) -> int:
          port = self._pick_port(preferred_port)  # thử 8765..8775, hết thì dùng port 0 (OS cấp)
          config = uvicorn.Config(app, host=host, port=port, log_level="warning", access_log=False, lifespan="off")
          self._server = uvicorn.Server(config)
          self._thread = threading.Thread(target=self._server.run, name="mobile-lan", daemon=True)
          self._thread.start(); self._wait_started(timeout=5)
          return port
      def stop(self, timeout=3) -> None:
          if self._server: self._server.should_exit = True
          if self._thread: self._thread.join(timeout)
      @property
      def running(self) -> bool: ...
  ```
  Kèm một job nền (thread timer 60s, hoặc APScheduler sẵn có) gọi `bridge.expire_if_idle()`; `on_stop` sẽ tắt LAN server.
- [ ] **Step 2: Viết test trước** cho API loopback (`TestClient(app)` của `main.py`, mock `LanServer` để test không mở cổng thật):
  - `POST /api/v1/mobile/session` body `{ip?: string}` → `{active:true, session_id, pair_url, ips, selected_ip, port, pairing_expires_at}`; `ip` không nằm trong `ips` → 400.
  - `GET /api/v1/mobile/session` → `{active, pair_url, devices:[{id,label,last_seen}], pending:[{id,filename,size,received_at}]}`. `pair_url` luôn là mã mới nhất; response **không chứa** `device_token`.
  - `GET /api/v1/mobile/photos/{id}` → `image/jpeg`; id lạ → 404.
  - `DELETE /api/v1/mobile/photos/{id}` → 204; `DELETE /api/v1/mobile/session` → 204 và `LanServer.stop` được gọi.
  - Khi `pairing_token` hết hạn 5 phút, `GET /session` tự sinh mã mới (UI hiện QR mới).
  - **Bảo mật:**
    - `app` chính không có route `/api/pair`, `/api/photos`;
    - `backend.app.core.config.BACKEND_HOST == "127.0.0.1"` khi không đặt env `HOST`;
    - log request (`RequestLoggingMiddleware`) không chứa token.
- [ ] **Step 3:** Cài đặt router và gắn vào `main.py` (`app.include_router(mobile_router, prefix="/api/v1")`). Trong lifespan shutdown gọi `bridge.stop()` và `lan_server.stop()` trước `shutdown_scheduler()`. `pair_url = f"http://{ip}:{port}/#p={pairing_token}"`.
- [ ] **Step 4:** Test tích hợp một lần với cổng thật: bật phiên, dùng `httpx` gọi `http://127.0.0.1:<port>/api/pair` rồi upload một JPEG mẫu, `GET /session` thấy ảnh chờ, `DELETE /session` rồi xác nhận cổng đã đóng.
- [ ] **Step 5:** `pytest backend/tests tests -q` pass → commit `feat(mobile): on-demand LAN server and desktop session API`.

---

### Task 5: Trang chụp ảnh trên điện thoại

**Files:**
- Modify: `backend/app/mobile/page.py`
- Test: `tests/test_mobile_api.py` (kiểm tra HTML có các phần tử chính)

- [ ] **Step 1:** Giao diện một cột, nút lớn, hợp dùng một tay, có dark mode theo hệ thống:
  - Thanh trạng thái: "● Đã kết nối với máy tính" / "Mất kết nối – đang thử lại" / "Phiên đã hết hạn – quét lại mã QR trên máy tính".
  - Nút chính **"📷 Chụp ảnh booking"** gắn với `<input type="file" accept="image/*" capture="environment">`.
  - Nút phụ **"🖼 Chọn ảnh có sẵn"** gắn với `<input type="file" accept="image/*" multiple>`.
  - Danh sách ảnh đã gửi: thumbnail, trạng thái (đang gửi % → đã gửi → máy tính đã nhận ✓ / lỗi + nút "Thử lại").
  - Gợi ý nhỏ: "Chụp thẳng, đủ sáng, thấy rõ toàn bộ booking".
- [ ] **Step 2:** Logic JS:
  1. Lúc tải trang: đọc `location.hash` lấy `p`, rồi **xoá hash ngay** bằng `history.replaceState` để token không bị chia sẻ nhầm.
  2. Đã có `device_token` trong `sessionStorage` thì bỏ qua bước pair; chưa có thì `POST /api/pair`. Lỗi `pair_invalid` → hiện "Mã QR đã được dùng hoặc hết hạn, hãy quét mã mới".
  3. Chuẩn hoá ảnh: `createImageBitmap(file, {imageOrientation:'from-image'})` (lỗi thì fallback `<img>`) → canvas cạnh dài ≤ 2400px → `canvas.toBlob('image/jpeg', 0.85)`.
  4. Upload bằng `XMLHttpRequest` để có tiến trình %. Mỗi lần chỉ gửi một ảnh; lỗi mạng tự thử lại 2 lần.
  5. Poll `GET /api/status` mỗi 3s để cập nhật "máy tính đã nhận" và phát hiện phiên hết hạn (401 → xoá `sessionStorage`).
  6. Chuỗi hiển thị có sẵn `vi`/`en`, chọn theo `navigator.language`.
- [ ] **Step 3:** Thử bằng Chrome DevTools (mobile emulation) trỏ tới `http://127.0.0.1:<port>`, rồi thử lại trên điện thoại thật như Task 0.
- [ ] **Step 4:** Commit `feat(mobile): phone capture page`.

---

### Task 6: Frontend — API, kiểu dữ liệu, i18n, thư viện QR

**Files:**
- Modify: `frontend/package.json`, `frontend/src/services/api.ts`, `frontend/src/types/index.ts`, `frontend/src/i18n/translations.ts`

- [ ] **Step 1:** `cd frontend && npm i qrcode && npm i -D @types/qrcode`.
- [ ] **Step 2:** Kiểu dữ liệu:
  ```ts
  export interface MobileDeviceInfo { id: string; label: string; last_seen: number }
  export interface MobilePendingPhoto { id: string; filename: string; size: number; received_at: number }
  export interface MobileSession {
    active: boolean; session_id?: string; pair_url?: string; ips?: string[]; selected_ip?: string;
    port?: number; pairing_expires_at?: number; devices: MobileDeviceInfo[]; pending: MobilePendingPhoto[];
  }
  ```
- [ ] **Step 3:** Hàm API: `startMobileSessionApi(ip?)`, `getMobileSessionApi()`, `stopMobileSessionApi()`, `fetchMobilePhotoApi(id): Promise<File>` (`responseType:'blob'`, tên file lấy từ metadata), `ackMobilePhotoApi(id)`.
- [ ] **Step 4:** i18n `booking.phone` (vi + en): `button`, `connected`, `modalTitle`, `scanHint`, `sameWifiHint`, `chooseIp`, `copyLink`, `devices`, `noDevices`, `photosWaiting`, `disconnect`, `received`, `startFailed`, `troubleshootTitle`, `troubleshootItems` (cùng WiFi; WiFi khách chặn thiết bị → dùng hotspot điện thoại; cho phép tường lửa Windows/macOS; tắt VPN), `sessionExpired`, `pendingInModal`.
- [ ] **Step 5:** `npm run build` pass → commit `feat(mobile): frontend API client, types and strings`.

---

### Task 7: `MobileBridgeContext` — poll, tải ảnh, hàng đợi

**Files:**
- Create: `frontend/src/context/MobileBridgeContext.tsx`, `frontend/src/context/MobileBridgeContext.test.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Viết test trước** (Vitest, mock `api.ts`, fake timers):
  - Chưa `start()` thì không poll.
  - `start()` → poll mỗi 2s; `pending` có ảnh mới → gọi `fetchMobilePhotoApi` **đúng một lần** cho mỗi id (không tải trùng khi poll chồng nhau) → ảnh vào `queue`.
  - `takeNext()` trả `File` đầu hàng và gọi `ackMobilePhotoApi(id)`.
  - `GET` trả `active:false` (hết hạn) → dừng poll, `session=null`, toast `sessionExpired`.
  - `stop()` → gọi API, dừng poll, xoá hàng đợi.
  - Lỗi mạng khi poll không làm crash; lỗi 3 lần liên tiếp thì chuyển trạng thái `error`.
- [ ] **Step 2:** Cài đặt context:
  ```ts
  interface MobileBridgeValue {
    session: MobileSession | null; status: 'idle'|'starting'|'active'|'error';
    queue: File[]; start(ip?: string): Promise<void>; stop(): Promise<void>; takeNext(): File | null;
    onPhotoArrived(cb: () => void): () => void; // App dùng để chuyển sang tab Booking
  }
  ```
  Lúc mount gọi `getMobileSessionApi()` một lần để khôi phục phiên sau khi reload renderer.
- [ ] **Step 3:** `App.tsx`: bọc `<MobileBridgeProvider>`; đăng ký `onPhotoArrived` → `setActiveTab('booking')`.
- [ ] **Step 4:** `npm test` pass → commit `feat(mobile): app-level bridge context with photo queue`.

---

### Task 8: `PhoneCaptureModal` + tích hợp `BookingTab` / `ImageBookingModal`

**Files:**
- Create: `frontend/src/components/booking/PhoneCaptureModal.tsx`, `PhoneCaptureModal.test.tsx`
- Modify: `frontend/src/components/booking/BookingTab.tsx`, `ImageBookingModal.tsx`

- [ ] **Step 1: `PhoneCaptureModal`** (dùng `Modal` sẵn có, Tailwind, `lucide-react` icon `Smartphone`):
  - Mở modal khi chưa có phiên → gọi `start()`; lỗi → hiện `startFailed` + nút thử lại.
  - QR vẽ bằng `QRCode.toCanvas(canvas, pair_url, {width: 240, margin: 1})`, vẽ lại khi `pair_url` đổi (sau mỗi lần quét hoặc khi mã hết hạn).
  - Dưới QR: link dạng chữ + nút sao chép; `ips.length > 1` thì hiện dropdown chọn IP (đổi IP → `start(ip)`).
  - Khối "Thiết bị đã kết nối" (label + thời điểm hoạt động gần nhất) và số ảnh đang chờ.
  - Khối gập "Không kết nối được?" hiện `troubleshootItems`.
  - Nút "Ngắt kết nối" (`stop()`) và "Đóng" (giữ phiên).
  - Test: render QR khi có `pair_url`, hiện dropdown khi nhiều IP, "Ngắt kết nối" gọi `stop`.
- [ ] **Step 2: `BookingTab`:**
  - Thêm nút **"Chụp từ điện thoại"** cạnh nút upload/dán ảnh. Khi `session.active` thì nút có chấm xanh + nhãn `connected`.
  - Thêm effect lấy ảnh từ hàng đợi, chỉ chạy khi modal xem trước đang đóng:
    ```ts
    useEffect(() => {
      if (isImageModalOpen || mobile.queue.length === 0) return;
      const file = mobile.takeNext();
      if (file) { setActiveImageFile(file); setIsImageModalOpen(true); }
    }, [isImageModalOpen, mobile.queue.length]);
    ```
  - Truyền `pendingCount={mobile.queue.length}` vào `ImageBookingModal`.
- [ ] **Step 3: `ImageBookingModal`:** thêm prop tùy chọn `pendingCount?: number`; > 0 thì hiện badge `pendingInModal` ở header. Không đổi logic trích xuất / lưu.
- [ ] **Step 4:** Chạy `npm run dev`. Dùng `curl` giả lập điện thoại (pair + upload ảnh mẫu) để xác nhận:
  - modal tự mở, OCR chạy, lưu được booking;
  - upload 3 ảnh liên tiếp thì mở lần lượt từng ảnh;
  - đang ở tab Tàu thì app tự chuyển sang tab Booking.
- [ ] **Step 5:** `npm test && npm run build` pass → commit `feat(mobile): phone capture modal and booking tab integration`.

---

### Task 9: Đóng gói, kiểm thử thực tế, tài liệu

**Files:** `backend_app.spec`, `README.md`, `tests/` (nếu phát sinh)

- [ ] **Step 1:** `backend_app.spec`: thêm `hiddenimports` cho `backend.app.mobile.app`, `backend.app.mobile.page`, `backend.app.api.mobile`, `PIL.ImageOps` nếu PyInstaller không tự thấy. Build `npm run build:mac` và chạy bản đóng gói.
- [ ] **Step 2: Checklist kiểm thử thủ công** (Mac và Windows, iPhone và Android), ghi kết quả vào báo cáo:
  - [ ] Quét QR → trang mở, trạng thái "Đã kết nối" trong ≤ 3s.
  - [ ] Chụp ảnh dọc/ngang → máy tính mở xem trước, ảnh đúng chiều, OCR ra ≥ số trường như khi dán cùng ảnh đó.
  - [ ] Chụp 5 ảnh liên tiếp → xử lý lần lượt, không mất ảnh nào, điện thoại hiện "máy tính đã nhận" cho cả 5.
  - [ ] Quét lại mã QR cũ (đã dùng) → báo lỗi rõ ràng; mã mới trên màn hình vẫn dùng được.
  - [ ] Hai điện thoại cùng kết nối và gửi ảnh.
  - [ ] Ngắt kết nối → điện thoại báo hết phiên; `http://IP:8765` không còn truy cập được.
  - [ ] Để yên 30 phút → tự ngắt. Thoát app → cổng đóng, thư mục tạm bị xoá.
  - [ ] Từ điện thoại gọi `http://IP:8000/api/v1/settings/ai` → **không kết nối được**.
  - [ ] Windows: hộp thoại tường lửa lần đầu, cho phép "Private" là chạy; hướng dẫn trong modal đúng.
  - [ ] Thời gian khởi động backend (`/health`) không đổi so với trước.
- [ ] **Step 3:** README: mục "Chụp booking bằng điện thoại" (các bước sử dụng + xử lý sự cố).
- [ ] **Step 4:** Commit `docs(mobile): packaging and phone capture guide`.

---

## Ước lượng

| Hạng mục | Thời gian |
|---|---|
| Task 0 – Spike | 0.5 ngày |
| Task 1–4 – Backend | 2 ngày |
| Task 5 – Trang điện thoại | 1 ngày |
| Task 6–8 – Desktop UI | 1.5 ngày |
| Task 9 – Đóng gói & kiểm thử thực tế | 1 ngày |
| **Tổng** | **≈ 6 ngày** |

## Rủi ro & cách xử lý

| Rủi ro | Xử lý |
|---|---|
| WiFi công ty / WiFi khách bật "client isolation", điện thoại không thấy máy tính | Hướng dẫn trong modal: dùng hotspot điện thoại; hiện link dạng chữ để thử trực tiếp |
| Tường lửa Windows chặn `backend_app.exe` | Tài liệu + gợi ý trong modal; không tự sửa cấu hình tường lửa |
| Máy có nhiều IP (VPN, Ethernet + WiFi) | IP theo route mặc định đứng đầu + dropdown chọn IP |
| iOS gửi HEIC / ảnh quá nặng | Chuyển sang JPEG bằng canvas trên điện thoại; server từ chối HEIC với thông báo rõ |
| Uvicorn thread phụ ảnh hưởng shutdown | Kiểm chứng ở Task 0; `daemon=True` + `should_exit` + join có timeout |
| Người cùng mạng dò cổng | Không có token thì không làm gì được; token 256-bit, dùng một lần; server chỉ bật khi đang dùng; không có endpoint đọc dữ liệu |

## Để dành cho phiên bản sau (ngoài phạm vi)

- Khung camera trực tiếp trong trang + tự căn chỉnh / cắt tài liệu (cần HTTPS).
- Hiển thị kết quả OCR và cho sửa ngay trên điện thoại.
- Kết nối qua internet (4G) bằng relay.
- Chụp nhiều trang PDF rồi ghép thành một booking.
