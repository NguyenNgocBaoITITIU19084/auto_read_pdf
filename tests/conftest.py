import os
import pytest
from pathlib import Path

@pytest.fixture(scope="session", autouse=True)
def isolated_test_db(tmp_path_factory):
    temp_dir = tmp_path_factory.mktemp("test_db_dir")
    test_db_path = str(temp_dir / "isolated_test_booking_data.db")
    os.environ["DB_PATH"] = test_db_path
    
    # Patch backend config
    try:
        import backend.app.core.config as be_config
        be_config.DB_PATH = test_db_path
    except ImportError:
        pass

    yield test_db_path


@pytest.fixture(autouse=True)
def _fresh_gemini_fallback_state(monkeypatch):
    """Overloaded-model cooldowns and the cached model list are process-wide: start every test clean, and never let
    the model-list lookup reach Google (tests that need it stub requests.get themselves)."""
    from unittest.mock import MagicMock
    import backend.app.services.image_extractor as ie
    ie._busy_until.clear()
    ie._live_models_cache.update(at=0.0, key="", models=[])
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: MagicMock(status_code=503, json=lambda: {}))


@pytest.fixture(autouse=True)
def _fleet_running_status_follows_use(request, tmp_path):
    """After every fleet test, whatever it did: a truck that can run is "active" (Đang chạy) exactly when someone
    drives it, and a trailer that can run is "active" (Đang dùng) exactly when it is hitched."""
    yield
    if not request.module.__name__.split(".")[-1].startswith("test_fleet"):
        return
    db_file = tmp_path / "fleet.db"
    if not db_file.exists():
        return
    import sqlite3
    conn = sqlite3.connect(db_file)
    try:
        bad_vehicles = conn.execute("""
            SELECT plate, status FROM fleet_vehicles v WHERE deleted_at IS NULL AND status IN ('ready', 'active')
            AND (status = 'active') != EXISTS (SELECT 1 FROM fleet_assignments a WHERE a.vehicle_id = v.id
                                               AND a.ended_at IS NULL);""").fetchall()
        bad_trailers = conn.execute("""
            SELECT plate, status FROM fleet_trailers t WHERE deleted_at IS NULL AND status IN ('ready', 'active')
            AND (status = 'active') != EXISTS (SELECT 1 FROM fleet_trailer_hitches h WHERE h.trailer_id = t.id
                                               AND h.ended_at IS NULL);""").fetchall()
    finally:
        conn.close()
    assert not bad_vehicles, f"Sẵn sàng / Đang chạy out of step with the driver: {bad_vehicles}"
    assert not bad_trailers, f"Sẵn sàng / Đang dùng out of step with the hitch: {bad_trailers}"


@pytest.fixture(autouse=True)
def _fleet_drivers_hold_fc_unless_told(request, monkeypatch):
    """Fleet tests make drivers by name only: they hold an FC licence (may drive tractors and trucks) unless the test
    gives a "license_class" itself (the licence-class tests do)."""
    if not request.module.__name__.split(".")[-1].startswith("test_fleet"):
        return
    from backend.app.core import fleet
    real = fleet.create_driver
    monkeypatch.setattr(fleet, "create_driver",
                        lambda data: real({**data} if "license_class" in data else {**data, "license_class": "FC"}))
