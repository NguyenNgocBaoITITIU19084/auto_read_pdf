from unittest.mock import MagicMock

import pytest

from backend.app.services import eport_client


def _ship(site_id):
    return {"SITE_ID": site_id, "VESSELNAME": "BRIGHT SAKURA", "IN_OUT_VOYAGE": "0022N-0022N"}


def _answer(monkeypatch, *ships):
    resp = MagicMock(status_code=200)
    resp.json.return_value = {"type": "success", "content": "", "model": list(ships)}
    monkeypatch.setattr(eport_client.requests, "post", lambda *a, **kw: resp)


@pytest.mark.parametrize("returned, stored", [
    ("TCI", "GNL"),   # ePort's GNL answer carries a site it cannot be searched with
    ("", "GNL"),
    ("CTL", "CTL"),   # a queryable site is kept as ePort returned it
])
def test_site_id_is_always_queryable(monkeypatch, returned, stored):
    _answer(monkeypatch, _ship(returned))
    items = eport_client.search_vessels("GNL", "BRIGHT SAKURA", "0022N")
    assert [it["SITE_ID"] for it in items] == [stored]

