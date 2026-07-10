import sqlite3
import os
from datetime import datetime

DB_PATH = "booking_data.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    with get_connection() as conn:
        # Create collections table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL
            );
        """)
        
        # Create bookings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                pdf_name TEXT,
                booking_no TEXT,
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
        
        # Check if collection_id column exists in vessel_schedules
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT collection_id FROM vessel_schedules LIMIT 1;")
        except sqlite3.OperationalError:
            # Table does not exist yet or collection_id column is missing
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

def insert_booking(col_id: int, data: dict) -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO bookings (
                collection_id, pdf_name, booking_no, port_of_discharging, place_of_delivery, block_val,
                ts_port, equipment_type, qty, empty_pickup_cy, full_return_cy,
                cutoff_time, vessel, etd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            col_id,
            data.get("Tên file PDF", ""),
            data.get("Booking No", ""),
            data.get("Port of Discharging", ""),
            data.get("Place of Delivery", ""),
            data.get("Block", ""),
            data.get("T/S Port", ""),
            data.get("Equipment Type", ""),
            data.get("Q'ty", ""),
            data.get("Empty Pick Up CY", ""),
            data.get("Full return CY", ""),
            data.get("Port Cargo Cut-off", ""),
            data.get("Vessel", ""),
            data.get("ETD", "")
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
                    "pdf_name", "booking_no", "port_of_discharging", "place_of_delivery", "block_val", 
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
                """, (col_id, q, q, q, q, q, q, q, q, q, q, q))
        else:
            cursor.execute("SELECT * FROM bookings WHERE collection_id = ? ORDER BY id ASC;", (col_id,))
        
        rows = cursor.fetchall()
        result = []
        for r in rows:
            row_dict = dict(r)
            # Map database keys back to display keys
            result.append({
                "id": row_dict["id"],
                "Tên file PDF": row_dict["pdf_name"],
                "Booking No": row_dict["booking_no"],
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

def export_backup_data() -> dict:
    collections = get_collections()
    backup_data = []
    
    for col in collections:
        bookings = get_bookings(col["id"])
        # remove internal database IDs to make it clean
        for b in bookings:
            if "id" in b:
                del b["id"]
                
        vessels = get_vessel_schedules(col["id"])
        for v in vessels:
            if "id" in v:
                del v["id"]
            if "collection_id" in v:
                del v["collection_id"]
                
        backup_data.append({
            "name": col["name"],
            "created_at": col["created_at"],
            "bookings": bookings,
            "vessel_schedules": vessels
        })
        
    return {"collections": backup_data}

def import_backup_data(backup_data: dict):
    if not isinstance(backup_data, dict) or "collections" not in backup_data:
        raise ValueError("Invalid backup format")
        
    for col_data in backup_data["collections"]:
        name = col_data.get("name")
        created_at = col_data.get("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        bookings = col_data.get("bookings", [])
        vessels = col_data.get("vessel_schedules", [])
        
        # Insert collection, if name exists, append suffix
        with get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO collections (name, created_at) VALUES (?, ?);",
                    (name, created_at)
                )
                col_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                # Suffix name
                suffix = datetime.now().strftime("%Y%m%d%H%M%S")
                new_name = f"{name}_imported_{suffix}"
                cursor.execute(
                    "INSERT INTO collections (name, created_at) VALUES (?, ?);",
                    (new_name, created_at)
                )
                col_id = cursor.lastrowid
                
            conn.commit()
            
        for b in bookings:
            insert_booking(col_id, b)
            
        if vessels:
            mapped_schedules = []
            for vs in vessels:
                mapped_schedules.append({
                    "SITE_ID": vs.get("site_id", ""),
                    "AGENT": vs.get("agent", ""),
                    "VESSELNAME": vs.get("vessel_name", ""),
                    "IN_OUT_VOYAGE": vs.get("in_out_voyage", ""),
                    "ACTUAL_BERTH_TIME": vs.get("actual_berth_time", ""),
                    "ACTUAL_DEPATURE_TIME": vs.get("actual_departure_time", ""),
                    "CLOSING_TIME": vs.get("closing_time", ""),
                    "CLOSING_TIME_ICD": vs.get("closing_time_icd", ""),
                    "IN_GATE": vs.get("in_gate", ""),
                    "OPEN_TS": vs.get("open_ts", ""),
                    "REEFER_OPEN_TS": vs.get("reefer_open_ts", ""),
                    "OOG_OPEN_TS": vs.get("oog_open_ts", ""),
                    "HAZ_OPEN_TS": vs.get("haz_open_ts", ""),
                    "REMARKS": vs.get("remarks", "")
                })
            insert_vessel_schedules(col_id, mapped_schedules)
            
    # Fallback for old backup format
    vessel_schedules_old = backup_data.get("vessel_schedules", [])
    if vessel_schedules_old:
        collections = get_collections()
        if collections:
            first_col_id = collections[0]["id"]
            mapped_schedules = []
            for vs in vessel_schedules_old:
                mapped_schedules.append({
                    "SITE_ID": vs.get("site_id", ""),
                    "AGENT": vs.get("agent", ""),
                    "VESSELNAME": vs.get("vessel_name", ""),
                    "IN_OUT_VOYAGE": vs.get("in_out_voyage", ""),
                    "ACTUAL_BERTH_TIME": vs.get("actual_berth_time", ""),
                    "ACTUAL_DEPATURE_TIME": vs.get("actual_departure_time", ""),
                    "CLOSING_TIME": vs.get("closing_time", ""),
                    "CLOSING_TIME_ICD": vs.get("closing_time_icd", ""),
                    "IN_GATE": vs.get("in_gate", ""),
                    "OPEN_TS": vs.get("open_ts", ""),
                    "REEFER_OPEN_TS": vs.get("reefer_open_ts", ""),
                    "OOG_OPEN_TS": vs.get("oog_open_ts", ""),
                    "HAZ_OPEN_TS": vs.get("haz_open_ts", ""),
                    "REMARKS": vs.get("remarks", "")
                })
            insert_vessel_schedules(first_col_id, mapped_schedules)

def insert_vessel_schedules(col_id: int, schedules: list[dict]):
    queried_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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
                s.get("SITE_ID", ""),
                s.get("AGENT", ""),
                s.get("VESSELNAME", ""),
                s.get("IN_OUT_VOYAGE", ""),
                s.get("ACTUAL_BERTH_TIME", ""),
                s.get("ACTUAL_DEPATURE_TIME", ""),
                s.get("CLOSING_TIME", ""),
                s.get("CLOSING_TIME_ICD", ""),
                s.get("IN_GATE", ""),
                s.get("OPEN_TS", ""),
                s.get("REEFER_OPEN_TS", ""),
                s.get("OOG_OPEN_TS", ""),
                s.get("HAZ_OPEN_TS", ""),
                s.get("REMARKS", ""),
                queried_at
            ))
        conn.commit()

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
