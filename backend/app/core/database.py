import sqlite3
import os
from datetime import datetime
from backend.app.core.config import DB_PATH

def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

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

def init_db():
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

        # Check if settings column exists in collections
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT settings FROM collections LIMIT 1;")
        except sqlite3.OperationalError:
            try:
                cursor.execute("ALTER TABLE collections ADD COLUMN settings TEXT;")
            except sqlite3.OperationalError:
                pass

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

        # Check if carrier column exists in bookings
        try:
            cursor.execute("SELECT carrier FROM bookings LIMIT 1;")
        except sqlite3.OperationalError:
            try:
                cursor.execute("ALTER TABLE bookings ADD COLUMN carrier TEXT;")
            except sqlite3.OperationalError:
                pass
        
        # Check if collection_id column exists in vessel_schedules
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT collection_id FROM vessel_schedules LIMIT 1;")
        except sqlite3.OperationalError:
            cursor.execute("DROP TABLE IF EXISTS vessel_schedules;")

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
        
        # Database migration: add port_of_discharging column if it doesn't exist
        try:
            conn.execute("ALTER TABLE bookings ADD COLUMN port_of_discharging TEXT;")
        except sqlite3.OperationalError:
            pass

        # Database migration: add event_type to container_watchlists
        try:
            conn.execute("ALTER TABLE container_watchlists ADD COLUMN event_type TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        # Database migration for containers table columns
        new_container_cols = [
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
        ]
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

        # Seed default color rules if missing
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for r in DEFAULT_COLOR_RULES:
            cursor.execute("""
                SELECT id FROM color_rules 
                WHERE target_table = ? AND column_key = ? AND match_value = ?;
            """, (
                r.get("target_table", "all"),
                r.get("column_key", "all"),
                r.get("match_value", "")
            ))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO color_rules (
                        target_table, column_key, match_value, match_type,
                        preset_id, custom_bg, custom_border, custom_text, is_enabled, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    r.get("target_table", "all"),
                    r.get("column_key", "all"),
                    r.get("match_value", ""),
                    r.get("match_type", "exact"),
                    r.get("preset_id"),
                    r.get("custom_bg"),
                    r.get("custom_border"),
                    r.get("custom_text"),
                    r.get("is_enabled", 1),
                    now_str
                ))

        # Create system_settings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

        conn.commit()

def create_collection(name: str) -> int:
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO collections (name, created_at) VALUES (?, ?);",
            (name, created_at)
        )
        conn.commit()
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
        conn.commit()

def update_collection_settings(col_id: int, settings_str: str):
    with get_connection() as conn:
        conn.execute("UPDATE collections SET settings = ? WHERE id = ?;", (settings_str, col_id))
        conn.commit()

def insert_booking(col_id: int, data: dict) -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
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
        conn.commit()
        return cursor.lastrowid

def get_bookings(col_id: int, search_query: str = None, search_field: str = None) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if search_query:
            q = f"%{search_query}%"
            if search_field and search_field != "all":
                allowed_columns = {
                    "pdf_name", "booking_no", "carrier", "port_of_discharging", "place_of_delivery", "block_val", 
                    "ts_port", "equipment_type", "qty", "empty_pickup_cy", 
                    "full_return_cy", "cutoff_time", "vessel", "etd"
                }
                if search_field in allowed_columns:
                    query_str = f"SELECT * FROM bookings WHERE collection_id = ? AND {search_field} LIKE ? ORDER BY id ASC;"
                    cursor.execute(query_str, (col_id, q))
                else:
                    search_field = "all"
            
            if not search_field or search_field == "all":
                cursor.execute("""
                    SELECT * FROM bookings 
                    WHERE collection_id = ? AND (
                        pdf_name LIKE ? OR 
                        booking_no LIKE ? OR 
                        carrier LIKE ? OR
                        port_of_discharging LIKE ? OR
                        place_of_delivery LIKE ? OR 
                        block_val LIKE ? OR 
                        ts_port LIKE ? OR 
                        equipment_type LIKE ? OR 
                        empty_pickup_cy LIKE ? OR 
                        full_return_cy LIKE ? OR 
                        vessel LIKE ? OR 
                        etd LIKE ?
                    ) ORDER BY id ASC;
                """, (col_id, q, q, q, q, q, q, q, q, q, q, q, q))
        else:
            cursor.execute("SELECT * FROM bookings WHERE collection_id = ? ORDER BY id ASC;", (col_id,))
        
        rows = cursor.fetchall()
        result = []
        for r in rows:
            row_dict = dict(r)
            carrier_val = row_dict.get("carrier")
            if not carrier_val or carrier_val == "null" or carrier_val == "":
                # Fallback carrier detection from metadata
                b_no = row_dict.get("booking_no", "") or ""
                v_name = row_dict.get("vessel", "") or ""
                f_name = row_dict.get("pdf_name", "") or ""
                upper_check = f"{b_no} {v_name} {f_name}".upper()
                if "DONGJIN" in upper_check or "DJSC" in upper_check or b_no.startswith("DJ"):
                    carrier_val = "DONGJIN"
                elif "PIL" in upper_check or b_no.startswith("SGN6") or "KOTA" in upper_check:
                    carrier_val = "PIL"
                elif "ONE" in upper_check or b_no.startswith("ONEY"):
                    carrier_val = "ONE"
                elif "SITC" in upper_check:
                    carrier_val = "SITC"
                elif "COSCO" in upper_check:
                    carrier_val = "COSCO"
                else:
                    carrier_val = "Khác"

            result.append({
                "id": row_dict["id"],
                "Tên file PDF": row_dict["pdf_name"],
                "Booking No": row_dict["booking_no"],
                "Carrier": carrier_val,
                "Port of Discharging": row_dict["port_of_discharging"],
                "Place of Delivery": row_dict["place_of_delivery"],
                "Block": row_dict["block_val"],
                "T/S Port": row_dict["ts_port"],
                "Equipment Type": row_dict["equipment_type"],
                "Q'ty": row_dict["qty"],
                "Empty Pick Up CY": row_dict["empty_pickup_cy"],
                "Full return CY": row_dict["full_return_cy"],
                "Port Cargo Cut-off": row_dict["cutoff_time"],
                "Vessel": row_dict["vessel"],
                "ETD": row_dict["etd"]
            })
        return result

def delete_booking(booking_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM bookings WHERE id = ?;", (booking_id,))
        conn.commit()

def clear_bookings(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM bookings WHERE collection_id = ?;", (col_id,))
        conn.commit()

def export_backup_data() -> dict:
    collections = get_collections()
    backup_data = []
    
    for col in collections:
        bookings = get_bookings(col["id"])
        for b in bookings:
            if "id" in b:
                del b["id"]
                
        vessels = get_vessel_schedules(col["id"])
        for v in vessels:
            if "id" in v:
                del v["id"]
            if "collection_id" in v:
                del v["collection_id"]
                
        containers = get_containers(col["id"])
        for c in containers:
            if "id" in c:
                del c["id"]
            if "collection_id" in c:
                del c["collection_id"]
                
        c_watchlists = get_container_watchlist(col["id"])
        for cw in c_watchlists:
            if "id" in cw:
                del cw["id"]
            if "collection_id" in cw:
                del cw["collection_id"]
                
        backup_data.append({
            "name": col["name"],
            "created_at": col["created_at"],
            "settings": col.get("settings"),
            "bookings": bookings,
            "vessel_schedules": vessels,
            "containers": containers,
            "container_watchlists": c_watchlists
        })
        
    color_rules = get_color_rules()
    for cr in color_rules:
        if "id" in cr:
            del cr["id"]

    return {
        "collections": backup_data,
        "color_rules": color_rules
    }

def import_backup_data(backup_data: dict):
    if not isinstance(backup_data, dict) or "collections" not in backup_data:
        raise ValueError("Invalid backup format")
        
    for col_data in backup_data["collections"]:
        name = col_data.get("name")
        created_at = col_data.get("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        settings = col_data.get("settings")
        bookings = col_data.get("bookings", [])
        vessels = col_data.get("vessel_schedules", [])
        containers = col_data.get("containers", [])
        c_watchlists = col_data.get("container_watchlists", [])
        
        with get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO collections (name, created_at, settings) VALUES (?, ?, ?);",
                    (name, created_at, settings)
                )
                col_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                suffix = datetime.now().strftime("%Y%m%d%H%M%S")
                new_name = f"{name}_imported_{suffix}"
                cursor.execute(
                    "INSERT INTO collections (name, created_at, settings) VALUES (?, ?, ?);",
                    (new_name, created_at, settings)
                )
                col_id = cursor.lastrowid
            conn.commit()
            
        for b in bookings:
            insert_booking(col_id, b)
            
        if vessels:
            mapped_schedules = []
            for vs in vessels:
                mapped_schedules.append({
                    "SITE_ID": vs.get("site_id", vs.get("SITE_ID", "")),
                    "AGENT": vs.get("agent", vs.get("AGENT", "")),
                    "VESSELNAME": vs.get("vessel_name", vs.get("VESSELNAME", "")),
                    "IN_OUT_VOYAGE": vs.get("in_out_voyage", vs.get("IN_OUT_VOYAGE", "")),
                    "ACTUAL_BERTH_TIME": vs.get("actual_berth_time", vs.get("ACTUAL_BERTH_TIME", "")),
                    "ACTUAL_DEPATURE_TIME": vs.get("actual_departure_time", vs.get("ACTUAL_DEPATURE_TIME", "")),
                    "CLOSING_TIME": vs.get("closing_time", vs.get("CLOSING_TIME", "")),
                    "CLOSING_TIME_ICD": vs.get("closing_time_icd", vs.get("CLOSING_TIME_ICD", "")),
                    "IN_GATE": vs.get("in_gate", vs.get("IN_GATE", "")),
                    "OPEN_TS": vs.get("open_ts", vs.get("OPEN_TS", "")),
                    "REEFER_OPEN_TS": vs.get("reefer_open_ts", vs.get("REEFER_OPEN_TS", "")),
                    "OOG_OPEN_TS": vs.get("oog_open_ts", vs.get("OOG_OPEN_TS", "")),
                    "HAZ_OPEN_TS": vs.get("haz_open_ts", vs.get("HAZ_OPEN_TS", "")),
                    "REMARKS": vs.get("remarks", vs.get("REMARKS", ""))
                })
            insert_vessel_schedules(col_id, mapped_schedules)
            
        if containers:
            insert_containers(col_id, containers)
            
        if c_watchlists:
            for cw in c_watchlists:
                add_to_container_watchlist(col_id, cw.get("site_id", ""), cw.get("container_no", ""))

    if "color_rules" in backup_data and isinstance(backup_data["color_rules"], list):
        for cr in backup_data["color_rules"]:
            create_color_rule(cr)

def insert_vessel_schedules(col_id: int, schedules: list[dict]) -> list[int]:
    queried_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted_ids = []
    with get_connection() as conn:
        cursor = conn.cursor()
        for s in schedules:
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
                queried_at
            ))
            if cursor.lastrowid:
                inserted_ids.append(cursor.lastrowid)
        conn.commit()
    return inserted_ids

def get_vessel_schedules(col_id: int, search_query: str = None, search_field: str = None) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if search_query:
            q = f"%{search_query}%"
            if search_field and search_field != "all":
                allowed_columns = {
                    "site_id", "agent", "vessel_name", "in_out_voyage", "actual_berth_time",
                    "actual_departure_time", "closing_time", "closing_time_icd", "in_gate",
                    "open_ts", "reefer_open_ts", "oog_open_ts", "haz_open_ts", "remarks", "queried_at"
                }
                if search_field in allowed_columns:
                    query_str = f"SELECT * FROM vessel_schedules WHERE collection_id = ? AND {search_field} LIKE ? ORDER BY queried_at DESC, id ASC;"
                    cursor.execute(query_str, (col_id, q))
                else:
                    search_field = "all"
            
            if not search_field or search_field == "all":
                cursor.execute("""
                    SELECT * FROM vessel_schedules
                    WHERE collection_id = ? AND (
                        site_id LIKE ? OR agent LIKE ? OR vessel_name LIKE ? OR in_out_voyage LIKE ? OR remarks LIKE ? OR closing_time LIKE ? OR in_gate LIKE ?
                    ) ORDER BY queried_at DESC, id ASC;
                """, (col_id, q, q, q, q, q, q, q))
        else:
            cursor.execute("SELECT * FROM vessel_schedules WHERE collection_id = ? ORDER BY queried_at DESC, id ASC;", (col_id,))
            
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def delete_vessel_schedule(schedule_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM vessel_schedules WHERE id = ?;", (schedule_id,))
        conn.commit()

def delete_vessel_schedules_batch(schedule_ids: list[int]):
    if not schedule_ids:
        return
    with get_connection() as conn:
        placeholders = ",".join(["?"] * len(schedule_ids))
        conn.execute(f"DELETE FROM vessel_schedules WHERE id IN ({placeholders});", tuple(schedule_ids))
        conn.commit()

def clear_vessel_schedules(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM vessel_schedules WHERE collection_id = ?;", (col_id,))
        conn.commit()

def get_watchlist(col_id: int) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vessel_watchlists WHERE collection_id = ? ORDER BY id ASC;", (col_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def get_all_watchlists() -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vessel_watchlists ORDER BY id ASC;")
        return [dict(row) for row in cursor.fetchall()]

def add_to_watchlist(col_id: int, site_id: str, vessel_name: str, voyage: str):
    with get_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO vessel_watchlists (collection_id, site_id, vessel_name, voyage)
            VALUES (?, ?, ?, ?);
        """, (col_id, site_id.strip(), vessel_name.strip(), voyage.strip()))
        conn.commit()

def remove_from_watchlist(watchlist_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM vessel_watchlists WHERE id = ?;", (watchlist_id,))
        conn.commit()

def insert_containers(col_id: int, containers: list[dict]) -> list[int]:
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

    queried_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted_ids = []
    with get_connection() as conn:
        cursor = conn.cursor()
        for c in containers:
            site_val = _s(c.get("SITE", c.get("site_id", ""))).upper()
            cont_val = _s(c.get("CONTAINERNO", c.get("containerno", ""))).upper()
            if not cont_val:
                continue

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
                queried_at
            ))
            if cursor.lastrowid:
                inserted_ids.append(cursor.lastrowid)
        conn.commit()
    return inserted_ids

def get_containers(col_id: int, search_query: str = None, search_field: str = None) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if search_query:
            q = f"%{search_query}%"
            if search_field and search_field != "all":
                allowed_columns = {
                    "site_id", "containerno", "event_time", "event_type", "in_yard", "fel", "iso", "gross",
                    "container_gross", "tare_wt", "manifest_wt", "gate_wt", "gate_gross_wt", "certified_weight",
                    "vgm", "category", "cust", "location", "stack", "temp", "haz", "load_to_vessel", "pod_destination",
                    "truck_vessel", "trans_in", "trans_out", "cont_in_ts", "cont_out_ts", "line_oper", "im_exp",
                    "bill_book", "cust_approval_date", "note", "item_seal_no", "custom_clearance_status",
                    "infras_fee_status", "item_key", "queried_at"
                }
                if search_field in allowed_columns:
                    query_str = f"SELECT * FROM containers WHERE collection_id = ? AND {search_field} LIKE ? ORDER BY queried_at DESC, id ASC;"
                    cursor.execute(query_str, (col_id, q))
                else:
                    search_field = "all"
            
            if not search_field or search_field == "all":
                cursor.execute("""
                    SELECT * FROM containers 
                    WHERE collection_id = ? AND (
                        site_id LIKE ? OR containerno LIKE ? OR event_type LIKE ? OR
                        location LIKE ? OR truck_vessel LIKE ? OR line_oper LIKE ? OR
                        im_exp LIKE ? OR bill_book LIKE ? OR note LIKE ? OR item_seal_no LIKE ? OR
                        custom_clearance_status LIKE ? OR infras_fee_status LIKE ? OR pod_destination LIKE ?
                    ) ORDER BY queried_at DESC, id ASC;
                """, (col_id, q, q, q, q, q, q, q, q, q, q, q, q, q))
        else:
            cursor.execute("SELECT * FROM containers WHERE collection_id = ? ORDER BY queried_at DESC, id ASC;", (col_id,))
        return [dict(row) for row in cursor.fetchall()]

def delete_container(cont_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM containers WHERE id = ?;", (cont_id,))
        conn.commit()

def delete_containers_batch(cont_ids: list[int]):
    if not cont_ids:
        return
    with get_connection() as conn:
        placeholders = ",".join(["?"] * len(cont_ids))
        conn.execute(f"DELETE FROM containers WHERE id IN ({placeholders});", tuple(cont_ids))
        conn.commit()

def clear_containers(col_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM containers WHERE collection_id = ?;", (col_id,))
        conn.commit()

def get_container_watchlist(col_id: int) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM container_watchlists WHERE collection_id = ? ORDER BY id ASC;", (col_id,))
        return [dict(row) for row in cursor.fetchall()]

def get_all_container_watchlists() -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM container_watchlists ORDER BY id ASC;")
        return [dict(row) for row in cursor.fetchall()]

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
        conn.commit()

def remove_from_container_watchlist(watchlist_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM container_watchlists WHERE id = ?;", (watchlist_id,))
        conn.commit()

def get_color_rules(target_table: str = None) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if target_table and target_table != "all":
            cursor.execute("SELECT * FROM color_rules WHERE target_table = ? OR target_table = 'all' ORDER BY id ASC;", (target_table,))
        else:
            cursor.execute("SELECT * FROM color_rules ORDER BY id ASC;")
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["is_enabled"] = bool(d.get("is_enabled", 1))
            result.append(d)
        return result

def create_color_rule(data: dict) -> int:
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    is_enabled_val = 1 if data.get("is_enabled", True) else 0
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO color_rules (
                target_table, column_key, match_value, match_type,
                preset_id, custom_bg, custom_border, custom_text, is_enabled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            data.get("target_table", "all") or "all",
            data.get("column_key", "all") or "all",
            str(data.get("match_value", "")).strip(),
            data.get("match_type", "exact") or "exact",
            data.get("preset_id"),
            data.get("custom_bg"),
            data.get("custom_border"),
            data.get("custom_text"),
            is_enabled_val,
            now_str
        ))
        conn.commit()
        return cursor.lastrowid

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
        conn.commit()
        return cursor.rowcount > 0

def delete_color_rule(rule_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM color_rules WHERE id = ?;", (rule_id,))
        conn.commit()
        return cursor.rowcount > 0

def reset_color_rules_to_default() -> list[dict]:
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM color_rules;")
        for r in DEFAULT_COLOR_RULES:
            cursor.execute("""
                INSERT INTO color_rules (
                    target_table, column_key, match_value, match_type,
                    preset_id, custom_bg, custom_border, custom_text, is_enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                r.get("target_table", "all"),
                r.get("column_key", "all"),
                r.get("match_value", ""),
                r.get("match_type", "exact"),
                r.get("preset_id"),
                r.get("custom_bg"),
                r.get("custom_border"),
                r.get("custom_text"),
                r.get("is_enabled", 1),
                now_str
            ))
        conn.commit()
    return get_color_rules()

def _calculate_teus(qty_str: str, equip_str: str) -> int:
    """Helper to estimate TEUs from quantity and equipment type strings."""
    import re
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
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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

        # 1. Booking KPIs
        cursor.execute(f"SELECT COUNT(*), qty, equipment_type FROM bookings {where_clause};", params)
        booking_count_row = cursor.fetchone()
        total_bookings = booking_count_row[0] if booking_count_row else 0

        cursor.execute(f"SELECT qty, equipment_type FROM bookings {where_clause};", params)
        booking_rows = cursor.fetchall()
        total_estimated_teus = sum(_calculate_teus(b["qty"], b["equipment_type"]) for b in booking_rows)

        # 2. Container KPIs
        cursor.execute(f"""
            SELECT 
                COUNT(*) as total_containers,
                SUM(CASE WHEN custom_clearance_status LIKE '%Chưa duyệt%' OR custom_clearance_status = 'N' THEN 1 ELSE 0 END) as customs_uncleared,
                SUM(CASE WHEN custom_clearance_status LIKE '%Đã duyệt%' OR custom_clearance_status = 'Y' THEN 1 ELSE 0 END) as customs_cleared,
                SUM(CASE WHEN infras_fee_status LIKE '%Chưa%' OR infras_fee_status = '3' THEN 1 ELSE 0 END) as infras_unpaid,
                SUM(CASE WHEN infras_fee_status LIKE '%Đã%' OR infras_fee_status = '1' OR infras_fee_status = '2' THEN 1 ELSE 0 END) as infras_paid,
                SUM(CASE WHEN in_yard = 'Y' OR in_yard = '1' OR in_yard LIKE '%in%' THEN 1 ELSE 0 END) as containers_in_yard,
                SUM(CASE WHEN in_yard = 'N' OR in_yard = '0' OR in_yard LIKE '%out%' THEN 1 ELSE 0 END) as containers_out_yard
            FROM containers {where_clause};
        """, params)
        cont_kpi = cursor.fetchone()
        total_containers = cont_kpi["total_containers"] if cont_kpi and cont_kpi["total_containers"] else 0
        customs_uncleared = cont_kpi["customs_uncleared"] if cont_kpi and cont_kpi["customs_uncleared"] else 0
        customs_cleared = cont_kpi["customs_cleared"] if cont_kpi and cont_kpi["customs_cleared"] else 0
        infras_unpaid = cont_kpi["infras_unpaid"] if cont_kpi and cont_kpi["infras_unpaid"] else 0
        infras_paid = cont_kpi["infras_paid"] if cont_kpi and cont_kpi["infras_paid"] else 0
        containers_in_yard = cont_kpi["containers_in_yard"] if cont_kpi and cont_kpi["containers_in_yard"] else 0
        containers_out_yard = cont_kpi["containers_out_yard"] if cont_kpi and cont_kpi["containers_out_yard"] else 0

        # 3. Vessel KPIs
        cursor.execute(f"SELECT COUNT(*) FROM vessel_schedules {where_clause};", params)
        vessel_row = cursor.fetchone()
        total_vessels = vessel_row[0] if vessel_row else 0

        cursor.execute(f"SELECT COUNT(*) FROM vessel_watchlists {where_clause};", params)
        vw_row = cursor.fetchone()
        watchlist_vessels = vw_row[0] if vw_row else 0

        cursor.execute(f"SELECT COUNT(*) FROM container_watchlists {where_clause};", params)
        cw_row = cursor.fetchone()
        watchlist_containers = cw_row[0] if cw_row else 0

        # 4. Critical Alerts
        # Cutoffs: bookings with cutoff_time
        cursor.execute(f"""
            SELECT id, booking_no, carrier, cutoff_time, vessel, port_of_discharging
            FROM bookings
            {where_clause} {"AND" if where_clause else "WHERE"} cutoff_time IS NOT NULL AND cutoff_time != ''
            ORDER BY cutoff_time ASC
            LIMIT 10;
        """, params)
        critical_cutoffs = [dict(r) for r in cursor.fetchall()]

        # Uncleared containers (Customs not cleared or infras fee unpaid)
        cursor.execute(f"""
            SELECT id, site_id, containerno, event_time, event_type, in_yard, 
                   custom_clearance_status, infras_fee_status, fel, iso, location
            FROM containers
            {where_clause} {"AND" if where_clause else "WHERE"} 
                (custom_clearance_status LIKE '%Chưa%' OR custom_clearance_status = 'N' 
                 OR infras_fee_status LIKE '%Chưa%' OR infras_fee_status = '3')
            ORDER BY event_time DESC, id DESC
            LIMIT 10;
        """, params)
        uncleared_containers = [dict(r) for r in cursor.fetchall()]

        # Upcoming vessel berthing
        cursor.execute(f"""
            SELECT id, site_id, vessel_name, in_out_voyage, actual_berth_time, actual_departure_time, closing_time
            FROM vessel_schedules
            {where_clause} {"AND" if where_clause else "WHERE"} 
                (actual_berth_time IS NOT NULL AND actual_berth_time != '')
            ORDER BY actual_berth_time ASC
            LIMIT 10;
        """, params)
        upcoming_vessels = [dict(r) for r in cursor.fetchall()]

        # 5. Visual Distributions
        # Top Carriers
        cursor.execute(f"""
            SELECT carrier as name, COUNT(*) as count 
            FROM bookings 
            {where_clause} {"AND" if where_clause else "WHERE"} carrier IS NOT NULL AND TRIM(carrier) != ''
            GROUP BY carrier 
            ORDER BY count DESC 
            LIMIT 8;
        """, params)
        carrier_rows = cursor.fetchall()
        total_c_count = sum(r["count"] for r in carrier_rows) if carrier_rows else 1
        carrier_dist = [
            {"name": r["name"], "count": r["count"], "percentage": round((r["count"] / total_c_count) * 100, 1)}
            for r in carrier_rows
        ]

        # Port/Site distribution (aggregated across containers & vessels)
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
        site_rows = cursor.fetchall()
        total_s_count = sum(r["count"] for r in site_rows) if site_rows else 1
        site_dist = [
            {"name": r["name"], "count": r["count"], "percentage": round((r["count"] / total_s_count) * 100, 1)}
            for r in site_rows
        ]

        # Equipment Types
        cursor.execute(f"""
            SELECT equipment_type as name, COUNT(*) as count
            FROM bookings
            {where_clause} {"AND" if where_clause else "WHERE"} equipment_type IS NOT NULL AND TRIM(equipment_type) != ''
            GROUP BY equipment_type
            ORDER BY count DESC
            LIMIT 8;
        """, params)
        eq_rows = cursor.fetchall()
        total_eq_count = sum(r["count"] for r in eq_rows) if eq_rows else 1
        eq_dist = [
            {"name": r["name"], "count": r["count"], "percentage": round((r["count"] / total_eq_count) * 100, 1)}
            for r in eq_rows
        ]

        # Container Events
        cursor.execute(f"""
            SELECT event_type as name, COUNT(*) as count
            FROM containers
            {where_clause} {"AND" if where_clause else "WHERE"} event_type IS NOT NULL AND TRIM(event_type) != ''
            GROUP BY event_type
            ORDER BY count DESC
            LIMIT 8;
        """, params)
        ev_rows = cursor.fetchall()
        total_ev_count = sum(r["count"] for r in ev_rows) if ev_rows else 1
        ev_dist = [
            {"name": r["name"], "count": r["count"], "percentage": round((r["count"] / total_ev_count) * 100, 1)}
            for r in ev_rows
        ]

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

def get_system_setting(key: str, default: str = "") -> str:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_settings WHERE key = ?;", (key,))
        row = cursor.fetchone()
        return row[0] if row else default

def set_system_setting(key: str, value: str):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
        """, (key, value, now_str))
        conn.commit()

def get_all_system_settings() -> dict:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM system_settings;")
        return {r[0]: r[1] for r in cursor.fetchall()}

