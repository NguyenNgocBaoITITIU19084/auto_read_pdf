import pytest
from fastapi.testclient import TestClient

from backend.app.core import database as db
from backend.app.main import app
import backend.app.api.vessels as vessels_api
import backend.app.api.containers as containers_api

API = "/api/v1"


@pytest.fixture
def client(fresh_db):
    return TestClient(app)


def test_vessel_watchlist_batch_endpoints(client):
    col = db.create_collection("API-V")
    res = client.post(f"{API}/vessels/watchlist/batch-add", json={
        "collection_id": col,
        "items": [{"site_id": "CTL", "vessel_name": "EVER MEMO", "voyage": "012E"},
                  {"site_id": "CTL", "vessel_name": "EVER MEMO", "voyage": "012E"}],
    })
    assert res.status_code == 200 and res.json() == {"status": "success", "added": 1}
    ids = [w["id"] for w in client.get(f"{API}/vessels/watchlist", params={"collection_id": col}).json()]
    assert "last_sync_status" in client.get(f"{API}/vessels/watchlist", params={"collection_id": col}).json()[0]
    res = client.post(f"{API}/vessels/watchlist/batch-remove", json={"ids": ids})
    assert res.json() == {"status": "success", "removed": 1}


def test_container_watchlist_batch_endpoints(client):
    col = db.create_collection("API-C")
    res = client.post(f"{API}/containers/watchlist/batch-add", json={
        "collection_id": col,
        "items": [{"site_id": "CTL", "container_no": "EMCU9914560", "event_type": "UNLOAD"},
                  {"site_id": "CTL", "container_no": "EMCU9914561", "event_type": ""}],
    })
    assert res.json() == {"status": "success", "added": 2}
    ids = [w["id"] for w in client.get(f"{API}/containers/watchlist", params={"collection_id": col}).json()]
    assert client.post(f"{API}/containers/watchlist/batch-remove", json={"ids": ids}).json() == {"status": "success", "removed": 2}


def test_move_endpoint(client):
    src = db.create_collection("API-SRC")
    dst = db.create_collection("API-DST")
    b_id = db.insert_booking(src, {"booking_no": "BK1"})
    res = client.post(f"{API}/collections/move", json={"entity": "bookings", "ids": [b_id], "target_collection_id": dst, "copy": True})
    assert res.status_code == 200 and res.json() == {"status": "success", "moved": 1}
    assert len(db.get_bookings(src)) == 1 and len(db.get_bookings(dst)) == 1
    res = client.post(f"{API}/collections/move", json={"entity": "bookings", "ids": [b_id], "target_collection_id": dst})
    assert res.json()["moved"] == 1 and len(db.get_bookings(src)) == 0
    assert client.post(f"{API}/collections/move", json={"entity": "bookings", "ids": [b_id], "target_collection_id": 99999}).status_code == 400
    assert client.post(f"{API}/collections/move", json={"entity": "ships", "ids": [b_id], "target_collection_id": dst}).status_code == 422


def test_vessel_resync_dedupes_and_reports(client, monkeypatch):
    col1 = db.create_collection("RS1")
    col2 = db.create_collection("RS2")
    db.insert_vessel_schedules(col1, [{"SITE_ID": "CTL", "VESSELNAME": "EVER MEMO", "IN_OUT_VOYAGE": "012E"},
                                      {"SITE_ID": "CTL", "VESSELNAME": "LOST SHIP", "IN_OUT_VOYAGE": "001N"},
                                      {"SITE_ID": "GNL", "VESSELNAME": "BROKEN", "IN_OUT_VOYAGE": "9"}])
    db.insert_vessel_schedules(col2, [{"SITE_ID": "CTL", "VESSELNAME": "EVER MEMO", "IN_OUT_VOYAGE": "012E"}])
    ids = [v["id"] for v in db.get_vessel_schedules(col1) + db.get_vessel_schedules(col2)]

    calls = []
    sleeps = []

    def fake_search(site_id, vessel_name, voyage=None):
        calls.append((site_id, vessel_name, voyage))
        if vessel_name == "EVER MEMO":
            return [{"SITE_ID": "CTL", "VESSELNAME": "EVER MEMO", "IN_OUT_VOYAGE": "012E", "CLOSING_TIME": "NEW"}]
        if vessel_name == "BROKEN":
            raise ConnectionError("ePort down")
        return []

    monkeypatch.setattr(vessels_api, "search_vessels", fake_search)
    monkeypatch.setattr(vessels_api.time, "sleep", lambda s: sleeps.append(s))

    body = client.post(f"{API}/vessels/resync", json={"ids": ids}).json()
    assert len(calls) == 3  # EVER MEMO deduped across collections
    assert len(sleeps) == 2
    assert body["status"] == "success"
    assert body["updated"] == 2
    assert len(body["not_found"]) == 1 and "LOST SHIP" in body["not_found"][0]
    assert len(body["errors"]) == 1 and "ePort down" in body["errors"][0]
    assert all(v["closing_time"] == "NEW" for v in db.get_vessel_schedules(col2))


def test_container_resync_groups_by_site(client, monkeypatch):
    col = db.create_collection("RSC")
    db.insert_containers(col, [
        {"SITE": "CTL", "CONTAINERNO": "AAAU1111111", "EVENT_TYPE": "INGATE", "EVENT_TIME": "t1"},
        {"SITE": "CTL", "CONTAINERNO": "AAAU1111111", "EVENT_TYPE": "LOAD", "EVENT_TIME": "t2"},
        {"SITE": "CTL", "CONTAINERNO": "BBBU2222222", "EVENT_TYPE": "INGATE", "EVENT_TIME": "t1"},
        {"SITE": "TNT", "CONTAINERNO": "CCCU3333333", "EVENT_TYPE": "INGATE", "EVENT_TIME": "t1"},
    ])
    ids = [c["id"] for c in db.get_containers(col)]
    calls = []

    def fake_search(site_id, container_nos, is_search_by_in_yard=False, is_search_by_batch=False):
        calls.append((site_id, container_nos))
        if site_id == "CTL":
            return [{"SITE": "CTL", "CONTAINERNO": "AAAU1111111", "EVENT_TYPE": "LOAD", "EVENT_TIME": "t2", "CUST": "Y"},
                    {"SITE": "CTL", "CONTAINERNO": "ZZZU9999999", "EVENT_TYPE": "LOAD", "EVENT_TIME": "t2"}]
        raise ValueError("bad site")

    monkeypatch.setattr(containers_api, "search_containers", fake_search)
    body = client.post(f"{API}/containers/resync", json={"ids": ids}).json()
    assert sorted(calls) == [("CTL", "AAAU1111111,BBBU2222222"), ("TNT", "CCCU3333333")]
    assert body["updated"] == 1
    assert body["not_found"] == ["BBBU2222222"]
    assert len(body["errors"]) == 1 and "bad site" in body["errors"][0]
    assert not any(c["containerno"] == "ZZZU9999999" for c in db.get_containers(col))
    loaded = next(c for c in db.get_containers(col) if c["event_type"] == "LOAD")
    assert loaded["customs_status"] == "Đang giám sát HQ"


def test_container_watchlist_sync_records_status(client, monkeypatch):
    col = db.create_collection("WLS")
    db.add_container_watchlist_batch(col, [{"site_id": "CTL", "container_no": "AAAU1111111", "event_type": ""},
                                           {"site_id": "CTL", "container_no": "BBBU2222222", "event_type": ""}])
    monkeypatch.setattr(containers_api, "search_containers",
                        lambda site, nos, **kw: [{"SITE": "CTL", "CONTAINERNO": "AAAU1111111", "EVENT_TYPE": "LOAD"}])
    body = client.post(f"{API}/containers/watchlist/sync", params={"collection_id": col}).json()
    assert body["updated_count"] == 1
    statuses = {w["container_no"]: w["last_sync_status"] for w in db.get_container_watchlist(col)}
    assert statuses == {"AAAU1111111": "ok", "BBBU2222222": "not_found"}


def test_vessel_search_save_flag_and_save_endpoint(client, monkeypatch):
    col = db.create_collection("QV")
    item = {"SITE_ID": "CTL", "VESSELNAME": "EVER MEMO", "IN_OUT_VOYAGE": "012E"}
    monkeypatch.setattr(vessels_api, "search_vessels_detailed", lambda *a, **k: {
        "items": [item], "reason": "ok", "message": "", "available_voyages": []})

    res = client.post(f"{API}/vessels/search", json={"collection_id": col, "site_id": "CTL",
                                                     "vessel_name": "EVER MEMO", "voyage": "012E", "save": False})
    assert res.status_code == 200 and res.json()["count"] == 1 and res.json()["saved"] is False
    assert db.get_vessel_schedules(col) == []

    res = client.post(f"{API}/vessels/save", json={"collection_id": col, "items": [item]})
    assert res.json() == {"status": "success", "saved": 1}
    assert len(db.get_vessel_schedules(col)) == 1

    res = client.post(f"{API}/vessels/search", json={"collection_id": col, "site_id": "CTL", "vessel_name": "EVER MEMO"})
    assert res.json()["saved"] is True  # default stays backward compatible


def test_container_resync_filters_by_selected_event_type(client, monkeypatch):
    col = db.create_collection("RS")
    ids = db.insert_containers(col, [{"SITE": "CTL", "CONTAINERNO": "ABCU1234567", "EVENT_TIME": "t0", "EVENT_TYPE": "LOAD"}])
    eport_rows = [
        {"CONTAINERNO": "ABCU1234567", "EVENT_TIME": "t1", "EVENT_TYPE": "LOAD"},
        {"CONTAINERNO": "ABCU1234567", "EVENT_TIME": "t2", "EVENT_TYPE": "UNLOAD"},
    ]
    monkeypatch.setattr(containers_api, "search_containers", lambda *a, **k: eport_rows)

    res = client.post(f"{API}/containers/resync", json={"ids": ids})
    assert res.json()["updated"] == 1
    assert sorted(c["event_type"] for c in db.get_containers(col)) == ["LOAD", "LOAD"]

    res = client.post(f"{API}/containers/resync", json={"ids": ids, "all_events": True})
    assert res.json()["updated"] == 2
    assert "UNLOAD" in {c["event_type"] for c in db.get_containers(col)}


def test_container_resync_reports_not_found_when_event_missing(client, monkeypatch):
    col = db.create_collection("RS2")
    ids = db.insert_containers(col, [{"SITE": "CTL", "CONTAINERNO": "ABCU7654321", "EVENT_TIME": "t0", "EVENT_TYPE": "OUTGATE"}])
    monkeypatch.setattr(containers_api, "search_containers",
                        lambda *a, **k: [{"CONTAINERNO": "ABCU7654321", "EVENT_TIME": "t1", "EVENT_TYPE": "LOAD"}])
    body = client.post(f"{API}/containers/resync", json={"ids": ids}).json()
    assert body["updated"] == 0 and body["not_found"] == ["ABCU7654321"]


