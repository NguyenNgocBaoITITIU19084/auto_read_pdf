"""Create a PERF-50K collection with synthetic rows for manual performance checks. Never run on a customer DB."""
import argparse
import os
import random
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Path to a COPY of booking_data.db")
    parser.add_argument("--containers", type=int, default=50_000)
    parser.add_argument("--vessels", type=int, default=5_000)
    parser.add_argument("--bookings", type=int, default=5_000)
    args = parser.parse_args()
    os.environ["DB_PATH"] = os.path.abspath(args.db)

    from backend.app.core import database as db
    db.init_db()
    col = db.create_collection(f"PERF-50K-{random.randint(1000, 9999)}")
    events = ["UNLOAD", "INGATE", "OUTGATE", "STACKING", "LOAD"]
    with db.get_connection() as conn:
        conn.executemany(
            "INSERT INTO containers (collection_id, site_id, containerno, event_time, event_type, location, "
            "custom_clearance_status, cust, queried_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
            [(col, random.choice(["CTL", "TNT", "CMS"]), f"PERF{i:07d}", f"2026-09-{i % 28 + 1:02d} 08:00:00",
              events[i % 5], f"B{i % 40:02d}", random.choice(["Y", "N", ""]), random.choice(["Y", ""]),
              f"2026-09-15 {i % 24:02d}:{i % 60:02d}:00") for i in range(args.containers)])
        conn.executemany(
            "INSERT INTO vessel_schedules (collection_id, site_id, vessel_name, in_out_voyage, queried_at) "
            "VALUES (?, ?, ?, ?, ?);",
            [(col, "CTL", f"PERF SHIP {i}", f"{i:04d}N", "2026-09-15 09:00:00") for i in range(args.vessels)])
        conn.executemany(
            "INSERT INTO bookings (collection_id, booking_no, carrier, vessel, etd) VALUES (?, ?, ?, ?, ?);",
            [(col, f"PERF{i:06d}", "PIL", f"KOTA {i % 50}", "20/09/2026") for i in range(args.bookings)])
    print(f"Created collection id={col}")


if __name__ == "__main__":
    main()
