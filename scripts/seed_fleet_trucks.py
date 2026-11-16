"""Add sample trucks (xe tải) and their drivers to the fleet, to try the Xe tải tab.

Safe to run again: trucks whose plate is already there (trash included) and drivers whose name is already there are
skipped. The database is backed up next to itself first (booking_data.db.bak-YYYYmmdd-HHMMSS).

    .venv/bin/python scripts/seed_fleet_trucks.py              # the app's database
    .venv/bin/python scripts/seed_fleet_trucks.py --db x.db    # another one
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# plate, type, body, payload, registration until, insurance until, note
TRUCKS = [
    ("51D-111.22", "Hino 300 XZU", "Thùng kín", "3.5 tấn", "2027-03-10", "2027-01-05", ""),
    ("51D-222.33", "Isuzu NQR 550", "Thùng bạt", "5.5 tấn", "2026-11-28", "2027-02-14", ""),
    ("51D-333.44", "Hyundai Mighty EX8", "Thùng lửng", "7 tấn", "2027-06-01", "2027-05-20", "Chở sắt thép, cọc"),
    ("51D-444.55", "Hino FG8JP7A", "Thùng đông lạnh", "8 tấn", "2027-01-15", "2026-12-20", "Hàng lạnh Bình Dương"),
    ("51D-555.66", "Isuzu FVR34", "Thùng cánh dơi", "8 tấn", "2026-11-10", "2027-04-01", ""),
    ("51D-666.77", "Thaco Ollin 720", "Thùng kín", "7 tấn", "2027-08-08", "2027-08-08", "Xe dự phòng"),
    ("51D-777.88", "Kia K250", "Thùng bạt", "2.4 tấn", "2027-02-02", "2026-12-05", "Giao nội thành"),
]
# name, phone, ID, licence no, class, licence until, home truck (plate)
DRIVERS = [
    ("Trương Văn Lộc", "0903 112 233", "079090001122", "790112233445", "C", "2028-05-10", "51D-111.22"),
    ("Đỗ Minh Nhật", "0938 224 466", "079091002233", "790223344556", "C", "2027-09-30", "51D-222.33"),
    ("Lý Văn Phúc", "0912 335 577", "079088003344", "790334455667", "C", "2026-12-01", "51D-333.44"),
    ("Châu Quốc Tài", "0987 446 688", "079085004455", "790445566778", "FC", "2029-01-20", "51D-444.55"),
    ("Mai Thanh Sơn", "0909 557 799", "079092005566", "790556677889", "C", "2028-11-11", "51D-555.66"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", help="database file (default: the app's booking_data.db)")
    args = parser.parse_args()
    if args.db:
        os.environ["DB_PATH"] = os.path.abspath(args.db)

    from backend.app.core import database as db
    from backend.app.core import fleet

    path = db.get_db_path() if hasattr(db, "get_db_path") else os.environ.get("DB_PATH")
    if path and os.path.exists(path):
        backup = f"{path}.bak-{datetime.now():%Y%m%d-%H%M%S}"
        with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
            src.backup(dst)
        print(f"Backup: {backup}")
    db.init_db()

    with db.get_connection() as conn:
        plates = {r[0] for r in conn.execute("SELECT plate_key FROM fleet_vehicles;")}
        names = {r[0] for r in conn.execute("SELECT name FROM fleet_drivers WHERE deleted_at IS NULL;")}

    ids = {}
    for plate, vtype, body, payload, reg, ins, note in TRUCKS:
        if fleet.plate_key(plate) in plates:
            print(f"  = {plate} đã có, bỏ qua")
            continue
        ids[plate] = fleet.create_vehicle({
            "plate": plate, "category": "truck", "vehicle_type": vtype, "body_type": body, "payload": payload,
            "registration_expiry": reg, "insurance_expiry": ins, "note": note})
        print(f"  + xe tải {plate} ({body}, {payload})")

    driver_ids = {}
    for name, phone, id_no, lic, cls, lic_exp, home in DRIVERS:
        if name in names:
            print(f"  = {name} đã có, bỏ qua")
            continue
        data = {"name": name, "phone": phone, "id_number": id_no, "license_no": lic, "license_class": cls,
                "license_expiry": lic_exp}
        if home in ids:
            data["home_vehicle_id"] = ids[home]
        driver_ids[name] = fleet.create_driver(data)
        print(f"  + tài xế {name}" + (f" → {home}" if home in ids else ""))

    # a few states to look at: a broken truck whose driver drives the spare for now, one in maintenance
    if "51D-444.55" in ids and "51D-666.77" in ids and "Châu Quốc Tài" in driver_ids:
        fleet.set_vehicle_status(ids["51D-444.55"], "broken", "Hư máy lạnh thùng", move_to_vehicle_id=ids["51D-666.77"])
        print("  ! 51D-444.55 hư máy lạnh → Châu Quốc Tài lái tạm 51D-666.77")
    if "51D-555.66" in ids:
        fleet.set_vehicle_status(ids["51D-555.66"], "maintenance", "Bảo dưỡng định kỳ 40.000 km")
        print("  ! 51D-555.66 bảo dưỡng")
    print(f"Xong: {len(ids)} xe tải, {len(driver_ids)} tài xế mới.")


if __name__ == "__main__":
    main()
