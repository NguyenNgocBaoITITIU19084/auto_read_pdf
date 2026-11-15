"""Trailers (rơ moóc): their own records, and which tractor pulls which trailer.

A trailer is hitched to at most one tractor and a tractor pulls at most one trailer. Who pulls what is the open row
(ended_at IS NULL) of `fleet_trailer_hitches`; closed rows are the history, keeping both plates as they were. Partial
unique indexes keep one open row per trailer and per tractor, so every move closes the old rows first, in one
transaction.

`fleet_vehicles.trailer_plate` / `trailer_key` stay as a cache of the hitched trailer's plate (the tractor list, the
driver list, search and export read it). Every function that opens or closes a hitch re-syncs the cache of each
tractor it touched, clearing before setting, so the unique index on `trailer_key` never sees two tractors at once.

Tractors made before trailers had records carry only `trailer_plate`: migrate_trailer_plates() turns each into a
trailer record and an open hitch, on every start, doing nothing once done.
"""
import re
from datetime import datetime

from backend.app.core.fleet import (
    VEHICLE_STATUSES, FleetError, _conn, _date, _fold, _now, _rows, _text, _vehicle, plate_key,
)

TRAILER_STATUSES = VEHICLE_STATUSES          # active / broken / maintenance / inactive
TRAILER_STATUS_LABELS = {"active": "Đang dùng", "broken": "Hư hỏng", "maintenance": "Bảo dưỡng",
                         "inactive": "Ngưng hoạt động"}
_TRAILER_FIELDS = ("plate", "trailer_type", "chassis_no", "payload", "year", "registration_expiry",
                   "insurance_expiry", "status", "note")
_YEAR_RE = re.compile(r"^\d{4}$")
HITCH_MAX_LIMIT = 1000
HITCH_SORT_COLUMNS = ("started_at", "ended_at", "trailer_plate", "vehicle_plate", "reason", "end_reason")
HITCH_STATES = ("open", "closed")


def create_trailer_tables(conn) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fleet_trailers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate TEXT NOT NULL,
            plate_key TEXT NOT NULL UNIQUE,
            trailer_type TEXT NOT NULL DEFAULT '',
            chassis_no TEXT NOT NULL DEFAULT '',
            payload TEXT NOT NULL DEFAULT '',
            year TEXT NOT NULL DEFAULT '',
            registration_expiry TEXT NOT NULL DEFAULT '',
            insurance_expiry TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            note TEXT NOT NULL DEFAULT '',
            photo TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fleet_trailer_hitches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trailer_id INTEGER REFERENCES fleet_trailers(id) ON DELETE SET NULL,
            vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
            trailer_plate TEXT NOT NULL,
            vehicle_plate TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            started_at TEXT NOT NULL,
            ended_at TEXT,
            end_reason TEXT NOT NULL DEFAULT ''
        );
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_hitch_open_trailer ON fleet_trailer_hitches(trailer_id) "
                 "WHERE ended_at IS NULL;")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_hitch_open_vehicle ON fleet_trailer_hitches(vehicle_id) "
                 "WHERE ended_at IS NULL;")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fleet_hitches_started ON fleet_trailer_hitches(started_at);")


def migrate_trailer_plates(conn) -> int:
    """Each tractor's typed trailer plate without a trailer record / open hitch gets them. A tractor in the trash
    gives its trailer up (the record is made, free). Returns how many tractors were migrated."""
    stamp = _now()
    done = 0
    for v in _rows(conn, "SELECT id, plate, trailer_plate, deleted_at FROM fleet_vehicles WHERE trailer_key != '';"):
        if _open_by_vehicle(conn, v["id"]):
            continue
        trailer = _by_key(conn, plate_key(v["trailer_plate"]))
        if not trailer:
            trailer_id = _insert(conn, {"plate": v["trailer_plate"].upper()}, stamp)
            trailer = _rows(conn, "SELECT * FROM fleet_trailers WHERE id = ?;", (trailer_id,))[0]
        if v["deleted_at"] or trailer["deleted_at"] or _open_by_trailer(conn, trailer["id"]):
            _sync_cache(conn, v["id"])
        else:
            _open(conn, trailer, v, "Có sẵn trên đầu kéo", stamp)
        done += 1
    return done


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def _trailer(conn, trailer_id: int) -> dict:
    """A trailer that is not in the trash (404 otherwise)."""
    rows = _rows(conn, "SELECT * FROM fleet_trailers WHERE id = ? AND deleted_at IS NULL;", (trailer_id,))
    if not rows:
        raise FleetError("Không tìm thấy moóc", 404)
    return rows[0]


def _by_key(conn, key: str) -> dict | None:
    rows = _rows(conn, "SELECT * FROM fleet_trailers WHERE plate_key = ?;", (key,))
    return rows[0] if rows else None


def _open_by_trailer(conn, trailer_id: int) -> dict | None:
    rows = _rows(conn, "SELECT * FROM fleet_trailer_hitches WHERE trailer_id = ? AND ended_at IS NULL;", (trailer_id,))
    return rows[0] if rows else None


def _open_by_vehicle(conn, vehicle_id: int) -> dict | None:
    rows = _rows(conn, "SELECT * FROM fleet_trailer_hitches WHERE vehicle_id = ? AND ended_at IS NULL;", (vehicle_id,))
    return rows[0] if rows else None


def list_trailers() -> list[dict]:
    """Every trailer with the tractor pulling it now (and that tractor's current driver), by plate."""
    with _conn() as conn:
        trailers = _rows(conn, "SELECT * FROM fleet_trailers WHERE deleted_at IS NULL;")
        pulling = {r["trailer_id"]: r for r in _rows(conn, """
            SELECT h.trailer_id, h.vehicle_id, h.started_at, h.reason, v.plate, v.status, v.photo,
                   d.name AS driver_name
            FROM fleet_trailer_hitches h JOIN fleet_vehicles v ON v.id = h.vehicle_id
            LEFT JOIN fleet_assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
            LEFT JOIN fleet_drivers d ON d.id = a.driver_id
            WHERE h.ended_at IS NULL;""")}
    out = []
    for t in trailers:
        p = pulling.get(t["id"])
        item = {k: t[k] for k in ("id", "plate", "trailer_type", "chassis_no", "payload", "year", "registration_expiry",
                                  "insurance_expiry", "status", "note", "photo", "created_at", "updated_at")}
        item["vehicle"] = ({"id": p["vehicle_id"], "plate": p["plate"], "status": p["status"], "photo": p["photo"],
                            "driver_name": p["driver_name"] or "", "since": p["started_at"], "reason": p["reason"]}
                           if p else None)
        out.append(item)
    out.sort(key=lambda r: plate_key(r["plate"]))
    return out


def get_trailer(trailer_id: int) -> dict:
    found = next((t for t in list_trailers() if t["id"] == trailer_id), None)
    if not found:
        raise FleetError("Không tìm thấy moóc", 404)
    return found


def hitch_history(trailer_id: int | None = None, vehicle_id: int | None = None, limit: int = 200) -> list[dict]:
    """Hitches, newest first (the open ones are the current ones)."""
    return hitch_page(trailer_id, vehicle_id, limit=limit)["items"]


def hitch_page(trailer_id: int | None = None, vehicle_id: int | None = None, states: list[str] | None = None,
               query: str = "", sort_by: str | None = None, sort_dir: str = "desc", limit: int = 50,
               offset: int = 0) -> dict:
    """One page of the hitch history: {"items", "total"}. `states`: open (still hitched) / closed. `query` matches
    either plate or a reason, accents and case ignored. Newest first unless `sort_by` is given."""
    limit = max(1, min(int(limit or 50), HITCH_MAX_LIMIT))
    offset = max(0, int(offset or 0))
    where, params = [], []
    if trailer_id is not None:
        where.append("trailer_id = ?")
        params.append(trailer_id)
    if vehicle_id is not None:
        where.append("vehicle_id = ?")
        params.append(vehicle_id)
    clean_states = {s for s in (states or []) if s in HITCH_STATES}
    if len(clean_states) == 1:
        where.append("ended_at IS NULL" if "open" in clean_states else "ended_at IS NOT NULL")
    sql = ("SELECT * FROM fleet_trailer_hitches" + (f" WHERE {' AND '.join(where)}" if where else "")
           + " ORDER BY started_at DESC, id DESC;")
    with _conn() as conn:
        rows = _rows(conn, sql, tuple(params))
    needle = _fold(query)
    if needle:
        rows = [r for r in rows if any(needle in _fold(r[k]) for k in
                                       ("trailer_plate", "vehicle_plate", "reason", "end_reason"))]
    if sort_by in HITCH_SORT_COLUMNS:
        if sort_by in ("started_at", "ended_at"):
            key = (lambda r: r[sort_by] or "9999")
        else:
            key = (lambda r: (_fold(r[sort_by]), r[sort_by] or ""))
        rows = sorted(rows, key=key, reverse=(sort_dir or "").lower() != "asc")
    return {"items": rows[offset:offset + limit], "total": len(rows)}


# ---------------------------------------------------------------------------
# Hitching (each called inside the caller's transaction)
# ---------------------------------------------------------------------------
def _sync_cache(conn, vehicle_id: int) -> None:
    """The tractor's trailer_plate / trailer_key = its hitched trailer's plate, or ''."""
    row = conn.execute("""SELECT t.plate FROM fleet_trailer_hitches h JOIN fleet_trailers t ON t.id = h.trailer_id
                          WHERE h.vehicle_id = ? AND h.ended_at IS NULL;""", (vehicle_id,)).fetchone()
    plate = row[0] if row else ""
    conn.execute("UPDATE fleet_vehicles SET trailer_plate = ?, trailer_key = ? WHERE id = ?;",
                 (plate, plate_key(plate), vehicle_id))


def _close(conn, row: dict | None, end_reason: str, stamp: str) -> None:
    if row:
        conn.execute("UPDATE fleet_trailer_hitches SET ended_at = ?, end_reason = ? WHERE id = ?;",
                     (stamp, _text(end_reason), row["id"]))
        if row["vehicle_id"]:
            _sync_cache(conn, row["vehicle_id"])


def _open(conn, trailer: dict, vehicle: dict, reason: str, stamp: str) -> None:
    conn.execute("INSERT INTO fleet_trailer_hitches (trailer_id, vehicle_id, trailer_plate, vehicle_plate, reason, "
                 "started_at) VALUES (?, ?, ?, ?, ?, ?);",
                 (trailer["id"], vehicle["id"], trailer["plate"], vehicle["plate"], _text(reason), stamp))
    _sync_cache(conn, vehicle["id"])


def _hitch(conn, trailer: dict, vehicle: dict, reason: str, stamp: str) -> dict:
    """`trailer` onto `vehicle`, off whatever it was on, and the tractor's old trailer off it.
    Returns {"replaced": plate of the trailer taken off the tractor, "from_plate": tractor the trailer came off}."""
    mine = _open_by_trailer(conn, trailer["id"])
    if mine and mine["vehicle_id"] == vehicle["id"]:
        return {"replaced": "", "from_plate": ""}
    theirs = _open_by_vehicle(conn, vehicle["id"])
    _close(conn, mine, f"Chuyển sang đầu kéo {vehicle['plate']}", stamp)
    _close(conn, theirs, f"Thay bằng moóc {trailer['plate']}", stamp)
    _open(conn, trailer, vehicle, reason, stamp)
    return {"replaced": theirs["trailer_plate"] if theirs else "", "from_plate": mine["vehicle_plate"] if mine else ""}


def hitch(trailer_id: int, vehicle_id: int | None, reason: str = "") -> dict:
    """Hitch the trailer to a tractor (None: unhitch it). The explicit move: it comes off another tractor, and the
    tractor's own trailer comes off, without asking."""
    stamp = _now()
    with _conn() as conn:
        trailer = _trailer(conn, trailer_id)
        if vehicle_id is None:
            _close(conn, _open_by_trailer(conn, trailer_id), reason or "Tháo moóc", stamp)
            return {"replaced": "", "from_plate": ""}
        vehicle = _vehicle(conn, vehicle_id)
        if trailer["status"] == "inactive":
            raise FleetError(f"Moóc {trailer['plate']} đang ngưng hoạt động")
        return _hitch(conn, trailer, vehicle, reason, stamp)


def hitch_by_plate(conn, vehicle: dict, plate: str, stamp: str) -> None:
    """The tractor form's "Biển số moóc": '' unhitches, a known trailer is hitched, a new plate makes the trailer.
    A trailer on another tractor is not taken from a form field (409)."""
    key = plate_key(plate)
    current = _open_by_vehicle(conn, vehicle["id"])
    if not key:
        _close(conn, current, "Tháo moóc", stamp)
        return
    if current and plate_key(current["trailer_plate"]) == key:
        return
    trailer = _by_key(conn, key)
    if trailer and trailer["deleted_at"]:
        raise FleetError(f"Moóc {trailer['plate']} đang nằm trong thùng rác: hãy khôi phục moóc đó hoặc xóa hẳn", 409)
    if trailer:
        other = _open_by_trailer(conn, trailer["id"])
        if other and other["vehicle_id"] != vehicle["id"]:
            raise FleetError(f"Moóc {trailer['plate']} đang gắn với xe {other['vehicle_plate']}", 409)
        if trailer["status"] == "inactive":
            raise FleetError(f"Moóc {trailer['plate']} đang ngưng hoạt động")
    else:
        trailer_id = _insert(conn, {"plate": _text(plate, 30).upper()}, stamp)
        trailer = _trailer(conn, trailer_id)
    _close(conn, current, f"Thay bằng moóc {trailer['plate']}", stamp)
    _open(conn, trailer, vehicle, "", stamp)


def release_vehicle(conn, vehicle: dict, end_reason: str, stamp: str) -> None:
    """The tractor goes to the trash: its trailer comes off (and stays a free trailer)."""
    _close(conn, _open_by_vehicle(conn, vehicle["id"]), end_reason, stamp)
    _sync_cache(conn, vehicle["id"])


# ---------------------------------------------------------------------------
# Create / edit / delete
# ---------------------------------------------------------------------------
def _clean(data: dict, partial: bool) -> dict:
    out = {}
    if "plate" in data or not partial:
        plate = _text(data.get("plate"), 30)
        if not plate_key(plate):
            raise FleetError("Cần nhập biển số moóc")
        out["plate"] = plate.upper()
    for key, limit in (("trailer_type", 60), ("chassis_no", 40), ("payload", 30)):
        if key in data or not partial:
            out[key] = _text(data.get(key), limit)
    if "chassis_no" in out:
        out["chassis_no"] = out["chassis_no"].upper()
    if "year" in data or not partial:
        year = _text(data.get("year"), 4)
        if year and (not _YEAR_RE.match(year) or not 1950 <= int(year) <= datetime.now().year + 1):
            raise FleetError(f"Năm sản xuất không hợp lệ: {year}")
        out["year"] = year
    if "registration_expiry" in data or not partial:
        out["registration_expiry"] = _date(data.get("registration_expiry"), "Hạn đăng kiểm")
    if "insurance_expiry" in data or not partial:
        out["insurance_expiry"] = _date(data.get("insurance_expiry"), "Hạn bảo hiểm")
    if "note" in data or not partial:
        out["note"] = str(data.get("note") or "").strip()[:1000]
    if "status" in data or not partial:
        status = data.get("status") or "active"
        if status not in TRAILER_STATUSES:
            raise FleetError(f"Trạng thái moóc không hợp lệ: {status}")
        out["status"] = status
    return out


def _check_unique(conn, plate: str, exclude_id: int | None) -> None:
    """Unique across the trash too, so a restore never clashes."""
    row = conn.execute("SELECT plate, deleted_at FROM fleet_trailers WHERE plate_key = ? AND id != ?;",
                       (plate_key(plate), exclude_id or -1)).fetchone()
    if row:
        raise FleetError(f"Moóc {row[0]} đang nằm trong thùng rác: hãy khôi phục moóc đó hoặc xóa hẳn" if row[1]
                         else f"Moóc {row[0]} đã có trong danh sách", 409)


def _insert(conn, data: dict, stamp: str) -> int:
    fields = _clean(data, partial=False)
    _check_unique(conn, fields["plate"], None)
    cur = conn.execute(
        "INSERT INTO fleet_trailers (plate, plate_key, trailer_type, chassis_no, payload, year, registration_expiry, "
        "insurance_expiry, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        (fields["plate"], plate_key(fields["plate"]), fields["trailer_type"], fields["chassis_no"], fields["payload"],
         fields["year"], fields["registration_expiry"], fields["insurance_expiry"], fields["status"], fields["note"],
         stamp, stamp))
    return cur.lastrowid


def create_trailer(data: dict) -> int:
    """A new trailer; with `vehicle_id`, hitched to that tractor at once."""
    stamp = _now()
    with _conn() as conn:
        trailer_id = _insert(conn, data, stamp)
        if data.get("vehicle_id"):
            vehicle = _vehicle(conn, int(data["vehicle_id"]))
            trailer = _trailer(conn, trailer_id)
            if trailer["status"] == "inactive":
                raise FleetError(f"Moóc {trailer['plate']} đang ngưng hoạt động")
            _hitch(conn, trailer, vehicle, "", stamp)
        return trailer_id


def update_trailer(trailer_id: int, data: dict) -> None:
    """Edit a trailer. A new plate shows on the tractor pulling it; going out of service takes it off."""
    fields = _clean({k: v for k, v in data.items() if k in _TRAILER_FIELDS}, partial=True)
    stamp = _now()
    with _conn() as conn:
        before = _trailer(conn, trailer_id)
        if "plate" in fields:
            _check_unique(conn, fields["plate"], trailer_id)
            fields["plate_key"] = plate_key(fields["plate"])
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE fleet_trailers SET {sets}, updated_at = ? WHERE id = ?;",
                         (*fields.values(), stamp, trailer_id))
        hitched = _open_by_trailer(conn, trailer_id)
        if hitched and "plate" in fields and fields["plate"] != before["plate"]:
            conn.execute("UPDATE fleet_trailer_hitches SET trailer_plate = ? WHERE id = ?;", (fields["plate"], hitched["id"]))
            _sync_cache(conn, hitched["vehicle_id"])
        if hitched and fields.get("status") == "inactive" and before["status"] != "inactive":
            _close(conn, hitched, TRAILER_STATUS_LABELS["inactive"], stamp)


def delete_trailer(trailer_id: int) -> None:
    """Move a trailer to the trash, off its tractor; the history keeps its plate."""
    stamp = _now()
    with _conn() as conn:
        trailer = _trailer(conn, trailer_id)
        _close(conn, _open_by_trailer(conn, trailer_id), f"Xóa moóc {trailer['plate']}", stamp)
        conn.execute("UPDATE fleet_trailers SET deleted_at = ? WHERE id = ?;", (stamp, trailer_id))
