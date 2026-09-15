import asyncio
from datetime import datetime
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app.core.database import init_db, get_system_setting, set_system_setting
from backend.app.services import background_tasks as bt
from backend.app.main import app

VN = bt.VN_TZ
client = TestClient(app)


def _reset_state():
    bt._state.update({"loaded": False, "enabled": False, "mode": "interval",
                      "interval_minutes": 10, "times": [], "last_run_at": None, "last_run_result": None})


@pytest.fixture(autouse=True)
def clean_scheduler_state():
    init_db()
    for k, v in [("auto_sync_enabled", "0"), ("auto_sync_mode", "interval"),
                 ("auto_sync_interval", "10"), ("auto_sync_times", "[]"),
                 ("auto_sync_last_run_at", "")]:
        set_system_setting(k, v)
    _reset_state()
    yield
    # Never leave auto-sync enabled in the shared test DB
    set_system_setting("auto_sync_enabled", "0")
    _reset_state()
    try:
        for job_id in (bt.AUTO_SYNC_JOB_ID, bt.AUTO_SYNC_KICK_JOB_ID):
            if bt.scheduler.get_job(job_id):
                bt.scheduler.remove_job(job_id)
    except Exception:
        pass


def test_normalize_times_validation():
    assert bt.normalize_times(["14:00", "8:30", "08:30"]) == ["08:30", "14:00"]
    for bad in (["24:00"], ["8"], ["12:60"], ["ab:cd"], "08:00"):
        with pytest.raises(ValueError):
            bt.normalize_times(bad)


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_settings_persistence_round_trip(mock_sync):
    async def scenario():
        status = await bt.toggle_auto_sync(True, mode="times", times=["14:00", "8:00"])
        job = bt.scheduler.get_job(bt.AUTO_SYNC_JOB_ID)
        assert job is not None
        assert job.misfire_grace_time == 3600 and job.coalesce is True and job.max_instances == 1
        return status

    status = asyncio.run(scenario())
    assert status["enabled"] is True
    assert status["mode"] == "times"
    assert status["times"] == ["08:00", "14:00"]

    assert get_system_setting("auto_sync_enabled") == "1"
    assert get_system_setting("auto_sync_mode") == "times"

    # Simulate app restart: memory lost, settings reloaded from DB
    _reset_state()
    loaded = bt.load_settings()
    assert loaded["enabled"] is True
    assert loaded["mode"] == "times"
    assert loaded["times"] == ["08:00", "14:00"]
    assert loaded["interval_minutes"] == 10


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_restore_on_startup_registers_job_with_delayed_first_run(mock_sync):
    set_system_setting("auto_sync_enabled", "1")
    set_system_setting("auto_sync_mode", "interval")
    set_system_setting("auto_sync_interval", "25")

    async def scenario():
        before = datetime.now(VN)
        await bt.restore_auto_sync()
        job = bt.scheduler.get_job(bt.AUTO_SYNC_JOB_ID)
        kick = bt.scheduler.get_job(bt.AUTO_SYNC_KICK_JOB_ID)
        assert job is not None and kick is not None
        delay = (kick.next_run_time - before).total_seconds()
        assert 20 <= delay <= 40
        return bt.get_auto_sync_status()

    status = asyncio.run(scenario())
    assert status["enabled"] is True
    assert status["interval_minutes"] == 25
    assert status["next_run_at"] is not None
    mock_sync.assert_not_called()


def test_times_trigger_next_run_computation():
    trigger = bt.build_trigger("times", 10, ["08:30", "14:00"])

    def nxt(y, mo, d, h, mi):
        return trigger.get_next_fire_time(None, datetime(y, mo, d, h, mi, tzinfo=VN))

    assert nxt(2026, 9, 15, 7, 0) == datetime(2026, 9, 15, 8, 30, tzinfo=VN)
    # No hour x minute cross product (08:00 / 14:30 must never fire)
    assert nxt(2026, 9, 15, 8, 31) == datetime(2026, 9, 15, 14, 0, tzinfo=VN)
    assert nxt(2026, 9, 15, 14, 1) == datetime(2026, 9, 16, 8, 30, tzinfo=VN)

    with pytest.raises(ValueError):
        bt.build_trigger("times", 10, [])


def test_lock_prevents_overlapping_runs():
    started = []

    async def slow_vessels():
        started.append(1)
        await asyncio.sleep(0.2)
        return {"vessels_ok": 2, "vessels_not_found": 1, "containers_ok": 0, "errors": 0}

    async def containers():
        return {"vessels_ok": 0, "vessels_not_found": 0, "containers_ok": 3, "errors": 0}

    async def scenario():
        with patch.object(bt, "sync_vessel_watchlists", slow_vessels), \
             patch.object(bt, "sync_container_watchlists", containers):
            first = asyncio.create_task(bt.run_sync_all())
            await asyncio.sleep(0.05)
            assert bt.get_auto_sync_status()["running"] is True
            second = await bt.run_sync_all()
            return await first, second

    first, second = asyncio.run(scenario())
    assert first == "completed"
    assert second == "already_running"
    assert len(started) == 1
    status = bt.get_auto_sync_status()
    assert status["running"] is False
    assert status["last_run_at"] is not None
    assert status["last_run_result"] == {"vessels_ok": 2, "vessels_not_found": 1, "containers_ok": 3, "errors": 0}


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_toggle_endpoint_backward_compatible(mock_sync):
    res = client.post("/api/v1/scheduler/toggle", json={"enable": True, "interval_minutes": 15})
    assert res.status_code == 200
    body = res.json()
    for key in ("enabled", "mode", "interval_minutes", "times", "running",
                "last_run_at", "last_run_result", "next_run_at"):
        assert key in body
    assert body["enabled"] is True
    assert body["mode"] == "interval"
    assert body["interval_minutes"] == 15

    # New fields
    res = client.post("/api/v1/scheduler/toggle", json={"enable": True, "mode": "times", "times": ["09:00"]})
    assert res.status_code == 200
    assert res.json()["times"] == ["09:00"]
    assert res.json()["interval_minutes"] == 15  # unchanged when omitted

    res = client.post("/api/v1/scheduler/toggle", json={"enable": True, "mode": "times", "times": ["25:00"]})
    assert res.status_code == 400

    res = client.post("/api/v1/scheduler/toggle", json={"enable": False})
    assert res.status_code == 200
    assert res.json()["enabled"] is False
    assert res.json()["next_run_at"] is None
    assert client.get("/api/v1/scheduler/status").json()["enabled"] is False


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_schedule_edit_while_enabled_does_not_kick_sync(mock_sync):
    async def scenario():
        await bt.toggle_auto_sync(True, interval_minutes=15)
        assert bt.scheduler.get_job(bt.AUTO_SYNC_KICK_JOB_ID) is not None  # OFF -> ON kicks
        bt._remove_job(bt.AUTO_SYNC_KICK_JOB_ID)
        await bt.toggle_auto_sync(True, interval_minutes=30)
        assert bt.scheduler.get_job(bt.AUTO_SYNC_KICK_JOB_ID) is None  # edit while ON does not
        assert bt.scheduler.get_job(bt.AUTO_SYNC_JOB_ID) is not None

    asyncio.run(scenario())


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_out_of_range_interval_rejected_and_not_persisted(mock_sync):
    res = client.post("/api/v1/scheduler/toggle", json={"enable": True, "interval_minutes": 10**10})
    assert res.status_code == 400
    assert get_system_setting("auto_sync_enabled", "0") == "0"
    assert get_system_setting("auto_sync_interval", "10") == "10"


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
def test_run_now_endpoint(mock_sync):
    res = client.post("/api/v1/scheduler/run-now")
    assert res.status_code == 200
    assert res.json() == {"status": "started"}

    asyncio.run(bt._sync_lock.acquire())
    try:
        res = client.post("/api/v1/scheduler/run-now")
        assert res.json() == {"status": "already_running"}
    finally:
        bt._sync_lock.release()


def test_vessel_sync_reports_available_voyages():
    watch = [{"id": 7, "collection_id": 1, "site_id": "CTL", "vessel_name": "EVER MEMO", "voyage": "999X"}]
    detail = {"items": [], "available_voyages": ["1461-012E", "1462-013E"],
              "reason": "voyage_mismatch", "message": ""}
    calls = []

    with patch.object(bt, "get_all_watchlists", return_value=watch), \
         patch.object(bt, "search_vessels_detailed", return_value=detail), \
         patch("backend.app.core.database.update_watchlist_sync_status",
               side_effect=lambda *a: calls.append(a), create=True):
        result = asyncio.run(bt.sync_vessel_watchlists())

    assert result["vessels_not_found"] == 1
    assert len(calls) == 1
    kind, wl_id, status, message = calls[0]
    assert (kind, wl_id, status) == ("vessel", 7, "not_found")
    assert "1461-012E" in message and "1462-013E" in message


def test_container_sync_reports_status_per_item():
    watch = [
        {"id": 1, "collection_id": 1, "site_id": "CTL", "container_no": "EMCU9914560", "event_type": ""},
        {"id": 2, "collection_id": 1, "site_id": "CTL", "container_no": "EGSU6257353", "event_type": "OUTGATE"},
    ]
    eport = [{"CONTAINERNO": "EMCU9914560", "EVENT_TYPE": "UNLOAD"},
             {"CONTAINERNO": "EGSU6257353", "EVENT_TYPE": "UNLOAD"}]
    calls = []

    with patch.object(bt, "get_all_container_watchlists", return_value=watch), \
         patch.object(bt, "search_containers", return_value=eport), \
         patch.object(bt, "insert_containers") as mock_insert, \
         patch("backend.app.core.database.update_watchlist_sync_status",
               side_effect=lambda *a: calls.append(a), create=True):
        result = asyncio.run(bt.sync_container_watchlists())

    assert result["containers_ok"] == 1
    mock_insert.assert_called_once()
    statuses = {c[1]: c[2] for c in calls}
    assert statuses == {1: "ok", 2: "not_found"}


def test_missed_times_slot():
    now = datetime(2026, 9, 15, 9, 0, tzinfo=VN)
    times = ["08:00", "14:00"]
    assert bt.missed_times_slot(times, None, now) is True
    assert bt.missed_times_slot(times, "2026-09-15 08:05:00", now) is False   # already ran after 08:00
    assert bt.missed_times_slot(times, "2026-09-15 07:59:00", now) is True    # 08:00 was missed
    assert bt.missed_times_slot(times, "2026-09-14 14:30:00", datetime(2026, 9, 15, 7, 0, tzinfo=VN)) is False
    assert bt.missed_times_slot(times, "2026-09-14 13:00:00", datetime(2026, 9, 15, 7, 0, tzinfo=VN)) is True
    assert bt.missed_times_slot([], None, now) is False
    assert bt.missed_times_slot(times, "garbage", now) is True


@patch("backend.app.services.background_tasks.run_sync_all", new_callable=AsyncMock)
@pytest.mark.parametrize("last_run,expect_kick", [("2099-01-01 00:00:00", False), ("2000-01-01 00:00:00", True)])
def test_times_mode_startup_kicks_only_when_slot_missed(mock_sync, last_run, expect_kick):
    set_system_setting("auto_sync_enabled", "1")
    set_system_setting("auto_sync_mode", "times")
    set_system_setting("auto_sync_times", '["08:00"]')
    set_system_setting("auto_sync_last_run_at", last_run)

    async def scenario():
        await bt.restore_auto_sync()
        return bt.scheduler.get_job(bt.AUTO_SYNC_KICK_JOB_ID)

    kick = asyncio.run(scenario())
    assert (kick is not None) is expect_kick
    assert bt.get_auto_sync_status()["last_run_at"] == last_run


def test_run_sync_all_persists_last_run_at():
    async def empty():
        return bt._empty_result()

    with patch.object(bt, "sync_vessel_watchlists", empty), patch.object(bt, "sync_container_watchlists", empty):
        asyncio.run(bt.run_sync_all())
    assert get_system_setting("auto_sync_last_run_at", "") == bt._state["last_run_at"]
    assert bt._state["last_run_at"]

