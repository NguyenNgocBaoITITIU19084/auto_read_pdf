"""Fleet: trucks, drivers, and who drives which truck. Trailers (rơ moóc) and which tractor pulls which
are in fleet_trailers.py.

A truck (`fleet_vehicles` row) is a tractor (đầu kéo, `category` 'tractor', pulls a trailer) or a rigid truck (xe tải,
'truck', carries its own load: `body_type`, `payload`, never a trailer). Both have drivers, papers, trash and reminders
alike; the category is set when the truck is made and does not change.

Fleet data is the company's, not a collection's: nothing here is scoped by collection.

A driver has a home truck (xe gốc, `fleet_drivers.home_vehicle_id`, at most one driver per truck) and drives at most
one truck at a time. Who drives what is the open row (ended_at IS NULL) of `fleet_assignments`; closed rows are the
history. A row is "primary" (the driver on their home truck) or "temporary" (on another truck while theirs is broken,
in maintenance, ...); a temporary driver goes back with return_home(). Partial unique indexes keep one open row per
driver and per truck, so every move closes the old row before it opens the new one, inside one transaction.

History rows keep the driver's name and the plate as they were, so deleting a driver or a truck keeps its history.
"""
import io
import logging
import os
import re
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from backend.app.core.timezone import VN_TZ

logger = logging.getLogger("backend.fleet")

VEHICLE_STATUSES = ("active", "broken", "maintenance", "inactive")
VEHICLE_STATUS_LABELS = {"active": "Đang chạy", "broken": "Hư hỏng", "maintenance": "Bảo dưỡng",
                         "inactive": "Ngưng hoạt động"}
DRIVER_STATUSES = ("active", "leave", "left")
DRIVER_STATUS_LABELS = {"active": "Đang làm", "leave": "Nghỉ phép", "left": "Đã nghỉ việc"}
ASSIGNMENT_KINDS = ("primary", "temporary")
VEHICLE_CATEGORIES = ("tractor", "truck")
# the app tab listing each category
CATEGORY_TABS = {"tractor": "fleet", "truck": "trucks"}

# Days before a document expires when it is reminded of (0 = it has expired); only the tightest one crossed is sent
EXPIRY_REMINDER_DAYS = (30, 7, 0)
EXPIRY_FIELDS = (
    # (table, column, kind, label)
    ("fleet_vehicles", "registration_expiry", "registration", "Đăng kiểm"),
    ("fleet_vehicles", "insurance_expiry", "insurance", "Bảo hiểm"),
    ("fleet_drivers", "license_expiry", "license", "Bằng lái"),
    ("fleet_trailers", "registration_expiry", "trailer_registration", "Đăng kiểm moóc"),
    ("fleet_trailers", "insurance_expiry", "trailer_insurance", "Bảo hiểm moóc"),
)
# per table: (entity, the column naming it, the status left out of reminders, the app tab showing it)
EXPIRY_ENTITIES = {
    "fleet_vehicles": ("vehicle", "plate", "inactive", "fleet"),
    "fleet_drivers": ("driver", "name", "left", "drivers"),
    "fleet_trailers": ("trailer", "plate", "inactive", "trailers"),
}
EXPIRY_LIST_LIMIT = 20
HISTORY_MAX_LIMIT = 1000

# Photos: one per truck / driver, kept next to the database as JPEG (never larger than PHOTO_MAX_SIDE)
PHOTO_MAX_BYTES = 15 * 1024 * 1024
PHOTO_MAX_SIDE = 1200
PHOTO_ENTITIES = {"vehicle": "fleet_vehicles", "driver": "fleet_drivers", "trailer": "fleet_trailers"}
# Scans of a driver's papers, front and back: a column of fleet_drivers each, stored like photos but larger
DRIVER_DOCUMENTS = ("license_front", "license_back", "id_front", "id_back")
DOCUMENT_MAX_SIDE = 2000
# ... and of a truck's: đăng kiểm (registration, as registration_expiry), bảo hiểm, giấy đăng ký xe (ownership, if any)
VEHICLE_DOCUMENTS = ("registration_front", "registration_back", "insurance_front", "insurance_back",
                     "ownership_front", "ownership_back")
DOCUMENTS = {"driver": DRIVER_DOCUMENTS, "vehicle": VEHICLE_DOCUMENTS}
# the image columns of each table (all deleted with the row when it is purged)
IMAGE_COLUMNS = {"fleet_vehicles": ("photo", *VEHICLE_DOCUMENTS), "fleet_drivers": ("photo", *DRIVER_DOCUMENTS),
                 "fleet_trailers": ("photo",)}
_PHOTO_NAME = re.compile(r"^(vehicle|driver|trailer)_\d+_"
                         r"(?:(?:license|id|registration|insurance|ownership)_(?:front|back)_)?[0-9a-f]{8}\.jpg$")
_NOT_FOUND = {"vehicle": "Không tìm thấy xe", "driver": "Không tìm thấy tài xế", "trailer": "Không tìm thấy moóc"}

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PLATE_JUNK = re.compile(r"[\s.\-_/]+")


class FleetError(Exception):
    """A request that cannot be done as asked. `status` is the HTTP status the API answers with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _conn():
    from backend.app.core.database import get_connection
    return get_connection()


def _now() -> str:
    from backend.app.core.database import _now_str
    return _now_str()


def plate_key(plate) -> str:
    """'51C-123.45', '51c 12345' and '51C12345' are the same plate."""
    return _PLATE_JUNK.sub("", str(plate or "")).upper()


def _text(value, limit: int = 200) -> str:
    return " ".join(str(value or "").split())[:limit]


def _date(value, label: str) -> str:
    """'' or a real 'YYYY-MM-DD' date."""
    s = str(value or "").strip()
    if not s:
        return ""
    if not _DATE_RE.match(s):
        raise FleetError(f"{label}: ngày không hợp lệ ({s}), cần dạng YYYY-MM-DD")
    try:
        date.fromisoformat(s)
    except ValueError:
        raise FleetError(f"{label}: ngày không tồn tại ({s})")
    return s


def create_fleet_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fleet_vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate TEXT NOT NULL,
            plate_key TEXT NOT NULL UNIQUE,
            trailer_plate TEXT NOT NULL DEFAULT '',
            trailer_key TEXT NOT NULL DEFAULT '',
            vehicle_type TEXT NOT NULL DEFAULT '',
            registration_expiry TEXT NOT NULL DEFAULT '',
            insurance_expiry TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            note TEXT NOT NULL DEFAULT '',
            photo TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_vehicles_trailer ON fleet_vehicles(trailer_key) "
                 "WHERE trailer_key != '';")
    from backend.app.core.fleet_trailers import create_trailer_tables, migrate_trailer_plates
    create_trailer_tables(conn)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fleet_drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            id_number TEXT NOT NULL DEFAULT '',
            license_no TEXT NOT NULL DEFAULT '',
            license_class TEXT NOT NULL DEFAULT '',
            license_expiry TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            home_vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
            note TEXT NOT NULL DEFAULT '',
            photo TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)
    # databases made before photos / the trash existed
    for table in PHOTO_ENTITIES.values():
        columns = {r[1] for r in conn.execute(f"PRAGMA table_info({table});")}
        if "photo" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN photo TEXT NOT NULL DEFAULT '';")
        if "deleted_at" not in columns:
            # set = in the trash (see "Trash"): hidden everywhere, restorable for TRASH_KEEP_DAYS days
            conn.execute(f"ALTER TABLE {table} ADD COLUMN deleted_at TEXT;")
    # databases made before trucks (xe tải): every truck there is a tractor
    have = {r[1] for r in conn.execute("PRAGMA table_info(fleet_vehicles);")}
    for column, default in (("category", "tractor"), ("body_type", ""), ("payload", "")):
        if column not in have:
            conn.execute(f"ALTER TABLE fleet_vehicles ADD COLUMN {column} TEXT NOT NULL DEFAULT '{default}';")
    for table, documents in (("fleet_drivers", DRIVER_DOCUMENTS), ("fleet_vehicles", VEHICLE_DOCUMENTS)):
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table});")}
        for column in documents:
            if column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT NOT NULL DEFAULT '';")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_drivers_home ON fleet_drivers(home_vehicle_id) "
                 "WHERE home_vehicle_id IS NOT NULL;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fleet_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
            vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
            driver_name TEXT NOT NULL,
            vehicle_plate TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'primary',
            home_vehicle_plate TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            started_at TEXT NOT NULL,
            ended_at TEXT,
            end_reason TEXT NOT NULL DEFAULT ''
        );
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_open_driver ON fleet_assignments(driver_id) "
                 "WHERE ended_at IS NULL;")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_open_vehicle ON fleet_assignments(vehicle_id) "
                 "WHERE ended_at IS NULL;")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fleet_assignments_started ON fleet_assignments(started_at);")
    # Expiry reminders already sent; a new expiry date re-arms them
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fleet_reminders (
            entity_key TEXT NOT NULL,
            expiry TEXT NOT NULL,
            threshold INTEGER NOT NULL,
            sent_at TEXT NOT NULL,
            PRIMARY KEY (entity_key, expiry, threshold)
        );
    """)
    # tractors from before trailers had records: their typed trailer plate becomes a trailer, hitched
    migrate_trailer_plates(conn)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def _rows(conn, sql: str, params: tuple = ()) -> list[dict]:
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _vehicle(conn, vehicle_id: int) -> dict:
    """A truck that is not in the trash (404 otherwise)."""
    rows = _rows(conn, "SELECT * FROM fleet_vehicles WHERE id = ? AND deleted_at IS NULL;", (vehicle_id,))
    if not rows:
        raise FleetError("Không tìm thấy xe", 404)
    return rows[0]


def _driver(conn, driver_id: int) -> dict:
    """A driver who is not in the trash (404 otherwise)."""
    rows = _rows(conn, "SELECT * FROM fleet_drivers WHERE id = ? AND deleted_at IS NULL;", (driver_id,))
    if not rows:
        raise FleetError("Không tìm thấy tài xế", 404)
    return rows[0]


def _open_by_driver(conn, driver_id: int) -> dict | None:
    rows = _rows(conn, "SELECT * FROM fleet_assignments WHERE driver_id = ? AND ended_at IS NULL;", (driver_id,))
    return rows[0] if rows else None


def _open_by_vehicle(conn, vehicle_id: int) -> dict | None:
    rows = _rows(conn, "SELECT * FROM fleet_assignments WHERE vehicle_id = ? AND ended_at IS NULL;", (vehicle_id,))
    return rows[0] if rows else None


def _home_driver_of(conn, vehicle_id: int) -> dict | None:
    rows = _rows(conn, "SELECT * FROM fleet_drivers WHERE home_vehicle_id = ? AND deleted_at IS NULL;", (vehicle_id,))
    return rows[0] if rows else None


def list_vehicles() -> list[dict]:
    """Every truck with its home driver and whoever drives it now (kind "primary" or "temporary")."""
    with _conn() as conn:
        vehicles = _rows(conn, "SELECT * FROM fleet_vehicles WHERE deleted_at IS NULL;")
        homes = {r["home_vehicle_id"]: r for r in _rows(
            conn, "SELECT id, name, status, photo, home_vehicle_id FROM fleet_drivers "
                  "WHERE home_vehicle_id IS NOT NULL AND deleted_at IS NULL;")}
        current = {r["vehicle_id"]: r for r in _rows(conn, """
            SELECT a.vehicle_id, a.driver_id, a.kind, a.started_at, a.reason, d.name, d.phone, d.photo
            FROM fleet_assignments a JOIN fleet_drivers d ON d.id = a.driver_id
            WHERE a.ended_at IS NULL;""")}
        # where each home driver is right now, to show "the home driver is away on another truck"
        away = {r["driver_id"]: r for r in _rows(conn, """
            SELECT a.driver_id, v.id AS vehicle_id, v.plate FROM fleet_assignments a
            JOIN fleet_vehicles v ON v.id = a.vehicle_id WHERE a.ended_at IS NULL;""")}
    out = []
    for v in vehicles:
        h = homes.get(v["id"])
        c = current.get(v["id"])
        item = {k: v[k] for k in ("id", "plate", "category", "trailer_plate", "vehicle_type", "body_type", "payload",
                                  "registration_expiry",
                                  "insurance_expiry", "status", "note", "photo", *VEHICLE_DOCUMENTS,
                                  "created_at", "updated_at")}
        item["home_driver"] = None
        if h:
            where = away.get(h["id"])
            item["home_driver"] = {"id": h["id"], "name": h["name"], "status": h["status"], "photo": h["photo"],
                                   "driving_vehicle_id": where["vehicle_id"] if where else None,
                                   "driving_plate": where["plate"] if where else ""}
        item["current_driver"] = ({"id": c["driver_id"], "name": c["name"], "phone": c["phone"], "photo": c["photo"],
                                   "kind": c["kind"],
                                   "since": c["started_at"], "reason": c["reason"]} if c else None)
        out.append(item)
    out.sort(key=lambda r: plate_key(r["plate"]))
    return out


def list_drivers() -> list[dict]:
    """Every driver with their home truck and the truck they drive now."""
    with _conn() as conn:
        drivers = _rows(conn, """
            SELECT d.*, hv.plate AS home_plate, hv.status AS home_status, hv.category AS home_category
            FROM fleet_drivers d LEFT JOIN fleet_vehicles hv ON hv.id = d.home_vehicle_id
            WHERE d.deleted_at IS NULL;""")
        current = {r["driver_id"]: r for r in _rows(conn, """
            SELECT a.driver_id, a.vehicle_id, a.kind, a.started_at, a.reason, v.plate, v.trailer_plate, v.photo,
                   v.category
            FROM fleet_assignments a JOIN fleet_vehicles v ON v.id = a.vehicle_id
            WHERE a.ended_at IS NULL;""")}
    out = []
    for d in drivers:
        c = current.get(d["id"])
        item = {k: d[k] for k in ("id", "name", "phone", "id_number", "license_no", "license_class",
                                  "license_expiry", "status", "note", "photo", *DRIVER_DOCUMENTS,
                                  "created_at", "updated_at")}
        item["home_vehicle"] = ({"id": d["home_vehicle_id"], "plate": d["home_plate"], "status": d["home_status"],
                                 "category": d["home_category"]} if d["home_vehicle_id"] else None)
        item["current_vehicle"] = ({"id": c["vehicle_id"], "plate": c["plate"], "trailer_plate": c["trailer_plate"],
                                    "photo": c["photo"], "category": c["category"],
                                    "kind": c["kind"], "since": c["started_at"], "reason": c["reason"]} if c else None)
        out.append(item)
    out.sort(key=lambda r: (DRIVER_STATUSES.index(r["status"]) if r["status"] in DRIVER_STATUSES else 9,
                            r["name"].casefold()))
    return out


def list_history(driver_id: int | None = None, vehicle_id: int | None = None, limit: int = 200) -> list[dict]:
    """Assignments, newest first (the open ones are the current ones)."""
    limit = max(1, min(int(limit or 200), HISTORY_MAX_LIMIT))
    where, params = [], []
    if driver_id is not None:
        where.append("driver_id = ?")
        params.append(driver_id)
    if vehicle_id is not None:
        where.append("vehicle_id = ?")
        params.append(vehicle_id)
    sql = ("SELECT * FROM fleet_assignments" + (f" WHERE {' AND '.join(where)}" if where else "")
           + " ORDER BY started_at DESC, id DESC LIMIT ?;")
    with _conn() as conn:
        return _rows(conn, sql, (*params, limit))


HISTORY_SORT_COLUMNS = ("started_at", "ended_at", "driver_name", "vehicle_plate", "kind", "reason", "end_reason")
HISTORY_STATES = ("open", "closed")


def history_page(driver_id: int | None = None, vehicle_id: int | None = None, kinds: list[str] | None = None,
                 states: list[str] | None = None, query: str = "", sort_by: str | None = None, sort_dir: str = "desc",
                 limit: int = 50, offset: int = 0, category: str | None = None) -> dict:
    """One page of assignments: {"items", "total"}. `kinds` (primary / temporary) and `states` (open = still driving /
    closed) filter; `query` matches the driver's name, the plate, the own-truck plate or a reason. Search and sort run
    in Python, accents and case ignored, so "Ngô" comes before "Nguyễn" and "Đặng" next to "Dũng" (SQLite compares
    bytes and its LOWER does not fold Vietnamese). Newest first unless `sort_by` is given; ties stay newest first.
    A still-open assignment counts as the latest end."""
    limit = max(1, min(int(limit or 50), HISTORY_MAX_LIMIT))
    offset = max(0, int(offset or 0))
    where, params = [], []
    if driver_id is not None:
        where.append("driver_id = ?")
        params.append(driver_id)
    if vehicle_id is not None:
        where.append("vehicle_id = ?")
        params.append(vehicle_id)
    if category in VEHICLE_CATEGORIES:
        # only the trucks of that category (the Đầu kéo / Xe tải tabs; a purged truck's rows have no vehicle any more)
        where.append("vehicle_id IN (SELECT id FROM fleet_vehicles WHERE category = ?)")
        params.append(category)
    clean_kinds = [k for k in (kinds or []) if k in ASSIGNMENT_KINDS]
    if clean_kinds:
        where.append(f"kind IN ({','.join('?' * len(clean_kinds))})")
        params.extend(clean_kinds)
    clean_states = {s for s in (states or []) if s in HISTORY_STATES}
    if len(clean_states) == 1:
        where.append("ended_at IS NULL" if "open" in clean_states else "ended_at IS NOT NULL")
    sql = ("SELECT * FROM fleet_assignments" + (f" WHERE {' AND '.join(where)}" if where else "")
           + " ORDER BY started_at DESC, id DESC;")
    with _conn() as conn:
        rows = _rows(conn, sql, tuple(params))
    needle = _fold(query)
    if needle:
        rows = [r for r in rows if any(needle in _fold(r[k]) for k in
                                       ("driver_name", "vehicle_plate", "home_vehicle_plate", "reason", "end_reason"))]
    if sort_by in HISTORY_SORT_COLUMNS:
        if sort_by in ("started_at", "ended_at"):
            key = (lambda r: r[sort_by] or "9999")
        else:
            key = (lambda r: (_fold(r[sort_by]), r[sort_by] or ""))
        rows = sorted(rows, key=key, reverse=(sort_dir or "").lower() != "asc")   # stable: ties stay newest first
    return {"items": rows[offset:offset + limit], "total": len(rows)}


def _fold(value) -> str:
    """Lowercase without Vietnamese accents ('Đặng Ân' -> 'dang an')."""
    import unicodedata
    text = unicodedata.normalize("NFD", str(value or "")).replace("đ", "d").replace("Đ", "D")
    return "".join(ch for ch in text if not unicodedata.combining(ch)).casefold().strip()


# ---------------------------------------------------------------------------
# Assignment moves (each called inside the caller's transaction)
# ---------------------------------------------------------------------------
def _close(conn, row: dict | None, end_reason: str, stamp: str) -> None:
    if row:
        conn.execute("UPDATE fleet_assignments SET ended_at = ?, end_reason = ? WHERE id = ?;",
                     (stamp, _text(end_reason), row["id"]))


def _open(conn, driver: dict, vehicle: dict, kind: str, reason: str, stamp: str) -> None:
    home_plate = ""
    if kind == "temporary" and driver.get("home_vehicle_id"):
        row = conn.execute("SELECT plate FROM fleet_vehicles WHERE id = ?;", (driver["home_vehicle_id"],)).fetchone()
        home_plate = row[0] if row else ""
    conn.execute(
        "INSERT INTO fleet_assignments (driver_id, vehicle_id, driver_name, vehicle_plate, kind, home_vehicle_plate, "
        "reason, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
        (driver["id"], vehicle["id"], driver["name"], vehicle["plate"], kind, home_plate, _text(reason), stamp))


def _settle_home(conn, driver: dict, stamp: str, reason: str = "") -> bool:
    """Put an idle, working driver back on their home truck when it can run and nobody else is on it."""
    if driver["status"] != "active" or not driver.get("home_vehicle_id") or _open_by_driver(conn, driver["id"]):
        return False
    vehicle = _vehicle(conn, driver["home_vehicle_id"])
    if vehicle["status"] != "active" or _open_by_vehicle(conn, vehicle["id"]):
        return False
    _open(conn, driver, vehicle, "primary", reason, stamp)
    return True


def set_home_vehicle(driver_id: int, vehicle_id: int | None, force: bool = False) -> dict:
    """Make `vehicle_id` the driver's home truck (None: no home truck). The driver moves onto it when it can run.

    Without `force` a truck that is another driver's home truck, or that someone else drives now, is refused (409,
    naming them); with `force` that driver loses the truck (and gets off it)."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        current = _open_by_driver(conn, driver_id)
        if vehicle_id is None:
            conn.execute("UPDATE fleet_drivers SET home_vehicle_id = NULL, updated_at = ? WHERE id = ?;",
                         (stamp, driver_id))
            if current and current["kind"] == "primary":
                _close(conn, current, "Bỏ gán xe cố định", stamp)
            return {"driver_id": driver_id, "vehicle_id": None}
        vehicle = _vehicle(conn, vehicle_id)
        if driver["status"] == "left":
            raise FleetError(f"{driver['name']} đã nghỉ việc, không gán xe được")
        other_home = _home_driver_of(conn, vehicle_id)
        if other_home and other_home["id"] != driver_id:
            if not force:
                raise FleetError(f"Xe {vehicle['plate']} đang là xe cố định của {other_home['name']}", 409)
            conn.execute("UPDATE fleet_drivers SET home_vehicle_id = NULL, updated_at = ? WHERE id = ?;",
                         (stamp, other_home["id"]))
        on_vehicle = _open_by_vehicle(conn, vehicle_id)
        if on_vehicle and on_vehicle["driver_id"] != driver_id:
            if not force:
                raise FleetError(f"Xe {vehicle['plate']} đang do {on_vehicle['driver_name']} lái", 409)
            _close(conn, on_vehicle, f"Xe giao cố định cho {driver['name']}", stamp)
        conn.execute("UPDATE fleet_drivers SET home_vehicle_id = ?, updated_at = ? WHERE id = ?;",
                     (vehicle_id, stamp, driver_id))
        driver["home_vehicle_id"] = vehicle_id
        if current and current["vehicle_id"] == vehicle_id:
            if current["kind"] != "primary":
                conn.execute("UPDATE fleet_assignments SET kind = 'primary', home_vehicle_plate = '' WHERE id = ?;",
                             (current["id"],))
        elif current and current["kind"] == "primary":
            # their old home truck is no longer theirs: get off it (a temporary move stays as it is)
            _close(conn, current, f"Đổi xe cố định sang {vehicle['plate']}", stamp)
            current = None
        if not current:
            _settle_home(conn, driver, stamp, "Gán xe cố định")
    return {"driver_id": driver_id, "vehicle_id": vehicle_id}


def move_temporary(driver_id: int, vehicle_id: int, reason: str = "") -> dict:
    """The driver takes another truck for now (their own is broken, in maintenance, ...)."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        vehicle = _vehicle(conn, vehicle_id)
        if driver["status"] != "active":
            raise FleetError(f"{driver['name']} đang {DRIVER_STATUS_LABELS.get(driver['status'], driver['status']).lower()}")
        if driver.get("home_vehicle_id") == vehicle_id:
            raise FleetError(f"Xe {vehicle['plate']} là xe gốc của {driver['name']}: dùng \"Trả về xe gốc\"")
        if vehicle["status"] != "active":
            raise FleetError(f"Xe {vehicle['plate']} đang {VEHICLE_STATUS_LABELS[vehicle['status']].lower()}", 409)
        on_vehicle = _open_by_vehicle(conn, vehicle_id)
        if on_vehicle and on_vehicle["driver_id"] != driver_id:
            raise FleetError(f"Xe {vehicle['plate']} đang do {on_vehicle['driver_name']} lái", 409)
        if on_vehicle:
            return {"driver_id": driver_id, "vehicle_id": vehicle_id}
        _close(conn, _open_by_driver(conn, driver_id), f"Chuyển tạm sang xe {vehicle['plate']}", stamp)
        _open(conn, driver, vehicle, "temporary", reason, stamp)
    return {"driver_id": driver_id, "vehicle_id": vehicle_id}


def return_home(driver_id: int) -> dict:
    """A driver on a temporary truck goes back to their home truck."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        if not driver.get("home_vehicle_id"):
            raise FleetError(f"{driver['name']} chưa có xe cố định")
        if driver["status"] != "active":
            raise FleetError(f"{driver['name']} đang {DRIVER_STATUS_LABELS.get(driver['status'], driver['status']).lower()}")
        home = _vehicle(conn, driver["home_vehicle_id"])
        if home["status"] != "active":
            raise FleetError(f"Xe gốc {home['plate']} vẫn đang {VEHICLE_STATUS_LABELS[home['status']].lower()}", 409)
        on_home = _open_by_vehicle(conn, home["id"])
        if on_home and on_home["driver_id"] != driver_id:
            raise FleetError(f"Xe gốc {home['plate']} đang do {on_home['driver_name']} lái tạm, hãy chuyển người đó trước",
                             409)
        if on_home:
            return {"driver_id": driver_id, "vehicle_id": home["id"]}
        _close(conn, _open_by_driver(conn, driver_id), f"Trả về xe gốc {home['plate']}", stamp)
        _open(conn, driver, home, "primary", "Trả về xe gốc", stamp)
    return {"driver_id": driver_id, "vehicle_id": home["id"]}


def unassign(driver_id: int, reason: str = "") -> dict:
    """The driver gets off whatever truck they drive (their home truck stays theirs)."""
    stamp = _now()
    with _conn() as conn:
        _driver(conn, driver_id)
        _close(conn, _open_by_driver(conn, driver_id), reason or "Cho xuống xe", stamp)
    return {"driver_id": driver_id, "vehicle_id": None}


def set_vehicle_status(vehicle_id: int, status: str, reason: str = "", move_to_vehicle_id: int | None = None,
                       bring_home_driver: bool = False) -> dict:
    """Change a truck's status in one step with what it means for its driver:
    - not running any more (broken / maintenance / inactive): the driver on it moves to `move_to_vehicle_id` for now,
      or gets off it when none is given;
    - running again: its home driver, when idle, gets back on it. A home driver away on a temporary truck comes back
      too with `bring_home_driver` ("Đã sửa xong") as long as nobody else is on the truck; otherwise they are left
      there and reported as `home_driver_away`, for the user to bring back with return_home().
    Returns {"vehicle_id", "status", "moved_driver", "home_driver_away", "returned_driver"}."""
    if status not in VEHICLE_STATUSES:
        raise FleetError(f"Trạng thái xe không hợp lệ: {status}")
    stamp = _now()
    moved, away, returned = None, None, None
    with _conn() as conn:
        vehicle = _vehicle(conn, vehicle_id)
        on_vehicle = _open_by_vehicle(conn, vehicle_id)
        target = None
        if move_to_vehicle_id is not None:
            if status == "active":
                raise FleetError("Chỉ chuyển tài xế sang xe khác khi xe không chạy được")
            if not on_vehicle:
                raise FleetError(f"Xe {vehicle['plate']} không có tài xế nào đang lái")
            if move_to_vehicle_id == vehicle_id:
                raise FleetError("Hãy chọn một xe khác")
            target = _vehicle(conn, move_to_vehicle_id)
            if target["status"] != "active":
                raise FleetError(f"Xe {target['plate']} đang {VEHICLE_STATUS_LABELS[target['status']].lower()}", 409)
            busy = _open_by_vehicle(conn, move_to_vehicle_id)
            if busy:
                raise FleetError(f"Xe {target['plate']} đang do {busy['driver_name']} lái", 409)
        conn.execute("UPDATE fleet_vehicles SET status = ?, updated_at = ? WHERE id = ?;", (status, stamp, vehicle_id))
        label = VEHICLE_STATUS_LABELS[status]
        why = f"Xe {vehicle['plate']} {label.lower()}" + (f": {_text(reason)}" if _text(reason) else "")
        if status != "active" and on_vehicle:
            driver = _driver(conn, on_vehicle["driver_id"])
            _close(conn, on_vehicle, why, stamp)
            if target:
                kind = "primary" if driver.get("home_vehicle_id") == target["id"] else "temporary"
                _open(conn, driver, target, kind, why, stamp)
            moved = {"id": driver["id"], "name": driver["name"], "to_vehicle_id": target["id"] if target else None,
                     "to_plate": target["plate"] if target else ""}
        if status == "active":
            home = _home_driver_of(conn, vehicle_id)
            if home and not _settle_home(conn, home, stamp, f"Xe {vehicle['plate']} chạy lại"):
                where = _open_by_driver(conn, home["id"])
                if where and where["vehicle_id"] != vehicle_id and home["status"] == "active":
                    if bring_home_driver and not _open_by_vehicle(conn, vehicle_id):
                        _close(conn, where, f"Trả về xe gốc {vehicle['plate']}", stamp)
                        _open(conn, home, vehicle, "primary", f"Xe {vehicle['plate']} sửa xong", stamp)
                        returned = {"id": home["id"], "name": home["name"], "from_plate": where["vehicle_plate"],
                                    "plate": vehicle["plate"]}
                    else:
                        away = {"id": home["id"], "name": home["name"], "plate": where["vehicle_plate"]}
    return {"vehicle_id": vehicle_id, "status": status, "moved_driver": moved, "home_driver_away": away,
            "returned_driver": returned}


# ---------------------------------------------------------------------------
# Trucks and drivers: create / edit / delete
# ---------------------------------------------------------------------------
# editable after creation (the category is not: see create_vehicle)
_VEHICLE_FIELDS = ("plate", "trailer_plate", "vehicle_type", "body_type", "payload", "registration_expiry",
                   "insurance_expiry", "status", "note")
_DRIVER_FIELDS = ("name", "phone", "id_number", "license_no", "license_class", "license_expiry", "status", "note")


def _clean_vehicle(data: dict, partial: bool) -> dict:
    out = {}
    if "plate" in data or not partial:
        plate = _text(data.get("plate"), 30)
        if not plate_key(plate):
            raise FleetError("Cần nhập biển số xe")
        out["plate"] = plate.upper()
    if "trailer_plate" in data or not partial:
        out["trailer_plate"] = _text(data.get("trailer_plate"), 30).upper()
    if "vehicle_type" in data or not partial:
        out["vehicle_type"] = _text(data.get("vehicle_type"), 60)
    if "body_type" in data or not partial:
        out["body_type"] = _text(data.get("body_type"), 60)
    if "payload" in data or not partial:
        out["payload"] = _text(data.get("payload"), 30)
    if "registration_expiry" in data or not partial:
        out["registration_expiry"] = _date(data.get("registration_expiry"), "Hạn đăng kiểm")
    if "insurance_expiry" in data or not partial:
        out["insurance_expiry"] = _date(data.get("insurance_expiry"), "Hạn bảo hiểm")
    if "note" in data or not partial:
        out["note"] = str(data.get("note") or "").strip()[:1000]
    if "status" in data or not partial:
        status = data.get("status") or "active"
        if status not in VEHICLE_STATUSES:
            raise FleetError(f"Trạng thái xe không hợp lệ: {status}")
        out["status"] = status
    return out


_IN_TRASH = "đang nằm trong thùng rác: hãy khôi phục xe đó hoặc xóa hẳn"


def _check_vehicle_unique(conn, fields: dict, exclude_id: int | None) -> None:
    """Plates stay unique across trucks in the trash too, so a restore never clashes."""
    if "plate" in fields:
        row = conn.execute("SELECT plate, deleted_at FROM fleet_vehicles WHERE plate_key = ? AND id != ?;",
                           (plate_key(fields["plate"]), exclude_id or -1)).fetchone()
        if row:
            raise FleetError(f"Biển số {row[0]} {_IN_TRASH}" if row[1] else f"Biển số {row[0]} đã có trong danh sách", 409)


def _category(value) -> str:
    category = value or "tractor"
    if category not in VEHICLE_CATEGORIES:
        raise FleetError(f"Loại xe không hợp lệ: {category}")
    return category


def create_vehicle(data: dict) -> int:
    """A new tractor (category "tractor", the default) or truck ("truck"). A tractor's "trailer_plate" hitches that
    trailer (made when it is new, see hitch_by_plate); a truck pulls none."""
    from backend.app.core.fleet_trailers import hitch_by_plate
    category = _category(data.get("category"))
    fields = _clean_vehicle(data, partial=False)
    if category == "truck" and fields["trailer_plate"]:
        raise FleetError("Xe tải không kéo moóc")
    stamp = _now()
    with _conn() as conn:
        _check_vehicle_unique(conn, fields, None)
        cur = conn.execute(
            "INSERT INTO fleet_vehicles (plate, plate_key, category, vehicle_type, body_type, payload, "
            "registration_expiry, insurance_expiry, status, note, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (fields["plate"], plate_key(fields["plate"]), category,
             fields["vehicle_type"], fields["body_type"], fields["payload"], fields["registration_expiry"],
             fields["insurance_expiry"], fields["status"], fields["note"], stamp, stamp))
        vehicle_id = cur.lastrowid
        if fields["trailer_plate"]:
            hitch_by_plate(conn, _vehicle(conn, vehicle_id), fields["trailer_plate"], stamp)
        return vehicle_id


def update_vehicle(vehicle_id: int, data: dict) -> None:
    """Edit a truck's details. A status change goes through set_vehicle_status() (it moves drivers), not here."""
    from backend.app.core.fleet_trailers import hitch_by_plate
    fields = _clean_vehicle({k: v for k, v in data.items() if k in _VEHICLE_FIELDS and k != "status"}, partial=True)
    trailer_plate = fields.pop("trailer_plate", None)
    stamp = _now()
    with _conn() as conn:
        if _vehicle(conn, vehicle_id)["category"] == "truck":
            if trailer_plate:
                raise FleetError("Xe tải không kéo moóc")
            trailer_plate = None
        _check_vehicle_unique(conn, fields, vehicle_id)
        if "plate" in fields:
            fields["plate_key"] = plate_key(fields["plate"])
            conn.execute("UPDATE fleet_trailer_hitches SET vehicle_plate = ? WHERE vehicle_id = ? AND ended_at IS NULL;",
                         (fields["plate"], vehicle_id))
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE fleet_vehicles SET {sets}, updated_at = ? WHERE id = ?;",
                         (*fields.values(), stamp, vehicle_id))
        if trailer_plate is not None:
            hitch_by_plate(conn, _vehicle(conn, vehicle_id), trailer_plate, stamp)
    if "status" in data and data["status"] is not None:
        with _conn() as conn:
            current = _vehicle(conn, vehicle_id)["status"]
        if data["status"] != current:
            set_vehicle_status(vehicle_id, data["status"])


def delete_vehicle(vehicle_id: int) -> None:
    """Move a truck to the trash. Its driver gets off it, its home driver loses it and its trailer comes off (a free
    trailer again); the history keeps its plate."""
    from backend.app.core.fleet_trailers import release_vehicle
    stamp = _now()
    with _conn() as conn:
        vehicle = _vehicle(conn, vehicle_id)
        _close(conn, _open_by_vehicle(conn, vehicle_id), f"Xóa xe {vehicle['plate']}", stamp)
        release_vehicle(conn, vehicle, f"Xóa xe {vehicle['plate']}", stamp)
        conn.execute("UPDATE fleet_drivers SET home_vehicle_id = NULL, updated_at = ? WHERE home_vehicle_id = ?;",
                     (stamp, vehicle_id))
        conn.execute("UPDATE fleet_vehicles SET deleted_at = ? WHERE id = ?;", (stamp, vehicle_id))


def _clean_driver(data: dict, partial: bool) -> dict:
    out = {}
    if "name" in data or not partial:
        name = _text(data.get("name"), 120)
        if not name:
            raise FleetError("Cần nhập tên tài xế")
        out["name"] = name
    for key, limit in (("phone", 40), ("id_number", 30), ("license_no", 40), ("license_class", 20)):
        if key in data or not partial:
            out[key] = _text(data.get(key), limit)
    if "license_class" in out:
        out["license_class"] = out["license_class"].upper()
    if "license_expiry" in data or not partial:
        out["license_expiry"] = _date(data.get("license_expiry"), "Hạn bằng lái")
    if "note" in data or not partial:
        out["note"] = str(data.get("note") or "").strip()[:1000]
    if "status" in data or not partial:
        status = data.get("status") or "active"
        if status not in DRIVER_STATUSES:
            raise FleetError(f"Trạng thái tài xế không hợp lệ: {status}")
        out["status"] = status
    return out


def create_driver(data: dict) -> int:
    fields = _clean_driver(data, partial=False)
    stamp = _now()
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO fleet_drivers (name, phone, id_number, license_no, license_class, license_expiry, status, note, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (fields["name"], fields["phone"], fields["id_number"], fields["license_no"], fields["license_class"],
             fields["license_expiry"], fields["status"], fields["note"], stamp, stamp))
        driver_id = cur.lastrowid
    vehicle_id = data.get("home_vehicle_id")
    if vehicle_id:
        try:
            set_home_vehicle(driver_id, int(vehicle_id))
        except FleetError:
            with _conn() as conn:
                conn.execute("DELETE FROM fleet_drivers WHERE id = ?;", (driver_id,))
            raise
    return driver_id


def update_driver(driver_id: int, data: dict) -> None:
    """Edit a driver. Going on leave gets them off their truck; quitting also gives up their home truck; coming back
    to work puts them on their home truck when it is free and running."""
    fields = _clean_driver({k: v for k, v in data.items() if k in _DRIVER_FIELDS}, partial=True)
    stamp = _now()
    with _conn() as conn:
        before = _driver(conn, driver_id)
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE fleet_drivers SET {sets}, updated_at = ? WHERE id = ?;",
                         (*fields.values(), stamp, driver_id))
        if "name" in fields and fields["name"] != before["name"]:
            conn.execute("UPDATE fleet_assignments SET driver_name = ? WHERE driver_id = ? AND ended_at IS NULL;",
                         (fields["name"], driver_id))
        status = fields.get("status", before["status"])
        if status != before["status"]:
            label = DRIVER_STATUS_LABELS[status]
            if status != "active":
                _close(conn, _open_by_driver(conn, driver_id), label, stamp)
            if status == "left":
                conn.execute("UPDATE fleet_drivers SET home_vehicle_id = NULL WHERE id = ?;", (driver_id,))
            if status == "active":
                _settle_home(conn, _driver(conn, driver_id), stamp, "Đi làm lại")


def delete_driver(driver_id: int) -> None:
    """Move a driver to the trash: off their truck and without an own truck (it is free for someone else)."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        _close(conn, _open_by_driver(conn, driver_id), f"Xóa tài xế {driver['name']}", stamp)
        conn.execute("UPDATE fleet_drivers SET deleted_at = ?, home_vehicle_id = NULL WHERE id = ?;", (stamp, driver_id))


# ---------------------------------------------------------------------------
# Trash: deleted trucks / drivers wait TRASH_KEEP_DAYS days (photos kept) before being purged
# ---------------------------------------------------------------------------
TRASH_ENTITIES = {"vehicle": "fleet_vehicles", "truck": "fleet_vehicles", "driver": "fleet_drivers",
                  "trailer": "fleet_trailers"}
# kinds sharing a table: which of its rows they are ("vehicle" = the tractors)
_TRASH_WHERE = {"vehicle": "category = 'tractor'", "truck": "category = 'truck'"}


def _keep_days() -> int:
    from backend.app.core.database import TRASH_KEEP_DAYS
    return TRASH_KEEP_DAYS


def _trash_table(kind: str) -> tuple[str, str]:
    """(table, the SQL condition picking the kind's rows)"""
    if kind not in TRASH_ENTITIES:
        raise FleetError(f"Loại không hợp lệ: {kind}")
    return TRASH_ENTITIES[kind], _TRASH_WHERE.get(kind, "1 = 1")


def _clean_ids(ids) -> list[int]:
    out = []
    for i in ids or []:
        try:
            out.append(int(i))
        except (TypeError, ValueError):
            continue
    return sorted(set(out))


def trash_page(kind: str, limit: int = 50, offset: int = 0) -> dict:
    """{"items", "total", "keep_days"}: the kind's rows in the trash, last deleted first, each with "deleted_at",
    "purge_at" and "days_left" (whole days before it is deleted for good)."""
    table, which = _trash_table(kind)
    keep = _keep_days()
    limit = max(1, min(int(limit or 50), HISTORY_MAX_LIMIT))
    offset = max(0, int(offset or 0))
    now = datetime.now(VN_TZ).replace(tzinfo=None)
    with _conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE deleted_at IS NOT NULL AND {which};").fetchone()[0]
        rows = _rows(conn, f"SELECT * FROM {table} WHERE deleted_at IS NOT NULL AND {which} "
                           "ORDER BY deleted_at DESC, id DESC "
                           "LIMIT ? OFFSET ?;", (limit, offset))
    for r in rows:
        purge = datetime.strptime(r["deleted_at"], "%Y-%m-%d %H:%M:%S") + timedelta(days=keep)
        r["purge_at"] = purge.strftime("%Y-%m-%d %H:%M:%S")
        r["days_left"] = max(0, (purge - now).days)
    return {"items": rows, "total": total, "keep_days": keep}


def trash_ids(kind: str) -> list[int]:
    table, which = _trash_table(kind)
    with _conn() as conn:
        return [r[0] for r in conn.execute(f"SELECT id FROM {table} WHERE deleted_at IS NOT NULL AND {which} "
                                           "ORDER BY id;")]


def trash_count() -> dict:
    with _conn() as conn:
        return {kind: conn.execute(f"SELECT COUNT(*) FROM {table} WHERE deleted_at IS NOT NULL AND {which};")
                .fetchone()[0] for kind, (table, which) in ((k, _trash_table(k)) for k in TRASH_ENTITIES)}


def restore_from_trash(kind: str, ids) -> int:
    """Back out of the trash, as they were but without a truck / driver (those links were let go on delete)."""
    table, which = _trash_table(kind)
    clean = _clean_ids(ids)
    if not clean:
        return 0
    stamp = _now()
    with _conn() as conn:
        cur = conn.execute(f"UPDATE {table} SET deleted_at = NULL, updated_at = ? WHERE deleted_at IS NOT NULL "
                           f"AND {which} AND id IN ({','.join('?' * len(clean))});", (stamp, *clean))
        return max(cur.rowcount, 0)


def _purge(conn, table: str, where: str, params: tuple) -> int:
    images = ", ".join(IMAGE_COLUMNS[table])
    rows = conn.execute(f"SELECT id, {images} FROM {table} WHERE deleted_at IS NOT NULL AND {where};", params).fetchall()
    if not rows:
        return 0
    conn.execute(f"DELETE FROM {table} WHERE id IN ({','.join('?' * len(rows))});", tuple(r[0] for r in rows))
    for _, *names in rows:
        for name in names:
            _delete_photo_file(name)
    return len(rows)


def delete_from_trash(kind: str, ids) -> int:
    """Delete for good (photo included). The assignment history keeps their name / plate."""
    table, which = _trash_table(kind)
    clean = _clean_ids(ids)
    if not clean:
        return 0
    with _conn() as conn:
        return _purge(conn, table, f"{which} AND id IN ({','.join('?' * len(clean))})", tuple(clean))


def purge_expired_trash() -> int:
    """Delete for good the trucks / drivers in the trash longer than TRASH_KEEP_DAYS days."""
    cutoff = (datetime.now(VN_TZ) - timedelta(days=_keep_days())).strftime("%Y-%m-%d %H:%M:%S")
    total = 0
    with _conn() as conn:
        for table in sorted(set(TRASH_ENTITIES.values())):
            total += _purge(conn, table, "deleted_at < ?", (cutoff,))
    if total:
        logger.info(f"Purged {total} truck(s) / driver(s) from the fleet trash")
    return total


# ---------------------------------------------------------------------------
# Photos
# ---------------------------------------------------------------------------
def photo_dir() -> Path:
    """Next to the database, so photos follow the user's data folder (and tests' throwaway databases)."""
    from backend.app.core.database import get_db_path
    return Path(os.path.dirname(os.path.abspath(get_db_path()))) / "fleet_photos"


def photo_path(name: str) -> Path | None:
    """The stored photo called `name`, or None (unknown, or not a name this module makes)."""
    if not _PHOTO_NAME.match(name or ""):
        return None
    path = photo_dir() / name
    return path if path.is_file() else None


def _delete_photo_file(name) -> None:
    if name and _PHOTO_NAME.match(name):
        try:
            (photo_dir() / name).unlink(missing_ok=True)
        except OSError:
            logger.warning(f"Could not delete fleet photo {name}")


def _to_jpeg(data: bytes, max_side: int = PHOTO_MAX_SIDE, quality: int = 85) -> bytes:
    from PIL import Image, ImageOps, UnidentifiedImageError
    if not data:
        raise FleetError("Ảnh trống")
    if len(data) > PHOTO_MAX_BYTES:
        raise FleetError(f"Ảnh quá lớn (tối đa {PHOTO_MAX_BYTES // (1024 * 1024)} MB)")
    head = data[:32]
    if any(brand in head for brand in (b"ftypheic", b"ftypheix", b"ftyphevc", b"ftypmif1", b"ftypheif")):
        raise FleetError("Ảnh HEIC chưa hỗ trợ: hãy chọn ảnh JPG hoặc PNG")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise FleetError("File không phải ảnh hoặc ảnh bị hỏng (cần JPG, PNG, WEBP)")
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=quality, optimize=True)
    return out.getvalue()


def _store_image(entity: str, entity_id: int, column: str, jpeg: bytes) -> str:
    """Write `jpeg` into the row's image `column`, replacing (and deleting) the old file. Every image gets a new name,
    so a browser never shows the old one from its cache. Returns the new name."""
    table = PHOTO_ENTITIES[entity]
    with _conn() as conn:
        row = conn.execute(f"SELECT {column} FROM {table} WHERE id = ? AND deleted_at IS NULL;", (entity_id,)).fetchone()
        if not row:
            raise FleetError(_NOT_FOUND[entity], 404)
        old = row[0]
        tag = "" if column == "photo" else f"{column}_"
        name = f"{entity}_{entity_id}_{tag}{secrets.token_hex(4)}.jpg"
        folder = photo_dir()
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(jpeg)
        conn.execute(f"UPDATE {table} SET {column} = ?, updated_at = ? WHERE id = ?;", (name, _now(), entity_id))
    _delete_photo_file(old)
    return name


def _clear_image(entity: str, entity_id: int, column: str) -> None:
    table = PHOTO_ENTITIES[entity]
    with _conn() as conn:
        row = conn.execute(f"SELECT {column} FROM {table} WHERE id = ? AND deleted_at IS NULL;", (entity_id,)).fetchone()
        if not row:
            raise FleetError(_NOT_FOUND[entity], 404)
        conn.execute(f"UPDATE {table} SET {column} = '', updated_at = ? WHERE id = ?;", (_now(), entity_id))
    _delete_photo_file(row[0])


def set_photo(entity: str, entity_id: int, data: bytes) -> str:
    """Store `data` (any image Pillow reads) as the truck's / driver's / trailer's photo. Returns the new name."""
    return _store_image(entity, entity_id, "photo", _to_jpeg(data))


def remove_photo(entity: str, entity_id: int) -> None:
    _clear_image(entity, entity_id, "photo")


def _document_column(entity: str, which: str) -> str:
    if which not in DOCUMENTS[entity]:
        raise FleetError(f"Loại giấy tờ không hợp lệ: {which}")
    return which


def set_document(entity: str, entity_id: int, which: str, data: bytes) -> str:
    """Store a scan of a driver's / truck's papers (`which`: one of DOCUMENTS[entity]), kept larger than a photo so
    its text stays readable. Returns the new name."""
    column = _document_column(entity, which)
    return _store_image(entity, entity_id, column, _to_jpeg(data, DOCUMENT_MAX_SIDE, 90))


def remove_document(entity: str, entity_id: int, which: str) -> None:
    _clear_image(entity, entity_id, _document_column(entity, which))


def set_driver_document(driver_id: int, which: str, data: bytes) -> str:
    return set_document("driver", driver_id, which, data)


def remove_driver_document(driver_id: int, which: str) -> None:
    remove_document("driver", driver_id, which)


# ---------------------------------------------------------------------------
# Expiry reminders
# ---------------------------------------------------------------------------
def expiring_documents(today: date, within_days: int = EXPIRY_REMINDER_DAYS[0]) -> list[dict]:
    """Documents expiring within `within_days` days or already expired, soonest first:
    [{"kind", "label", "entity", "entity_id", "subject", "expiry" (YYYY-MM-DD), "days_left"}]. Trucks / trailers that no
    longer run (inactive) and drivers who quit are left out."""
    out = []
    with _conn() as conn:
        for table, column, kind, label in EXPIRY_FIELDS:
            entity, name_col, skip, tab = EXPIRY_ENTITIES[table]
            category = "category" if table == "fleet_vehicles" else "''"
            for row_id, subject, expiry, cat in conn.execute(
                    f"SELECT id, {name_col}, {column}, {category} FROM {table} WHERE {column} != '' AND status != ? "
                    "AND deleted_at IS NULL;", (skip,)):
                try:
                    left = (date.fromisoformat(expiry) - today).days
                except ValueError:
                    continue
                if left <= within_days:
                    out.append({"kind": kind, "label": label, "entity": entity, "entity_id": row_id,
                                "subject": subject, "expiry": expiry, "days_left": left,
                                "tab": CATEGORY_TABS.get(cat, tab)})
    out.sort(key=lambda r: (r["days_left"], r["subject"]))
    return out


def _doc_tab(doc: dict) -> str:
    """The app tab listing the document's truck / driver / trailer."""
    return doc.get("tab") or next(tab for entity, _, _, tab in EXPIRY_ENTITIES.values() if entity == doc["entity"])


def _days_text(days_left: int) -> str:
    if days_left < 0:
        return f"quá hạn {-days_left} ngày"
    if days_left == 0:
        return "hết hạn hôm nay"
    return f"còn {days_left} ngày"


def scan_expiry_reminders(now: datetime | None = None) -> int:
    """Remind of truck registrations / insurance and driving licences expiring within 30 days, again at 7 days and
    once expired. Only the tightest threshold crossed is sent, once per document, expiry date and threshold (a new
    date re-arms it). Everything found in one pass shares ONE notification. Returns 1 when one was sent, else 0."""
    from backend.app.core import database as db
    from backend.app.services import change_detection as cd
    if cd.FLEET_EXPIRY not in db.get_notification_settings()["kinds"]:
        return 0
    now = (now or datetime.now(VN_TZ)).astimezone(VN_TZ)
    today = now.date()
    stamp_now = now.replace(tzinfo=None)
    stamp = stamp_now.strftime("%Y-%m-%d %H:%M:%S")
    due = []
    with _conn() as conn:
        for doc in expiring_documents(today):
            threshold = min(t for t in EXPIRY_REMINDER_DAYS if doc["days_left"] <= t)
            key = f"{doc['entity']}|{doc['entity_id']}|{doc['kind']}"
            if conn.execute("SELECT 1 FROM fleet_reminders WHERE entity_key = ? AND expiry = ? AND threshold = ?;",
                            (key, doc["expiry"], threshold)).fetchone():
                continue
            due.append((key, threshold, doc))
        if not due:
            return 0
        docs = [d for _, _, d in due]
        first = docs[0]
        expired = sum(1 for d in docs if d["days_left"] < 0)
        if len(docs) == 1:
            title = f"{first['label']} {first['subject']} {_days_text(first['days_left'])}"
        else:
            title = f"{len(docs)} giấy tờ xe / tài xế sắp hết hạn"
        summary = "; ".join(f"{d['label']} {d['subject']}: {_days_text(d['days_left'])}" for d in docs[:3])
        if len(docs) > 3:
            summary += f" … (+{len(docs) - 3})"
        db._insert_notification(conn, None, {
            "kind": cd.FLEET_EXPIRY,
            "entity_key": f"fleet_expiry|{stamp}",
            "title": title, "old": "", "new": summary,
            "nav_tab": _doc_tab(first) if len(docs) == 1 else "fleet", "nav_query": first["subject"] if len(docs) == 1 else None,
            "detail": {"count": len(docs), "expired": expired,
                       "documents": [{**d, "expiry": date.fromisoformat(d["expiry"]).strftime("%d/%m/%Y")}
                                 for d in docs[:EXPIRY_LIST_LIMIT]]},
        }, db.NOTIFY_SOURCE_AUTO, stamp)
        conn.executemany("INSERT OR IGNORE INTO fleet_reminders (entity_key, expiry, threshold, sent_at) "
                         "VALUES (?, ?, ?, ?);", [(key, d["expiry"], t, stamp) for key, t, d in due])
        # reminders of dates long gone (renewed documents) hold nothing back any more
        conn.execute("DELETE FROM fleet_reminders WHERE expiry < ?;", ((today - timedelta(days=400)).isoformat(),))
        db._trim_notifications(conn, stamp_now)
    logger.info(f"Fleet expiry reminder sent for {len(docs)} document(s)")
    return 1
