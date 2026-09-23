from types import SimpleNamespace

import psutil
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import resource_monitor as rm

client = TestClient(app)


class FakeProc:
    def __init__(self, pid, rss, cpu, children=(), gone=False):
        self.pid = pid
        self._rss = rss
        self._cpu = cpu
        self._children = list(children)
        self._gone = gone

    def memory_info(self):
        if self._gone:
            raise psutil.NoSuchProcess(self.pid)
        return SimpleNamespace(rss=self._rss)

    def cpu_percent(self, interval=None):
        if self._gone:
            raise psutil.NoSuchProcess(self.pid)
        return self._cpu

    def children(self, recursive=False):
        return self._children


@pytest.fixture
def fake_psutil(monkeypatch):
    def install(proc, cpu_count=4, sys_cpu=37.5, total=16 * 2**30, available=6 * 2**30, percent=62.5):
        monkeypatch.setattr(rm, "_SELF", proc)
        monkeypatch.setattr(rm, "_children", {})
        monkeypatch.setattr(rm.psutil, "cpu_count", lambda *a, **k: cpu_count)
        monkeypatch.setattr(rm.psutil, "cpu_percent", lambda *a, **k: sys_cpu)
        monkeypatch.setattr(
            rm.psutil, "virtual_memory",
            lambda: SimpleNamespace(total=total, available=available, percent=percent),
        )
    return install


def test_snapshot_sums_children_and_normalizes_cpu(fake_psutil):
    child = FakeProc(11, 50_000_000, 50.0)
    fake_psutil(FakeProc(10, 100_000_000, 150.0, children=[child]), cpu_count=4)

    snap = rm.get_resource_snapshot()

    assert snap["system"] == {
        "cpu_percent": 37.5, "cpu_count": 4,
        "ram_total": 16 * 2**30, "ram_used": 10 * 2**30, "ram_percent": 62.5,
    }
    assert snap["backend"]["rss"] == 150_000_000
    assert snap["backend"]["cpu_percent"] == 50.0  # (150 + 50) / 4 cores
    assert snap["backend"]["child_count"] == 1


def test_vanished_child_is_skipped(fake_psutil):
    fake_psutil(FakeProc(10, 100, 10.0, children=[FakeProc(12, 999, 99.0, gone=True)]), cpu_count=1)

    backend = rm.get_resource_snapshot()["backend"]

    assert backend["rss"] == 100
    assert backend["cpu_percent"] == 10.0
    assert backend["child_count"] == 0
    assert rm._children == {}


def test_child_process_objects_are_reused_between_samples(fake_psutil):
    fake_psutil(FakeProc(10, 1, 0.0, children=[FakeProc(13, 1, 0.0)]))
    rm.get_resource_snapshot()
    cached = rm._children[13]

    rm._SELF._children = [FakeProc(13, 1, 0.0)]  # psutil returns a fresh object each call
    rm.get_resource_snapshot()

    assert rm._children[13] is cached


def test_resources_api(fake_psutil):
    fake_psutil(FakeProc(10, 123, 4.0), cpu_count=2)
    res = client.get("/api/v1/system/resources")
    assert res.status_code == 200
    data = res.json()
    assert data["backend"] == {"pid": 10, "rss": 123, "cpu_percent": 2.0, "child_count": 0}
    assert data["system"]["cpu_count"] == 2
    assert data["sampled_at"]


def test_resources_api_real_psutil():
    res = client.get("/api/v1/system/resources")
    assert res.status_code == 200
    data = res.json()
    assert data["system"]["ram_total"] > 0
    assert data["backend"]["rss"] > 0


def test_free_memory_api():
    res = client.post("/api/v1/system/free-memory")
    assert res.status_code == 200
    data = res.json()
    assert data["rss_before"] > 0 and data["rss_after"] > 0
