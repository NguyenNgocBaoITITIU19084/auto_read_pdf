### Task 6: API thêm/sửa booking thủ công (validate + cảnh báo trùng)

**Files:**
- Modify: `backend/app/core/database.py` (cạnh `_insert_booking_row` L511-540)
- Modify: `backend/app/api/bookings.py:160-168` (`manual-save`) + endpoint mới `PUT /{booking_id}`
- Test: `backend/tests/test_booking_edit_api.py`

**Interfaces:**
- Consumes: `_booking_row_to_api`, `get_bookings_by_ids` (kế hoạch C Task 3); `parse_date_str` (kế hoạch D Task 1: ngày sai giữ nguyên chuỗi)
- Produces (Python):
  - `BOOKING_FIELD_MAP: dict[str, str]` — key hiển thị → cột DB (`"Booking No" → "booking_no"`, …, `"Tên file PDF" → "pdf_name"`)
  - `update_booking(booking_id: int, data: dict) -> dict | None` — chỉ cập nhật key có trong `data` (key hiển thị hoặc tên cột), trả booking dạng API hoặc `None` nếu không tồn tại
  - `find_duplicate_booking_ids(col_id: int, booking_no: str, exclude_id: int | None = None) -> list[int]` — so khớp không phân biệt hoa thường/khoảng trắng
- Produces (backend/app/services/booking_validation.py, mới):
  - `normalize_manual_booking(data: dict) -> tuple[dict, list[str]]` — trả dữ liệu đã chuẩn hoá và danh sách lỗi
  - Quy tắc: strip mọi chuỗi, `"null"` → `""`; `ETD`/`Port Cargo Cut-off` qua `parse_date_str`, nếu kết quả không khớp `^\d{2}/\d{2}/\d{4}( \d{2}:\d{2})?$` thì báo lỗi `"<Tên trường>: ngày không hợp lệ (DD/MM/YYYY hoặc DD/MM/YYYY HH:mm)"`; `Q'ty` nếu có phải là số nguyên 1–999; thêm mới cần ít nhất `Booking No` hoặc `Vessel`
- Produces (HTTP):
  - `POST /bookings/manual-save` → 400 `{detail: "<lỗi 1>; <lỗi 2>"}` nếu không hợp lệ; thành công trả `{status, id, item, warnings: string[]}`
  - `PUT /bookings/{id}` body `{booking: {...}}` → `{status: "success", item, warnings}`; 404 nếu không có; 400 nếu không hợp lệ
  - Cảnh báo trùng: `"Booking No 'X' đã có trong bộ sưu tập (N dòng)"`

- [ ] **Step 1: Viết test thất bại**

`backend/tests/test_booking_edit_api.py`:
```python
import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services.booking_validation import normalize_manual_booking

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def test_normalize_manual_booking_rules():
    data, errors = normalize_manual_booking({"Booking No": "  SGN1 ", "ETD": "2026-09-20", "Q'ty": "2", "Block": "null"})
    assert errors == [] and data["Booking No"] == "SGN1" and data["ETD"] == "20/09/2026" and data["Block"] == ""
    _, errors = normalize_manual_booking({"Booking No": "X", "ETD": "30/02/2026", "Port Cargo Cut-off": "abc", "Q'ty": "0"})
    assert len(errors) == 3
    _, errors = normalize_manual_booking({"Carrier": "PIL"})
    assert errors and "Booking No" in errors[0]
    _, errors = normalize_manual_booking({"Carrier": "PIL"}, require_identity=False)
    assert errors == []


def test_manual_save_validates_and_warns_duplicates(client):
    col = db.create_collection("M")
    bad = client.post(f"{API}/bookings/manual-save", json={"collection_id": col, "booking": {"Carrier": "PIL"}})
    assert bad.status_code == 400
    first = client.post(f"{API}/bookings/manual-save", json={"collection_id": col, "booking": {"Booking No": "SGN9", "ETD": "2026-09-20"}})
    assert first.status_code == 200 and first.json()["warnings"] == []
    assert first.json()["item"]["ETD"] == "20/09/2026"
    dup = client.post(f"{API}/bookings/manual-save", json={"collection_id": col, "booking": {"Booking No": "sgn9 "}})
    assert dup.status_code == 200 and "SGN9" in dup.json()["warnings"][0].upper()


def test_update_booking_partial_and_not_found(client):
    col = db.create_collection("U")
    bid = db.insert_booking(col, {"Booking No": "A1", "Vessel": "OLD", "Carrier": "PIL"})
    res = client.put(f"{API}/bookings/{bid}", json={"booking": {"Vessel": "NEW SHIP", "Port Cargo Cut-off": "2026-09-18 17:00"}})
    assert res.status_code == 200
    item = res.json()["item"]
    assert item["Vessel"] == "NEW SHIP" and item["Carrier"] == "PIL" and item["Port Cargo Cut-off"] == "18/09/2026 17:00"
    assert db.get_bookings(col)[0]["Vessel"] == "NEW SHIP"
    assert client.put(f"{API}/bookings/999999", json={"booking": {"Vessel": "X"}}).status_code == 404
    assert client.put(f"{API}/bookings/{bid}", json={"booking": {"ETD": "31/04/2026"}}).status_code == 400


def test_update_does_not_warn_about_itself(client):
    col = db.create_collection("D")
    bid = db.insert_booking(col, {"Booking No": "SAME"})
    res = client.put(f"{API}/bookings/{bid}", json={"booking": {"Booking No": "SAME", "Vessel": "V"}})
    assert res.json()["warnings"] == []
    assert db.find_duplicate_booking_ids(col, " same ") == [bid]
    assert db.find_duplicate_booking_ids(col, "SAME", exclude_id=bid) == []
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

Run: `pytest backend/tests/test_booking_edit_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.app.services.booking_validation'`

- [ ] **Step 3: Cài đặt validate**

`backend/app/services/booking_validation.py`:
```python
import re

from backend.app.services.extractor import parse_date_str

DATE_FIELDS = ("ETD", "Port Cargo Cut-off")
_DMY_RE = re.compile(r"^\d{2}/\d{2}/\d{4}( \d{2}:\d{2})?$")


def normalize_manual_booking(data: dict, require_identity: bool = True) -> tuple[dict, list[str]]:
    """Clean a user-entered booking. Returns (normalized, errors). Unknown keys are kept as-is."""
    out: dict = {}
    for key, value in (data or {}).items():
        if isinstance(value, str):
            value = value.strip()
            if value.lower() == "null":
                value = ""
        out[key] = "" if value is None else value

    errors: list[str] = []
    for field in DATE_FIELDS:
        raw = out.get(field)
        if raw:
            parsed = parse_date_str(str(raw))
            if _DMY_RE.match(parsed):
                out[field] = parsed
            else:
                errors.append(f"{field}: ngày không hợp lệ (DD/MM/YYYY hoặc DD/MM/YYYY HH:mm)")
    qty = str(out.get("Q'ty", "") or "")
    if qty and not (qty.isdigit() and 1 <= int(qty) <= 999):
        errors.append("Q'ty: phải là số nguyên từ 1 đến 999")
    if require_identity and not (out.get("Booking No") or out.get("Vessel")):
        errors.append("Cần nhập ít nhất Booking No hoặc Tàu (Vessel)")
    return out, errors
```

- [ ] **Step 4: Cài đặt DB** — `database.py` sau `insert_booking`:
```python
BOOKING_FIELD_MAP = {
    "Tên file PDF": "pdf_name", "Booking No": "booking_no", "Carrier": "carrier",
    "Port of Discharging": "port_of_discharging", "Place of Delivery": "place_of_delivery", "Block": "block_val",
    "T/S Port": "ts_port", "Equipment Type": "equipment_type", "Q'ty": "qty", "Empty Pick Up CY": "empty_pickup_cy",
    "Full return CY": "full_return_cy", "Port Cargo Cut-off": "cutoff_time", "Vessel": "vessel", "ETD": "etd",
}


def update_booking(booking_id: int, data: dict) -> dict | None:
    columns = set(BOOKING_FIELD_MAP.values())
    updates: dict[str, str] = {}
    for key, value in (data or {}).items():
        col = BOOKING_FIELD_MAP.get(key, key if key in columns else None)
        if col:
            updates[col] = "" if value is None else str(value)
    with get_connection() as conn:
        if not conn.execute("SELECT 1 FROM bookings WHERE id = ?;", (booking_id,)).fetchone():
            return None
        if updates:
            assignments = ", ".join(f"{c} = ?" for c in updates)
            conn.execute(f"UPDATE bookings SET {assignments} WHERE id = ?;", (*updates.values(), booking_id))
    rows = get_bookings_by_ids([booking_id])
    return rows[0] if rows else None


def find_duplicate_booking_ids(col_id: int, booking_no: str, exclude_id: int | None = None) -> list[int]:
    key = (booking_no or "").strip().upper()
    if not key:
        return []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM bookings WHERE collection_id = ? AND UPPER(TRIM(booking_no)) = ? AND id != ? ORDER BY id;",
            (col_id, key, exclude_id if exclude_id is not None else -1)).fetchall()
    return [r[0] for r in rows]
```
Tên cột trong `updates` chỉ lấy từ `BOOKING_FIELD_MAP` nên câu SQL ghép chuỗi không bị chèn lệnh.

- [ ] **Step 5: Cài đặt API** — `bookings.py`:
```python
from backend.app.core.database import (
    insert_booking, get_bookings, delete_booking, clear_bookings, delete_bookings_batch,
    update_booking, find_duplicate_booking_ids, get_bookings_by_ids, get_booking_collection_id,
)
from backend.app.services.booking_validation import normalize_manual_booking


class UpdateBookingRequest(BaseModel):
    booking: Dict[str, Any]


def _duplicate_warnings(col_id: int, booking_no: str, exclude_id: Optional[int]) -> List[str]:
    dups = find_duplicate_booking_ids(col_id, booking_no, exclude_id)
    return [f"Booking No '{booking_no.strip()}' đã có trong bộ sưu tập ({len(dups)} dòng)"] if dups else []
```
Thay `save_manual_booking`:
```python
@router.post("/manual-save")
def save_manual_booking(req: SaveBookingRequest):
    """Saves a reviewed or manually created booking to a collection."""
    data, errors = normalize_manual_booking(req.booking)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    warnings = _duplicate_warnings(req.collection_id, data.get("Booking No", ""), None)
    row_id = insert_booking(req.collection_id, data)
    logger.info(f"Manual booking saved id={row_id} collection={req.collection_id} duplicate={bool(warnings)}")
    saved = get_bookings_by_ids([row_id])
    item = saved[0] if saved else {**data, "id": row_id}
    return {"status": "success", "id": row_id, "item": item, "warnings": warnings}
```
Thêm **trước** `@router.delete("/{booking_id}")`:
```python
@router.put("/{booking_id}")
def edit_booking(booking_id: int, req: UpdateBookingRequest):
    data, errors = normalize_manual_booking(req.booking, require_identity=False)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    current = get_bookings_by_ids([booking_id])
    if not current:
        raise HTTPException(status_code=404, detail="Booking không tồn tại")
    merged_no = data.get("Booking No", current[0].get("Booking No") or "")
    merged_vessel = data.get("Vessel", current[0].get("Vessel") or "")
    if not (merged_no or merged_vessel):
        raise HTTPException(status_code=400, detail="Cần nhập ít nhất Booking No hoặc Tàu (Vessel)")
    item = update_booking(booking_id, data)
    col_id = get_booking_collection_id(booking_id)
    warnings = _duplicate_warnings(col_id, merged_no, booking_id) if col_id is not None else []
    logger.info(f"Booking updated id={booking_id} fields={sorted(data.keys())}")
    return {"status": "success", "item": item, "warnings": warnings}
```
`get_bookings_by_ids` trả key hiển thị, không có `collection_id`. Vì vậy thêm vào `database.py`:
```python
def get_booking_collection_id(booking_id: int) -> int | None:
    with get_connection() as conn:
        row = conn.execute("SELECT collection_id FROM bookings WHERE id = ?;", (booking_id,)).fetchone()
    return row[0] if row else None
```
và import `get_booking_collection_id` trong `bookings.py`.

`ImageBookingModal.tsx` `handleSave` hiện gửi cả key phụ (`Pre Carrier`, `ETD_Pre`…). Các key này đi qua `normalize_manual_booking` không lỗi và `_insert_booking_row` bỏ qua chúng — không cần sửa.

- [ ] **Step 6: Chạy test**

Run: `pytest backend/tests tests -q`
Expected: PASS toàn bộ

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/booking_validation.py backend/app/core/database.py backend/app/api/bookings.py backend/tests/test_booking_edit_api.py
git commit -m "feat(bookings): validated manual create, partial update endpoint and duplicate warnings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

