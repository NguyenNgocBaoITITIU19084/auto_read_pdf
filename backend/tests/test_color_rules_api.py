from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_color_rules_api():
    # GET rules
    res = client.get("/api/v1/color-rules")
    assert res.status_code == 200
    rules = res.json()
    assert isinstance(rules, list)
    assert len(rules) > 0
    
    # POST rule
    create_res = client.post("/api/v1/color-rules", json={
        "target_table": "container",
        "column_key": "custom_clearance_status",
        "match_value": "TEST_CLEARANCE",
        "match_type": "exact",
        "preset_id": "rose",
        "is_enabled": True
    })
    assert create_res.status_code == 200
    created = create_res.json()
    rule_id = created["id"]
    assert created["match_value"] == "TEST_CLEARANCE"
    
    # PUT rule
    put_res = client.put(f"/api/v1/color-rules/{rule_id}", json={
        "match_value": "TEST_CLEARANCE_UPDATED",
        "is_enabled": False
    })
    assert put_res.status_code == 200
    updated = put_res.json()
    assert updated["match_value"] == "TEST_CLEARANCE_UPDATED"
    assert updated["is_enabled"] is False
    
    # DELETE rule
    del_res = client.delete(f"/api/v1/color-rules/{rule_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"
    
    # POST reset
    reset_res = client.post("/api/v1/color-rules/reset")
    assert reset_res.status_code == 200
    reset_rules = reset_res.json()
    assert len(reset_rules) >= 10
