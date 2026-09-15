import pytest
import pandas as pd
from backend.app.services.exporter import export_to_excel_buffer

def test_export_to_excel():
    data = [{"Booking No": "123", "Pre Carrier": "Ship A"}, {"Booking No": "456", "Pre Carrier": "Ship B"}]
    cols = ["Booking No", "Pre Carrier"]

    buf = export_to_excel_buffer(data, cols)

    df = pd.read_excel(buf, dtype=str)
    assert len(df) == 2
    assert list(df.columns) == cols

def test_export_to_excel_early_exit():
    # No data
    with pytest.raises(ValueError):
        export_to_excel_buffer([], ["Col"])

    # No selected columns
    with pytest.raises(ValueError):
        export_to_excel_buffer([{"Col": "val"}], [])

def test_export_to_excel_missing_fields():
    data = [
        {"Booking No": "123"},
        {"Booking No": "456", "Pre Carrier": None}
    ]
    cols = ["Booking No", "Pre Carrier", "Missing Col"]

    buf = export_to_excel_buffer(data, cols)

    # keep_default_na=False ensures empty cells are read as "" rather than NaN
    df = pd.read_excel(buf, keep_default_na=False, dtype=str)
    assert list(df.columns) == cols
    assert len(df) == 2

    # Check row 1
    assert df.iloc[0]["Booking No"] == "123"
    assert df.iloc[0]["Pre Carrier"] == "null"
    assert df.iloc[0]["Missing Col"] == "null"

    # Check row 2
    assert df.iloc[1]["Booking No"] == "456"
    assert df.iloc[1]["Pre Carrier"] == "null"
    assert df.iloc[1]["Missing Col"] == "null"
