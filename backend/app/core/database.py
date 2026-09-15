import html
import logging
import os
import re
import sqlite3
import threading
from datetime import datetime
from backend.app.core import config
from backend.app.core.timezone import VN_TZ, now_vn_str

logger = logging.getLogger("backend.database")


def get_db_path() -> str:
    return os.environ.get("DB_PATH", str(config.DATA_DIR / "booking_data.db"))


def _now_str() -> str:
    return now_vn_str()


class ManagedConnection(sqlite3.Connection):
    """sqlite3 connection whose context manager commits (or rolls back) AND closes.

    The stock ``with sqlite3.connect(...) as conn`` only commits/rolls back and leaves
    the connection open, which leaked one connection per DB call.
    """

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()
        return False


_wal_initialized_paths: set[str] = set()
_wal_lock = threading.Lock()


def get_connection() -> ManagedConnection:
    db_path = get_db_path()
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=5.0, check_same_thread=False, factory=ManagedConnection)
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA foreign_keys = ON;")
    if db_path not in _wal_initialized_paths:
        # journal_mode=WAL is persistent in the database file, so it only needs to be set once.
        with _wal_lock:
            if db_path not in _wal_initialized_paths:
                try:
                    conn.execute("PRAGMA journal_mode = WAL;")
                    _wal_initialized_paths.add(db_path)
                except sqlite3.OperationalError as e:
                    logger.warning(f"Could not enable WAL journal mode: {e}")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def _clean_ids(ids) -> list[int]:
    seen = set()
    result = []
    for i in ids or []:
        try:
            v = int(i)
        except (TypeError, ValueError):
            continue
        if v not in seen:
            seen.add(v)
            result.append(v)
    return result


def _chunks(items: list, size: int = 500):
    for i in range(0, len(items), size):
        yield items[i:i + size]


PAGE_MAX_LIMIT = 5000
PAGE_DEFAULT_LIMIT = 50


def _page_bounds(limit, offset) -> tuple[int, int]:
    try:
        limit = int(limit) if limit is not None else PAGE_DEFAULT_LIMIT
    except (TypeError, ValueError):
        limit = PAGE_DEFAULT_LIMIT
    try:
        offset = int(offset) if offset is not None else 0
    except (TypeError, ValueError):
        offset = 0
    return max(1, min(limit, PAGE_MAX_LIMIT)), max(0, offset)


def _ensure_columns(conn: sqlite3.Connection, table: str, columns: list[tuple[str, str]]):
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table});").fetchall()}
    for name, col_type in columns:
        if name not in existing:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {col_type};")
            except sqlite3.OperationalError:
                pass


# ---------------------------------------------------------------------------
# Customs status / IMDG helpers (computed, not stored)
# ---------------------------------------------------------------------------
CUSTOMS_CLEARED = "Đã thông quan"
CUSTOMS_SUPERVISED = "Đang giám sát HQ"
CUSTOMS_NOT_CLEARED = "Chưa thông quan"


def _yn_flag(value, allow_legacy_labels: bool = False) -> str:
    """Normalize ePort Y/N values ('Y', 'N', or display strings ending in '(Y)'/'(N)').

    With allow_legacy_labels, clearance labels like 'Đã duyệt' / 'Chưa duyệt' are accepted too.
    Mirrors CLEARANCE_Y_SQL / CLEARANCE_N_SQL / CUST_Y_SQL below.
    """
    if value is None:
        return ""
    s = str(value).strip()
    up = s.upper()
    if up == "Y" or up.endswith("(Y)") or (allow_legacy_labels and "Đã duyệt" in s):
        return "Y"
    if up == "N" or up.endswith("(N)") or (allow_legacy_labels and "Chưa duyệt" in s):
        return "N"
    return ""


def compute_customs_status(cust, custom_clearance_status) -> str:
    clearance = _yn_flag(custom_clearance_status, allow_legacy_labels=True)
    if clearance == "Y":
        return CUSTOMS_CLEARED
    if _yn_flag(cust) == "Y":
        return CUSTOMS_SUPERVISED
    if clearance == "N":
        return CUSTOMS_NOT_CLEARED
    return ""


_CLR = "TRIM(COALESCE(custom_clearance_status, ''))"
_CUST = "TRIM(COALESCE(cust, ''))"
CLEARANCE_Y_SQL = f"(UPPER({_CLR}) = 'Y' OR UPPER({_CLR}) LIKE '%(Y)' OR {_CLR} LIKE '%Đã duyệt%')"
CLEARANCE_N_SQL = f"(UPPER({_CLR}) = 'N' OR UPPER({_CLR}) LIKE '%(N)' OR {_CLR} LIKE '%Chưa duyệt%')"
CUST_Y_SQL = f"(UPPER({_CUST}) = 'Y' OR UPPER({_CUST}) LIKE '%(Y)')"
CUSTOMS_STATUS_SQL = (
    f"(CASE WHEN {CLEARANCE_Y_SQL} THEN '{CUSTOMS_CLEARED}' "
    f"WHEN {CUST_Y_SQL} THEN '{CUSTOMS_SUPERVISED}' "
    f"WHEN {CLEARANCE_N_SQL} THEN '{CUSTOMS_NOT_CLEARED}' ELSE '' END)"
)
# Not cleared = under customs supervision or explicitly not cleared (and clearance != Y)
CUSTOMS_UNCLEARED_SQL = f"(NOT {CLEARANCE_Y_SQL} AND ({CUST_Y_SQL} OR {CLEARANCE_N_SQL}))"

_HREF_RE = re.compile(r"""href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]*>")


def parse_haz(raw) -> tuple[str, str]:
    """Return (text, imdg_url) for an ePort HAZ value that may contain an HTML anchor."""
    if raw is None:
        return "", ""
    s = str(raw)
    if "<" not in s:
        return s.strip(), ""
    url = ""
    m = _HREF_RE.search(s)
    if m:
        url = html.unescape(next(g for g in m.groups() if g is not None)).strip()
    text = html.unescape(_TAG_RE.sub("", s)).strip()
    return text, url


def _enrich_container_row(row: dict) -> dict:
    row["customs_status"] = compute_customs_status(row.get("cust"), row.get("custom_clearance_status"))
    text, url = parse_haz(row.get("haz"))
    row["haz"] = text
    row["imdg_url"] = url
    return row


# ---------------------------------------------------------------------------
# Default color rules
# ---------------------------------------------------------------------------
DEFAULT_COLOR_RULES = [
    # Port codes (Mã cảng)
    {"target_table": "all", "column_key": "site_id", "match_value": "CTL", "match_type": "exact", "preset_id": "blue", "is_enabled": 1},
    {"target_table": "all", "column_key": "site_id", "match_value": "TNT", "match_type": "exact", "preset_id": "emerald", "is_enabled": 1},
    {"target_table": "all", "column_key": "site_id", "match_value": "THP", "match_type": "exact", "preset_id": "amber", "is_enabled": 1},
    {"target_table": "all", "column_key": "site_id", "match_value": "GNL", "match_type": "exact", "preset_id": "purple", "is_enabled": 1},
    {"target_table": "all", "column_key": "site_id", "match_value": "CMS", "match_type": "exact", "preset_id": "teal", "is_enabled": 1},
    {"target_table": "all", "column_key": "site_id", "match_value": "IST", "match_type": "exact", "preset_id": "orange", "is_enabled": 1},
    # Status & Logistics codes
    {"target_table": "container", "column_key": "custom_clearance_status", "match_value": "Chưa duyệt (N)", "match_type": "exact", "preset_id": "rose", "is_enabled": 1},
    {"target_table": "container", "column_key": "custom_clearance_status", "match_value": "N", "match_type": "exact", "preset_id": "rose", "is_enabled": 1},
    {"target_table": "container", "column_key": "custom_clearance_status", "match_value": "Đã duyệt (Y)", "match_type": "exact", "preset_id": "emerald", "is_enabled": 1},
    {"target_table": "container", "column_key": "custom_clearance_status", "match_value": "Y", "match_type": "exact", "preset_id": "emerald", "is_enabled": 1},
    {"target_table": "container", "column_key": "customs_status", "match_value": CUSTOMS_CLEARED, "match_type": "exact", "preset_id": "emerald", "is_enabled": 1},
    {"target_table": "container", "column_key": "customs_status", "match_value": CUSTOMS_SUPERVISED, "match_type": "exact", "preset_id": "amber", "is_enabled": 1},
    {"target_table": "container", "column_key": "customs_status", "match_value": CUSTOMS_NOT_CLEARED, "match_type": "exact", "preset_id": "rose", "is_enabled": 1},
    {"target_table": "container", "column_key": "infras_fee_status", "match_value": "Chưa đóng (3)", "match_type": "exact", "preset_id": "amber", "is_enabled": 1},
    {"target_table": "container", "column_key": "infras_fee_status", "match_value": "3", "match_type": "exact", "preset_id": "amber", "is_enabled": 1},
    {"target_table": "container", "column_key": "fel", "match_value": "F", "match_type": "exact", "preset_id": "blue", "is_enabled": 1},
    {"target_table": "container", "column_key": "fel", "match_value": "E", "match_type": "exact", "preset_id": "slate", "is_enabled": 1},
    {"target_table": "container", "column_key": "vgm", "match_value": "Y", "match_type": "exact", "preset_id": "emerald", "is_enabled": 1},
    {"target_table": "container", "column_key": "event_type", "match_value": "UNLOAD", "match_type": "contains", "preset_id": "sky", "is_enabled": 1},
    {"target_table": "container", "column_key": "event_type", "match_value": "INGATE", "match_type": "contains", "preset_id": "emerald", "is_enabled": 1},
    {"target_table": "container", "column_key": "event_type", "match_value": "OUTGATE", "match_type": "contains", "preset_id": "amber", "is_enabled": 1},
    {"target_table": "container", "column_key": "event_type", "match_value": "STACK", "match_type": "contains", "preset_id": "purple", "is_enabled": 1},
    {"target_table": "container", "column_key": "event_type", "match_value": "LOAD", "match_type": "contains", "preset_id": "teal", "is_enabled": 1},
]

COLOR_RULES_UNIQUE_INDEX = "ux_color_rules_rule"
WATCHLIST_SYNC_COLUMNS = [
    ("last_sync_at", "TEXT"),
    ("last_sync_status", "TEXT"),
    ("last_sync_message", "TEXT"),
]

_COLOR_RULE_INSERT_SQL = """
    INSERT OR IGNORE INTO color_rules (
        target_table, column_key, match_value, match_type,
        preset_id, custom_bg, custom_border, custom_text, is_enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
"""


def _color_rule_key(data: dict) -> tuple[str, str, str, str]:
    return (
        data.get("target_table", "all") or "all",
        data.get("column_key", "all") or "all",
        str(data.get("match_value", "") if data.get("match_value") is not None else "").strip(),
        data.get("match_type", "exact") or "exact",
    )


def _color_rule_params(data: dict, created_at: str) -> tuple:
    is_enabled = data.get("is_enabled", True)
    return (
        *_color_rule_key(data),
        data.get("preset_id"),
        data.get("custom_bg"),
        data.get("custom_border"),
        data.get("custom_text"),
        1 if is_enabled else 0,
        created_at,
    )


def _dedupe_color_rules(conn: sqlite3.Connection) -> int:
    """One-time migration: remove duplicate color rules and add a UNIQUE index. Returns rows removed."""
    has_index = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?;", (COLOR_RULES_UNIQUE_INDEX,)
    ).fetchone()
    if has_index:
        return 0
    cur = conn.execute("""
        DELETE FROM color_rules WHERE id NOT IN (
            SELECT MAX(id) FROM color_rules
            GROUP BY target_table, column_key, match_value, match_type
        );
    """)
    removed = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {COLOR_RULES_UNIQUE_INDEX} "
        f"ON color_rules(target_table, column_key, match_value, match_type);"
    )
    if removed:
        logger.info(f"[DB migration] Removed {removed} duplicate color rule row(s)")
    return removed


def init_db():
    removed_color_rules = 0
    with get_connection() as conn:
        # Create collections table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL,
                settings TEXT
            );
        """)
        _ensure_columns(conn, "collections", [("settings", "TEXT")])

        # Create bookings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                pdf_name TEXT,
                booking_no TEXT,
                carrier TEXT,
                port_of_discharging TEXT,
                place_of_delivery TEXT,
                block_val TEXT,
                ts_port TEXT,
                equipment_type TEXT,
                qty TEXT,
                empty_pickup_cy TEXT,
                full_return_cy TEXT,
                cutoff_time TEXT,
                vessel TEXT,
                etd TEXT,
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE
            );
        """)
        _ensure_columns(conn, "bookings", [("carrier", "TEXT"), ("port_of_discharging", "TEXT")])

        # Legacy vessel_schedules without collection_id are dropped and recreated
        vs_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vessel_schedules';"
        ).fetchone()
        if vs_exists:
            vs_cols = {row[1] for row in conn.execute("PRAGMA table_info(vessel_schedules);").fetchall()}
            if "collection_id" not in vs_cols:
                conn.execute("DROP TABLE IF EXISTS vessel_schedules;")

        # Create vessel_schedules table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vessel_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                site_id TEXT,
                agent TEXT,
                vessel_name TEXT,
                in_out_voyage TEXT,
                actual_berth_time TEXT,
                actual_departure_time TEXT,
                closing_time TEXT,
                closing_time_icd TEXT,
                in_gate TEXT,
                open_ts TEXT,
                reefer_open_ts TEXT,
                oog_open_ts TEXT,
                haz_open_ts TEXT,
                remarks TEXT,
                queried_at TEXT,
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
                UNIQUE(collection_id, site_id, vessel_name, in_out_voyage) ON CONFLICT REPLACE
            );
        """)

        # Create vessel_watchlists table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vessel_watchlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                site_id TEXT NOT NULL,
                vessel_name TEXT NOT NULL,
                voyage TEXT NOT NULL,
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
                UNIQUE(collection_id, site_id, vessel_name, voyage) ON CONFLICT IGNORE
            );
        """)
        _ensure_columns(conn, "vessel_watchlists", WATCHLIST_SYNC_COLUMNS)

        # Create containers table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS containers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                site_id TEXT,
                containerno TEXT NOT NULL,
                event_time TEXT,
                event_type TEXT,
                in_yard TEXT,
                fel TEXT,
                iso TEXT,
                gross REAL,
                container_gross REAL,
                tare_wt REAL,
                manifest_wt REAL,
                gate_wt REAL,
                gate_gross_wt REAL,
                certified_weight REAL,
                vgm TEXT,
                category TEXT,
                cust TEXT,
                location TEXT,
                stack TEXT,
                temp TEXT,
                haz TEXT,
                load_to_vessel TEXT,
                pod_destination TEXT,
                truck_vessel TEXT,
                trans_in TEXT,
                trans_out TEXT,
                cont_in_ts TEXT,
                cont_out_ts TEXT,
                line_oper TEXT,
                im_exp TEXT,
                bill_book TEXT,
                cust_approval_date TEXT,
                note TEXT,
                item_seal_no TEXT,
                custom_clearance_status TEXT,
                infras_fee_status TEXT,
                item_key INTEGER,
                queried_at TEXT,
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
                UNIQUE(collection_id, containerno, event_time, event_type) ON CONFLICT REPLACE
            );
        """)
        _ensure_columns(conn, "containers", [
            ("in_yard", "TEXT"),
            ("stack", "TEXT"),
            ("temp", "TEXT"),
            ("haz", "TEXT"),
            ("load_to_vessel", "TEXT"),
            ("pod_destination", "TEXT"),
            ("cont_in_ts", "TEXT"),
            ("cont_out_ts", "TEXT"),
            ("gate_gross_wt", "REAL"),
            ("container_gross", "REAL"),
            ("manifest_wt", "REAL"),
            ("tare_wt", "REAL"),
            ("certified_weight", "REAL"),
            ("item_key", "INTEGER"),
        ])

        # Create container_watchlists table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS container_watchlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                site_id TEXT NOT NULL,
                container_no TEXT NOT NULL,
                event_type TEXT DEFAULT '',
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
                UNIQUE(collection_id, site_id, container_no, event_type) ON CONFLICT IGNORE
            );
        """)
        _ensure_columns(conn, "container_watchlists", [("event_type", "TEXT DEFAULT ''"), *WATCHLIST_SYNC_COLUMNS])

        # Indexes for common lookups (watchlists are covered by their UNIQUE autoindexes,
        # whose leading column is collection_id)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_collection ON bookings(collection_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vessel_schedules_col_queried ON vessel_schedules(collection_id, queried_at);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_containers_col_queried ON containers(collection_id, queried_at);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_containers_col_event ON containers(collection_id, event_type);")

        # Create color_rules table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS color_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_table TEXT NOT NULL DEFAULT 'all',
                column_key TEXT NOT NULL DEFAULT 'all',
                match_value TEXT NOT NULL,
                match_type TEXT NOT NULL DEFAULT 'exact',
                preset_id TEXT,
                custom_bg TEXT,
                custom_border TEXT,
                custom_text TEXT,
                is_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
        """)
        removed_color_rules = _dedupe_color_rules(conn)

        # Seed default color rules if missing (same table/column/value counts as present)
        now_str = _now_str()
        for r in DEFAULT_COLOR_RULES:
            exists = conn.execute("""
                SELECT 1 FROM color_rules
                WHERE target_table = ? AND column_key = ? AND match_value = ? LIMIT 1;
            """, (r["target_table"], r["column_key"], r["match_value"])).fetchone()
            if not exists:
                conn.execute(_COLOR_RULE_INSERT_SQL, _color_rule_params(r, now_str))

        # Create system_settings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

    if removed_color_rules > 0:
        # VACUUM cannot run inside a transaction; reclaim the space freed by the dedupe.
        try:
            with get_connection() as conn:
                conn.execute("VACUUM;")
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        except sqlite3.Error as e:
            logger.warning(f"[DB migration] VACUUM after color rule dedupe failed: {e}")


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------
def create_collection(name: str) -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO collections (name, created_at) VALUES (?, ?);",
            (name, _now_str())
        )
        return cursor.lastrowid


def get_collections() -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM collections ORDER BY name ASC;")
        return [dict(row) for row in cursor.fetchall()]


def delete_collection(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM collections WHERE id = ?;", (col_id,))


def update_collection_settings(col_id: int, settings_str: str):
    with get_connection() as conn:
        conn.execute("UPDATE collections SET settings = ? WHERE id = ?;", (settings_str, col_id))


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------
def _insert_booking_row(cursor: sqlite3.Cursor, col_id: int, data: dict) -> int:
    cursor.execute("""
        INSERT INTO bookings (
            collection_id, pdf_name, booking_no, carrier, port_of_discharging, place_of_delivery, block_val,
            ts_port, equipment_type, qty, empty_pickup_cy, full_return_cy,
            cutoff_time, vessel, etd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (
        col_id,
        data.get("Tên file PDF", data.get("pdf_name", "")),
        data.get("Booking No", data.get("booking_no", "")),
        data.get("Carrier", data.get("carrier", "")),
        data.get("Port of Discharging", data.get("port_of_discharging", "")),
        data.get("Place of Delivery", data.get("place_of_delivery", "")),
        data.get("Block", data.get("block_val", "")),
        data.get("T/S Port", data.get("ts_port", "")),
        data.get("Equipment Type", data.get("equipment_type", "")),
        data.get("Q'ty", data.get("qty", "")),
        data.get("Empty Pick Up CY", data.get("empty_pickup_cy", "")),
        data.get("Full return CY", data.get("full_return_cy", "")),
        data.get("Port Cargo Cut-off", data.get("cutoff_time", "")),
        data.get("Vessel", data.get("vessel", "")),
        data.get("ETD", data.get("etd", ""))
    ))
    return cursor.lastrowid


def insert_booking(col_id: int, data: dict) -> int:
    with get_connection() as conn:
        return _insert_booking_row(conn.cursor(), col_id, data)


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


def get_booking_collection_id(booking_id: int) -> int | None:
    with get_connection() as conn:
        row = conn.execute("SELECT collection_id FROM bookings WHERE id = ?;", (booking_id,)).fetchone()
    return row[0] if row else None


BOOKING_SEARCH_COLUMNS = {
    "pdf_name", "booking_no", "carrier", "port_of_discharging", "place_of_delivery", "block_val",
    "ts_port", "equipment_type", "qty", "empty_pickup_cy", "full_return_cy", "cutoff_time", "vessel", "etd"
}
_BOOKING_ALL_FIELDS = ("pdf_name", "booking_no", "carrier", "port_of_discharging", "place_of_delivery", "block_val",
                       "ts_port", "equipment_type", "empty_pickup_cy", "full_return_cy", "vessel", "etd")


def _booking_where(col_id: int, search_query: str = None, search_field: str = None) -> tuple[str, list]:
    where = "collection_id = ?"
    params: list = [col_id]
    if search_query:
        q = f"%{search_query}%"
        if search_field and search_field != "all" and search_field in BOOKING_SEARCH_COLUMNS:
            where += f" AND {search_field} LIKE ?"
            params.append(q)
        else:
            where += " AND (" + " OR ".join(f"{c} LIKE ?" for c in _BOOKING_ALL_FIELDS) + ")"
            params.extend([q] * len(_BOOKING_ALL_FIELDS))
    return where, params


def _fallback_carrier(row: dict) -> str:
    carrier_val = row.get("carrier")
    if carrier_val and carrier_val != "null":
        return carrier_val
    b_no = row.get("booking_no", "") or ""
    upper_check = f"{b_no} {row.get('vessel', '') or ''} {row.get('pdf_name', '') or ''}".upper()
    if "DONGJIN" in upper_check or "DJSC" in upper_check or b_no.startswith("DJ"):
        return "DONGJIN"
    if "PIL" in upper_check or b_no.startswith("SGN6") or "KOTA" in upper_check:
        return "PIL"
    if "ONE" in upper_check or b_no.startswith("ONEY"):
        return "ONE"
    if "SITC" in upper_check:
        return "SITC"
    if "COSCO" in upper_check:
        return "COSCO"
    return "Khác"


def _booking_row_to_api(row: dict) -> dict:
    return {
        "id": row["id"],
        "Tên file PDF": row["pdf_name"],
        "Booking No": row["booking_no"],
        "Carrier": _fallback_carrier(row),
        "Port of Discharging": row["port_of_discharging"],
        "Place of Delivery": row["place_of_delivery"],
        "Block": row["block_val"],
        "T/S Port": row["ts_port"],
        "Equipment Type": row["equipment_type"],
        "Q'ty": row["qty"],
        "Empty Pick Up CY": row["empty_pickup_cy"],
        "Full return CY": row["full_return_cy"],
        "Port Cargo Cut-off": row["cutoff_time"],
        "Vessel": row["vessel"],
        "ETD": row["etd"],
    }


def get_bookings(col_id: int, search_query: str = None, search_field: str = None) -> list[dict]:
    where, params = _booking_where(col_id, search_query, search_field)
    with get_connection() as conn:
        rows = _select_dicts(conn, f"SELECT * FROM bookings WHERE {where} ORDER BY id ASC;", tuple(params))
    return [_booking_row_to_api(r) for r in rows]


def get_bookings_page(col_id: int, limit: int = PAGE_DEFAULT_LIMIT, offset: int = 0,
                      search_query: str = None, search_field: str = None) -> dict:
    limit, offset = _page_bounds(limit, offset)
    where, params = _booking_where(col_id, search_query, search_field)
    with get_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM bookings WHERE {where};", tuple(params)).fetchone()[0]
        rows = _select_dicts(conn, f"SELECT * FROM bookings WHERE {where} ORDER BY id ASC LIMIT ? OFFSET ?;",
                             (*params, limit, offset))
    return {"items": [_booking_row_to_api(r) for r in rows], "total": total}


def get_booking_ids(col_id: int, search_query: str = None, search_field: str = None) -> list[int]:
    where, params = _booking_where(col_id, search_query, search_field)
    with get_connection() as conn:
        return [r[0] for r in conn.execute(f"SELECT id FROM bookings WHERE {where} ORDER BY id ASC;",
                                           tuple(params)).fetchall()]


def get_bookings_by_ids(ids: list[int]) -> list[dict]:
    clean = _clean_ids(ids)
    rows = []
    with get_connection() as conn:
        for chunk in _chunks(clean):
            placeholders = ",".join(["?"] * len(chunk))
            rows.extend(_select_dicts(conn, f"SELECT * FROM bookings WHERE id IN ({placeholders});", tuple(chunk)))
    rows.sort(key=lambda r: r["id"])
    return [_booking_row_to_api(r) for r in rows]


def delete_booking(booking_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM bookings WHERE id = ?;", (booking_id,))


def delete_bookings_batch(booking_ids: list[int]) -> int:
    ids = _clean_ids(booking_ids)
    if not ids:
        return 0
    deleted = 0
    with get_connection() as conn:
        for chunk in _chunks(ids):
            placeholders = ",".join(["?"] * len(chunk))
            cur = conn.execute(f"DELETE FROM bookings WHERE id IN ({placeholders});", tuple(chunk))
            deleted += max(cur.rowcount, 0)
    return deleted


def clear_bookings(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM bookings WHERE collection_id = ?;", (col_id,))


# ---------------------------------------------------------------------------
# Backup / restore
# ---------------------------------------------------------------------------
def _strip_keys(rows: list[dict], keys=("id", "collection_id")) -> list[dict]:
    for r in rows:
        for k in keys:
            r.pop(k, None)
    return rows


def _select_dicts(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def export_backup_data() -> dict:
    collections = get_collections()
    backup_data = []

    for col in collections:
        bookings = _strip_keys(get_bookings(col["id"]))
        with get_connection() as conn:
            vessels = _strip_keys(_select_dicts(
                conn, "SELECT * FROM vessel_schedules WHERE collection_id = ? ORDER BY queried_at DESC, id ASC;", (col["id"],)))
            # Raw container rows (haz keeps its original HTML so the IMDG link survives a restore)
            containers = _strip_keys(_select_dicts(
                conn, "SELECT * FROM containers WHERE collection_id = ? ORDER BY queried_at DESC, id ASC;", (col["id"],)))
            v_watchlists = _strip_keys(_select_dicts(
                conn, "SELECT * FROM vessel_watchlists WHERE collection_id = ? ORDER BY id ASC;", (col["id"],)))
            c_watchlists = _strip_keys(_select_dicts(
                conn, "SELECT * FROM container_watchlists WHERE collection_id = ? ORDER BY id ASC;", (col["id"],)))

        backup_data.append({
            "name": col["name"],
            "created_at": col["created_at"],
            "settings": col.get("settings"),
            "bookings": bookings,
            "vessel_schedules": vessels,
            "containers": containers,
            "vessel_watchlists": v_watchlists,
            "container_watchlists": c_watchlists
        })

    color_rules = _strip_keys(get_color_rules(), keys=("id",))

    return {
        "collections": backup_data,
        "color_rules": color_rules
    }


RESTORE_MODES = ("merge", "replace")


def _insert_collection_unique(cursor: sqlite3.Cursor, name: str, created_at: str, settings) -> int:
    base_name = (name or "").strip() or "Imported Collection"
    candidate = base_name
    exists = cursor.execute("SELECT 1 FROM collections WHERE name = ?;", (candidate,)).fetchone()
    if exists:
        suffix = datetime.now(VN_TZ).strftime("%Y%m%d%H%M%S")
        candidate = f"{base_name}_imported_{suffix}"
        n = 2
        while cursor.execute("SELECT 1 FROM collections WHERE name = ?;", (candidate,)).fetchone():
            candidate = f"{base_name}_imported_{suffix}_{n}"
            n += 1
    cursor.execute(
        "INSERT INTO collections (name, created_at, settings) VALUES (?, ?, ?);",
        (candidate, created_at, settings)
    )
    return cursor.lastrowid


def _merge_collection(cursor: sqlite3.Cursor, name: str, created_at: str, settings) -> int:
    base_name = (name or "").strip() or "Imported Collection"
    row = cursor.execute("SELECT id FROM collections WHERE name = ?;", (base_name,)).fetchone()
    if not row:
        return _insert_collection_unique(cursor, base_name, created_at, settings)
    if settings is not None:
        cursor.execute("UPDATE collections SET settings = ? WHERE id = ?;", (settings, row[0]))
    return row[0]


def import_backup_data(backup_data: dict, mode: str = "merge"):
    """
    mode="merge": same-name collections are merged; on conflicts the backup row wins.
    mode="replace": all collections (with their rows) and color rules are deleted first.
    System settings are never touched. Runs in ONE transaction.
    """
    if mode not in RESTORE_MODES:
        raise ValueError(f"Invalid restore mode: {mode}")
    if not isinstance(backup_data, dict) or "collections" not in backup_data:
        raise ValueError("Invalid backup format")
    collections = backup_data.get("collections") or []
    if not isinstance(collections, list):
        raise ValueError("Invalid backup format")
    color_rules = backup_data.get("color_rules")
    has_rules = isinstance(color_rules, list) and bool(color_rules)

    now_str = _now_str()
    # Everything runs in ONE transaction: either the whole backup is restored or nothing is.
    with get_connection() as conn:
        cursor = conn.cursor()
        if mode == "replace":
            cursor.execute("DELETE FROM collections;")  # ON DELETE CASCADE removes rows + watchlists
            if has_rules:
                cursor.execute("DELETE FROM color_rules;")

        for col_data in collections:
            if not isinstance(col_data, dict):
                continue
            created_at = col_data.get("created_at") or now_str
            col_id = _merge_collection(cursor, col_data.get("name"), created_at, col_data.get("settings"))

            for b in col_data.get("bookings") or []:
                booking_no = (b.get("Booking No", b.get("booking_no")) or "").strip()
                pdf_name = b.get("Tên file PDF", b.get("pdf_name")) or ""
                if booking_no:
                    cursor.execute(
                        "DELETE FROM bookings WHERE collection_id = ? AND booking_no = ? AND COALESCE(pdf_name, '') = ?;",
                        (col_id, booking_no, pdf_name))
                _insert_booking_row(cursor, col_id, b)

            vessels = col_data.get("vessel_schedules") or []
            if vessels:
                _insert_vessel_rows(cursor, col_id, vessels, now_str, preserve_queried_at=True)

            containers = col_data.get("containers") or []
            if containers:
                _insert_container_rows(cursor, col_id, containers, now_str, preserve_queried_at=True)

            v_items = [
                ((vw.get("site_id") or "").strip(), (vw.get("vessel_name") or "").strip(), (vw.get("voyage") or "").strip())
                for vw in (col_data.get("vessel_watchlists") or []) if isinstance(vw, dict)
            ]
            cursor.executemany("""
                INSERT OR IGNORE INTO vessel_watchlists (collection_id, site_id, vessel_name, voyage)
                VALUES (?, ?, ?, ?);
            """, [(col_id, *it) for it in v_items if it[1]])

            c_items = [
                ((cw.get("site_id") or "").strip().upper(), (cw.get("container_no") or "").strip().upper(),
                 (cw.get("event_type") or "").strip().upper())
                for cw in (col_data.get("container_watchlists") or []) if isinstance(cw, dict)
            ]
            cursor.executemany("""
                INSERT OR IGNORE INTO container_watchlists (collection_id, site_id, container_no, event_type)
                VALUES (?, ?, ?, ?);
            """, [(col_id, *it) for it in c_items if it[1]])

        if has_rules:
            # Old backups may contain duplicates: the last occurrence wins (matches the UI, which
            # applies the newest rule), then INSERT OR IGNORE can't keep a stale earlier copy
            latest = {}
            for cr in color_rules:
                if isinstance(cr, dict) and cr.get("match_value") not in (None, ""):
                    key = _color_rule_key(cr)
                    latest.pop(key, None)
                    latest[key] = cr
            if mode == "merge":
                cursor.executemany(
                    "DELETE FROM color_rules WHERE target_table = ? AND column_key = ? AND match_value = ? AND match_type = ?;",
                    list(latest.keys()))
            cursor.executemany(_COLOR_RULE_INSERT_SQL, [
                _color_rule_params(cr, cr.get("created_at") or now_str) for cr in latest.values()
            ])


# ---------------------------------------------------------------------------
# Vessel schedules
# ---------------------------------------------------------------------------
def _insert_vessel_rows(cursor: sqlite3.Cursor, col_id: int, schedules: list[dict], queried_at: str,
                        preserve_queried_at: bool = False) -> list[int]:
    inserted_ids = []
    for s in schedules:
        row_queried_at = (s.get("queried_at") or queried_at) if preserve_queried_at else queried_at
        cursor.execute("""
            INSERT OR REPLACE INTO vessel_schedules (
                collection_id, site_id, agent, vessel_name, in_out_voyage, actual_berth_time,
                actual_departure_time, closing_time, closing_time_icd, in_gate,
                open_ts, reefer_open_ts, oog_open_ts, haz_open_ts, remarks, queried_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            col_id,
            s.get("SITE_ID", s.get("site_id", "")),
            s.get("AGENT", s.get("agent", "")),
            s.get("VESSELNAME", s.get("vessel_name", "")),
            s.get("IN_OUT_VOYAGE", s.get("in_out_voyage", "")),
            s.get("ACTUAL_BERTH_TIME", s.get("actual_berth_time", "")),
            s.get("ACTUAL_DEPATURE_TIME", s.get("actual_departure_time", "")),
            s.get("CLOSING_TIME", s.get("closing_time", "")),
            s.get("CLOSING_TIME_ICD", s.get("closing_time_icd", "")),
            s.get("IN_GATE", s.get("in_gate", "")),
            s.get("OPEN_TS", s.get("open_ts", "")),
            s.get("REEFER_OPEN_TS", s.get("reefer_open_ts", "")),
            s.get("OOG_OPEN_TS", s.get("oog_open_ts", "")),
            s.get("HAZ_OPEN_TS", s.get("haz_open_ts", "")),
            s.get("REMARKS", s.get("remarks", "")),
            row_queried_at
        ))
        if cursor.lastrowid:
            inserted_ids.append(cursor.lastrowid)
    return inserted_ids


def insert_vessel_schedules(col_id: int, schedules: list[dict]) -> list[int]:
    with get_connection() as conn:
        return _insert_vessel_rows(conn.cursor(), col_id, schedules, _now_str())


_VESSEL_ORDER = "ORDER BY queried_at DESC, id ASC"
VESSEL_SEARCH_COLUMNS = {
    "site_id", "agent", "vessel_name", "in_out_voyage", "actual_berth_time",
    "actual_departure_time", "closing_time", "closing_time_icd", "in_gate",
    "open_ts", "reefer_open_ts", "oog_open_ts", "haz_open_ts", "remarks", "queried_at"
}


def _vessel_where(col_id: int, search_query: str = None, search_field: str = None) -> tuple[str, list]:
    where = "collection_id = ?"
    params: list = [col_id]
    if search_query:
        q = f"%{search_query}%"
        if search_field and search_field != "all" and search_field in VESSEL_SEARCH_COLUMNS:
            where += f" AND {search_field} LIKE ?"
            params.append(q)
        else:
            where += (" AND (site_id LIKE ? OR agent LIKE ? OR vessel_name LIKE ? OR in_out_voyage LIKE ? "
                      "OR remarks LIKE ? OR closing_time LIKE ? OR in_gate LIKE ?)")
            params.extend([q] * 7)
    return where, params


def get_vessel_schedules(col_id: int, search_query: str = None, search_field: str = None) -> list[dict]:
    where, params = _vessel_where(col_id, search_query, search_field)
    with get_connection() as conn:
        return _select_dicts(conn, f"SELECT * FROM vessel_schedules WHERE {where} {_VESSEL_ORDER};", tuple(params))


def get_vessel_schedules_page(col_id: int, limit: int = PAGE_DEFAULT_LIMIT, offset: int = 0,
                              search_query: str = None, search_field: str = None) -> dict:
    limit, offset = _page_bounds(limit, offset)
    where, params = _vessel_where(col_id, search_query, search_field)
    with get_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM vessel_schedules WHERE {where};", tuple(params)).fetchone()[0]
        items = _select_dicts(
            conn, f"SELECT * FROM vessel_schedules WHERE {where} {_VESSEL_ORDER} LIMIT ? OFFSET ?;",
            (*params, limit, offset))
    return {"items": items, "total": total}


def get_vessel_schedule_ids(col_id: int, search_query: str = None, search_field: str = None) -> list[int]:
    where, params = _vessel_where(col_id, search_query, search_field)
    with get_connection() as conn:
        return [r[0] for r in conn.execute(
            f"SELECT id FROM vessel_schedules WHERE {where} {_VESSEL_ORDER};", tuple(params)).fetchall()]


def get_vessel_schedules_by_ids(ids: list[int]) -> list[dict]:
    clean = _clean_ids(ids)
    if not clean:
        return []
    rows = []
    with get_connection() as conn:
        for chunk in _chunks(clean):
            placeholders = ",".join(["?"] * len(chunk))
            rows.extend(_select_dicts(conn, f"SELECT * FROM vessel_schedules WHERE id IN ({placeholders});", tuple(chunk)))
    rows.sort(key=lambda r: (r.get("queried_at") or "", -r["id"]), reverse=True)
    return rows


def delete_vessel_schedule(schedule_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM vessel_schedules WHERE id = ?;", (schedule_id,))


def delete_vessel_schedules_batch(schedule_ids: list[int]) -> int:
    ids = _clean_ids(schedule_ids)
    if not ids:
        return 0
    deleted = 0
    with get_connection() as conn:
        for chunk in _chunks(ids):
            placeholders = ",".join(["?"] * len(chunk))
            cur = conn.execute(f"DELETE FROM vessel_schedules WHERE id IN ({placeholders});", tuple(chunk))
            deleted += max(cur.rowcount, 0)
    return deleted


def clear_vessel_schedules(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM vessel_schedules WHERE collection_id = ?;", (col_id,))


# ---------------------------------------------------------------------------
# Vessel watchlists
# ---------------------------------------------------------------------------
def get_watchlist(col_id: int) -> list[dict]:
    with get_connection() as conn:
        return _select_dicts(conn, "SELECT * FROM vessel_watchlists WHERE collection_id = ? ORDER BY id ASC;", (col_id,))


def get_all_watchlists() -> list[dict]:
    with get_connection() as conn:
        return _select_dicts(conn, "SELECT * FROM vessel_watchlists ORDER BY id ASC;")


def add_to_watchlist(col_id: int, site_id: str, vessel_name: str, voyage: str):
    with get_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO vessel_watchlists (collection_id, site_id, vessel_name, voyage)
            VALUES (?, ?, ?, ?);
        """, (col_id, (site_id or "").strip(), (vessel_name or "").strip(), (voyage or "").strip()))


def add_vessel_watchlist_batch(col_id: int, items: list[dict]) -> int:
    rows = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        vessel_name = (it.get("vessel_name") or "").strip()
        if not vessel_name:
            continue
        rows.append((col_id, (it.get("site_id") or "").strip(), vessel_name, (it.get("voyage") or "").strip()))
    if not rows:
        return 0
    with get_connection() as conn:
        before = conn.total_changes
        conn.executemany("""
            INSERT OR IGNORE INTO vessel_watchlists (collection_id, site_id, vessel_name, voyage)
            VALUES (?, ?, ?, ?);
        """, rows)
        return conn.total_changes - before


def remove_from_watchlist(watchlist_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM vessel_watchlists WHERE id = ?;", (watchlist_id,))


def remove_vessel_watchlist_batch(watchlist_ids: list[int]) -> int:
    return _delete_by_ids("vessel_watchlists", watchlist_ids)


def _delete_by_ids(table: str, ids: list[int]) -> int:
    clean = _clean_ids(ids)
    if not clean:
        return 0
    deleted = 0
    with get_connection() as conn:
        for chunk in _chunks(clean):
            placeholders = ",".join(["?"] * len(chunk))
            cur = conn.execute(f"DELETE FROM {table} WHERE id IN ({placeholders});", tuple(chunk))
            deleted += max(cur.rowcount, 0)
    return deleted


_WATCHLIST_TABLES = {"vessel": "vessel_watchlists", "container": "container_watchlists"}
_SYNC_STATUSES = {"ok", "not_found", "error"}


def update_watchlist_sync_status(kind: str, watchlist_id: int, status: str, message: str = "") -> None:
    table = _WATCHLIST_TABLES.get(kind)
    if not table:
        raise ValueError(f"Invalid watchlist kind: {kind}")
    if status not in _SYNC_STATUSES:
        raise ValueError(f"Invalid sync status: {status}")
    with get_connection() as conn:
        conn.execute(
            f"UPDATE {table} SET last_sync_at = ?, last_sync_status = ?, last_sync_message = ? WHERE id = ?;",
            (_now_str(), status, (message or "")[:1000], watchlist_id)
        )


# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------
def _s(val, default=""):
    if val is None:
        return default
    return str(val).strip()


def _f(val, default=0.0):
    if val is None or val == "" or val == "null":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _i(val, default=None):
    if val is None or val == "" or val == "null":
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _insert_container_rows(cursor: sqlite3.Cursor, col_id: int, containers: list[dict], queried_at: str,
                           preserve_queried_at: bool = False) -> list[int]:
    inserted_ids = []
    for c in containers:
        site_val = _s(c.get("SITE", c.get("site_id", ""))).upper()
        cont_val = _s(c.get("CONTAINERNO", c.get("containerno", ""))).upper()
        if not cont_val:
            continue
        row_queried_at = (c.get("queried_at") or queried_at) if preserve_queried_at else queried_at

        cursor.execute("""
            INSERT OR REPLACE INTO containers (
                collection_id, site_id, containerno, event_time, event_type, in_yard, fel, iso,
                gross, container_gross, tare_wt, manifest_wt, gate_wt, gate_gross_wt, certified_weight,
                vgm, category, cust, location, stack, temp, haz, load_to_vessel, pod_destination,
                truck_vessel, trans_in, trans_out, cont_in_ts, cont_out_ts, line_oper, im_exp,
                bill_book, cust_approval_date, note, item_seal_no, custom_clearance_status,
                infras_fee_status, item_key, queried_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            col_id,
            site_val,
            cont_val,
            _s(c.get("EVENT_TIME", c.get("event_time", ""))),
            _s(c.get("EVENT_TYPE", c.get("event_type", ""))),
            _s(c.get("IN_YARD", c.get("in_yard", ""))),
            _s(c.get("FEL", c.get("fel", ""))),
            _s(c.get("ISO", c.get("iso", ""))),
            _f(c.get("GROSS", c.get("gross", 0.0))),
            _f(c.get("CONTAINER_GROSS", c.get("container_gross", 0.0))),
            _f(c.get("TARE_WT", c.get("tare_wt", 0.0))),
            _f(c.get("MANIFEST_WT", c.get("manifest_wt", 0.0))),
            _f(c.get("GATE_WT", c.get("gate_wt", 0.0))),
            _f(c.get("GATE_GROSS_WT", c.get("gate_gross_wt", 0.0))),
            _f(c.get("CERTIFIED_WEIGHT", c.get("certified_weight", 0.0))),
            _s(c.get("VGM", c.get("vgm", ""))),
            _s(c.get("CATEGORY", c.get("category", ""))),
            _s(c.get("CUST", c.get("cust", ""))),
            _s(c.get("LOCATION", c.get("location", ""))),
            _s(c.get("STACK", c.get("stack", ""))),
            _s(c.get("TEMP", c.get("temp", ""))),
            _s(c.get("HAZ", c.get("haz", ""))),
            _s(c.get("LOAD_TO_VESSEL", c.get("load_to_vessel", ""))),
            _s(c.get("POD_DESTINATION", c.get("pod_destination", ""))),
            _s(c.get("TRUCK_VESSEL", c.get("truck_vessel", ""))),
            _s(c.get("TRANS_IN", c.get("trans_in", ""))),
            _s(c.get("TRANS_OUT", c.get("trans_out", ""))),
            _s(c.get("CONT_IN_TS", c.get("cont_in_ts", ""))),
            _s(c.get("CONT_OUT_TS", c.get("cont_out_ts", ""))),
            _s(c.get("LINE_OPER", c.get("line_oper", ""))),
            _s(c.get("IM_EXP", c.get("im_exp", ""))),
            _s(c.get("BILL_BOOK", c.get("bill_book", ""))),
            _s(c.get("CUST_APPROVAL_DATE", c.get("cust_approval_date", ""))),
            _s(c.get("NOTE", c.get("note", ""))),
            _s(c.get("ITEM_SEAL_NO", c.get("item_seal_no", ""))),
            _s(c.get("CUSTOM_CLEARANCE_STATUS", c.get("custom_clearance_status", ""))),
            _s(c.get("INFRAS_FEE_STATUS", c.get("infras_fee_status", ""))),
            _i(c.get("ITEM_KEY", c.get("item_key", None))),
            row_queried_at
        ))
        if cursor.lastrowid:
            inserted_ids.append(cursor.lastrowid)
    return inserted_ids


def insert_containers(col_id: int, containers: list[dict]) -> list[int]:
    with get_connection() as conn:
        return _insert_container_rows(conn.cursor(), col_id, containers, _now_str())


CONTAINER_SEARCH_COLUMNS = {
    "site_id", "containerno", "event_time", "event_type", "in_yard", "fel", "iso", "gross",
    "container_gross", "tare_wt", "manifest_wt", "gate_wt", "gate_gross_wt", "certified_weight",
    "vgm", "category", "cust", "location", "stack", "temp", "haz", "load_to_vessel", "pod_destination",
    "truck_vessel", "trans_in", "trans_out", "cont_in_ts", "cont_out_ts", "line_oper", "im_exp",
    "bill_book", "cust_approval_date", "note", "item_seal_no", "custom_clearance_status",
    "infras_fee_status", "item_key", "queried_at", "customs_status"
}


_CONTAINER_ORDER = "ORDER BY queried_at DESC, id ASC"


def _container_where(col_id: int, search_query: str = None, search_field: str = None,
                     event_type: str = None) -> tuple[str, list]:
    where = "collection_id = ?"
    params: list = [col_id]
    if search_query:
        q = f"%{search_query}%"
        if search_field and search_field != "all" and search_field in CONTAINER_SEARCH_COLUMNS:
            expr = CUSTOMS_STATUS_SQL if search_field == "customs_status" else search_field
            where += f" AND {expr} LIKE ?"
            params.append(q)
        else:
            where += f""" AND (
                site_id LIKE ? OR containerno LIKE ? OR event_type LIKE ? OR
                location LIKE ? OR truck_vessel LIKE ? OR line_oper LIKE ? OR
                im_exp LIKE ? OR bill_book LIKE ? OR note LIKE ? OR item_seal_no LIKE ? OR
                custom_clearance_status LIKE ? OR infras_fee_status LIKE ? OR pod_destination LIKE ? OR
                {CUSTOMS_STATUS_SQL} LIKE ?
            )"""
            params.extend([q] * 14)
    ev = (event_type or "").strip().upper()
    if ev and ev != "ALL":
        where += " AND UPPER(TRIM(COALESCE(event_type, ''))) = ?"
        params.append(ev)
    return where, params


def get_containers(col_id: int, search_query: str = None, search_field: str = None) -> list[dict]:
    where, params = _container_where(col_id, search_query, search_field)
    with get_connection() as conn:
        rows = _select_dicts(conn, f"SELECT * FROM containers WHERE {where} {_CONTAINER_ORDER};", tuple(params))
    return [_enrich_container_row(r) for r in rows]


def get_containers_page(col_id: int, limit: int = PAGE_DEFAULT_LIMIT, offset: int = 0, search_query: str = None,
                        search_field: str = None, event_type: str = None) -> dict:
    limit, offset = _page_bounds(limit, offset)
    base_where, base_params = _container_where(col_id, search_query, search_field)
    where, params = _container_where(col_id, search_query, search_field, event_type)
    with get_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM containers WHERE {where};", tuple(params)).fetchone()[0]
        counts = {
            ev: n for ev, n in conn.execute(
                f"SELECT UPPER(TRIM(COALESCE(event_type, ''))) AS ev, COUNT(*) FROM containers "
                f"WHERE {base_where} GROUP BY ev;", tuple(base_params)
            ).fetchall()
        }
        rows = _select_dicts(
            conn, f"SELECT * FROM containers WHERE {where} {_CONTAINER_ORDER} LIMIT ? OFFSET ?;",
            (*params, limit, offset))
    return {"items": [_enrich_container_row(r) for r in rows], "total": total, "event_type_counts": counts}


def get_container_ids(col_id: int, search_query: str = None, search_field: str = None,
                      event_type: str = None) -> list[int]:
    where, params = _container_where(col_id, search_query, search_field, event_type)
    with get_connection() as conn:
        return [r[0] for r in conn.execute(
            f"SELECT id FROM containers WHERE {where} {_CONTAINER_ORDER};", tuple(params)).fetchall()]


def get_containers_by_ids(ids: list[int]) -> list[dict]:
    clean = _clean_ids(ids)
    if not clean:
        return []
    rows = []
    with get_connection() as conn:
        for chunk in _chunks(clean):
            placeholders = ",".join(["?"] * len(chunk))
            rows.extend(_select_dicts(conn, f"SELECT * FROM containers WHERE id IN ({placeholders});", tuple(chunk)))
    rows.sort(key=lambda r: (r.get("queried_at") or "", -r["id"]), reverse=True)
    return [_enrich_container_row(r) for r in rows]


def delete_container(cont_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM containers WHERE id = ?;", (cont_id,))


def delete_containers_batch(cont_ids: list[int]) -> int:
    return _delete_by_ids("containers", cont_ids)


def clear_containers(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM containers WHERE collection_id = ?;", (col_id,))


# ---------------------------------------------------------------------------
# Container watchlists
# ---------------------------------------------------------------------------
def get_container_watchlist(col_id: int) -> list[dict]:
    with get_connection() as conn:
        return _select_dicts(conn, "SELECT * FROM container_watchlists WHERE collection_id = ? ORDER BY id ASC;", (col_id,))


def get_all_container_watchlists() -> list[dict]:
    with get_connection() as conn:
        return _select_dicts(conn, "SELECT * FROM container_watchlists ORDER BY id ASC;")


def add_to_container_watchlist(col_id: int, site_id: str, container_no: str, event_type: str = ""):
    with get_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO container_watchlists (collection_id, site_id, container_no, event_type)
            VALUES (?, ?, ?, ?);
        """, (
            col_id,
            (site_id or "").strip().upper(),
            (container_no or "").strip().upper(),
            (event_type or "").strip().upper()
        ))


def add_container_watchlist_batch(col_id: int, items: list[dict]) -> int:
    rows = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        container_no = (it.get("container_no") or "").strip().upper()
        if not container_no:
            continue
        rows.append((
            col_id,
            (it.get("site_id") or "").strip().upper(),
            container_no,
            (it.get("event_type") or "").strip().upper()
        ))
    if not rows:
        return 0
    with get_connection() as conn:
        before = conn.total_changes
        conn.executemany("""
            INSERT OR IGNORE INTO container_watchlists (collection_id, site_id, container_no, event_type)
            VALUES (?, ?, ?, ?);
        """, rows)
        return conn.total_changes - before


def remove_from_container_watchlist(watchlist_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM container_watchlists WHERE id = ?;", (watchlist_id,))


def remove_container_watchlist_batch(watchlist_ids: list[int]) -> int:
    return _delete_by_ids("container_watchlists", watchlist_ids)


# ---------------------------------------------------------------------------
# Move / copy between collections
# ---------------------------------------------------------------------------
_ENTITY_TABLES = {"bookings": "bookings", "vessels": "vessel_schedules", "containers": "containers"}


def move_items_to_collection(entity: str, ids: list[int], target_col_id: int, copy: bool = False) -> int:
    table = _ENTITY_TABLES.get(entity)
    if not table:
        raise ValueError(f"Invalid entity: {entity}")
    clean = _clean_ids(ids)
    if not clean:
        return 0
    total = 0
    with get_connection() as conn:
        if not conn.execute("SELECT 1 FROM collections WHERE id = ?;", (target_col_id,)).fetchone():
            raise ValueError(f"Target collection {target_col_id} not found")
        cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table});").fetchall()
                if row[1] not in ("id", "collection_id")]
        col_sql = ", ".join(cols)
        for chunk in _chunks(clean):
            placeholders = ",".join(["?"] * len(chunk))
            if copy:
                cur = conn.execute(f"""
                    INSERT INTO {table} (collection_id, {col_sql})
                    SELECT ?, {col_sql} FROM {table}
                    WHERE id IN ({placeholders}) AND collection_id != ?
                    ORDER BY id ASC;
                """, (target_col_id, *chunk, target_col_id))
            else:
                # vessel_schedules/containers UNIQUE ... ON CONFLICT REPLACE: a moved row replaces
                # an identical row already present in the target collection.
                cur = conn.execute(
                    f"UPDATE {table} SET collection_id = ? WHERE id IN ({placeholders}) AND collection_id != ?;",
                    (target_col_id, *chunk, target_col_id)
                )
            total += max(cur.rowcount, 0)
    return total


# ---------------------------------------------------------------------------
# Color rules
# ---------------------------------------------------------------------------
def get_color_rules(target_table: str = None) -> list[dict]:
    with get_connection() as conn:
        if target_table and target_table != "all":
            rows = _select_dicts(conn, "SELECT * FROM color_rules WHERE target_table = ? OR target_table = 'all' ORDER BY id ASC;", (target_table,))
        else:
            rows = _select_dicts(conn, "SELECT * FROM color_rules ORDER BY id ASC;")
    for d in rows:
        d["is_enabled"] = bool(d.get("is_enabled", 1))
    return rows


def create_color_rule(data: dict) -> int:
    """Insert a rule; if an identical (table, column, value, match_type) rule exists, return its id."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(_COLOR_RULE_INSERT_SQL, _color_rule_params(data, _now_str()))
        if cursor.rowcount and cursor.rowcount > 0:
            return cursor.lastrowid
        row = cursor.execute("""
            SELECT id FROM color_rules
            WHERE target_table = ? AND column_key = ? AND match_value = ? AND match_type = ?;
        """, _color_rule_key(data)).fetchone()
        return row[0] if row else 0


def update_color_rule(rule_id: int, data: dict) -> bool:
    fields = []
    params = []

    for k in ["target_table", "column_key", "match_value", "match_type", "preset_id", "custom_bg", "custom_border", "custom_text"]:
        if k in data and data[k] is not None:
            fields.append(f"{k} = ?")
            params.append(data[k])

    if "is_enabled" in data and data["is_enabled"] is not None:
        fields.append("is_enabled = ?")
        params.append(1 if data["is_enabled"] else 0)

    if not fields:
        return False

    params.append(rule_id)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE color_rules SET {', '.join(fields)} WHERE id = ?;", tuple(params))
        return cursor.rowcount > 0


def delete_color_rule(rule_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM color_rules WHERE id = ?;", (rule_id,))
        return cursor.rowcount > 0


def reset_color_rules_to_default() -> list[dict]:
    now_str = _now_str()
    with get_connection() as conn:
        conn.execute("DELETE FROM color_rules;")
        conn.executemany(_COLOR_RULE_INSERT_SQL, [_color_rule_params(r, now_str) for r in DEFAULT_COLOR_RULES])
    return get_color_rules()


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
def _calculate_teus(qty_str: str, equip_str: str) -> int:
    """Helper to estimate TEUs from quantity and equipment type strings."""
    if not qty_str and not equip_str:
        return 1
    total = 0
    # Search for patterns like '2x40HC', '1 x 20GP', '3*45'
    matches = re.findall(r'(\d+)\s*[*xX]\s*(\d{2})', qty_str or "")
    if matches:
        for count_s, size_s in matches:
            count = int(count_s)
            multiplier = 2 if int(size_s) >= 40 else 1
            total += count * multiplier
        return total if total > 0 else 1

    # Check numeric quantity with equipment type
    digits = re.findall(r'\d+', qty_str or "")
    count = int(digits[0]) if digits else 1
    multiplier = 2 if (equip_str and ("40" in equip_str or "45" in equip_str)) else 1
    return count * multiplier


def get_dashboard_summary(collection_id: int = None) -> dict:
    now_str = _now_str()
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Scope information
        scope_info = {"collection_id": collection_id, "collection_name": "Tất cả bộ sưu tập"}
        if collection_id is not None:
            cursor.execute("SELECT id, name FROM collections WHERE id = ?;", (collection_id,))
            col_row = cursor.fetchone()
            if col_row:
                scope_info = {"collection_id": col_row["id"], "collection_name": col_row["name"]}

        where_clause = "WHERE collection_id = ?" if collection_id is not None else ""
        params = (collection_id,) if collection_id is not None else ()
        and_or_where = "AND" if where_clause else "WHERE"

        # 1. Booking KPIs
        cursor.execute(f"SELECT qty, equipment_type FROM bookings {where_clause};", params)
        booking_rows = cursor.fetchall()
        total_bookings = len(booking_rows)
        total_estimated_teus = sum(_calculate_teus(b["qty"], b["equipment_type"]) for b in booking_rows)

        # 2. Container KPIs (customs uses the merged customs_status logic)
        cursor.execute(f"""
            SELECT
                COUNT(*) as total_containers,
                SUM(CASE WHEN {CUSTOMS_UNCLEARED_SQL} THEN 1 ELSE 0 END) as customs_uncleared,
                SUM(CASE WHEN {CLEARANCE_Y_SQL} THEN 1 ELSE 0 END) as customs_cleared,
                SUM(CASE WHEN infras_fee_status LIKE '%Chưa%' OR infras_fee_status = '3' THEN 1 ELSE 0 END) as infras_unpaid,
                SUM(CASE WHEN infras_fee_status LIKE '%Đã%' OR infras_fee_status = '1' OR infras_fee_status = '2' THEN 1 ELSE 0 END) as infras_paid,
                SUM(CASE WHEN in_yard = 'Y' OR in_yard = '1' OR in_yard LIKE '%in%' THEN 1 ELSE 0 END) as containers_in_yard,
                SUM(CASE WHEN in_yard = 'N' OR in_yard = '0' OR in_yard LIKE '%out%' THEN 1 ELSE 0 END) as containers_out_yard
            FROM containers {where_clause};
        """, params)
        cont_kpi = cursor.fetchone()

        def _kpi(name):
            return (cont_kpi[name] or 0) if cont_kpi else 0

        total_containers = _kpi("total_containers")
        customs_uncleared = _kpi("customs_uncleared")
        customs_cleared = _kpi("customs_cleared")
        infras_unpaid = _kpi("infras_unpaid")
        infras_paid = _kpi("infras_paid")
        containers_in_yard = _kpi("containers_in_yard")
        containers_out_yard = _kpi("containers_out_yard")

        # 3. Vessel KPIs
        cursor.execute(f"SELECT COUNT(*) FROM vessel_schedules {where_clause};", params)
        total_vessels = cursor.fetchone()[0]

        cursor.execute(f"SELECT COUNT(*) FROM vessel_watchlists {where_clause};", params)
        watchlist_vessels = cursor.fetchone()[0]

        cursor.execute(f"SELECT COUNT(*) FROM container_watchlists {where_clause};", params)
        watchlist_containers = cursor.fetchone()[0]

        # 4. Critical Alerts
        cursor.execute(f"""
            SELECT id, booking_no, carrier, cutoff_time, vessel, port_of_discharging
            FROM bookings
            {where_clause} {and_or_where} cutoff_time IS NOT NULL AND cutoff_time != ''
            ORDER BY cutoff_time ASC
            LIMIT 10;
        """, params)
        critical_cutoffs = [dict(r) for r in cursor.fetchall()]

        # Uncleared containers (customs not cleared / under supervision, or infras fee unpaid)
        cursor.execute(f"""
            SELECT id, site_id, containerno, event_time, event_type, in_yard, cust,
                   custom_clearance_status, infras_fee_status, fel, iso, location
            FROM containers
            {where_clause} {and_or_where}
                ({CUSTOMS_UNCLEARED_SQL}
                 OR COALESCE(infras_fee_status, '') LIKE '%Chưa%' OR COALESCE(infras_fee_status, '') = '3')
            ORDER BY event_time DESC, id DESC
            LIMIT 10;
        """, params)
        uncleared_containers = []
        for r in cursor.fetchall():
            d = dict(r)
            d["customs_status"] = compute_customs_status(d.get("cust"), d.get("custom_clearance_status"))
            uncleared_containers.append(d)

        # Upcoming vessel berthing
        cursor.execute(f"""
            SELECT id, site_id, vessel_name, in_out_voyage, actual_berth_time, actual_departure_time, closing_time
            FROM vessel_schedules
            {where_clause} {and_or_where}
                (actual_berth_time IS NOT NULL AND actual_berth_time != '')
            ORDER BY actual_berth_time ASC
            LIMIT 10;
        """, params)
        upcoming_vessels = [dict(r) for r in cursor.fetchall()]

        def _distribution(rows):
            total = sum(r["count"] for r in rows) if rows else 1
            return [
                {"name": r["name"], "count": r["count"], "percentage": round((r["count"] / total) * 100, 1)}
                for r in rows
            ]

        # 5. Visual Distributions
        cursor.execute(f"""
            SELECT carrier as name, COUNT(*) as count
            FROM bookings
            {where_clause} {and_or_where} carrier IS NOT NULL AND TRIM(carrier) != ''
            GROUP BY carrier
            ORDER BY count DESC
            LIMIT 8;
        """, params)
        carrier_dist = _distribution(cursor.fetchall())

        cursor.execute(f"""
            SELECT site_id as name, COUNT(*) as count FROM (
                SELECT site_id FROM containers {where_clause}
                UNION ALL
                SELECT site_id FROM vessel_schedules {where_clause}
            )
            WHERE name IS NOT NULL AND TRIM(name) != ''
            GROUP BY name
            ORDER BY count DESC
            LIMIT 8;
        """, (*params, *params) if params else ())
        site_dist = _distribution(cursor.fetchall())

        cursor.execute(f"""
            SELECT equipment_type as name, COUNT(*) as count
            FROM bookings
            {where_clause} {and_or_where} equipment_type IS NOT NULL AND TRIM(equipment_type) != ''
            GROUP BY equipment_type
            ORDER BY count DESC
            LIMIT 8;
        """, params)
        eq_dist = _distribution(cursor.fetchall())

        cursor.execute(f"""
            SELECT event_type as name, COUNT(*) as count
            FROM containers
            {where_clause} {and_or_where} event_type IS NOT NULL AND TRIM(event_type) != ''
            GROUP BY event_type
            ORDER BY count DESC
            LIMIT 8;
        """, params)
        ev_dist = _distribution(cursor.fetchall())

        return {
            "updated_at": now_str,
            "scope": scope_info,
            "kpis": {
                "total_bookings": total_bookings,
                "total_estimated_teus": total_estimated_teus,
                "customs_uncleared": customs_uncleared,
                "customs_cleared": customs_cleared,
                "infras_unpaid": infras_unpaid,
                "infras_paid": infras_paid,
                "containers_in_yard": containers_in_yard,
                "containers_out_yard": containers_out_yard,
                "total_vessels": total_vessels,
                "watchlist_vessels": watchlist_vessels,
                "total_containers": total_containers,
                "watchlist_containers": watchlist_containers
            },
            "alerts": {
                "critical_cutoffs": critical_cutoffs,
                "uncleared_containers": uncleared_containers,
                "upcoming_vessels": upcoming_vessels
            },
            "distributions": {
                "carriers": carrier_dist,
                "sites": site_dist,
                "equipment_types": eq_dist,
                "container_events": ev_dist
            }
        }


# ---------------------------------------------------------------------------
# System settings
# ---------------------------------------------------------------------------
def get_system_setting(key: str, default: str = "") -> str:
    with get_connection() as conn:
        row = conn.execute("SELECT value FROM system_settings WHERE key = ?;", (key,)).fetchone()
        return row[0] if row else default


def set_system_setting(key: str, value: str):
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
        """, (key, value, _now_str()))


def get_all_system_settings() -> dict:
    with get_connection() as conn:
        return {r[0]: r[1] for r in conn.execute("SELECT key, value FROM system_settings;").fetchall()}
