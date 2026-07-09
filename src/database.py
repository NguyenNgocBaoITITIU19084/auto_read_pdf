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
                collection_id, pdf_name, booking_no, place_of_delivery, block_val,
                ts_port, equipment_type, qty, empty_pickup_cy, full_return_cy,
                cutoff_time, vessel, etd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            col_id,
            data.get("Tên file PDF", ""),
            data.get("Booking No", ""),
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

def get_bookings(col_id: int, search_query: str = None) -> list[dict]:
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if search_query:
            q = f"%{search_query}%"
            cursor.execute("""
                SELECT * FROM bookings 
                WHERE collection_id = ? AND (
                    pdf_name LIKE ? OR 
                    booking_no LIKE ? OR 
                    place_of_delivery LIKE ? OR 
                    block_val LIKE ? OR 
                    ts_port LIKE ? OR 
                    equipment_type LIKE ? OR 
                    empty_pickup_cy LIKE ? OR 
                    full_return_cy LIKE ? OR 
                    vessel LIKE ? OR 
                    etd LIKE ?
                ) ORDER BY id ASC;
            """, (col_id, q, q, q, q, q, q, q, q, q, q))
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
