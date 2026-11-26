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

Only a trailer that can run (ready / active) is hitched. A hitched trailer that stops running (not ready, broken,
maintenance, out of service: by hand or by the paper lock) stays on its tractor, and the tractor is held in "not_ready":
its own status is kept in `fleet_vehicles.trailer_hold_status` and comes back when the trailer comes off or runs again
(the paper lock still applies to it then). The driver stays on the tractor through the hold. See _refresh_hold.
"""
import re
from datetime import datetime

from backend.app.core.fleet import (
    LOCK_FREE_STATUSES, RUNNING_STATUSES, TRAILER_DOCUMENTS, VEHICLE_STATUSES, FleetError, _check_paper_lock, _conn, _date, _fold, _now,
    _paper_move, _rows, _text, _vehicle, expired_papers, logger, plate_key,
)
from backend.app.core.fleet import _close as _end_drive, _open_by_vehicle as _drive_of, _sync_running

TRAILER_STATUSES = VEHICLE_STATUSES          # ready / active / not_ready / broken / maintenance / inactive
TRAILER_STATUS_LABELS = {"ready": "Sẵn sàng", "active": "Đang dùng", "not_ready": "Không sẵn sàng", "broken": "Hư hỏng",
                         "maintenance": "Bảo dưỡng", "inactive": "Ngưng hoạt động"}
_TRAILER_FIELDS = ("plate", "trailer_type", "chassis_no", "payload", "year", "ownership_expiry", "registration_expiry",
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
        item = {k: t[k] for k in ("id", "plate", "trailer_type", "chassis_no", "payload", "year", "ownership_expiry",
                                  "registration_expiry", "insurance_expiry", "status", "status_forced", "note",
                                  "photo", *TRAILER_DOCUMENTS,
                                  "created_at", "updated_at")}
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
    _refresh_hold(conn, vehicle_id)


def stopped_trailer(conn, vehicle_id: int) -> dict | None:
    """The trailer hitched to the tractor when it cannot run (it holds the tractor in not_ready), else None."""
    rows = _rows(conn, """SELECT t.* FROM fleet_trailer_hitches h JOIN fleet_trailers t ON t.id = h.trailer_id
                          WHERE h.vehicle_id = ? AND h.ended_at IS NULL;""", (vehicle_id,))
    return rows[0] if rows and rows[0]["status"] not in RUNNING_STATUSES else None


def _refresh_hold(conn, vehicle_id: int) -> None:
    """A tractor pulling a trailer that cannot run is held in not_ready, its own status kept; once the trailer is off
    or runs again it gets that status back (not_ready, forced, if its own papers ran out meanwhile). Only a running
    tractor is held. The driver stays on it either way."""
    rows = _rows(conn, "SELECT * FROM fleet_vehicles WHERE id = ?;", (vehicle_id,))
    if not rows:
        return
    v = rows[0]
    held = v.get("trailer_hold_status") or ""
    stopped = stopped_trailer(conn, vehicle_id)
    if stopped and not held and v["status"] in RUNNING_STATUSES and not v["deleted_at"]:
        conn.execute("UPDATE fleet_vehicles SET trailer_hold_status = ?, status = 'not_ready', updated_at = ? "
                     "WHERE id = ?;", (v["status"], _now(), vehicle_id))
        logger.info(f"Trailer hold: tractor {v['plate']} -> not_ready (moóc {stopped['plate']} {stopped['status']})")
    elif held and not stopped:
        status, forced = held, 0
        if expired_papers(v):  # its own papers ran out meanwhile: the paper lock's not_ready, the driver gets off
            status, forced = "not_ready", 1
            _end_drive(conn, _drive_of(conn, vehicle_id), f"Xe {v['plate']}: {', '.join(expired_papers(v))} hết hạn",
                       _now())
        conn.execute("UPDATE fleet_vehicles SET trailer_hold_status = '', status = ?, status_forced = ?, updated_at = ? "
                     "WHERE id = ?;", (status, forced, _now(), vehicle_id))
        _sync_running(conn, vehicle_id)   # its driver may have left meanwhile
        logger.info(f"Trailer hold: tractor {v['plate']} -> {status}")


def _sync_trailer(conn, trailer_id: int | None) -> None:
    """A trailer that can run is "active" (Đang dùng) on a tractor, "ready" (Sẵn sàng) when free; a stopped one is
    left alone."""
    if trailer_id is None:
        return
    row = conn.execute("SELECT status FROM fleet_trailers WHERE id = ?;", (trailer_id,)).fetchone()
    if not row or row[0] not in RUNNING_STATUSES:
        return
    want = "active" if _open_by_trailer(conn, trailer_id) else "ready"
    if row[0] != want:
        conn.execute("UPDATE fleet_trailers SET status = ?, updated_at = ? WHERE id = ?;", (want, _now(), trailer_id))


def refresh_all_holds(conn) -> None:
    """Every tractor's hold, on start (trailers that stopped before the hold existed)."""
    for (vehicle_id,) in conn.execute("SELECT id FROM fleet_vehicles WHERE deleted_at IS NULL;").fetchall():
        _refresh_hold(conn, vehicle_id)


def _close(conn, row: dict | None, end_reason: str, stamp: str) -> None:
    if row:
        conn.execute("UPDATE fleet_trailer_hitches SET ended_at = ?, end_reason = ? WHERE id = ?;",
                     (stamp, _text(end_reason), row["id"]))
        _sync_trailer(conn, row["trailer_id"])
        if row["vehicle_id"]:
            _sync_cache(conn, row["vehicle_id"])


def _open(conn, trailer: dict, vehicle: dict, reason: str, stamp: str) -> None:
    conn.execute("INSERT INTO fleet_trailer_hitches (trailer_id, vehicle_id, trailer_plate, vehicle_plate, reason, "
                 "started_at) VALUES (?, ?, ?, ?, ?, ?);",
                 (trailer["id"], vehicle["id"], trailer["plate"], vehicle["plate"], _text(reason), stamp))
    _sync_trailer(conn, trailer["id"])
    _sync_cache(conn, vehicle["id"])


def _hitch(conn, trailer: dict, vehicle: dict, reason: str, stamp: str) -> dict:
    """`trailer` onto `vehicle`, off whatever it was on, and the tractor's old trailer off it.
    Returns {"replaced": plate of the trailer taken off the tractor, "from_plate": tractor the trailer came off}."""
    if vehicle.get("category") == "truck":
        raise FleetError(f"Xe {vehicle['plate']} là xe tải, không kéo moóc")
    mine = _open_by_trailer(conn, trailer["id"])
    if mine and mine["vehicle_id"] == vehicle["id"]:
        return {"replaced": "", "from_plate": ""}
    theirs = _open_by_vehicle(conn, vehicle["id"])
    _close(conn, mine, f"Chuyển sang đầu kéo {vehicle['plate']}", stamp)
    _close(conn, theirs, f"Thay bằng moóc {trailer['plate']}", stamp)
    _open(conn, trailer, vehicle, reason, stamp)
    return {"replaced": theirs["trailer_plate"] if theirs else "", "from_plate": mine["vehicle_plate"] if mine else ""}


def _check_hitchable(trailer: dict) -> None:
    """Only a trailer that can run (ready / active) goes on a tractor (409 otherwise)."""
    if trailer["status"] not in RUNNING_STATUSES:
        expired = expired_papers(trailer)
        why = f" ({', '.join(expired)} hết hạn)" if expired else ""
        raise FleetError(f"Moóc {trailer['plate']} đang {TRAILER_STATUS_LABELS[trailer['status']].lower()}{why}: "
                         "chỉ ghép được moóc sẵn sàng hoặc đang dùng", 409)


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
        _check_hitchable(trailer)
        return _hitch(conn, trailer, vehicle, reason, stamp)


def hitch_vehicle(vehicle_id: int, trailer_id: int | None, reason: str = "") -> dict:
    """From the tractor: Ghép rơ moóc (a trailer that can run, off any other tractor; the tractor's own trailer comes
    off) or, with None, Tháo rơ moóc (400 when it pulls none)."""
    if trailer_id is not None:
        return hitch(trailer_id, vehicle_id, reason or "Ghép rơ moóc")
    stamp = _now()
    with _conn() as conn:
        vehicle = _vehicle(conn, vehicle_id)
        current = _open_by_vehicle(conn, vehicle_id)
        if not current:
            raise FleetError(f"Đầu kéo {vehicle['plate']} chưa ghép moóc nào")
        _close(conn, current, reason or "Tháo rơ moóc", stamp)
    return {"replaced": current["trailer_plate"], "from_plate": ""}


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
        _check_hitchable(trailer)
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
    # papers already expired: it starts as not_ready (forced), whatever was picked
    forced = int(bool(expired_papers(fields)) and fields["status"] not in LOCK_FREE_STATUSES)
    if forced:
        fields["status"] = "not_ready"
    cur = conn.execute(
        "INSERT INTO fleet_trailers (plate, plate_key, trailer_type, chassis_no, payload, year, ownership_expiry, "
        "registration_expiry, insurance_expiry, status, status_forced, note, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        (fields["plate"], plate_key(fields["plate"]), fields["trailer_type"], fields["chassis_no"], fields["payload"],
         fields["year"], fields["ownership_expiry"], fields["registration_expiry"], fields["insurance_expiry"],
         fields["status"], forced, fields["note"], stamp, stamp))
    return cur.lastrowid


def create_trailer(data: dict) -> int:
    """A new trailer; with `vehicle_id`, hitched to that tractor at once."""
    stamp = _now()
    with _conn() as conn:
        trailer_id = _insert(conn, data, stamp)
        if data.get("vehicle_id"):
            vehicle = _vehicle(conn, int(data["vehicle_id"]))
            trailer = _trailer(conn, trailer_id)
            _check_hitchable(trailer)
            _hitch(conn, trailer, vehicle, "", stamp)
        _sync_trailer(conn, trailer_id)
        return trailer_id


def update_trailer(trailer_id: int, data: dict) -> None:
    """Edit a trailer. A new plate shows on the tractor pulling it; it stays hitched whatever its status, and one
    that cannot run holds its tractor in not_ready (see _refresh_hold).
    A status other than the stored one is a change by hand: refused while a paper is expired (unless not_ready /
    inactive), and it clears the "forced" mark. The same status (the form always sends it) changes nothing; the new
    dates then lock or free it (see enforce_trailer_papers)."""
    fields = _clean({k: v for k, v in data.items() if k in _TRAILER_FIELDS}, partial=True)
    stamp = _now()
    with _conn() as conn:
        before = _trailer(conn, trailer_id)
        if fields.get("status", before["status"]) == before["status"]:
            fields.pop("status", None)
        else:
            _check_paper_lock({**before, **fields}, fields["status"])
            fields["status_forced"] = 0
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
        if hitched and "status" in fields:
            _refresh_hold(conn, hitched["vehicle_id"])
        _sync_trailer(conn, trailer_id)
    enforce_trailer_papers(trailer_id)


def enforce_trailer_papers(trailer_id: int, today=None) -> str | None:
    """The paper lock on one trailer (see fleet.enforce_vehicle_papers): an expired paper makes it not_ready (its
    tractor is held in not_ready too); renewed papers bring a trailer it had forced back to "ready" (and its tractor
    back). Returns the new status."""
    stamp = _now()
    with _conn() as conn:
        rows = _rows(conn, "SELECT * FROM fleet_trailers WHERE id = ? AND deleted_at IS NULL;", (trailer_id,))
        move = _paper_move(rows[0], today) if rows else None
        if not move:
            return None
        status, reason = move
        conn.execute("UPDATE fleet_trailers SET status = ?, status_forced = ?, updated_at = ? WHERE id = ?;",
                     (status, int(status == "not_ready"), stamp, trailer_id))
        hitched = _open_by_trailer(conn, trailer_id)
        if hitched:
            _refresh_hold(conn, hitched["vehicle_id"])
        _sync_trailer(conn, trailer_id)
    logger.info(f"Paper lock: trailer {rows[0]['plate']} -> {status} ({reason})")
    return status


def delete_trailer(trailer_id: int) -> None:
    """Move a trailer to the trash, off its tractor; the history keeps its plate."""
    stamp = _now()
    with _conn() as conn:
        trailer = _trailer(conn, trailer_id)
        _close(conn, _open_by_trailer(conn, trailer_id), f"Xóa moóc {trailer['plate']}", stamp)
        conn.execute("UPDATE fleet_trailers SET deleted_at = ? WHERE id = ?;", (stamp, trailer_id))
