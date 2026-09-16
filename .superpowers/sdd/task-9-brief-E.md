### Task 9: API bộ sưu tập — số lượng dữ liệu và đổi tên

**Files:**
- Modify: `backend/app/core/database.py:480-506` (khu Collections)
- Modify: `backend/app/api/collections.py`, `backend/app/schemas/models.py:4-14`
- Test: `backend/tests/test_collections_api.py`

**Interfaces:**
- Produces (Python):
  - `get_collections_with_counts() -> list[dict]` — thêm `booking_count, vessel_count, container_count, watchlist_count` (tàu + cont), sắp theo tên
  - `rename_collection(col_id: int, name: str) -> bool` — `False` nếu không tồn tại; `ValueError` nếu tên rỗng; `sqlite3.IntegrityError` nếu trùng tên
- Produces (HTTP):
  - `GET /collections?with_counts=true` → thêm 4 trường đếm (không tham số: như cũ)
  - `PUT /collections/{id}` body `{name}` → `{status: "success", id, name}`; 400 tên rỗng hoặc dài hơn 100 ký tự; 404 không tồn tại; 409 trùng tên với bộ sưu tập khác. So trùng **không phân biệt hoa thường** (ràng buộc `UNIQUE` của SQLite thì phân biệt, nên API tự kiểm tra trước).
  - `POST /collections` cũng áp quy tắc tên như trên (409 khi trùng thay vì 400 chung chung)

- [ ] **Step 1: Viết test thất bại**

`backend/tests/test_collections_api.py`:
```python
import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def test_list_with_counts(client):
    col = db.create_collection("Kho HCM")
    db.insert_booking(col, {"Booking No": "A"})
    db.insert_booking(col, {"Booking No": "B"})
    db.insert_vessel_schedules(col, [{"SITE_ID": "CTL", "VESSELNAME": "EVER", "IN_OUT_VOYAGE": "1N"}])
    db.insert_containers(col, [{"SITE": "CTL", "CONTAINERNO": "ABCU1234567", "EVENT_TIME": "t", "EVENT_TYPE": "LOAD"}])
    db.add_to_watchlist(col, "CTL", "EVER", "1N")
    rows = client.get(f"{API}/collections", params={"with_counts": "true"}).json()
    row = next(r for r in rows if r["id"] == col)
    assert (row["booking_count"], row["vessel_count"], row["container_count"], row["watchlist_count"]) == (2, 1, 1, 1)
    plain = client.get(f"{API}/collections").json()
    assert "booking_count" not in next(r for r in plain if r["id"] == col)


def test_rename_collection(client):
    a = db.create_collection("Alpha")
    db.create_collection("Beta")
    res = client.put(f"{API}/collections/{a}", json={"name": "  Alpha 2026 "})
    assert res.status_code == 200 and res.json()["name"] == "Alpha 2026"
    assert client.put(f"{API}/collections/{a}", json={"name": "beta"}).status_code == 409
    assert client.put(f"{API}/collections/{a}", json={"name": "   "}).status_code == 400
    assert client.put(f"{API}/collections/{a}", json={"name": "x" * 101}).status_code == 400
    assert client.put(f"{API}/collections/999999", json={"name": "Gamma"}).status_code == 404
    assert client.put(f"{API}/collections/{a}", json={"name": "ALPHA 2026"}).status_code == 200  # own name, other case


def test_create_duplicate_returns_409(client):
    db.create_collection("Dup")
    assert client.post(f"{API}/collections", json={"name": "dup"}).status_code == 409
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

Run: `pytest backend/tests/test_collections_api.py -v`
Expected: FAIL — `KeyError: 'booking_count'`

- [ ] **Step 3: Cài đặt DB** — `database.py` sau `get_collections`:
```python
def get_collections_with_counts() -> list[dict]:
    with get_connection() as conn:
        return _select_dicts(conn, """
            SELECT c.*,
                (SELECT COUNT(*) FROM bookings b WHERE b.collection_id = c.id) AS booking_count,
                (SELECT COUNT(*) FROM vessel_schedules v WHERE v.collection_id = c.id) AS vessel_count,
                (SELECT COUNT(*) FROM containers t WHERE t.collection_id = c.id) AS container_count,
                (SELECT COUNT(*) FROM vessel_watchlists w WHERE w.collection_id = c.id)
                  + (SELECT COUNT(*) FROM container_watchlists cw WHERE cw.collection_id = c.id) AS watchlist_count
            FROM collections c ORDER BY c.name ASC;
        """)


def collection_name_taken(name: str, exclude_id: int | None = None) -> bool:
    with get_connection() as conn:
        return conn.execute(
            "SELECT 1 FROM collections WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1;",
            (name, exclude_id if exclude_id is not None else -1)).fetchone() is not None


def rename_collection(col_id: int, name: str) -> bool:
    name = (name or "").strip()
    if not name:
        raise ValueError("Collection name cannot be empty")
    with get_connection() as conn:
        cur = conn.execute("UPDATE collections SET name = ? WHERE id = ?;", (name, col_id))
        return cur.rowcount > 0
```
Các subquery `COUNT(*)` dùng index sẵn có (`idx_bookings_collection`, `idx_*_col_queried`, autoindex UNIQUE của watchlist), nên nhanh với 50k dòng.

- [ ] **Step 4: Cài đặt API** — `models.py`:
```python
class CollectionRename(BaseModel):
    name: str

class CollectionResponse(BaseModel):
    id: int
    name: str
    created_at: str
    settings: Optional[str] = None
    booking_count: Optional[int] = None
    vessel_count: Optional[int] = None
    container_count: Optional[int] = None
    watchlist_count: Optional[int] = None
```
`collections.py`:
```python
import logging

from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_collections, get_collections_with_counts, create_collection, delete_collection, update_collection_settings,
    move_items_to_collection, rename_collection, collection_name_taken,
)
from backend.app.schemas.models import (
    CollectionCreate, CollectionRename, CollectionUpdateSettings, CollectionResponse, MoveItemsRequest
)

logger = logging.getLogger("backend.api.collections")
router = APIRouter(prefix="/collections", tags=["Collections"])
MAX_NAME_LENGTH = 100


def _clean_name(name: str, exclude_id: int | None = None) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên bộ sưu tập không được để trống")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Tên bộ sưu tập tối đa {MAX_NAME_LENGTH} ký tự")
    if collection_name_taken(name, exclude_id):
        raise HTTPException(status_code=409, detail=f"Đã có bộ sưu tập tên '{name}'")
    return name


@router.get("", response_model=list[CollectionResponse], response_model_exclude_none=True)
def list_collections(with_counts: bool = Query(False)):
    return get_collections_with_counts() if with_counts else get_collections()


@router.post("", response_model=dict)
def create_new_collection(payload: CollectionCreate):
    name = _clean_name(payload.name)
    col_id = create_collection(name)
    logger.info(f"Created collection id={col_id}")
    return {"id": col_id, "name": name}


@router.put("/{col_id}")
def rename(col_id: int, payload: CollectionRename):
    name = _clean_name(payload.name, exclude_id=col_id)
    if not rename_collection(col_id, name):
        raise HTTPException(status_code=404, detail="Bộ sưu tập không tồn tại")
    logger.info(f"Renamed collection id={col_id}")
    return {"status": "success", "id": col_id, "name": name}
```
Giữ nguyên các route `/move`, `DELETE /{col_id}`, `PUT /{col_id}/settings`. Route `PUT /{col_id}/settings` có 2 đoạn path nên không đụng `PUT /{col_id}`.
`response_model_exclude_none=True` có tác dụng phụ: `settings: null` sẽ **bị bỏ** khỏi response không tham số. `types/index.ts` đã khai `settings?: string | null` nên frontend không vỡ; test cũ (nếu có) so sánh `settings` là `None` thì đổi sang `.get("settings")`.

- [ ] **Step 5: Chạy test**

Run: `pytest backend/tests tests -q`
Expected: PASS toàn bộ

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/database.py backend/app/api/collections.py backend/app/schemas/models.py backend/tests/test_collections_api.py
git commit -m "feat(collections): row counts, rename endpoint and case-insensitive duplicate names

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

