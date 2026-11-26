"""Disk used by the app's own data, and the safe clean-ups: only what is made again by itself (the Zalo image cache,
the database's free pages) or is an old copy (migration backups beyond the newest few). Messages, booking files and
fleet photos are never removed here."""
import logging
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from backend.app.core import database as db

logger = logging.getLogger("backend.storage")

# The migration backups next to the database (booking_data.db.bak-<tag>-<time>) kept by a clean-up
BACKUPS_KEPT = 3
CLEAN_TARGETS = ("zalo_media_cache", "backups", "database")
# Table name prefixes counted as Zalo / Gmail / Outlook inside the database
_DB_GROUPS = (("zalo", "zalo_"), ("gmail", "gmail_"), ("outlook", "outlook_"))


def zalo_media_cache_dir() -> Path:
    """Where the Zalo image proxy keeps the photos it fetched (see api/zalo.py)."""
    return Path(tempfile.gettempdir()) / "auto_read_pdf_zalo_media"


def _data_dir() -> Path:
    return Path(os.path.dirname(os.path.abspath(db.get_db_path())))


def _dir_size(path: Path) -> tuple[int, int]:
    """(bytes, files) under `path`; (0, 0) when it does not exist."""
    total = count = 0
    if not path.is_dir():
        return 0, 0
    for root, _, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
                count += 1
            except OSError:
                pass
    return total, count


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _backups() -> list[Path]:
    """The migration backups of the database, newest first."""
    db_path = Path(db.get_db_path())
    found = [p for p in db_path.parent.glob(f"{db_path.name}.bak-*") if p.is_file()]
    return sorted(found, key=lambda p: p.stat().st_mtime, reverse=True)


def _database() -> dict:
    db_path = Path(db.get_db_path())
    size = sum(_file_size(Path(f"{db_path}{suffix}")) for suffix in ("", "-wal", "-shm"))
    free = 0
    groups = {name: 0 for name, _ in _DB_GROUPS}
    with db.get_connection() as conn:
        page_size = conn.execute("PRAGMA page_size;").fetchone()[0]
        free = conn.execute("PRAGMA freelist_count;").fetchone()[0] * page_size
        try:
            # dbstat is not built into every SQLite; without it there is just no breakdown
            for name, used in conn.execute("SELECT name, SUM(pgsize) FROM dbstat GROUP BY name;"):
                # an index belongs to its table: ix_zalo_..., sqlite_autoindex_zalo_messages_1
                key = name.removeprefix("sqlite_autoindex_").removeprefix("ix_").removeprefix("idx_")
                for group, prefix in _DB_GROUPS:
                    if key.startswith(prefix):
                        groups[group] += used or 0
                        break
        except sqlite3.Error:
            groups = {}
    return {"bytes": size, "free_bytes": free, "groups": groups}


def usage() -> dict:
    """{"data_dir", "disk": {total, used, free}, "total_bytes", "items": [...]}. Each item: id, bytes, files (folders),
    cleanable (bytes a clean-up frees)."""
    data_dir = _data_dir()
    disk = shutil.disk_usage(data_dir)
    database = _database()
    zalo_files, zalo_count = _dir_size(data_dir / "zalo-files")
    media, media_count = _dir_size(zalo_media_cache_dir())
    photos, photos_count = _dir_size(data_dir / "fleet_photos")
    backups = _backups()
    backups_size = sum(_file_size(p) for p in backups)
    old_backups = sum(_file_size(p) for p in backups[BACKUPS_KEPT:])
    items = [
        {"id": "database", "bytes": database["bytes"], "files": None, "cleanable": database["free_bytes"],
         "groups": database["groups"]},
        {"id": "zalo_files", "bytes": zalo_files, "files": zalo_count, "cleanable": 0},
        {"id": "zalo_media_cache", "bytes": media, "files": media_count, "cleanable": media},
        {"id": "fleet_photos", "bytes": photos, "files": photos_count, "cleanable": 0},
        {"id": "backups", "bytes": backups_size, "files": len(backups), "cleanable": old_backups},
    ]
    return {
        "data_dir": str(data_dir),
        "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
        "total_bytes": sum(i["bytes"] for i in items),
        "backups_kept": BACKUPS_KEPT,
        "items": items,
    }


def clean(target: str) -> dict:
    """Run one safe clean-up: {"target", "freed_bytes"}. ValueError for an unknown target."""
    if target not in CLEAN_TARGETS:
        raise ValueError(f"Không có mục dọn dẹp '{target}'")
    freed = 0
    if target == "zalo_media_cache":
        path = zalo_media_cache_dir()
        for item in path.iterdir() if path.is_dir() else ():
            if item.is_file():
                size = _file_size(item)
                try:
                    item.unlink()
                    freed += size
                except OSError as e:
                    logger.warning(f"Could not delete cached Zalo image {item.name}: {e}")
    elif target == "backups":
        for item in _backups()[BACKUPS_KEPT:]:
            size = _file_size(item)
            try:
                item.unlink()
                freed += size
            except OSError as e:
                logger.warning(f"Could not delete backup {item.name}: {e}")
    else:
        before = _database()["bytes"]
        # VACUUM cannot run inside a transaction: autocommit connection, then fold the WAL back into the file
        with db.get_connection() as conn:
            conn.isolation_level = None
            conn.execute("VACUUM;")
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        freed = max(0, before - _database()["bytes"])
    logger.info(f"Storage clean-up '{target}' freed {freed} bytes")
    return {"target": target, "freed_bytes": freed}
