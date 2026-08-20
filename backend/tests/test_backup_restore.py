from backend.app.core.database import (
    init_db, get_color_rules, create_color_rule,
    export_backup_data, import_backup_data
)

def test_backup_restore_includes_color_rules():
    init_db()
    # Create custom rule
    rule_id = create_color_rule({
        "target_table": "booking",
        "column_key": "Carrier",
        "match_value": "COSCO_SPECIAL",
        "match_type": "exact",
        "preset_id": "purple",
        "is_enabled": 1
    })
    
    # Export backup
    backup = export_backup_data()
    assert "color_rules" in backup
    assert any(r["match_value"] == "COSCO_SPECIAL" for r in backup["color_rules"])
    
    # Simulate restoring
    import_backup_data(backup)
    restored_rules = get_color_rules()
    assert any(r["match_value"] == "COSCO_SPECIAL" for r in restored_rules)
