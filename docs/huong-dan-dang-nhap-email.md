# Đăng nhập Gmail / Outlook một nút

Bạn (người phát hành app) đăng ký **một lần** hai "ứng dụng đăng nhập" với Google và Microsoft, rồi lưu mã vào
GitHub Secrets. CI đưa mã vào bản cài khi build. Người dùng chỉ còn bấm **Đăng nhập bằng Google** /
**Đăng nhập bằng tài khoản Microsoft** — không phải nhập Client ID, Tenant ID gì nữa.

Mã không nằm trong code hay git: CI ghi chúng vào `backend/app/core/oauth_builtin.py` (file bị git bỏ qua) ngay trước
khi đóng gói.

---

## 1. Outlook / Microsoft 365 (khoảng 5 phút)

Cần một tài khoản Microsoft 365 công ty có quyền đăng ký ứng dụng (thường mọi nhân viên đều được; nếu bị chặn thì nhờ IT).

1. Mở <https://entra.microsoft.com> → **Applications › App registrations › New registration**.
   - **Name:** `Auto Read PDF`
   - **Supported account types:** *Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant)*
     (chỉ dùng trong công ty mình cũng chọn được mục này; nếu muốn khoá trong một công ty xem mục "Chỉ nội bộ" bên dưới).
   - **Redirect URI:** chọn *Public client/native (mobile & desktop)*, nhập
     `http://localhost/api/v1/outlook/oauth/callback`
   - Bấm **Register**.
2. Trong ứng dụng vừa tạo → **Authentication**:
   - Ở *Mobile and desktop applications*, tick thêm `https://login.microsoftonline.com/common/oauth2/nativeclient`
     (trang IT thấy sau khi duyệt).
   - *Advanced settings* → **Allow public client flows: Yes** → **Save**.
   - Nếu ô redirect không nhận `http://`: vào **Manifest**, thêm vào `replyUrlsWithType`
     `{"url": "http://localhost/api/v1/outlook/oauth/callback", "type": "InstalledClient"}` → Save.
3. **API permissions › Add a permission › Microsoft Graph › Delegated permissions**, chọn:
   `offline_access`, `User.Read` (có sẵn), `Mail.ReadWrite`, `Mail.Send` → **Add permissions**.
   Nếu bạn là quản trị viên: bấm **Grant admin consent for …** để cả công ty khỏi phải duyệt.
4. **Overview** → chép **Application (client) ID**. Không cần tạo Client secret.

**Chỉ nội bộ (tuỳ chọn):** ở bước 1 chọn *Accounts in this organizational directory only*, rồi chép thêm
**Directory (tenant) ID** để lưu vào secret `OUTLOOK_TENANT_ID`.

**Công ty chặn nhân viên tự cấp quyền** (đăng nhập báo "Cần quản trị viên phê duyệt"): trong app, Outlook › Cài đặt
có sẵn **link duyệt cho IT**. IT mở link bằng tài khoản quản trị, bấm *Chấp nhận* một lần là cả công ty đăng nhập được.

---

## 2. Gmail (khoảng 10 phút)

1. Mở <https://console.cloud.google.com> → tạo project mới, ví dụ `Auto Read PDF`.
2. **APIs & Services › Library** → tìm **Gmail API** → **Enable**.
3. **Google Auth Platform** (OAuth consent screen):
   - **Branding:** tên app, email hỗ trợ, email liên hệ → Save.
   - **Audience:** *External* → bấm **Publish app** (chuyển sang *In production*).
     Để ở *Testing* thì người dùng bị đăng xuất sau 7 ngày và phải được thêm tay vào danh sách test.
   - **Data Access › Add or remove scopes:** thêm `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
     `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.send` → Save.
4. **Clients › Create client** → *Application type:* **Desktop app** → Create → chép **Client ID** và **Client secret**.

Lưu ý: quyền đọc/gửi Gmail là nhóm Google kiểm soát chặt. Khi chưa qua kiểm duyệt của Google, người dùng thấy màn hình
*"Google hasn't verified this app"* → bấm **Advanced › Go to Auto Read PDF** để tiếp tục, và tối đa 100 người dùng.
Muốn bỏ cảnh báo phải gửi Google kiểm duyệt (Verification Center trong Google Auth Platform).

---

## 3. Lưu mã vào GitHub Secrets

Repo GitHub → **Settings › Secrets and variables › Actions › New repository secret**, tạo:

| Secret | Giá trị |
|---|---|
| `OUTLOOK_CLIENT_ID` | Application (client) ID ở mục 1 |
| `OUTLOOK_TENANT_ID` | chỉ khi chọn "Chỉ nội bộ"; bỏ qua với ứng dụng nhiều tổ chức |
| `GMAIL_CLIENT_ID` | Client ID ở mục 2 (`….apps.googleusercontent.com`) |
| `GMAIL_CLIENT_SECRET` | Client secret ở mục 2 (`GOCSPX-…`) |

Hoặc bằng dòng lệnh (lệnh sẽ hỏi giá trị):

```bash
gh secret set OUTLOOK_CLIENT_ID
gh secret set GMAIL_CLIENT_ID
gh secret set GMAIL_CLIENT_SECRET
```

Lần build tiếp theo trên `main`, bước *🔑 Write built-in sign-in app ids* in ra `set` cho từng mã đã có.

---

## 4. Thử trên máy trước khi release (tuỳ chọn)

```bash
OUTLOOK_CLIENT_ID=... GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... .venv/bin/python scripts/write_oauth_builtin.py
```

Khởi động lại app: tab Gmail / Outlook chỉ còn nút đăng nhập. Xoá `backend/app/core/oauth_builtin.py` để quay lại như cũ.

Người dùng vẫn có thể dùng ứng dụng riêng của họ ở mục **Nâng cao** trong cài đặt; bấm "Bỏ … riêng" để quay về ứng
dụng có sẵn.
