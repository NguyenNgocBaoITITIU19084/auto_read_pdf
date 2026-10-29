"""Auto import of booking PDFs saved into a watched folder."""
import json
import os
import re
import time

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services import auto_import as ai
from backend.app.services import background_tasks as bt
from backend.app.services import change_detection as cd

client = TestClient(app)


def _fake_extract(data: bytes) -> dict:
    """Stands in for the PDF parser (tested on its own): b"%PDF BK=<no>" reads as booking <no>, anything else as a scan."""
    m = re.search(rb"BK=(\w+)", data)
    if not m:
        return {"Booking No": "null", "Carrier": "null"}
    return {"Booking No": m.group(1).decode(), "Carrier": "ONE", "Trunk Vessel": "EVER OATH", "ETD_Trunk": "20/10/2026"}


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    db.init_db()
    db.set_notification_settings(cd.ALL_KINDS, True, "07:30")
    with db.get_connection() as conn:
        conn.execute("DELETE FROM auto_import_files;")
    for key in (ai.KEY_ENABLED, ai.KEY_FOLDER, ai.KEY_COLLECTION, ai.KEY_LAST_RESULT, ai.KEY_LAST_SCAN_AT,
                ai.KEY_MODE, ai.KEY_INTERVAL, ai.KEY_TIMES):
        db.set_system_setting(key, "")
    ai._reset_memory()
    monkeypatch.setattr(ai, "extract_booking_from_pdf_bytes", _fake_extract)
    yield
    for job_id in (bt.AUTO_IMPORT_JOB_ID, bt.AUTO_IMPORT_RECHECK_JOB_ID):
        bt._remove_job(job_id)


@pytest.fixture
def col_id():
    return db.create_collection(f"auto-import-{time.time_ns()}")


def _write(folder, name, booking_no=None, age_seconds=120, content=None):
    path = folder / name
    path.write_bytes(content if content is not None else (b"%PDF-1.4 " + (f"BK={booking_no}".encode() if booking_no else b"scan")))
    old = time.time() - age_seconds
    os.utime(path, (old, old))
    return path


def _bookings(col_id):
    return {b["Booking No"]: b for b in db.get_bookings(col_id)}


def _notes(col_id):
    with db.get_connection() as conn:
        rows = db._select_dicts(conn, "SELECT * FROM notifications WHERE kind = ? AND collection_id = ? ORDER BY id;",
                                (cd.BOOKING_AUTO_IMPORT, col_id))
    for r in rows:
        r["detail"] = json.loads(r["detail"] or "{}")
    return rows


def test_files_already_in_the_folder_are_left_alone(tmp_path, col_id):
    _write(tmp_path, "old.pdf", "OLD1")
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "new.pdf", "NEW1")

    result = ai.scan_once()

    assert [i["booking_no"] for i in result["imported"]] == ["NEW1"]
    assert set(_bookings(col_id)) == {"NEW1"}
    assert [h["file_name"] for h in db.list_auto_import_files()] == ["new.pdf"]  # the remembered one is not listed


def test_import_existing_reads_the_files_already_there(tmp_path, col_id):
    _write(tmp_path, "old.pdf", "OLD1")
    ai.save_settings(True, str(tmp_path), col_id, import_existing=True)

    ai.scan_once()

    assert set(_bookings(col_id)) == {"OLD1"}


def test_imported_booking_keeps_file_name_and_vessel(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "BK ONE.pdf", "ONE123")

    ai.scan_once()

    b = _bookings(col_id)["ONE123"]
    assert b["Tên file PDF"] == "BK ONE.pdf"
    assert b["Vessel"] == "EVER OATH"
    assert os.path.exists(tmp_path / "BK ONE.pdf")  # never moved or deleted


def test_each_file_is_read_once(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "a.pdf", "A1")
    ai.scan_once()
    ai._reset_memory()  # as after a restart
    _write(tmp_path, "a copy.pdf", "A1")  # same content under another name

    assert ai.scan_once()["imported"] == []
    assert len(db.get_bookings(col_id)) == 1


def test_existing_booking_no_is_skipped_and_reported(tmp_path, col_id):
    booking_id = db.insert_booking(col_id, {"Booking No": "DUP1", "Ghi chú": "giữ nguyên", "Vessel": "OLD VESSEL"})
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "amend.pdf", "DUP1")

    result = ai.scan_once()

    assert result["imported"] == []
    assert result["skipped"][0]["status"] == db.AUTO_IMPORT_DUPLICATE
    rows = db.get_bookings(col_id)
    assert len(rows) == 1 and rows[0]["id"] == booking_id and rows[0]["Vessel"] == "OLD VESSEL"
    note = _notes(col_id)[-1]
    assert note["title"] == "1 file PDF cần xem lại"
    assert note["nav_query"] == "DUP1"
    assert note["detail"]["skipped"][0]["file"] == "amend.pdf"


def test_scan_without_booking_fields_is_not_saved(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "scan.pdf")

    result = ai.scan_once()

    assert result["skipped"][0]["status"] == db.AUTO_IMPORT_NO_DATA
    assert db.get_bookings(col_id) == []


def test_file_not_really_a_pdf(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "photo.pdf", content=b"\x89PNG\r\n\x1a\n" + b"0" * 32)

    assert ai.scan_once()["skipped"][0]["status"] == db.AUTO_IMPORT_ERROR


def test_file_still_being_written_waits_for_next_scan(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "downloading.pdf", "W1", age_seconds=0)

    first = ai.scan_once()
    assert first["imported"] == [] and first["waiting"] == 1
    second = ai.scan_once()  # unchanged since the previous scan: done
    assert [i["booking_no"] for i in second["imported"]] == ["W1"]


def test_only_pdfs_at_the_top_of_the_folder(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    (tmp_path / "sub").mkdir()
    _write(tmp_path / "sub", "inner.pdf", "SUB1")
    _write(tmp_path, "note.txt", "TXT1")
    _write(tmp_path, "~$lock.pdf", "LOCK1")
    _write(tmp_path, "UPPER.PDF", "UP1")

    assert [i["booking_no"] for i in ai.scan_once()["imported"]] == ["UP1"]


def test_one_notification_per_scan(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "a.pdf", "N1")
    _write(tmp_path, "b.pdf", "N2")
    _write(tmp_path, "c.pdf")

    ai.scan_once()

    notes = _notes(col_id)
    assert len(notes) == 1
    assert notes[0]["title"] == "Tự nhập 2 booking từ thư mục, 1 file cần xem lại"
    assert notes[0]["nav_tab"] == "booking"
    assert notes[0]["detail"]["count"] == 2


def test_notification_kind_switched_off(tmp_path, col_id):
    db.set_notification_settings([k for k in cd.ALL_KINDS if k != cd.BOOKING_AUTO_IMPORT], True)
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "a.pdf", "OFF1")

    ai.scan_once()

    assert "OFF1" in _bookings(col_id)
    assert _notes(col_id) == []


def test_disabled_does_nothing(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    ai.save_settings(False, str(tmp_path), col_id)
    _write(tmp_path, "a.pdf", "D1")

    assert ai.scan_once()["status"] == "disabled"
    assert db.get_bookings(col_id) == []


def test_deleted_collection_is_reported(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    db.delete_collection(col_id)

    result = ai.scan_once()

    assert result["status"] == "error" and result["message"] == ai.MSG_COLLECTION_MISSING
    assert ai.get_settings()["last_result"]["message"] == ai.MSG_COLLECTION_MISSING


def test_missing_folder_cannot_be_enabled(tmp_path, col_id):
    with pytest.raises(ValueError):
        ai.save_settings(True, str(tmp_path / "nope"), col_id)


def test_forget_reads_the_file_again(tmp_path, col_id):
    db.insert_booking(col_id, {"Booking No": "AGAIN1"})
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "again.pdf", "AGAIN1")
    ai.scan_once()
    db.delete_bookings_batch([b["id"] for b in db.get_bookings(col_id)])
    sha = db.list_auto_import_files()[0]["sha256"]

    assert ai.forget(sha)
    assert [i["booking_no"] for i in ai.scan_once()["imported"]] == ["AGAIN1"]


def test_api_round_trip(tmp_path, col_id):
    res = client.put("/api/v1/auto-import/settings", json={"enabled": True, "folder": str(tmp_path), "collection_id": col_id})
    assert res.status_code == 200 and res.json()["enabled"] and res.json()["folder_ok"]
    _write(tmp_path, "api.pdf", "API1")

    run = client.post("/api/v1/auto-import/run").json()
    assert [i["booking_no"] for i in run["imported"]] == ["API1"]
    assert run["settings"]["last_result"]["imported"] == 1

    items = client.get("/api/v1/auto-import/history").json()["items"]
    assert items[0]["file_name"] == "api.pdf" and items[0]["status"] == "imported"
    assert client.delete(f"/api/v1/auto-import/history/{items[0]['sha256']}").status_code == 200
    assert client.delete("/api/v1/auto-import/history/unknown").status_code == 404


def test_api_rejects_missing_folder(tmp_path, col_id):
    res = client.put("/api/v1/auto-import/settings", json={"enabled": True, "folder": str(tmp_path / "x"), "collection_id": col_id})
    assert res.status_code == 400
    assert res.json()["detail"] == ai.MSG_FOLDER_MISSING


def test_new_kind_is_on_for_existing_settings():
    db.set_system_setting("notify_kinds", json.dumps(list(cd.LEGACY_KINDS + cd.REMINDER_KINDS)))
    db.set_system_setting("notify_kinds_known", json.dumps(list(cd.LEGACY_KINDS + cd.REMINDER_KINDS)))
    assert cd.BOOKING_AUTO_IMPORT in db.get_notification_settings()["kinds"]


def test_import_seq_goes_up_only_when_bookings_are_added(tmp_path, col_id):
    ai.save_settings(True, str(tmp_path), col_id)
    start = ai.import_seq()
    _write(tmp_path, "scan.pdf")
    ai.scan_once()
    assert ai.import_seq() == start
    _write(tmp_path, "a.pdf", "SEQ1")
    ai.scan_once()
    assert ai.import_seq() == start + 1
    assert client.get("/api/v1/notifications").json()["auto_import_seq"] == start + 1


def test_import_seq_goes_up_with_the_notification_off(tmp_path, col_id):
    db.set_notification_settings([k for k in cd.ALL_KINDS if k != cd.BOOKING_AUTO_IMPORT], True)
    ai.save_settings(True, str(tmp_path), col_id)
    start = ai.import_seq()
    _write(tmp_path, "a.pdf", "SEQ2")
    ai.scan_once()
    assert ai.import_seq() == start + 1


def test_folder_without_permission_says_so(tmp_path, col_id, monkeypatch):
    ai.save_settings(True, str(tmp_path), col_id)

    def denied(_folder):
        raise PermissionError("Operation not permitted")
    monkeypatch.setattr(ai, "_list_pdfs", denied)

    result = ai.scan_once()
    assert result["status"] == "error" and result["message"] == ai.MSG_FOLDER_DENIED


def test_switching_on_for_a_protected_folder_says_so_and_saves_nothing(tmp_path, col_id, monkeypatch):
    def denied(_folder):
        raise PermissionError("Operation not permitted")
    monkeypatch.setattr(ai, "_list_pdfs", denied)

    res = client.put("/api/v1/auto-import/settings", json={"enabled": True, "folder": str(tmp_path), "collection_id": col_id})

    assert res.status_code == 400 and res.json()["detail"] == ai.MSG_FOLDER_DENIED
    settings = ai.get_settings()
    assert not settings["enabled"] and settings["folder"] == "" and settings["collection_id"] is None


def test_too_large_file_is_reported_once_even_after_a_restart(tmp_path, col_id, monkeypatch):
    monkeypatch.setattr(ai, "MAX_FILE_BYTES", 100)
    ai.save_settings(True, str(tmp_path), col_id)
    _write(tmp_path, "big.pdf", content=b"%PDF-1.4 " + b"x" * 200)

    first = ai.scan_once()
    ai._reset_memory()  # the app is restarted
    second = ai.scan_once()

    assert [i["message"] for i in first["skipped"]] == [ai.MSG_TOO_LARGE]
    assert second["skipped"] == [] and len(_notes(col_id)) == 1
    assert [(h["file_name"], h["status"]) for h in db.list_auto_import_files()] == [("big.pdf", db.AUTO_IMPORT_ERROR)]


def test_too_large_file_already_in_the_folder_is_left_alone(tmp_path, col_id, monkeypatch):
    monkeypatch.setattr(ai, "MAX_FILE_BYTES", 100)
    _write(tmp_path, "big.pdf", content=b"%PDF-1.4 " + b"x" * 200)
    ai.save_settings(True, str(tmp_path), col_id)

    assert ai.scan_once()["skipped"] == []


def test_folder_changed_while_switched_off_is_not_imported_whole_by_scan_now(tmp_path, col_id):
    first, second = tmp_path / "a", tmp_path / "b"
    first.mkdir()
    second.mkdir()
    ai.save_settings(True, str(first), col_id)
    _write(second, "old.pdf", "OLD2")
    ai.save_settings(False, str(second), col_id)   # new path typed, then switched off
    _write(second, "new.pdf", "NEW2")

    result = ai.scan_once(force=True)               # "scan now"

    assert [i["booking_no"] for i in result["imported"]] == ["NEW2"]


def _job():
    return bt.scheduler.get_job(bt.AUTO_IMPORT_JOB_ID)


def test_schedule_defaults_to_every_five_minutes(tmp_path, col_id):
    settings = ai.save_settings(True, str(tmp_path), col_id)
    assert (settings["mode"], settings["interval_minutes"], settings["times"]) == ("interval", 5, [])


def test_scan_job_follows_the_chosen_schedule(tmp_path, col_id):
    body = {"enabled": True, "folder": str(tmp_path), "collection_id": col_id}
    res = client.put("/api/v1/auto-import/settings", json={**body, "mode": "interval", "interval_minutes": 30})
    assert res.status_code == 200 and res.json()["next_scan_at"]
    assert _job().trigger.interval.total_seconds() == 30 * 60

    res = client.put("/api/v1/auto-import/settings", json={**body, "mode": "times", "times": ["17:30", "8:00", "08:00"]})
    assert res.json()["times"] == ["08:00", "17:30"]
    assert type(_job().trigger).__name__ == "OrTrigger"      # one cron trigger per time

    # Left out: the schedule stays as it is
    assert client.put("/api/v1/auto-import/settings", json=body).json()["times"] == ["08:00", "17:30"]


def test_no_scan_job_while_switched_off(tmp_path, col_id):
    body = {"folder": str(tmp_path), "collection_id": col_id}
    client.put("/api/v1/auto-import/settings", json={**body, "enabled": True})
    assert _job() is not None
    res = client.put("/api/v1/auto-import/settings", json={**body, "enabled": False})
    assert _job() is None and res.json()["next_scan_at"] is None


@pytest.mark.parametrize("schedule, message", [
    ({"mode": "interval", "interval_minutes": 0}, ai.MSG_INTERVAL),
    ({"mode": "interval", "interval_minutes": 2000}, ai.MSG_INTERVAL),
    ({"mode": "times", "times": []}, ai.MSG_TIMES),
    ({"mode": "times", "times": ["25:00"]}, ai.MSG_TIMES),
])
def test_invalid_schedule_is_rejected_and_nothing_saved(tmp_path, col_id, schedule, message):
    res = client.put("/api/v1/auto-import/settings",
                     json={"enabled": True, "folder": str(tmp_path), "collection_id": col_id, **schedule})
    assert res.status_code == 400 and res.json()["detail"] == message
    assert not ai.get_settings()["enabled"] and ai.get_settings()["folder"] == ""


def test_file_still_being_written_is_rechecked_soon(tmp_path, col_id):
    import asyncio
    ai.save_settings(True, str(tmp_path), col_id, mode="times", times=["08:00"])
    _write(tmp_path, "fresh.pdf", "FRESH1", age_seconds=0)       # just saved: waits

    async def scan():
        bt.setup_scheduler()
        bt.register_auto_import_job()
        await bt._run_auto_import()
        recheck = bt.scheduler.get_job(bt.AUTO_IMPORT_RECHECK_JOB_ID)
        bt._remove_job(bt.AUTO_IMPORT_JOB_ID)
        bt._remove_job(bt.AUTO_IMPORT_RECHECK_JOB_ID)
        return recheck

    recheck = asyncio.run(scan())
    assert recheck is not None and recheck.kwargs == {"recheck": False}
