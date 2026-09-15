import pytest

from backend.app.services import background_tasks as bt


@pytest.fixture(autouse=True)
def _cleanup_job():
    yield
    try:
        if bt.scheduler.get_job("log_retention"):
            bt.scheduler.remove_job("log_retention")
    except Exception:
        pass


def test_register_log_retention_job_adds_job_to_scheduler():
    bt.register_log_retention_job()
    job = bt.scheduler.get_job("log_retention")
    assert job is not None


def test_register_log_retention_job_is_idempotent():
    bt.register_log_retention_job()
    bt.register_log_retention_job()
    jobs = [j for j in bt.scheduler.get_jobs() if j.id == "log_retention"]
    assert len(jobs) == 1
