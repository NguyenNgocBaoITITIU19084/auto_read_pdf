import sqlite3

import pytest

from backend.app.core import database as db


def _count(sql, params=()):
    with db.get_connection() as conn:
        return conn.execute(sql, params).fetchone()[0]


# ---------------------------------------------------------------------------
# Color rules dedupe + restore idempotency
# ---------------------------------------------------------------------------
def test_init_db_dedupes_bloated_color_rules(tmp_path, monkeypatch):
    db_path = str(tmp_path / "legacy.db")
    monkeypatch.setenv("DB_PATH", db_path)
    # Legacy schema: no UNIQUE index, watchlists without sync columns
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE color_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_table TEXT NOT NULL DEFAULT 'all', column_key TEXT NOT NULL DEFAULT 'all',
            match_value TEXT NOT NULL, match_type TEXT NOT NULL DEFAULT 'exact',
            preset_id TEXT, custom_bg TEXT, custom_border TEXT, custom_text TEXT,
            is_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        );
        CREATE TABLE collections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE container_watchlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER NOT NULL,
            site_id TEXT NOT NULL, container_no TEXT NOT NULL
        );
    """)
    rows = []
    for copy_no in range(200):
        for r in db.DEFAULT_COLOR_RULES:
            rows.append((r["target_table"], r["column_key"], r["match_value"], r["match_type"],
                         "custom" if copy_no == 199 else r["preset_id"], "2026-01-01 00:00:00"))
        rows.append(("booking", "Carrier", "USER_RULE", "exact", "pink", "2026-01-01 00:00:00"))
    conn.executemany(
        "INSERT INTO color_rules (target_table, column_key, match_value, match_type, preset_id, created_at) VALUES (?,?,?,?,?,?)",
        rows)
    conn.commit()
    conn.close()

    db.init_db()

    distinct = len(db.DEFAULT_COLOR_RULES) + 1
    assert _count("SELECT COUNT(*) FROM color_rules") == distinct
    # MAX(id) (the newest copy — the one the UI was applying) is the one kept
    assert _count("SELECT COUNT(*) FROM color_rules WHERE preset_id = 'custom'") == len(db.DEFAULT_COLOR_RULES)
    assert _count("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", (db.COLOR_RULES_UNIQUE_INDEX,)) == 1

    cw_cols = {r[1] for r in sqlite3.connect(db_path).execute("PRAGMA table_info(container_watchlists)")}
    assert {"event_type", "last_sync_at", "last_sync_status", "last_sync_message"} <= cw_cols

    # Running init again is a no-op
    db.init_db()
    assert _count("SELECT COUNT(*) FROM color_rules") == distinct


def test_create_color_rule_is_idempotent(fresh_db):
    data = {"target_table": "booking", "column_key": "Carrier", "match_value": " DUP ", "match_type": "exact", "preset_id": "pink"}
    first = db.create_color_rule(data)
    second = db.create_color_rule(data)
    assert first > 0 and first == second
    assert _count("SELECT COUNT(*) FROM color_rules WHERE match_value = 'DUP'") == 1


def test_default_customs_status_rules_seeded(fresh_db):
    rules = [r for r in db.get_color_rules() if r["column_key"] == "customs_status"]
    presets = {r["match_value"]: r["preset_id"] for r in rules}
    assert presets == {"Đã thông quan": "emerald", "Chưa thông quan": "rose"}
    reset = db.reset_color_rules_to_default()
    assert len(reset) == len(db.DEFAULT_COLOR_RULES)


def test_restore_three_times_keeps_color_rule_count(fresh_db):
    db.create_color_rule({"target_table": "booking", "column_key": "Carrier", "match_value": "COSCO_SPECIAL", "preset_id": "purple"})
    before = len(db.get_color_rules())
    backup = db.export_backup_data()
    for _ in range(3):
        db.import_backup_data(backup)
    after = db.get_color_rules()
    assert len(after) == before
    assert any(r["match_value"] == "COSCO_SPECIAL" for r in after)


def test_restore_keeps_last_duplicate_from_backup(fresh_db):
    backup = db.export_backup_data()
    rule = {"target_table": "all", "column_key": "site_id", "match_value": "CTL", "match_type": "exact", "is_enabled": 1}
    backup["color_rules"] = [dict(rule, preset_id="blue"), dict(rule, preset_id="rose")]
    db.import_backup_data(backup, mode="replace")
    rules = db.get_color_rules()
    assert len(rules) == 1 and rules[0]["preset_id"] == "rose"


def test_restore_of_bloated_backup_dedupes(fresh_db):
    backup = db.export_backup_data()
    backup["color_rules"] = backup["color_rules"] * 50
    db.import_backup_data(backup)
    assert len(db.get_color_rules()) == len(db.DEFAULT_COLOR_RULES)


def test_restore_is_single_transaction(fresh_db):
    before = _count("SELECT COUNT(*) FROM collections")
    bad_backup = {"collections": [
        {"name": "Good", "bookings": [{"booking_no": "B1"}]},
        {"name": "Broken", "bookings": ["not-a-dict"]},
    ]}
    with pytest.raises(Exception):
        db.import_backup_data(bad_backup)
    assert _count("SELECT COUNT(*) FROM collections") == before
    assert _count("SELECT COUNT(*) FROM bookings") == 0


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------
def test_connection_context_closes_and_pragmas(fresh_db):
    with db.get_connection() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")


def test_connection_context_rolls_back_on_error(fresh_db):
    with pytest.raises(RuntimeError):
        with db.get_connection() as conn:
            conn.execute("INSERT INTO collections (name, created_at) VALUES ('rollback-me', 'x')")
            raise RuntimeError("boom")
    assert _count("SELECT COUNT(*) FROM collections WHERE name = 'rollback-me'") == 0
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")


def test_indexes_created(fresh_db):
    with db.get_connection() as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert {"idx_bookings_collection", "idx_vessel_schedules_col_queried", "idx_containers_col_queried"} <= names


# ---------------------------------------------------------------------------
# Batch functions / watchlist sync status
# ---------------------------------------------------------------------------
def test_delete_bookings_batch(fresh_db):
    col = db.create_collection("B")
    ids = [db.insert_booking(col, {"booking_no": f"BK{i}"}) for i in range(5)]
    assert db.delete_bookings_batch(ids[:3] + [999999]) == 3
    assert db.delete_bookings_batch([]) == 0
    assert len(db.get_bookings(col)) == 2


def test_vessel_watchlist_batch_and_sync_status(fresh_db):
    col = db.create_collection("V")
    items = [
        {"site_id": "CTL", "vessel_name": "EVER MEMO", "voyage": "012E"},
        {"site_id": "CTL", "vessel_name": "EVER MEMO", "voyage": "012E"},  # duplicate
        {"site_id": "GNL", "vessel_name": "ONE APUS", "voyage": ""},
        {"site_id": "GNL", "vessel_name": "  ", "voyage": "X"},  # invalid
    ]
    assert db.add_vessel_watchlist_batch(col, items) == 2
    assert db.add_vessel_watchlist_batch(col, items) == 0
    wl = db.get_watchlist(col)
    assert len(wl) == 2

    db.update_watchlist_sync_status("vessel", wl[0]["id"], "not_found", "voyage mismatch")
    row = next(w for w in db.get_all_watchlists() if w["id"] == wl[0]["id"])
    assert row["last_sync_status"] == "not_found"
    assert row["last_sync_message"] == "voyage mismatch"
    assert len(row["last_sync_at"]) == 19
    with pytest.raises(ValueError):
        db.update_watchlist_sync_status("ship", wl[0]["id"], "ok")
    with pytest.raises(ValueError):
        db.update_watchlist_sync_status("vessel", wl[0]["id"], "weird")

    assert db.remove_vessel_watchlist_batch([w["id"] for w in wl]) == 2
    assert db.get_watchlist(col) == []


def test_container_watchlist_batch(fresh_db):
    col = db.create_collection("C")
    items = [
        {"site_id": "ctl", "container_no": "emcu1234567", "event_type": "unload"},
        {"site_id": "CTL", "container_no": "EMCU1234567", "event_type": "UNLOAD"},
        {"site_id": "CTL", "container_no": "EMCU1234567", "event_type": ""},
    ]
    assert db.add_container_watchlist_batch(col, items) == 2
    wl = db.get_container_watchlist(col)
    assert {w["event_type"] for w in wl} == {"UNLOAD", ""}
    db.update_watchlist_sync_status("container", wl[0]["id"], "ok")
    assert db.get_all_container_watchlists()[0]["last_sync_status"] == "ok"
    assert db.remove_container_watchlist_batch([w["id"] for w in wl]) == 2


def test_get_by_ids(fresh_db):
    col = db.create_collection("IDS")
    db.insert_vessel_schedules(col, [{"SITE_ID": "CTL", "VESSELNAME": "A", "IN_OUT_VOYAGE": "1"},
                                     {"SITE_ID": "CTL", "VESSELNAME": "B", "IN_OUT_VOYAGE": "2"}])
    v_ids = [v["id"] for v in db.get_vessel_schedules(col)]
    assert {v["vessel_name"] for v in db.get_vessel_schedules_by_ids(v_ids[:1])} <= {"A", "B"}
    assert len(db.get_vessel_schedules_by_ids(v_ids + [424242])) == 2
    assert db.get_vessel_schedules_by_ids([]) == []


# ---------------------------------------------------------------------------
# Move / copy
# ---------------------------------------------------------------------------
def test_move_and_copy_items(fresh_db):
    src = db.create_collection("SRC")
    dst = db.create_collection("DST")
    b_ids = [db.insert_booking(src, {"booking_no": f"BK{i}"}) for i in range(3)]
    db.insert_vessel_schedules(src, [{"SITE_ID": "CTL", "VESSELNAME": "A", "IN_OUT_VOYAGE": "1"},
                                     {"SITE_ID": "CTL", "VESSELNAME": "B", "IN_OUT_VOYAGE": "2"}])
    db.insert_containers(src, [{"SITE": "CTL", "CONTAINERNO": "AAAU1111111", "EVENT_TYPE": "LOAD", "EVENT_TIME": "t1"}])

    assert db.move_items_to_collection("bookings", b_ids[:2], dst) == 2
    assert len(db.get_bookings(src)) == 1 and len(db.get_bookings(dst)) == 2

    v_ids = [v["id"] for v in db.get_vessel_schedules(src)]
    assert db.move_items_to_collection("vessels", v_ids, dst, copy=True) == 2
    assert len(db.get_vessel_schedules(src)) == 2 and len(db.get_vessel_schedules(dst)) == 2
    # copying again replaces the identical rows instead of duplicating (UNIQUE ... ON CONFLICT REPLACE)
    db.move_items_to_collection("vessels", v_ids, dst, copy=True)
    assert len(db.get_vessel_schedules(dst)) == 2
    # items already in the target are skipped
    assert db.move_items_to_collection("vessels", [v["id"] for v in db.get_vessel_schedules(dst)], dst) == 0

    c_ids = [c["id"] for c in db.get_containers(src)]
    assert db.move_items_to_collection("containers", c_ids, dst) == 1
    assert db.get_containers(src) == [] and len(db.get_containers(dst)) == 1

    with pytest.raises(ValueError):
        db.move_items_to_collection("ships", c_ids, dst)
    with pytest.raises(ValueError):
        db.move_items_to_collection("bookings", b_ids, 987654)
    assert db.move_items_to_collection("bookings", [], dst) == 0


# ---------------------------------------------------------------------------
# customs_status / imdg_url
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("cust,clearance,expected", [
    ("Y", "Y", "Đã thông quan"),
    ("Y", "N", "Đã thông quan"),
    ("Y", "", "Đã thông quan"),
    ("N", "Y", "Chưa thông quan"),
    ("N", "N", "Chưa thông quan"),
    ("", "N", ""),
    ("", "Y", ""),
    ("", "", ""),
    (None, None, ""),
])
def test_compute_customs_status(cust, clearance, expected):
    assert db.compute_customs_status(cust, clearance) == expected


def test_parse_haz():
    raw = "<a target='_blank' href='http://imdg.saigonnewport.com.vn/?siteId=CTL&amp;itemNo=ZGLU2008173'></a>"
    assert db.parse_haz(raw) == ("", "http://imdg.saigonnewport.com.vn/?siteId=CTL&itemNo=ZGLU2008173")
    assert db.parse_haz('<a href="http://x/y">3.1</a>') == ("3.1", "http://x/y")
    assert db.parse_haz("3") == ("3", "")
    assert db.parse_haz(None) == ("", "")


def _seed_customs_containers(col):
    haz = "<a target='_blank' href='http://imdg.saigonnewport.com.vn/?siteId=CTL&itemNo=ZGLU2008173'></a>"
    db.insert_containers(col, [
        {"SITE": "CTL", "CONTAINERNO": "CLRD0000001", "EVENT_TYPE": "INGATE", "CUST": "Y", "CUSTOM_CLEARANCE_STATUS": "Y", "HAZ": haz},
        {"SITE": "CTL", "CONTAINERNO": "SUPV0000002", "EVENT_TYPE": "INGATE", "CUST": "Y", "CUSTOM_CLEARANCE_STATUS": "N"},
        {"SITE": "CTL", "CONTAINERNO": "NOTC0000003", "EVENT_TYPE": "INGATE", "CUST": "N", "CUSTOM_CLEARANCE_STATUS": "N"},
        {"SITE": "CTL", "CONTAINERNO": "UNKN0000004", "EVENT_TYPE": "INGATE"},
    ])


def test_get_containers_computed_fields_and_search(fresh_db):
    col = db.create_collection("CUS")
    _seed_customs_containers(col)
    rows = {r["containerno"]: r for r in db.get_containers(col)}
    assert rows["CLRD0000001"]["customs_status"] == "Đã thông quan"
    assert rows["CLRD0000001"]["imdg_url"].endswith("itemNo=ZGLU2008173")
    assert rows["CLRD0000001"]["haz"] == ""
    assert rows["SUPV0000002"]["customs_status"] == "Đã thông quan"
    assert rows["NOTC0000003"]["customs_status"] == "Chưa thông quan"
    assert rows["UNKN0000004"]["customs_status"] == "" and rows["UNKN0000004"]["imdg_url"] == ""

    by_field = db.get_containers(col, "Chưa thông quan", "customs_status")
    assert [r["containerno"] for r in by_field] == ["NOTC0000003"]
    all_fields = db.get_containers(col, "Chưa thông quan", "all")
    assert [r["containerno"] for r in all_fields] == ["NOTC0000003"]

    by_ids = db.get_containers_by_ids([rows["CLRD0000001"]["id"], rows["SUPV0000002"]["id"]])
    assert {r["customs_status"] for r in by_ids} == {"Đã thông quan"}
    assert all("imdg_url" in r for r in by_ids)


def test_dashboard_uses_merged_customs_logic(fresh_db):
    col = db.create_collection("DASH")
    _seed_customs_containers(col)
    summary = db.get_dashboard_summary(collection_id=col)
    assert summary["kpis"]["customs_cleared"] == 2
    assert summary["kpis"]["customs_uncleared"] == 1
    alert_nos = {c["containerno"] for c in summary["alerts"]["uncleared_containers"]}
    assert alert_nos == {"SUPV0000002", "NOTC0000003"}
    assert all(c["customs_status"] for c in summary["alerts"]["uncleared_containers"])


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
def test_backup_includes_watchlists_and_raw_haz(fresh_db):
    col = db.create_collection("BK")
    db.add_to_watchlist(col, "CTL", "EVER MEMO", "012E")
    db.add_to_container_watchlist(col, "CTL", "EMCU9914560", "UNLOAD")
    _seed_customs_containers(col)

    backup = db.export_backup_data()
    col_backup = next(c for c in backup["collections"] if c["name"] == "BK")
    assert col_backup["vessel_watchlists"][0]["vessel_name"] == "EVER MEMO"
    assert col_backup["container_watchlists"][0]["event_type"] == "UNLOAD"
    assert any("<a" in (c["haz"] or "") for c in col_backup["containers"])

    with db.get_connection() as conn:
        conn.execute("DELETE FROM collections;")
    db.import_backup_data(backup)

    restored = next(c for c in db.get_collections() if c["name"] == "BK")
    assert [(w["site_id"], w["vessel_name"], w["voyage"]) for w in db.get_watchlist(restored["id"])] == [("CTL", "EVER MEMO", "012E")]
    assert [w["event_type"] for w in db.get_container_watchlist(restored["id"])] == ["UNLOAD"]
    assert any(r["imdg_url"] for r in db.get_containers(restored["id"]))


def test_restore_twice_creates_unique_collection_names(fresh_db):
    db.create_collection("Same")
    backup = db.export_backup_data()
    db.import_backup_data(backup)
    db.import_backup_data(backup)
    names = [c["name"] for c in db.get_collections()]
    assert len(names) == len(set(names))
