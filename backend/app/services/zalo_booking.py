"""Booking files sent in watched Zalo chats: downloaded at once, read, and put in a review queue.

Rules (see docs/superpowers/plans/2026-11-25-zalo-booking-watch.md):
- a chat is watched by the user's choice; files sent by anyone in it are read, the user's own included;
- Zalo file links expire after a few weeks, so a file is downloaded as soon as it arrives and kept on disk;
- a PDF is read from its text layer (no AI); a scanned PDF or a photo follows the image mode the user picked:
  ``manual`` (default: wait for a click, nothing goes to Gemini from the background), ``caption`` (read it when the
  message text mentions a booking) or ``auto`` (read every photo);
- nothing is saved: every booking read waits in the review queue for the user to check and save it;
- each file content (SHA-256) is read once, whoever sends it again and wherever.
"""
import hashlib
import json
import logging
import os
import queue
import re
import threading
import time
from typing import Any, Optional
from urllib.parse import urlparse

import requests

from backend.app.core import database as db
from datetime import datetime, timedelta

from backend.app.core.timezone import VN_TZ, now_vn_str
from backend.app.services.extractor import extract_booking_from_pdf_bytes, has_booking_fields, resolve_vessel_etd
from backend.app.services.file_kind import IMAGE, PDF, detect_file_kind

logger = logging.getLogger("backend.services.zalo_booking")

KEY_COLLECTION = "zalo_booking_collection_id"
KEY_IMAGE_MODE = "zalo_booking_image_mode"
IMAGE_MODES = ("manual", "caption", "auto")
DEFAULT_IMAGE_MODE = "manual"

MAX_FILE_BYTES = 30 * 1024 * 1024
# Gap between two Gemini reads, so a chat that drops 20 photos at once does not burn the quota in a burst
GEMINI_GAP_SECONDS = 3.0
ALLOWED_MEDIA_SUFFIXES = (".zdn.vn", ".zadn.vn", ".dlfl.vn", ".zaloapp.com", ".zalo.me")
# Message text that marks a photo as a booking in "caption" mode
CAPTION_RE = re.compile(r"\b(booking|bkg|bk|book)\b|\b[A-Z]{2,5}\d{6,}\b|\b\d{9,12}\b", re.IGNORECASE)

# Statuses
DOWNLOADING = "downloading"
SCANNING = "scanning"
MANUAL = "manual"  # a photo / scanned PDF waiting for the user to click "Quét booking"
PENDING_REVIEW = "pending_review"
SAVED = "saved"
DUPLICATE = "duplicate"
NO_DATA = "no_data"
NOT_BOOKING = "not_booking"
EXPIRED = "expired"
ERROR = "error"
DISMISSED = "dismissed"
STATUSES = (DOWNLOADING, SCANNING, MANUAL, PENDING_REVIEW, SAVED, DUPLICATE, NO_DATA, NOT_BOOKING, EXPIRED, ERROR,
            DISMISSED)
# A file in one of these can be read again by a click
RESCANNABLE = (MANUAL, NO_DATA, ERROR, EXPIRED, NOT_BOOKING)

MSG_EXPIRED = "Link Zalo đã hết hạn, nhờ người gửi gửi lại tệp"
MSG_TOO_LARGE = "Tệp lớn hơn 30 MB, bỏ qua"
MSG_NOT_BOOKING = "Không phải booking"
MSG_NO_DATA = "Không đọc được booking, cần nhập tay"
MSG_MANUAL = "Bấm \"Quét booking\" để đọc ảnh"
MSG_DB_DUPLICATE = "Booking No đã có trong bộ sưu tập"

_queue: "queue.Queue[tuple[int, bool]]" = queue.Queue()
_worker: Optional[threading.Thread] = None
_worker_lock = threading.Lock()
_last_gemini_at = 0.0
# Bumped on every status change: the Zalo tab polls it to know when to redraw
_version = 0
_version_lock = threading.Lock()


def _bump() -> None:
    global _version
    with _version_lock:
        _version += 1


def version() -> int:
    return _version


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def _collection_id() -> Optional[int]:
    raw = db.get_system_setting(KEY_COLLECTION, "")
    if not raw:
        # Same place as the folder auto-import when the user has not picked one for Zalo
        raw = db.get_system_setting("auto_import_collection_id", "")
    try:
        col_id = int(raw)
    except (TypeError, ValueError):
        return None
    return col_id if db.collection_exists(col_id) else None


def get_settings() -> dict:
    mode = db.get_system_setting(KEY_IMAGE_MODE, DEFAULT_IMAGE_MODE)
    return {
        "collection_id": _collection_id(),
        "image_mode": mode if mode in IMAGE_MODES else DEFAULT_IMAGE_MODE,
    }


def save_settings(collection_id: Optional[int], image_mode: str) -> dict:
    if image_mode not in IMAGE_MODES:
        raise ValueError("Chế độ quét ảnh không hợp lệ")
    if collection_id is not None and not db.collection_exists(collection_id):
        raise ValueError("Bộ sưu tập không tồn tại")
    db.set_system_setting(KEY_COLLECTION, str(int(collection_id)) if collection_id else "")
    db.set_system_setting(KEY_IMAGE_MODE, image_mode)
    return get_settings()


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
def files_dir() -> str:
    path = os.path.join(os.path.dirname(os.path.abspath(db.get_db_path())), "zalo-files")
    os.makedirs(path, exist_ok=True)
    return path


def _rows(conn, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _public(row: Optional[dict]) -> Optional[dict]:
    """A scan row for the UI: data parsed, local path left out."""
    if not row:
        return None
    out = {k: v for k, v in row.items() if k not in ("local_path", "data_json")}
    try:
        out["data"] = json.loads(row.get("data_json") or "{}") or {}
    except ValueError:
        out["data"] = {}
    out["has_file"] = bool(row.get("local_path")) and os.path.exists(row.get("local_path") or "")
    return out


def get_scan(message_id: int) -> Optional[dict]:
    with db.get_connection() as conn:
        rows = _rows(conn, "SELECT * FROM zalo_booking_scans WHERE message_id = ?;", (message_id,))
    return rows[0] if rows else None


def _update(message_id: int, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = now_vn_str()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with db.get_connection() as conn:
        conn.execute(f"UPDATE zalo_booking_scans SET {cols} WHERE message_id = ?;", (*fields.values(), message_id))
    _bump()


def scans_for_messages(message_ids: list[int]) -> dict[int, dict]:
    if not message_ids:
        return {}
    marks = ",".join("?" * len(message_ids))
    with db.get_connection() as conn:
        rows = _rows(conn, f"SELECT * FROM zalo_booking_scans WHERE message_id IN ({marks});", tuple(message_ids))
    return {r["message_id"]: _public(r) for r in rows}


# ---------------------------------------------------------------------------
# Which messages are booking candidates
# ---------------------------------------------------------------------------
_DOC_NAME = re.compile(r"\.pdf$", re.IGNORECASE)


def is_candidate(msg: dict) -> bool:
    """A PDF file or a photo with a link. Other files (Word, Excel, voice...) cannot be read as a booking."""
    if not msg.get("media_url"):
        return False
    if msg.get("msg_type") == "image":
        return True
    return msg.get("msg_type") == "file" and bool(_DOC_NAME.search(str(msg.get("content") or "")))


def _uid(conn) -> str:
    """The Zalo account logged in now: reads and the review queue show only its chats ('' = nobody, nothing)."""
    row = conn.execute("SELECT uid FROM zalo_sessions WHERE id = 1;").fetchone()
    return str(row[0]) if row and row[0] else ""


def _file_name(msg: dict) -> str:
    if msg.get("msg_type") == "file":
        return str(msg.get("content") or "booking.pdf")
    return f"zalo_{msg.get('msg_id') or msg.get('id')}.jpg"


def set_watch(thread_id: str, watch: bool) -> Optional[dict]:
    with db.get_connection() as conn:
        cur = conn.execute(
            "UPDATE zalo_conversations SET watch_booking = ? WHERE account_uid = ? AND thread_id = ?;",
            (1 if watch else 0, _uid(conn), thread_id),
        )
        if cur.rowcount == 0:
            return None
    _bump()
    return {"thread_id": thread_id, "watch_booking": 1 if watch else 0}


def history_counts(thread_id: str) -> dict:
    """How many not yet read files a history scan would take, for the 'scan older files?' question."""
    with db.get_connection() as conn:
        rows = _rows(
            conn,
            """
            SELECT m.id, m.msg_type, m.content, m.media_url, m.created_at
            FROM zalo_messages m
            LEFT JOIN zalo_booking_scans s ON s.message_id = m.id
            WHERE m.account_uid = ? AND m.thread_id = ? AND s.message_id IS NULL AND m.media_url != '';
            """,
            (_uid(conn), thread_id),
        )
    rows = [r for r in rows if is_candidate(r)]

    def within(r: dict, days: int) -> bool:
        return str(r.get("created_at") or "") >= _since(days)

    def count(sub: list[dict]) -> dict:
        return {"pdf": sum(1 for r in sub if r["msg_type"] == "file"), "image": sum(1 for r in sub if r["msg_type"] == "image")}

    return {
        "7": count([r for r in rows if within(r, 7)]),
        "30": count([r for r in rows if within(r, 30)]),
        "all": count(rows),
    }


def _since(days: Optional[int]) -> str:
    """Message times are Vietnam wall-clock strings, so compare against one."""
    if not days:
        return ""
    return (datetime.now(VN_TZ) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def scan_history(thread_id: str, days: Optional[int]) -> int:
    """Queues the files of a chat sent in the last `days` (all when None) that were never read."""
    since = _since(days)
    with db.get_connection() as conn:
        rows = _rows(
            conn,
            """
            SELECT m.* FROM zalo_messages m
            LEFT JOIN zalo_booking_scans s ON s.message_id = m.id
            WHERE m.account_uid = ? AND m.thread_id = ? AND s.message_id IS NULL AND m.media_url != ''
              AND m.created_at >= ?
            ORDER BY m.created_at ASC, m.id ASC;
            """,
            (_uid(conn), thread_id, since),
        )
    queued = 0
    for msg in rows:
        if is_candidate(msg):
            enqueue_message(msg, force=False)
            queued += 1
    return queued


# ---------------------------------------------------------------------------
# Entry points from the message flow
# ---------------------------------------------------------------------------
def on_message(msg: Optional[dict], conversation: Optional[dict]) -> None:
    """Called after a live message (incoming or the user's own) is stored, or when its link arrives later."""
    try:
        if not msg or not conversation or not conversation.get("watch_booking"):
            return
        if not is_candidate(msg):
            return
        if get_scan(int(msg["id"])):
            return
        enqueue_message(msg, force=False)
    except Exception:  # never break message recording
        logger.exception("Could not queue a Zalo booking scan")


def enqueue_message(msg: dict, force: bool) -> dict:
    """Creates (or resets) the scan row of a message and hands it to the worker. `force` = the user clicked."""
    message_id = int(msg["id"])
    now = now_vn_str()
    with db.get_connection() as conn:
        conn.execute(
            """
            INSERT INTO zalo_booking_scans
                (message_id, account_uid, thread_id, file_name, kind, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(message_id) DO UPDATE SET status = excluded.status, message = '', updated_at = excluded.updated_at;
            """,
            (message_id, msg.get("account_uid") or "", msg["thread_id"], _file_name(msg), "pdf" if msg.get("msg_type") == "file" else "image",
             DOWNLOADING, now, now),
        )
    _bump()
    _queue.put((message_id, force))
    _ensure_worker()
    return _public(get_scan(message_id))


def attach_local_copy(msg_id: str, file_name: str, data: bytes) -> Optional[dict]:
    """A file sent from this app: its bytes are known right away, while Zalo's link for it comes later (or, now and
    then, never). In a watched chat it is read from this copy instead of waiting for the link."""
    if not data or len(data) > MAX_FILE_BYTES:
        return None
    with db.get_connection() as conn:
        rows = _rows(
            conn,
            """
            SELECT m.*, c.watch_booking FROM zalo_messages m
            LEFT JOIN zalo_conversations c ON c.account_uid = m.account_uid AND c.thread_id = m.thread_id
            WHERE m.account_uid = ? AND m.msg_id = ?;
            """,
            (_uid(conn), msg_id),
        )
    if not rows or not rows[0].get("watch_booking"):
        return None
    msg = rows[0]
    if get_scan(int(msg["id"])):
        return None  # already queued from Zalo's link
    kind = detect_file_kind(data, file_name)
    if kind not in (PDF, IMAGE):
        return None
    sha = hashlib.sha256(data).hexdigest()
    local = os.path.join(files_dir(), f"{sha}.{'pdf' if kind == PDF else 'jpg'}")
    if not os.path.exists(local):
        with open(local, "wb") as f:
            f.write(data)
    now = now_vn_str()
    with db.get_connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO zalo_booking_scans
                (message_id, account_uid, thread_id, file_name, kind, sha256, local_path, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (int(msg["id"]), msg.get("account_uid") or "", msg["thread_id"], file_name, "pdf" if kind == PDF else "image", sha, local, DOWNLOADING, now, now),
        )
    _bump()
    _queue.put((int(msg["id"]), False))
    _ensure_worker()
    return _public(get_scan(int(msg["id"])))


def scan_now(message_id: int) -> dict:
    """The user's "Quét booking" click on any PDF / photo message, watched chat or not."""
    with db.get_connection() as conn:
        rows = _rows(conn, "SELECT * FROM zalo_messages WHERE id = ?;", (message_id,))
    if not rows:
        raise LookupError("Không tìm thấy tin nhắn")
    msg = rows[0]
    existing = get_scan(message_id)
    if not is_candidate(msg) and not (existing and existing.get("local_path")):
        raise ValueError("Chỉ quét được tệp PDF hoặc ảnh")
    if existing and existing["status"] not in RESCANNABLE:
        return _public(existing)
    return enqueue_message(msg, force=True)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------
def _ensure_worker() -> None:
    global _worker
    with _worker_lock:
        if _worker and _worker.is_alive():
            return
        _worker = threading.Thread(target=_run, name="zalo-booking-scan", daemon=True)
        _worker.start()


def _run() -> None:
    while True:
        message_id, force = _queue.get()
        try:
            process(message_id, force)
        except Exception as e:
            logger.exception(f"Zalo booking scan failed for message {message_id}")
            _update(message_id, status=ERROR, message=str(e)[:300])
        finally:
            _queue.task_done()


def _allowed(url: str) -> bool:
    parsed = urlparse(url or "")
    host = (parsed.hostname or "").lower()
    return parsed.scheme in ("http", "https") and any(host == s.lstrip(".") or host.endswith(s) for s in ALLOWED_MEDIA_SUFFIXES)


def _download(url: str) -> tuple[Optional[bytes], str, str]:
    """(bytes, status, message): status is '' when downloaded."""
    if not _allowed(url):
        return None, ERROR, "Link tệp không thuộc Zalo"
    try:
        resp = requests.get(url, timeout=30, stream=True, headers={"User-Agent": "Mozilla/5.0"})
    except requests.RequestException as e:
        return None, ERROR, f"Không tải được tệp: {e}"[:300]
    if resp.status_code in (403, 404, 410):
        return None, EXPIRED, MSG_EXPIRED
    if resp.status_code >= 400:
        return None, ERROR, f"Zalo trả lỗi {resp.status_code} khi tải tệp"
    chunks, size = [], 0
    for chunk in resp.iter_content(64 * 1024):
        size += len(chunk)
        if size > MAX_FILE_BYTES:
            return None, ERROR, MSG_TOO_LARGE
        chunks.append(chunk)
    return b"".join(chunks), "", ""


def _pdf_has_text(data: bytes) -> bool:
    try:
        import io

        import pdfplumber

        with pdfplumber.open(io.BytesIO(data)) as pdf:
            text = "".join((p.extract_text() or "") for p in pdf.pages[:2])
        return len(text.strip()) >= 30
    except Exception:
        return False


def _read_with_gemini(data: bytes, name: str, kind: str) -> dict:
    """The same reading as a photo dropped on the Booking tab (Gemini, OCR fallback)."""
    global _last_gemini_at
    wait = GEMINI_GAP_SECONDS - (time.time() - _last_gemini_at)
    if wait > 0:
        time.sleep(wait)
    from backend.app.api.bookings import _extract_preview  # heavy import, only when a photo is read

    try:
        return _extract_preview(data, name, kind, None)
    finally:
        _last_gemini_at = time.time()


def _wants_image_read(msg: dict, force: bool) -> bool:
    if force:
        return True
    mode = get_settings()["image_mode"]
    if mode == "auto":
        return True
    if mode == "caption":
        return bool(CAPTION_RE.search(str(msg.get("content") or "")))
    return False


def _finish_with_booking(message_id: int, data: dict, engine: str, warnings: list[str]) -> None:
    booking_no = str(data.get("Booking No") or "").strip()
    booking_no = "" if booking_no.lower() == "null" else booking_no
    col_id = _collection_id()
    dup = bool(booking_no and col_id and db.find_duplicate_booking_ids(col_id, booking_no))
    data["__warnings"] = warnings
    _update(
        message_id,
        status=PENDING_REVIEW,
        data_json=json.dumps(data, ensure_ascii=False, default=str),
        engine_used=engine,
        booking_no=booking_no,
        db_duplicate=1 if dup else 0,
        message=MSG_DB_DUPLICATE if dup else "",
    )
    _notify(message_id, booking_no)


def process(message_id: int, force: bool = False) -> None:
    with db.get_connection() as conn:
        rows = _rows(conn, "SELECT * FROM zalo_messages WHERE id = ?;", (message_id,))
    if not rows:
        return
    msg = rows[0]
    scan = get_scan(message_id) or {}
    name = scan.get("file_name") or _file_name(msg)

    # 1. The bytes: the copy on disk when there is one, else download now (links expire)
    data: Optional[bytes] = None
    local = scan.get("local_path") or ""
    if local and os.path.exists(local):
        with open(local, "rb") as f:
            data = f.read()
    else:
        data, status, message = _download(msg.get("media_url") or "")
        if data is None:
            _update(message_id, status=status, message=message)
            return
    sha = hashlib.sha256(data).hexdigest()
    kind = detect_file_kind(data, name)
    ext = "pdf" if kind == PDF else "jpg"
    if not local:
        local = os.path.join(files_dir(), f"{sha}.{ext}")
        if not os.path.exists(local):
            with open(local, "wb") as f:
                f.write(data)
    _update(message_id, sha256=sha, local_path=local, kind="pdf" if kind == PDF else "image", status=SCANNING)

    # 2. Read once per content: a file sent again (or forwarded) points to the first reading
    if not force:
        with db.get_connection() as conn:
            earlier = _rows(
                conn,
                """
                SELECT message_id, status, booking_no FROM zalo_booking_scans
                WHERE sha256 = ? AND message_id != ? AND status IN (?, ?, ?, ?)
                ORDER BY created_at LIMIT 1;
                """,
                (sha, message_id, PENDING_REVIEW, SAVED, DISMISSED, NO_DATA),
            )
            folder = conn.execute(
                "SELECT booking_no FROM auto_import_files WHERE sha256 = ?;", (sha,)
            ).fetchone()
        if earlier:
            e = earlier[0]
            _update(message_id, status=DUPLICATE, booking_no=e.get("booking_no") or "",
                    message="Tệp này đã được quét ở tin khác")
            return
        if folder:
            _update(message_id, status=DUPLICATE, booking_no=folder[0] or "",
                    message="Tệp này đã được nhập từ thư mục theo dõi")
            return

    if kind is None:
        _update(message_id, status=NOT_BOOKING, message=MSG_NOT_BOOKING)
        return

    # 3. A PDF with a text layer: read without AI
    if kind == PDF and _pdf_has_text(data):
        booking = extract_booking_from_pdf_bytes(data)
        if not has_booking_fields(booking):
            _update(message_id, status=NOT_BOOKING, message=MSG_NOT_BOOKING)
            return
        booking["Tên file PDF"] = name
        resolve_vessel_etd(booking)
        _finish_with_booking(message_id, booking, "pdf", [])
        return

    # 4. A photo or a scanned PDF: Gemini only when the user's mode allows it, or on a click
    if not _wants_image_read(msg, force):
        _update(message_id, status=MANUAL, message=MSG_MANUAL)
        return
    result = _read_with_gemini(data, name, kind if kind in (PDF, IMAGE) else IMAGE)
    booking = result.get("data") or {}
    if not has_booking_fields(booking):
        warn = "; ".join(result.get("warnings") or [])
        _update(message_id, status=NO_DATA, engine_used=result.get("engine_used") or "",
                message=(MSG_NO_DATA + (f" ({warn})" if warn else ""))[:300])
        return
    booking["Tên file PDF"] = name
    _finish_with_booking(message_id, booking, result.get("engine_used") or "", list(result.get("warnings") or []))


# ---------------------------------------------------------------------------
# Review queue
# ---------------------------------------------------------------------------
def list_queue(status: str = PENDING_REVIEW) -> list[dict]:
    with db.get_connection() as conn:
        rows = _rows(
            conn,
            """
            SELECT s.*, m.created_at AS sent_at, m.sender_name, m.direction,
                   c.display_name AS conversation_name, c.thread_type
            FROM zalo_booking_scans s
            JOIN zalo_messages m ON m.id = s.message_id
            LEFT JOIN zalo_conversations c ON c.account_uid = m.account_uid AND c.thread_id = m.thread_id
            WHERE s.status = ? AND m.account_uid = ?
            ORDER BY m.created_at DESC, s.message_id DESC;
            """,
            (status, _uid(conn)),
        )
    return [_public(r) for r in rows]


def summary() -> dict:
    with db.get_connection() as conn:
        counts = dict(conn.execute(
            "SELECT status, COUNT(*) FROM zalo_booking_scans WHERE account_uid = ? GROUP BY status;", (_uid(conn),)
        ).fetchall())
    return {
        "pending_review": int(counts.get(PENDING_REVIEW, 0)),
        "in_progress": int(counts.get(DOWNLOADING, 0)) + int(counts.get(SCANNING, 0)),
        "version": version(),
    }


def mark_saved(message_id: int, booking_id: int, collection_id: Optional[int]) -> Optional[dict]:
    if not get_scan(message_id):
        return None
    _update(message_id, status=SAVED, booking_id=booking_id, collection_id=collection_id, message="")
    return _public(get_scan(message_id))


def dismiss(message_id: int) -> Optional[dict]:
    if not get_scan(message_id):
        return None
    _update(message_id, status=DISMISSED, message="Đã bỏ qua")
    return _public(get_scan(message_id))


def file_path(message_id: int) -> Optional[str]:
    scan = get_scan(message_id)
    path = (scan or {}).get("local_path") or ""
    return path if path and os.path.exists(path) else None


def _notify(message_id: int, booking_no: str) -> None:
    """One bell entry per booking waiting for review (the folder import's notification kind and switch)."""
    try:
        from backend.app.services import change_detection as cd

        if cd.BOOKING_AUTO_IMPORT not in db.get_notification_settings()["kinds"]:
            return
        with db.get_connection() as conn:
            row = conn.execute(
                """
                SELECT c.display_name, s.file_name FROM zalo_booking_scans s
                LEFT JOIN zalo_conversations c ON c.account_uid = s.account_uid AND c.thread_id = s.thread_id
                WHERE s.message_id = ?;
                """,
                (message_id,),
            ).fetchone()
            chat, file_name = (row or ("Zalo", ""))
            stamp = now_vn_str()
            db._insert_notification(conn, _collection_id(), {
                "kind": cd.BOOKING_AUTO_IMPORT,
                "entity_key": f"zalo_booking|{message_id}",
                "title": f"Zalo · {chat}: booking chờ duyệt",
                "old": "",
                "new": f"{booking_no or '—'} · {file_name}",
                "nav_tab": "zalo",
                "nav_query": None,
                "detail": {"zalo_message_id": message_id, "booking_no": booking_no},
            }, db.NOTIFY_SOURCE_AUTO, stamp)
    except Exception:
        logger.exception("Could not add the Zalo booking notification")
