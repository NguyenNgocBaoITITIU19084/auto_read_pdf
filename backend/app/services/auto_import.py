"""Auto import: booking PDFs saved into a watched folder are read and added to a collection without dragging them in.

The rules are conservative on purpose — the folder belongs to the user and a wrong row is worse than a missed one:
- only *.pdf files directly in the folder (no subfolders); the files are never moved, renamed or deleted;
- a file is read once its size and modification time have stopped changing (a download or copy still in progress
  is left for the next scan), and each content (SHA-256) only once, whatever it is called;
- the PDF text layer only: a scan is never sent to Gemini / OCR from the background, it is listed as needing a hand;
- a Booking No already in the collection is skipped and reported, never overwritten;
- the files already in the folder when it is chosen are remembered, not imported (unless asked for).
"""
import hashlib
import json
import logging
import os
import threading
import time

from backend.app.core import database as db
from backend.app.core.timezone import now_vn_str
from backend.app.services.extractor import extract_booking_from_pdf_bytes, has_booking_fields, resolve_vessel_etd
from backend.app.services.file_kind import PDF, detect_file_kind

logger = logging.getLogger("backend.services.auto_import")

KEY_ENABLED = "auto_import_enabled"
KEY_FOLDER = "auto_import_folder"
KEY_COLLECTION = "auto_import_collection_id"
KEY_LAST_SCAN_AT = "auto_import_last_scan_at"
KEY_LAST_RESULT = "auto_import_last_result"
KEY_MODE = "auto_import_mode"
KEY_INTERVAL = "auto_import_interval_minutes"
KEY_TIMES = "auto_import_times"
# Goes up each time a scan adds bookings: open booking tables reload on it, whatever the notification settings
KEY_IMPORT_SEQ = "auto_import_seq"

# When the folder is scanned (chosen by the user): every N minutes, or at fixed times of day
MODES = ("interval", "times")
DEFAULT_INTERVAL_MINUTES = 5
MAX_INTERVAL_MINUTES = 1440
# A file written to less than this long ago may still be downloading / copying, even if it did not change between scans
SETTLE_SECONDS = 20
MAX_FILE_BYTES = 30 * 1024 * 1024

MSG_DUPLICATE = "Booking No đã có trong bộ sưu tập, bỏ qua"
MSG_NO_DATA = "Không đọc được booking (PDF scan hoặc mẫu chưa hỗ trợ), cần nhập tay"
MSG_NOT_PDF = "File không phải PDF"
MSG_TOO_LARGE = "File quá lớn (trên 30 MB)"
MSG_FOLDER_MISSING = "Không tìm thấy thư mục theo dõi"
MSG_FOLDER_DENIED = "Không có quyền đọc thư mục theo dõi (cấp quyền cho app trong cài đặt bảo mật của máy)"
MSG_COLLECTION_MISSING = "Bộ sưu tập nhận booking không còn tồn tại, vui lòng chọn lại"
MSG_INTERVAL = f"Chu kỳ quét phải từ 1 đến {MAX_INTERVAL_MINUTES} phút"
MSG_TIMES = "Cần ít nhất một giờ quét hợp lệ (HH:MM)"

_scan_lock = threading.Lock()
# path -> (size, mtime_ns) at the previous scan: a file is read once it is the same twice in a row (or old enough)
_last_seen: dict[str, tuple[int, int]] = {}
# path -> (size, mtime_ns) of files already handled, so they are not hashed again every minute
_handled: dict[str, tuple[int, int]] = {}


def import_seq() -> int:
    try:
        return int(db.get_system_setting(KEY_IMPORT_SEQ, "0") or 0)
    except ValueError:
        return 0


def _reset_memory():
    _last_seen.clear()
    _handled.clear()


def get_settings() -> dict:
    folder = db.get_system_setting(KEY_FOLDER, "")
    try:
        col_id = int(db.get_system_setting(KEY_COLLECTION, "") or 0) or None
    except ValueError:
        col_id = None
    try:
        last_result = json.loads(db.get_system_setting(KEY_LAST_RESULT, "") or "null")
    except ValueError:
        last_result = None
    mode = db.get_system_setting(KEY_MODE, "") or "interval"
    try:
        interval = int(db.get_system_setting(KEY_INTERVAL, "") or DEFAULT_INTERVAL_MINUTES)
    except ValueError:
        interval = DEFAULT_INTERVAL_MINUTES
    try:
        times = [str(t) for t in json.loads(db.get_system_setting(KEY_TIMES, "") or "[]")]
    except ValueError:
        times = []
    return {
        "enabled": db.get_system_setting(KEY_ENABLED, "0") == "1",
        "folder": folder,
        "folder_ok": bool(folder) and os.path.isdir(folder),
        "collection_id": col_id,
        "collection_ok": db.collection_exists(col_id) if col_id else False,
        "last_scan_at": db.get_system_setting(KEY_LAST_SCAN_AT, "") or None,
        "last_result": last_result,
        "mode": mode if mode in MODES else "interval",
        "interval_minutes": min(MAX_INTERVAL_MINUTES, max(1, interval)),
        "times": times,
    }


def _check_schedule(mode: str, interval_minutes, times) -> tuple[str, int, list[str]]:
    from backend.app.services.background_tasks import normalize_times  # it imports this module
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    try:
        interval = int(interval_minutes)
    except (TypeError, ValueError):
        raise ValueError(MSG_INTERVAL) from None
    if not 1 <= interval <= MAX_INTERVAL_MINUTES:
        raise ValueError(MSG_INTERVAL)
    try:
        times = normalize_times(times)
    except ValueError:
        raise ValueError(MSG_TIMES) from None
    if mode == "times" and not times:
        raise ValueError(MSG_TIMES)
    return mode, interval, times


def save_settings(enabled: bool, folder: str, collection_id: int | None, import_existing: bool = False,
                  mode: str | None = None, interval_minutes: int | None = None, times: list[str] | None = None) -> dict:
    """Validates and stores the settings. A newly chosen folder (also while switched off, so "scan now" does not import
    it whole) or switching the import on remembers the PDFs already in it, so they are not imported, unless
    `import_existing`. The schedule left out (None) stays as it is. Nothing is stored when a value is invalid or the
    import is switched on for a folder that cannot be read; the caller reschedules the scan job."""
    folder = os.path.abspath(os.path.expanduser(folder.strip())) if (folder or "").strip() else ""
    if enabled:
        if not folder or not os.path.isdir(folder):
            raise ValueError(MSG_FOLDER_MISSING)
        if not db.collection_exists(collection_id):
            raise ValueError(MSG_COLLECTION_MISSING)
    before = get_settings()
    mode, interval_minutes, times = _check_schedule(
        before["mode"] if mode is None else mode,
        before["interval_minutes"] if interval_minutes is None else interval_minutes,
        before["times"] if times is None else times)
    folder_changed = os.path.normcase(before["folder"]) != os.path.normcase(folder)
    starts_watching = (enabled and (not before["enabled"] or folder_changed)) or (folder_changed and os.path.isdir(folder))
    if starts_watching:
        try:
            _list_pdfs(folder)
        except OSError as e:
            # macOS privacy-protected folders (Desktop, Documents, Downloads): isdir() passes, listing does not
            if enabled:
                raise ValueError(MSG_FOLDER_DENIED if isinstance(e, PermissionError) else MSG_FOLDER_MISSING) from None
            starts_watching = False
    db.set_system_setting(KEY_FOLDER, folder)
    db.set_system_setting(KEY_COLLECTION, str(int(collection_id)) if collection_id else "")
    db.set_system_setting(KEY_MODE, mode)
    db.set_system_setting(KEY_INTERVAL, str(interval_minutes))
    db.set_system_setting(KEY_TIMES, json.dumps(times))
    if starts_watching:
        with _scan_lock:
            _reset_memory()
            if not import_existing:
                remembered = _remember_existing(folder)
                logger.info(f"Auto import: watching {folder}, {remembered} PDF(s) already there left as they are")
    db.set_system_setting(KEY_ENABLED, "1" if enabled else "0")
    return get_settings()


def forget(sha256: str) -> bool:
    """Lets a handled file be read again on the next scan."""
    with _scan_lock:
        _handled.clear()  # the file's path is not known here: let every file be hashed once more
        return db.forget_auto_import_file(sha256)


def _list_pdfs(folder: str) -> list[os.DirEntry]:
    entries = []
    with os.scandir(folder) as it:
        for entry in it:
            name = entry.name
            if name.startswith((".", "~$")) or not name.lower().endswith(".pdf"):
                continue
            try:
                if entry.is_file():
                    entries.append(entry)
            except OSError:
                continue
    return sorted(entries, key=lambda e: e.name.lower())


def _read(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _large_key(name: str, st: os.stat_result) -> str:
    """Stands in for the SHA-256 of a file too large to read: the same name, size and modification time."""
    return hashlib.sha256(f"too-large|{name}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()


def _remember_existing(folder: str) -> int:
    count = 0
    for entry in _list_pdfs(folder):
        try:
            st = entry.stat()
            key = _large_key(entry.name, st) if st.st_size > MAX_FILE_BYTES else hashlib.sha256(_read(entry.path)).hexdigest()
        except OSError:
            continue
        if db.record_auto_import_file(key, entry.name, db.AUTO_IMPORT_BASELINE):
            count += 1
        _handled[entry.path] = (st.st_size, st.st_mtime_ns)
    return count


def _import_one(col_id: int, name: str, data: bytes, sha: str) -> dict:
    """Reads one PDF and adds it to the collection. Returns {file, status, booking_no, message, booking_id}."""
    out = {"file": name, "booking_no": "", "message": "", "booking_id": None}
    if detect_file_kind(data, name) != PDF:
        out.update(status=db.AUTO_IMPORT_ERROR, message=MSG_NOT_PDF)
    else:
        booking = extract_booking_from_pdf_bytes(data)
        if not has_booking_fields(booking):
            out.update(status=db.AUTO_IMPORT_NO_DATA, message=MSG_NO_DATA)
        else:
            booking["Tên file PDF"] = name
            resolve_vessel_etd(booking)
            booking_no = str(booking.get("Booking No") or "").strip()
            booking_no = "" if booking_no.lower() == "null" else booking_no
            out["booking_no"] = booking_no
            if booking_no and db.find_duplicate_booking_ids(col_id, booking_no):
                out.update(status=db.AUTO_IMPORT_DUPLICATE, message=MSG_DUPLICATE)
            else:
                out.update(status=db.AUTO_IMPORT_IMPORTED, booking_id=db.insert_booking(col_id, booking))
    db.record_auto_import_file(sha, name, out["status"], col_id, out["booking_id"], out["booking_no"], out["message"])
    return out


def scan_once(now: float | None = None, force: bool = False) -> dict:
    """One pass over the watched folder (blocking: run it in a worker thread). `force` also scans while switched off.
    Returns {status, imported, skipped, waiting, message} and stores it as the last result."""
    if not _scan_lock.acquire(blocking=False):
        return {"status": "busy", "imported": [], "skipped": [], "waiting": 0, "message": ""}
    try:
        settings = get_settings()
        if not settings["enabled"] and not force:
            return {"status": "disabled", "imported": [], "skipped": [], "waiting": 0, "message": ""}
        result = _scan(settings, time.time() if now is None else now)
        db.set_system_setting(KEY_LAST_SCAN_AT, now_vn_str())
        db.set_system_setting(KEY_LAST_RESULT, json.dumps(
            {k: result[k] for k in ("status", "waiting", "message")} |
            {"imported": len(result["imported"]), "skipped": len(result["skipped"])}, ensure_ascii=False))
        return result
    finally:
        _scan_lock.release()


def _scan(settings: dict, now: float) -> dict:
    result = {"status": "ok", "imported": [], "skipped": [], "waiting": 0, "message": ""}
    folder, col_id = settings["folder"], settings["collection_id"]
    if not settings["folder_ok"]:
        return {**result, "status": "error", "message": MSG_FOLDER_MISSING}
    if not settings["collection_ok"]:
        return {**result, "status": "error", "message": MSG_COLLECTION_MISSING}
    try:
        entries = _list_pdfs(folder)
    except PermissionError as e:
        # macOS privacy-protected folders (Desktop, Documents, Downloads) and Windows ACLs: the folder is there
        logger.warning(f"Auto import: no permission to list {folder}: {e}")
        return {**result, "status": "error", "message": MSG_FOLDER_DENIED}
    except OSError as e:
        logger.warning(f"Auto import: cannot list {folder}: {e}")
        return {**result, "status": "error", "message": MSG_FOLDER_MISSING}

    present = set()
    for entry in entries:
        path = entry.path
        present.add(path)
        try:
            st = entry.stat()
        except OSError:
            continue
        sig = (st.st_size, st.st_mtime_ns)
        if _handled.get(path) == sig:
            continue
        settled = _last_seen.get(path) == sig or now - st.st_mtime >= SETTLE_SECONDS
        _last_seen[path] = sig
        if not settled or st.st_size == 0:
            result["waiting"] += 1
            continue
        if st.st_size > MAX_FILE_BYTES:
            # Not read, but remembered like any other file: reported once, not again after each restart
            _handled[path] = sig
            key = _large_key(entry.name, st)
            if db.auto_import_known_hashes([key]):
                continue
            db.record_auto_import_file(key, entry.name, db.AUTO_IMPORT_ERROR, col_id, None, "", MSG_TOO_LARGE)
            result["skipped"].append({"file": entry.name, "status": db.AUTO_IMPORT_ERROR, "booking_no": "",
                                      "message": MSG_TOO_LARGE, "booking_id": None})
            continue
        try:
            data = _read(path)
        except OSError as e:
            logger.warning(f"Auto import: cannot read {entry.name}: {e}")
            result["waiting"] += 1
            continue
        sha = hashlib.sha256(data).hexdigest()
        _handled[path] = sig
        if db.auto_import_known_hashes([sha]):
            continue
        try:
            item = _import_one(col_id, entry.name, data, sha)
        except Exception:
            logger.exception(f"Auto import: failed on {entry.name}")
            item = {"file": entry.name, "status": db.AUTO_IMPORT_ERROR, "booking_no": "", "booking_id": None,
                    "message": "Lỗi khi đọc file"}
            db.record_auto_import_file(sha, entry.name, item["status"], col_id, None, "", item["message"])
        logger.info(f"Auto import: {entry.name} -> {item['status']} {item['booking_no']}".rstrip())
        (result["imported"] if item["status"] == db.AUTO_IMPORT_IMPORTED else result["skipped"]).append(item)

    for gone in [p for p in _last_seen if p not in present]:
        _last_seen.pop(gone, None)
        _handled.pop(gone, None)
    if result["imported"]:
        db.set_system_setting(KEY_IMPORT_SEQ, str(import_seq() + 1))
    if result["imported"] or result["skipped"]:
        db._safely(db.record_auto_import_notification, col_id,
                   [{k: i[k] for k in ("file", "booking_no")} for i in result["imported"]],
                   [{k: i[k] for k in ("file", "booking_no", "status", "message")} for i in result["skipped"]])
    return result
