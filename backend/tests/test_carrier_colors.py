import re
from pathlib import Path

from backend.app.core import database as db

PRESETS_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "colorPresets.ts"


def test_every_default_rule_uses_a_preset_the_frontend_knows():
    known = set(re.findall(r"^\s*id: '([a-z]+)'", PRESETS_TS.read_text(encoding="utf-8"), re.M))
    assert {r["preset_id"] for r in db.DEFAULT_COLOR_RULES} <= known


def test_carrier_colours_are_seeded_and_distinct(fresh_db):
    carriers = [r for r in db.DEFAULT_COLOR_RULES if r["target_table"] == "booking" and r["column_key"] == "Carrier"]
    assert len(carriers) == 18
    assert len({r["preset_id"] for r in carriers}) == 18
    rules = {(r["match_value"], r["preset_id"]) for r in db.get_color_rules() if r["column_key"] == "Carrier"}
    assert ("WAN HAI", "orange") in rules and ("ONE", "fuchsia") in rules
