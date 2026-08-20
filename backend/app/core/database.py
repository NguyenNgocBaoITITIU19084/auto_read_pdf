import sqlite3
import os
from datetime import datetime
from backend.app.core.config import DB_PATH

def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

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
                fel TEXT,
                iso TEXT,
                gross REAL,
                vgm TEXT,
                category TEXT,
                cust TEXT,
                location TEXT,
                truck_vessel TEXT,
                trans_in TEXT,
                trans_out TEXT,
                gate_wt REAL,
                line_oper TEXT,
                im_exp TEXT,
                bill_book TEXT,
                cust_approval_date TEXT,
                note TEXT,
                item_seal_no TEXT,
                custom_clearance_status TEXT,
                infras_fee_status TEXT,
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
                FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
                UNIQUE(collection_id, site_id, container_no) ON CONFLICT IGNORE
            );
        """)
        
        # Database migration: add port_of_discharging column if it doesn't exist
        try:
            conn.execute("ALTER TABLE bookings ADD COLUMN port_of_discharging TEXT;")
        except sqlite3.OperationalError:
            pass
            
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
        
    return {"collections": backup_data}

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
    queried_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted_ids = []
    with get_connection() as conn:
        cursor = conn.cursor()
        for c in containers:
            cursor.execute("""
                INSERT OR REPLACE INTO containers (
                    collection_id, site_id, containerno, event_time, event_type, fel, iso,
                    gross, vgm, category, cust, location, truck_vessel, trans_in, trans_out,
                    gate_wt, line_oper, im_exp, bill_book, cust_approval_date, note, item_seal_no,
                    custom_clearance_status, infras_fee_status, queried_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                col_id,
                c.get("SITE", c.get("site_id", "")),
                c.get("CONTAINERNO", c.get("containerno", "")),
                c.get("EVENT_TIME", c.get("event_time", "")),
                c.get("EVENT_TYPE", c.get("event_type", "")),
                c.get("FEL", c.get("fel", "")),
                c.get("ISO", c.get("iso", "")),
                c.get("GROSS", c.get("gross", 0.0)),
                c.get("VGM", c.get("vgm", "")),
                c.get("CATEGORY", c.get("category", "")),
                c.get("CUST", c.get("cust", "")),
                c.get("LOCATION", c.get("location", "")),
                c.get("TRUCK_VESSEL", c.get("truck_vessel", "")),
                c.get("TRANS_IN", c.get("trans_in", "")),
                c.get("TRANS_OUT", c.get("trans_out", "")),
                c.get("GATE_WT", c.get("gate_wt", 0.0)),
                c.get("LINE_OPER", c.get("line_oper", "")),
                c.get("IM_EXP", c.get("im_exp", "")),
                c.get("BILL_BOOK", c.get("bill_book", "")),
                c.get("CUST_APPROVAL_DATE", c.get("cust_approval_date", "")),
                c.get("NOTE", c.get("note", "")),
                c.get("ITEM_SEAL_NO", c.get("item_seal_no", "")),
                c.get("CUSTOM_CLEARANCE_STATUS", c.get("custom_clearance_status", "")),
                c.get("INFRAS_FEE_STATUS", c.get("infras_fee_status", "")),
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
                    "site_id", "containerno", "event_time", "event_type", "fel", "iso", "gross",
                    "vgm", "category", "cust", "location", "truck_vessel", "trans_in", "trans_out",
                    "gate_wt", "line_oper", "im_exp", "bill_book", "cust_approval_date", "note",
                    "item_seal_no", "custom_clearance_status", "infras_fee_status", "queried_at"
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
                        im_exp LIKE ? OR bill_book LIKE ? OR note LIKE ? OR item_seal_no LIKE ?
                    ) ORDER BY queried_at DESC, id ASC;
                """, (col_id, q, q, q, q, q, q, q, q, q, q))
        else:
            cursor.execute("SELECT * FROM containers WHERE collection_id = ? ORDER BY queried_at DESC, id ASC;", (col_id,))
        return [dict(row) for row in cursor.fetchall()]

def delete_container(cont_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM containers WHERE id = ?;", (cont_id,))
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

def add_to_container_watchlist(col_id: int, site_id: str, container_no: str):
    with get_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO container_watchlists (collection_id, site_id, container_no)
            VALUES (?, ?, ?);
        """, (col_id, site_id.strip(), container_no.strip().upper()))
        conn.commit()

def remove_from_container_watchlist(watchlist_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM container_watchlists WHERE id = ?;", (watchlist_id,))
        conn.commit()
