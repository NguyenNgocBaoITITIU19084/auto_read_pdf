import os
import tempfile

import pytest

# Point the backend at a throwaway database BEFORE any backend module is imported,
# so backend tests never touch the real backend/booking_data.db.
_TEST_DB_DIR = tempfile.mkdtemp(prefix="backend_tests_db_")
os.environ["DB_PATH"] = os.path.join(_TEST_DB_DIR, "backend_test_booking_data.db")


@pytest.fixture(scope="session", autouse=True)
def _init_shared_test_db():
    from backend.app.core.database import init_db
    init_db()
    yield


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """An empty, initialized database used only by the requesting test."""
    from backend.app.core.database import init_db
    db_path = str(tmp_path / "fresh.db")
    monkeypatch.setenv("DB_PATH", db_path)
    init_db()
    return db_path


@pytest.fixture(autouse=True)
def _fresh_gemini_fallback_state(monkeypatch):
    """Overloaded-model cooldowns and the cached model list are process-wide: start every test clean, and never let
    the model-list lookup reach Google (tests that need it stub requests.get themselves)."""
    from unittest.mock import MagicMock
    import backend.app.services.image_extractor as ie
    ie._busy_until.clear()
    ie._live_models_cache.update(at=0.0, key="", models=[])
    monkeypatch.setattr(ie.requests, "get", lambda *a, **k: MagicMock(status_code=503, json=lambda: {}))
