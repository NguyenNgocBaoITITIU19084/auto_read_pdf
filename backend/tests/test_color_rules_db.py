import pytest
from backend.app.core.database import (
    init_db, get_color_rules, create_color_rule, 
    update_color_rule, delete_color_rule, reset_color_rules_to_default,
    export_backup_data, import_backup_data
)

def test_color_rules_crud():
    init_db()
    rules = get_color_rules()
    assert isinstance(rules, list)
    assert len(rules) > 0  # Defaults should be loaded
    
    # Test create
    new_id = create_color_rule({
        "target_table": "booking",
        "column_key": "Carrier",
        "match_value": "ONE",
        "match_type": "exact",
        "preset_id": "pink",
        "is_enabled": 1
    })
    assert new_id > 0
    
    # Test update
    update_color_rule(new_id, {"match_value": "ONEY", "is_enabled": 0})
    updated_rules = get_color_rules()
    found = next((r for r in updated_rules if r["id"] == new_id), None)
    assert found is not None
    assert found["match_value"] == "ONEY"
    assert bool(found["is_enabled"]) is False
    
    # Test delete
    delete_color_rule(new_id)
    after_del = get_color_rules()
    assert not any(r["id"] == new_id for r in after_del)

def test_reset_color_rules():
    init_db()
    rules = reset_color_rules_to_default()
    assert len(rules) >= 10
    has_rose = any(r["preset_id"] == "rose" for r in rules)
    assert has_rose is True
