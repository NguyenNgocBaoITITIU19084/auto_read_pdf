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
