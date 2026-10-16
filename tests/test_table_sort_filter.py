"""Column sort of the vessel schedule and container tables, the container operator filter and the shared sort key."""
import time

import pytest

from backend.app.core import database as db


@pytest.fixture(autouse=True)
def _db():
    db.init_db()


@pytest.fixture
def col_id():
    return db.create_collection(f"sort-filter-{time.time_ns()}")


@pytest.mark.parametrize("earlier, later", [
    ("19/10/2026", "05/11/2026"),
    ("EST (dự kiến): 23:00 16/10/2026", "14:00 17/10/2026"),
    ("16/10/2026 09:00", "16/10/2026 10:00"),
    ("2026-10-15 08:50:56", "2026-10-15 09:00:00"),
    ("3", "10"),
    ("-18", "5 C"),
    ("18900 KGM", "30000.5 KGM"),
    ("CMA CGM", "MAERSK"),
])
def test_sort_key_orders_dates_numbers_and_text(earlier, later):
    assert db._sort_key(earlier) < db._sort_key(later)


def _vessel(site, agent, name, closing):
    return {"site_id": site, "agent": agent, "vessel_name": name, "in_out_voyage": "001",
            "closing_time": closing}


def test_vessel_schedules_sort_by_column(col_id):
    db.insert_vessel_schedules(col_id, [
        _vessel("CTL", "SNK", "A", "EST (dự kiến): 14:00 17/10/2026"),
        _vessel("CTL", "MSK", "B", "09:00 16/10/2026"),
        _vessel("CTL", "SNK", "C", ""),
        _vessel("CTL", "", "D", "01:00 20/10/2026"),
    ])

    def names(**kw):
        return [r["vessel_name"] for r in db.get_vessel_schedules_page(col_id, **kw)["items"]]

    assert names(sort_by="closing_time", sort_dir="asc") == ["B", "A", "D", "C"]  # blank last
    assert names(sort_by="closing_time", sort_dir="desc") == ["D", "A", "B", "C"]
    assert names(sort_by="agent", sort_dir="asc") == ["B", "A", "C", "D"]  # blank agent last
    assert len(db.get_vessel_schedule_ids(col_id, sort_by="closing_time")) == 4


def _container(no, line, gross, event_type="GATE IN"):
    return {"containerno": no, "event_time": "16/10/2026 08:00", "event_type": event_type, "line_oper": line,
            "gross": gross}


def test_containers_sort_and_filter_by_line_operator(col_id):
    db.insert_containers(col_id, [
        _container("AAAU1", "ONE", "10500"),
        _container("AAAU2", "MSC", "9000"),
        _container("AAAU3", "ONE", "21000", "DISCHARGE"),
    ])

    def conts(**kw):
        return [r["containerno"] for r in db.get_containers_page(col_id, **kw)["items"]]

    assert conts(sort_by="gross", sort_dir="asc") == ["AAAU2", "AAAU1", "AAAU3"]  # by weight, not text
    assert sorted(conts(line_opers=["ONE"])) == ["AAAU1", "AAAU3"]
    page = db.get_containers_page(col_id, line_opers=["ONE"], event_type="GATE IN")
    assert [r["containerno"] for r in page["items"]] == ["AAAU1"]
    assert page["event_type_counts"] == {"GATE IN": 1, "DISCHARGE": 1}  # counts follow the operator filter
    assert db.get_container_line_opers(col_id) == [{"carrier": "MSC", "count": 1}, {"carrier": "ONE", "count": 2}]
    # unknown column -> default order
    assert len(conts(sort_by="containerno; DROP TABLE containers")) == 3
