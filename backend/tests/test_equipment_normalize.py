import pytest

from backend.app.core.database import normalize_equipment_type


@pytest.mark.parametrize("raw, expected", [
    ("40'DRY HC", "40HC"),
    ("40HC", "40HC"),
    ("40'HC", "40HC"),
    ("40' HI-CUBE", "40HC"),
    ("40 High Cube", "40HC"),
    ("40HQ", "40HC"),
    ("45G1", "40HC"),
    ("20 GP", "20GP"),
    ("20'DRY", "20GP"),
    ("20DV", "20GP"),
    ("22G1", "20GP"),
    ("40' STANDARD", "40GP"),
    ("40RF", "40RF"),
    ("40' REEFER HC", "40RH"),
    ("20OT", "20OT"),
    ("40' FLAT RACK", "40FR"),
    ("2x40HC", "40HC"),
    ("", ""),
    (None, ""),
    ("20GP/40HC", "20GP/40HC"),
    ("MIXED", "MIXED"),
])
def test_normalize_equipment_type(raw, expected):
    assert normalize_equipment_type(raw) == expected
