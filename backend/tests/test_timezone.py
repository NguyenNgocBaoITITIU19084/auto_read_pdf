import time
from datetime import datetime, timedelta

import pytest

from backend.app.core import database as db
from backend.app.core.timezone import VN_TZ, now_vn_str


def _as_vn(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=VN_TZ)


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="time.tzset is POSIX-only")
def test_now_vn_str_ignores_machine_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    try:
        expected = datetime.now(VN_TZ)
        assert abs(_as_vn(now_vn_str()) - expected) < timedelta(seconds=5)
        assert abs(_as_vn(db._now_str()) - expected) < timedelta(seconds=5)
    finally:
        monkeypatch.delenv("TZ", raising=False)
        time.tzset()
