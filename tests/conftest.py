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
