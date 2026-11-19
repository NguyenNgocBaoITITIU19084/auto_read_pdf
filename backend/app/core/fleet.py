"""Fleet: trucks, drivers, and who drives which truck. Trailers (rơ moóc) and which tractor pulls which
are in fleet_trailers.py.

A truck (`fleet_vehicles` row) is a tractor (đầu kéo, `category` 'tractor', pulls a trailer) or a rigid truck (xe tải,
'truck', carries its own load: `body_type`, `payload`, never a trailer). Both have drivers, papers, trash and reminders
alike; the category is set when the truck is made and does not change.

Fleet data is the company's, not a collection's: nothing here is scoped by collection.

A driver drives at most one truck at a time, and a truck has at most one driver. Who drives what is the open row
(ended_at IS NULL) of `fleet_assignments`; closed rows are the history. Partial unique indexes keep one open row per
driver and per truck, so every move closes the old row before it opens the new one, inside one transaction.
(There is no "own truck" any more: `fleet_drivers.home_vehicle_id` and the `kind` / `home_vehicle_plate` columns of
old assignment rows are left in the database, unused.)

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

VEHICLE_STATUSES = ("ready", "active", "not_ready", "broken", "maintenance", "inactive")
VEHICLE_STATUS_LABELS = {"ready": "Sẵn sàng", "active": "Đang chạy", "not_ready": "Không sẵn sàng", "broken": "Hư hỏng",
                         "maintenance": "Bảo dưỡng", "inactive": "Ngưng hoạt động"}
# the statuses a truck / trailer can run in (the rest stop it: its driver gets off, a trailer comes off its tractor).
# Which of the two is not picked by hand but follows use (see _sync_running / fleet_trailers._sync_trailer): a truck
# with a driver is "active" (Đang chạy), without one "ready" (Sẵn sàng); a trailer on a tractor is "active" (Đang dùng),
# a free one "ready".
RUNNING_STATUSES = ("ready", "active")
# Papers whose expiry locks a truck / trailer in "not_ready" (Không sẵn sàng): (column, label). Expired = the date is
# before today. While one is expired only these statuses can be picked; "inactive" (out of service) is never forced.
PAPER_EXPIRIES = (("ownership_expiry", "Đăng ký"), ("registration_expiry", "Đăng kiểm"), ("insurance_expiry", "Bảo hiểm"))
LOCK_FREE_STATUSES = ("not_ready", "inactive")
DRIVER_STATUSES = ("active", "not_ready", "leave", "left")
DRIVER_STATUS_LABELS = {"active": "Đang làm", "not_ready": "Không sẵn sàng", "leave": "Nghỉ phép", "left": "Đã nghỉ việc"}
# A driver whose licence has expired (the date is before today) is "not_ready", off their truck; while it is expired
# only these can be picked. Someone on leave or who quit is not driving anyway: never forced.
DRIVER_LOCK_FREE_STATUSES = ("not_ready", "leave", "left")
ASSIGNMENT_KINDS = ("primary", "temporary")
# Licence classes (hạng bằng lái) that may drive each category. A tractor pulling a semi-trailer needs FC (before
# 2025) or CE (Luật TTATGTĐB 2024). A truck takes a class covering hạng C: C1 / C (new), C1E / CE, and the old FC, E,
# FD, FE. "D" is left out: the old D covered C but the new one does not. Mirrored in frontend fleetUtils.ts.
LICENSE_CLASSES_FOR = {"tractor": ("FC", "CE"), "truck": ("C1", "C", "C1E", "CE", "FC", "E", "FD", "FE")}
VEHICLE_CATEGORIES = ("tractor", "truck")
# the app tab listing each category
CATEGORY_TABS = {"tractor": "fleet", "truck": "trucks"}

# Days before a document expires when it is reminded of (0 = it has expired); only the tightest one crossed is sent
EXPIRY_REMINDER_DAYS = (30, 7, 0)
EXPIRY_FIELDS = (
    # (table, column, kind, label)
    ("fleet_vehicles", "ownership_expiry", "ownership", "Đăng ký xe"),
    ("fleet_vehicles", "registration_expiry", "registration", "Đăng kiểm"),
    ("fleet_vehicles", "insurance_expiry", "insurance", "Bảo hiểm"),
    ("fleet_drivers", "license_expiry", "license", "Bằng lái"),
    ("fleet_trailers", "ownership_expiry", "trailer_ownership", "Đăng ký moóc"),
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
# ... and of a trailer's: the same three papers as a truck's
TRAILER_DOCUMENTS = VEHICLE_DOCUMENTS
DOCUMENTS = {"driver": DRIVER_DOCUMENTS, "vehicle": VEHICLE_DOCUMENTS, "trailer": TRAILER_DOCUMENTS}
# the image columns of each table (all deleted with the row when it is purged)
IMAGE_COLUMNS = {"fleet_vehicles": ("photo", *VEHICLE_DOCUMENTS), "fleet_drivers": ("photo", *DRIVER_DOCUMENTS),
                 "fleet_trailers": ("photo", *TRAILER_DOCUMENTS)}
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
    from backend.app.core.fleet_trailers import create_trailer_tables, migrate_trailer_plates, refresh_all_holds
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
    # trailer_hold_status: the tractor's own status while a stopped trailer holds it in not_ready ('' = not held)
    for column, default in (("category", "tractor"), ("body_type", ""), ("payload", ""), ("trailer_hold_status", "")):
        if column not in have:
            conn.execute(f"ALTER TABLE fleet_vehicles ADD COLUMN {column} TEXT NOT NULL DEFAULT '{default}';")
    # Hạn đăng ký, and whether the status was forced to not_ready by expired papers (1: it comes back to "ready" once
    # they are renewed; a not_ready picked by hand stays)
    for table in ("fleet_vehicles", "fleet_trailers", "fleet_drivers"):
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table});")}
        if "ownership_expiry" not in have and table != "fleet_drivers":
            conn.execute(f"ALTER TABLE {table} ADD COLUMN ownership_expiry TEXT NOT NULL DEFAULT '';")
        if "status_forced" not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN status_forced INTEGER NOT NULL DEFAULT 0;")
    for table, documents in (("fleet_drivers", DRIVER_DOCUMENTS), ("fleet_vehicles", VEHICLE_DOCUMENTS),
                             ("fleet_trailers", TRAILER_DOCUMENTS)):
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
    # tractors pulling a trailer that cannot run are held in not_ready (and let go once it can)
    refresh_all_holds(conn)
    # Sẵn sàng / Đang chạy follow whether a truck is driven (a trailer: hitched)
    sync_all_running(conn)


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


def list_vehicles() -> list[dict]:
    """Every truck with whoever drives it now."""
    with _conn() as conn:
        vehicles = _rows(conn, "SELECT * FROM fleet_vehicles WHERE deleted_at IS NULL;")
        current = {r["vehicle_id"]: r for r in _rows(conn, """
            SELECT a.vehicle_id, a.driver_id, a.started_at, a.reason, d.name, d.phone, d.photo, d.license_class,
                   d.license_no, d.license_expiry
            FROM fleet_assignments a JOIN fleet_drivers d ON d.id = a.driver_id
            WHERE a.ended_at IS NULL;""")}
        pulled = {r["vehicle_id"]: r for r in _rows(conn, """
            SELECT h.vehicle_id, h.trailer_id, h.started_at, t.plate, t.status
            FROM fleet_trailer_hitches h JOIN fleet_trailers t ON t.id = h.trailer_id
            WHERE h.ended_at IS NULL;""")}
    out = []
    for v in vehicles:
        c = current.get(v["id"])
        h = pulled.get(v["id"])
        item = {k: v[k] for k in ("id", "plate", "category", "trailer_plate", "vehicle_type", "body_type", "payload",
                                  "ownership_expiry", "registration_expiry", "status_forced",
                                  "insurance_expiry", "status", "note", "photo", *VEHICLE_DOCUMENTS,
                                  "trailer_hold_status", "created_at", "updated_at")}
        item["trailer"] = ({"id": h["trailer_id"], "plate": h["plate"], "status": h["status"], "since": h["started_at"]}
                           if h else None)
        item["current_driver"] = ({"id": c["driver_id"], "name": c["name"], "phone": c["phone"], "photo": c["photo"],
                                   "since": c["started_at"], "reason": c["reason"], "license_class": c["license_class"],
                                   "license_no": c["license_no"], "license_expiry": c["license_expiry"]}
                                  if c else None)
        out.append(item)
    out.sort(key=lambda r: plate_key(r["plate"]))
    return out


def list_drivers() -> list[dict]:
    """Every driver with the truck they drive now."""
    with _conn() as conn:
        drivers = _rows(conn, "SELECT * FROM fleet_drivers WHERE deleted_at IS NULL;")
        current = {r["driver_id"]: r for r in _rows(conn, """
            SELECT a.driver_id, a.vehicle_id, a.started_at, a.reason, v.plate, v.trailer_plate, v.photo, v.category
            FROM fleet_assignments a JOIN fleet_vehicles v ON v.id = a.vehicle_id
            WHERE a.ended_at IS NULL;""")}
    out = []
    for d in drivers:
        c = current.get(d["id"])
        item = {k: d[k] for k in ("id", "name", "phone", "id_number", "license_no", "license_class",
                                  "license_expiry", "status", "status_forced", "note", "photo", *DRIVER_DOCUMENTS,
                                  "created_at", "updated_at")}
        item["current_vehicle"] = ({"id": c["vehicle_id"], "plate": c["plate"], "trailer_plate": c["trailer_plate"],
                                    "photo": c["photo"], "category": c["category"],
                                    "since": c["started_at"], "reason": c["reason"]} if c else None)
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
        _sync_running(conn, row["vehicle_id"])


def _open(conn, driver: dict, vehicle: dict, reason: str, stamp: str) -> None:
    conn.execute(
        "INSERT INTO fleet_assignments (driver_id, vehicle_id, driver_name, vehicle_plate, kind, home_vehicle_plate, "
        "reason, started_at) VALUES (?, ?, ?, ?, 'primary', '', ?, ?);",
        (driver["id"], vehicle["id"], driver["name"], vehicle["plate"], _text(reason), stamp))
    _sync_running(conn, vehicle["id"])


def license_classes(value) -> set[str]:
    """The classes written in a driver's "Hạng bằng" ("B2, FC", "fc" ...), upper case."""
    return {c for c in re.split(r"[^0-9A-Za-z]+", str(value or "").upper()) if c}


def license_allows(license_class, category: str) -> bool:
    """The driver's licence classes include one that may drive this category of truck (an empty one never does)."""
    return bool(license_classes(license_class) & set(LICENSE_CLASSES_FOR.get(category, ())))


def _check_license(driver: dict, vehicle: dict) -> None:
    """409 when the driver's licence may not drive the truck (an expired one is refused by the status check)."""
    if license_allows(driver.get("license_class"), vehicle.get("category") or "tractor"):
        return
    need = "/".join(LICENSE_CLASSES_FOR[vehicle.get("category") or "tractor"])
    kind = "đầu kéo" if (vehicle.get("category") or "tractor") == "tractor" else "xe tải"
    have = f"bằng {driver['license_class']}" if (driver.get("license_class") or "").strip() else "chưa nhập hạng bằng"
    raise FleetError(f"{driver['name']} ({have}) không được lái {kind} {vehicle['plate']}: cần bằng {need}", 409)


def _sync_running(conn, vehicle_id: int | None) -> None:
    """A truck that can run is "active" (Đang chạy) with a driver on it, "ready" (Sẵn sàng) without; a stopped one is
    left alone."""
    if vehicle_id is None:
        return
    row = conn.execute("SELECT status FROM fleet_vehicles WHERE id = ?;", (vehicle_id,)).fetchone()
    if not row or row[0] not in RUNNING_STATUSES:
        return
    want = "active" if _open_by_vehicle(conn, vehicle_id) else "ready"
    if row[0] != want:
        conn.execute("UPDATE fleet_vehicles SET status = ?, updated_at = ? WHERE id = ?;", (want, _now(), vehicle_id))


def sync_all_running(conn) -> None:
    """Every truck's and trailer's Sẵn sàng / Đang chạy (Đang dùng), on start (they were picked by hand before)."""
    from backend.app.core.fleet_trailers import _sync_trailer
    for (vehicle_id,) in conn.execute("SELECT id FROM fleet_vehicles WHERE deleted_at IS NULL;").fetchall():
        _sync_running(conn, vehicle_id)
    for (trailer_id,) in conn.execute("SELECT id FROM fleet_trailers WHERE deleted_at IS NULL;").fetchall():
        _sync_trailer(conn, trailer_id)


def _check_free_running(conn, vehicle: dict, driver_id: int | None = None) -> None:
    """A truck a driver can be put on: it can run, and nobody else drives it (409 otherwise)."""
    if vehicle["status"] not in RUNNING_STATUSES:
        raise FleetError(f"Xe {vehicle['plate']} đang {VEHICLE_STATUS_LABELS[vehicle['status']].lower()}: không giao được",
                         409)
    on_vehicle = _open_by_vehicle(conn, vehicle["id"])
    if on_vehicle and on_vehicle["driver_id"] != driver_id:
        raise FleetError(f"Xe {vehicle['plate']} đang do {on_vehicle['driver_name']} lái: thu hồi xe trước khi giao", 409)


def assign_vehicle(driver_id: int, vehicle_id: int, reason: str = "") -> dict:
    """Giao xe / Đổi xe: put a working driver on a free truck that can run. A driver on another truck leaves it."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        vehicle = _vehicle(conn, vehicle_id)
        if driver["status"] != "active":
            raise FleetError(f"{driver['name']} đang {DRIVER_STATUS_LABELS.get(driver['status'], driver['status']).lower()}:"
                             " không giao xe được", 409)
        _check_free_running(conn, vehicle, driver_id)
        _check_license(driver, vehicle)
        current = _open_by_driver(conn, driver_id)
        if current and current["vehicle_id"] == vehicle_id:
            return {"driver_id": driver_id, "vehicle_id": vehicle_id}
        _close(conn, current, f"Đổi sang xe {vehicle['plate']}", stamp)
        _open(conn, driver, vehicle, reason or "Giao xe", stamp)
    return {"driver_id": driver_id, "vehicle_id": vehicle_id}


def unassign(driver_id: int, reason: str = "") -> dict:
    """The driver gets off whatever truck they drive."""
    stamp = _now()
    with _conn() as conn:
        _driver(conn, driver_id)
        _close(conn, _open_by_driver(conn, driver_id), reason or "Cho xuống xe", stamp)
    return {"driver_id": driver_id, "vehicle_id": None}


def revoke_vehicle(driver_id: int, reason: str = "") -> dict:
    """Thu hồi xe: the driver gets off the truck they drive; it is then free for "Giao xe" to someone else."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        current = _open_by_driver(conn, driver_id)
        if not current:
            raise FleetError(f"{driver['name']} chưa có xe để thu hồi")
        _close(conn, current, reason or "Thu hồi xe", stamp)
    return {"driver_id": driver_id, "vehicle_id": None}


def set_vehicle_status(vehicle_id: int, status: str, reason: str = "", move_to_vehicle_id: int | None = None,
                       forced: bool = False) -> dict:
    """Change a truck's status in one step with what it means for its driver: when it stops running (not_ready /
    broken / maintenance / inactive) the driver on it moves to `move_to_vehicle_id`, or gets off it when none is
    given. Running again changes nobody: give it to a driver with assign_vehicle().
    While its papers are expired only not_ready / inactive can be picked (409 otherwise). `forced`: the change is the
    paper lock's own (see enforce_papers), remembered so renewed papers bring it back to "ready".
    Returns {"vehicle_id", "status", "moved_driver"}."""
    if status not in VEHICLE_STATUSES:
        raise FleetError(f"Trạng thái xe không hợp lệ: {status}")
    stamp = _now()
    moved = None
    from backend.app.core.fleet_trailers import TRAILER_STATUS_LABELS, stopped_trailer
    with _conn() as conn:
        vehicle = _vehicle(conn, vehicle_id)
        if not forced:
            _check_paper_lock(vehicle, status)
        stopped = stopped_trailer(conn, vehicle_id)
        if stopped and status in RUNNING_STATUSES:
            raise FleetError(f"Đầu kéo {vehicle['plate']} đang ghép moóc {stopped['plate']} "
                             f"({TRAILER_STATUS_LABELS[stopped['status']].lower()}): tháo moóc trước", 409)
        on_vehicle = _open_by_vehicle(conn, vehicle_id)
        target = None
        if move_to_vehicle_id is not None:
            if status in RUNNING_STATUSES:
                raise FleetError("Chỉ chuyển tài xế sang xe khác khi xe không chạy được")
            if not on_vehicle:
                raise FleetError(f"Xe {vehicle['plate']} không có tài xế nào đang lái")
            if move_to_vehicle_id == vehicle_id:
                raise FleetError("Hãy chọn một xe khác")
            target = _vehicle(conn, move_to_vehicle_id)
            _check_free_running(conn, target)
            _check_license(_driver(conn, on_vehicle["driver_id"]), target)
        if status in RUNNING_STATUSES:  # which of the two follows whether someone drives it
            status = "active" if on_vehicle else "ready"
        # a change by hand clears the "forced" mark; the same status again keeps it
        flag = 1 if forced else (vehicle.get("status_forced") or 0) if status == vehicle["status"] else 0
        # another status picked while a trailer held it: that one stays, not the one from before the hold
        hold = vehicle.get("trailer_hold_status") or "" if status == vehicle["status"] else ""
        conn.execute("UPDATE fleet_vehicles SET status = ?, status_forced = ?, trailer_hold_status = ?, updated_at = ? "
                     "WHERE id = ?;", (status, flag, hold, stamp, vehicle_id))
        label = VEHICLE_STATUS_LABELS[status]
        why = f"Xe {vehicle['plate']} {label.lower()}" + (f": {_text(reason)}" if _text(reason) else "")
        if status not in RUNNING_STATUSES and on_vehicle:
            driver = _driver(conn, on_vehicle["driver_id"])
            _close(conn, on_vehicle, why, stamp)
            if target:
                _open(conn, driver, target, why, stamp)
            moved = {"id": driver["id"], "name": driver["name"], "to_vehicle_id": target["id"] if target else None,
                     "to_plate": target["plate"] if target else ""}
    return {"vehicle_id": vehicle_id, "status": status, "moved_driver": moved}


# ---------------------------------------------------------------------------
# Trucks and drivers: create / edit / delete
# ---------------------------------------------------------------------------
# editable after creation (the category is not: see create_vehicle)
_VEHICLE_FIELDS = ("plate", "trailer_plate", "vehicle_type", "body_type", "payload", "ownership_expiry",
                   "registration_expiry", "insurance_expiry", "status", "note")
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
    if "ownership_expiry" in data or not partial:
        out["ownership_expiry"] = _date(data.get("ownership_expiry"), "Hạn đăng ký")
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
    # papers already expired: it starts as not_ready (forced), whatever was picked
    forced = int(bool(expired_papers(fields)) and fields["status"] not in LOCK_FREE_STATUSES)
    if forced:
        fields["status"] = "not_ready"
    stamp = _now()
    with _conn() as conn:
        _check_vehicle_unique(conn, fields, None)
        cur = conn.execute(
            "INSERT INTO fleet_vehicles (plate, plate_key, category, vehicle_type, body_type, payload, ownership_expiry, "
            "registration_expiry, insurance_expiry, status, status_forced, note, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (fields["plate"], plate_key(fields["plate"]), category,
             fields["vehicle_type"], fields["body_type"], fields["payload"], fields["ownership_expiry"],
             fields["registration_expiry"], fields["insurance_expiry"], fields["status"], forced, fields["note"],
             stamp, stamp))
        vehicle_id = cur.lastrowid
        _sync_running(conn, vehicle_id)
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
        before = _vehicle(conn, vehicle_id)
        if before["category"] == "truck":
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
    # the form sends the status it showed: only a different one is a change (a trailer swap may have moved it)
    if "status" in data and data["status"] is not None and data["status"] != before["status"]:
        with _conn() as conn:
            current = _vehicle(conn, vehicle_id)["status"]
        if data["status"] != current:
            set_vehicle_status(vehicle_id, data["status"])
    # new dates may lock it (expired) or free it (renewed)
    enforce_vehicle_papers(vehicle_id)


def delete_vehicle(vehicle_id: int) -> None:
    """Move a truck to the trash. Its driver gets off it and its trailer comes off (a free trailer again); the history
    keeps its plate."""
    from backend.app.core.fleet_trailers import release_vehicle
    stamp = _now()
    with _conn() as conn:
        vehicle = _vehicle(conn, vehicle_id)
        _close(conn, _open_by_vehicle(conn, vehicle_id), f"Xóa xe {vehicle['plate']}", stamp)
        release_vehicle(conn, vehicle, f"Xóa xe {vehicle['plate']}", stamp)
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


def phone_key(value) -> str:
    """A phone number as compared for uniqueness: digits only, +84 / 84 read as a leading 0."""
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("84") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


def id_number_key(value) -> str:
    """A CCCD / CMND number as compared for uniqueness: letters and digits only, upper case."""
    return re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()


def _check_driver_unique(conn, phone: str, id_number: str, exclude_id: int | None = None) -> None:
    """Two drivers (outside the trash) never share a phone number or a CCCD (409 naming who has it)."""
    want = {"phone": phone_key(phone), "id_number": id_number_key(id_number)}
    if not any(want.values()):
        return
    for row in conn.execute("SELECT id, name, phone, id_number FROM fleet_drivers WHERE deleted_at IS NULL;"):
        if row[0] == exclude_id:
            continue
        if want["phone"] and phone_key(row[2]) == want["phone"]:
            raise FleetError(f"Số điện thoại {phone} đã thuộc về tài xế {row[1]}", 409)
        if want["id_number"] and id_number_key(row[3]) == want["id_number"]:
            raise FleetError(f"Số CCCD {id_number} đã thuộc về tài xế {row[1]}", 409)


def create_driver(data: dict) -> int:
    """A new driver; one whose licence has already expired starts as not_ready (forced), whatever was picked.
    The phone number and the CCCD may not be another driver's."""
    fields = _clean_driver(data, partial=False)
    forced = int(license_expired(fields) and fields["status"] not in DRIVER_LOCK_FREE_STATUSES)
    if forced:
        fields["status"] = "not_ready"
    stamp = _now()
    with _conn() as conn:
        _check_driver_unique(conn, fields["phone"], fields["id_number"])
        cur = conn.execute(
            "INSERT INTO fleet_drivers (name, phone, id_number, license_no, license_class, license_expiry, status, "
            "status_forced, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (fields["name"], fields["phone"], fields["id_number"], fields["license_no"], fields["license_class"],
             fields["license_expiry"], fields["status"], forced, fields["note"], stamp, stamp))
        driver_id = cur.lastrowid
    return driver_id


def update_driver(driver_id: int, data: dict) -> None:
    """Edit a driver. Any status but "active" (leave, not ready, quit) gets them off their truck; coming back to work
    puts them on none (give them one with assign_vehicle). A status other than the stored one
    is a change by hand: refused while the licence is expired (unless not_ready / leave / left), and it clears the
    "forced" mark. The new licence date then locks or frees them (see enforce_driver_papers)."""
    fields = _clean_driver({k: v for k, v in data.items() if k in _DRIVER_FIELDS}, partial=True)
    stamp = _now()
    with _conn() as conn:
        before = _driver(conn, driver_id)
        if "phone" in fields or "id_number" in fields:
            _check_driver_unique(conn, fields.get("phone", ""), fields.get("id_number", ""), exclude_id=driver_id)
        if fields.get("status", before["status"]) == before["status"]:
            fields.pop("status", None)
        else:
            after = {**before, **fields}
            if license_expired(after) and fields["status"] not in DRIVER_LOCK_FREE_STATUSES:
                raise FleetError(f"{before['name']}: bằng lái đã hết hạn, chỉ chuyển được sang "
                                 f"\"{DRIVER_STATUS_LABELS['not_ready']}\", \"{DRIVER_STATUS_LABELS['leave']}\" "
                                 f"hoặc \"{DRIVER_STATUS_LABELS['left']}\"", 409)
            fields["status_forced"] = 0
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
    enforce_driver_papers(driver_id)


def delete_driver(driver_id: int) -> None:
    """Move a driver to the trash: off their truck (it is free for someone else)."""
    stamp = _now()
    with _conn() as conn:
        driver = _driver(conn, driver_id)
        _close(conn, _open_by_driver(conn, driver_id), f"Xóa tài xế {driver['name']}", stamp)
        conn.execute("UPDATE fleet_drivers SET deleted_at = ? WHERE id = ?;", (stamp, driver_id))


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
        if kind == "driver":
            # one coming back may not take a phone number / CCCD another driver has now (or one restored with it)
            seen: dict[str, str] = {}
            for driver_id, name, phone, id_number in conn.execute(
                    f"SELECT id, name, phone, id_number FROM fleet_drivers WHERE deleted_at IS NOT NULL "
                    f"AND id IN ({','.join('?' * len(clean))});", clean).fetchall():
                _check_driver_unique(conn, phone, id_number, exclude_id=driver_id)
                for key, label, value in (("p" + phone_key(phone), "Số điện thoại", phone),
                                          ("i" + id_number_key(id_number), "Số CCCD", id_number)):
                    if len(key) == 1:
                        continue
                    if key in seen:
                        raise FleetError(f"{label} {value} trùng giữa {seen[key]} và {name}", 409)
                    seen[key] = name
        cur = conn.execute(f"UPDATE {table} SET deleted_at = NULL, updated_at = ? WHERE deleted_at IS NOT NULL "
                           f"AND {which} AND id IN ({','.join('?' * len(clean))});", (stamp, *clean))
        restored = max(cur.rowcount, 0)
        if kind in ("vehicle", "truck"):
            for vehicle_id in clean:
                _sync_running(conn, vehicle_id)
        elif kind == "trailer":
            from backend.app.core.fleet_trailers import _sync_trailer
            for trailer_id in clean:
                _sync_trailer(conn, trailer_id)
    # papers that ran out while it was in the trash lock it now
    if kind in ("vehicle", "truck"):
        for vehicle_id in clean:
            enforce_vehicle_papers(vehicle_id)
    elif kind == "driver":
        for driver_id in clean:
            enforce_driver_papers(driver_id)
    elif kind == "trailer":
        from backend.app.core.fleet_trailers import enforce_trailer_papers
        for trailer_id in clean:
            enforce_trailer_papers(trailer_id)
    return restored


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
    """Store a scan of a driver's / truck's / trailer's papers (`which`: one of DOCUMENTS[entity]), kept larger than a photo so
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
# Paper lock: a truck / trailer whose đăng ký, đăng kiểm or bảo hiểm has expired is "not_ready" (Không sẵn sàng)
# ---------------------------------------------------------------------------
def _vn_today() -> date:
    return datetime.now(VN_TZ).date()


def expired_papers(row: dict, today: date | None = None) -> list[str]:
    """The labels of the row's papers whose expiry date is before `today` (VN date), in PAPER_EXPIRIES order."""
    today = today or _vn_today()
    out = []
    for column, label in PAPER_EXPIRIES:
        value = row.get(column) or ""
        try:
            if value and date.fromisoformat(value) < today:
                out.append(label)
        except ValueError:
            continue
    return out


def _check_paper_lock(row: dict, status: str, today: date | None = None) -> None:
    """Refuse a status other than not_ready / inactive while a paper is expired (409, naming the papers)."""
    expired = expired_papers(row, today)
    if expired and status not in LOCK_FREE_STATUSES:
        raise FleetError(f"{row['plate']}: {', '.join(expired)} đã hết hạn, chỉ chuyển được sang "
                         f"\"{VEHICLE_STATUS_LABELS['not_ready']}\" hoặc \"{VEHICLE_STATUS_LABELS['inactive']}\"", 409)


def _paper_move(row: dict, today: date | None = None) -> tuple[str, str] | None:
    """What the lock does to the row: ("not_ready", reason) when a paper has expired, ("ready", reason) when the
    papers of a row it had forced are valid again, else None. "inactive" rows are left alone."""
    if row["status"] == "inactive":
        return None
    expired = expired_papers(row, today)
    if expired and row["status"] != "not_ready":
        return "not_ready", f"{', '.join(expired)} hết hạn"
    if not expired and row["status"] == "not_ready" and row.get("status_forced"):
        return "ready", "Giấy tờ đã gia hạn"
    return None


def enforce_vehicle_papers(vehicle_id: int, today: date | None = None) -> str | None:
    """Apply the paper lock to one truck, through set_vehicle_status so its driver moves as for any other change
    (forced to not_ready: the driver gets off; back to ready: nobody is put on it). Returns the new status
    when it changed."""
    with _conn() as conn:
        rows = _rows(conn, "SELECT * FROM fleet_vehicles WHERE id = ? AND deleted_at IS NULL;", (vehicle_id,))
    move = _paper_move(rows[0], today) if rows else None
    if not move:
        return None
    status, reason = move
    from backend.app.core.fleet_trailers import stopped_trailer
    if status == "ready":
        with _conn() as conn:
            held = stopped_trailer(conn, vehicle_id)
            if held:  # its trailer still holds it: "ready" is what it gets once the trailer is off or runs again
                conn.execute("UPDATE fleet_vehicles SET status_forced = 0, trailer_hold_status = 'ready', updated_at = ? "
                             "WHERE id = ?;", (_now(), vehicle_id))
        if held:
            logger.info(f"Paper lock: vehicle {rows[0]['plate']} renewed, still held by moóc {held['plate']}")
            return None
    if status == "ready":
        set_vehicle_status(vehicle_id, "ready", reason)
    else:
        set_vehicle_status(vehicle_id, "not_ready", reason, forced=True)
    logger.info(f"Paper lock: vehicle {rows[0]['plate']} -> {status} ({reason})")
    return status


def license_expired(row: dict, today: date | None = None) -> bool:
    """The driver's licence date is before `today` (VN date); its last day still counts."""
    try:
        return bool(row.get("license_expiry")) and date.fromisoformat(row["license_expiry"]) < (today or _vn_today())
    except ValueError:
        return False


def enforce_driver_papers(driver_id: int, today: date | None = None) -> str | None:
    """The licence lock on one driver: an expired licence makes a working driver not_ready (off their truck); a renewed
    one brings a driver it had forced back to work (on no truck: give them one with assign_vehicle). Someone on leave
    or who quit is left alone. Returns the new status when it changed."""
    stamp = _now()
    with _conn() as conn:
        rows = _rows(conn, "SELECT * FROM fleet_drivers WHERE id = ? AND deleted_at IS NULL;", (driver_id,))
        if not rows:
            return None
        driver = rows[0]
        expired = license_expired(driver, today)
        if expired and driver["status"] == "active":
            conn.execute("UPDATE fleet_drivers SET status = 'not_ready', status_forced = 1, updated_at = ? WHERE id = ?;",
                         (stamp, driver_id))
            _close(conn, _open_by_driver(conn, driver_id), "Bằng lái hết hạn", stamp)
            status = "not_ready"
        elif not expired and driver["status"] == "not_ready" and driver["status_forced"]:
            conn.execute("UPDATE fleet_drivers SET status = 'active', status_forced = 0, updated_at = ? WHERE id = ?;",
                         (stamp, driver_id))
            status = "active"
        else:
            return None
    logger.info(f"Paper lock: driver {driver['name']} -> {status}")
    return status


def enforce_papers(today: date | None = None) -> int:
    """The paper lock over every truck, trailer and driver (papers run out with time): run with the reminders.
    Returns how many changed."""
    from backend.app.core.fleet_trailers import enforce_trailer_papers
    with _conn() as conn:
        vehicles = [r[0] for r in conn.execute("SELECT id FROM fleet_vehicles WHERE deleted_at IS NULL;")]
        trailer_ids = [r[0] for r in conn.execute("SELECT id FROM fleet_trailers WHERE deleted_at IS NULL;")]
        driver_ids = [r[0] for r in conn.execute("SELECT id FROM fleet_drivers WHERE deleted_at IS NULL;")]
    changed = sum(1 for v in vehicles if enforce_vehicle_papers(v, today))
    changed += sum(1 for t in trailer_ids if enforce_trailer_papers(t, today))
    changed += sum(1 for d in driver_ids if enforce_driver_papers(d, today))
    return changed


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
