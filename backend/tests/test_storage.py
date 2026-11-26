"""Storage: what the app's data takes on disk, and the safe clean-ups."""
import os
import time

import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
from backend.app.services import storage

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh(fresh_db, tmp_path, monkeypatch):
    cache = tmp_path / "zalo_media"
    monkeypatch.setattr(storage, "zalo_media_cache_dir", lambda: cache)
    yield


def _item(data, item_id):
    return next(i for i in data["items"] if i["id"] == item_id)


def _write(path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def test_usage_counts_each_kind_of_data():
    data_dir = os.path.dirname(db.get_db_path())
    from pathlib import Path
    _write(Path(data_dir) / "zalo-files" / "a.jpg", 1000)
    _write(Path(data_dir) / "fleet_photos" / "v.jpg", 500)
    _write(storage.zalo_media_cache_dir() / "k.jpg", 300)
    with db.get_connection() as conn:
        conn.execute("INSERT INTO zalo_sessions (id, uid, status, updated_at) VALUES (1, 'u', 'connected', '') "
                     "ON CONFLICT(id) DO NOTHING;")

    data = client.get("/api/v1/system/storage").json()
    assert data["disk"]["total"] > 0 and data["disk"]["free"] > 0
    assert (_item(data, "zalo_files")["bytes"], _item(data, "zalo_files")["files"]) == (1000, 1)
    assert _item(data, "fleet_photos")["bytes"] == 500 and _item(data, "fleet_photos")["cleanable"] == 0
    assert _item(data, "zalo_media_cache")["cleanable"] == 300
    database = _item(data, "database")
    assert database["bytes"] > 0 and set(database["groups"]) == {"zalo", "gmail", "outlook"}
    assert database["groups"]["zalo"] > 0
    assert data["total_bytes"] == sum(i["bytes"] for i in data["items"])


def test_clean_zalo_image_cache():
    _write(storage.zalo_media_cache_dir() / "a.jpg", 200)
    _write(storage.zalo_media_cache_dir() / "b.jxl", 100)
    res = client.post("/api/v1/system/storage/clean/zalo_media_cache").json()
    assert res == {"target": "zalo_media_cache", "freed_bytes": 300}
    assert list(storage.zalo_media_cache_dir().iterdir()) == []


def test_clean_backups_keeps_the_newest_and_leaves_other_files():
    from pathlib import Path
    db_path = Path(db.get_db_path())
    now = time.time()
    for i in range(5):  # bak-0 is the newest
        p = Path(f"{db_path}.bak-t{i}")
        _write(p, 100)
        os.utime(p, (now - i * 60, now - i * 60))
    other = db_path.parent / "my-own-copy.db"
    _write(other, 100)

    assert _item(client.get("/api/v1/system/storage").json(), "backups")["cleanable"] == 200
    res = client.post("/api/v1/system/storage/clean/backups").json()
    assert res["freed_bytes"] == 200
    assert sorted(p.name.split(".bak-")[1] for p in db_path.parent.glob(f"{db_path.name}.bak-*")) == ["t0", "t1", "t2"]
    assert other.exists()


def test_vacuum_gives_back_the_free_pages():
    with db.get_connection() as conn:
        conn.execute("CREATE TABLE junk (v BLOB);")
        conn.executemany("INSERT INTO junk VALUES (?);", [(b"x" * 4000,) for _ in range(300)])
    with db.get_connection() as conn:
        conn.execute("DROP TABLE junk;")
    before = _item(client.get("/api/v1/system/storage").json(), "database")
    assert before["cleanable"] > 1_000_000
    res = client.post("/api/v1/system/storage/clean/database").json()
    assert res["freed_bytes"] > 1_000_000
    assert _item(client.get("/api/v1/system/storage").json(), "database")["cleanable"] == 0


def test_unknown_target_is_refused():
    assert client.post("/api/v1/system/storage/clean/zalo_messages").status_code == 400
