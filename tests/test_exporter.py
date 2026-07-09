import os
import pytest
import pandas as pd
from src.exporter import export_to_excel

def test_export_to_excel(tmp_path):
    data = [{"Booking No": "123", "Pre Carrier": "Ship A"}, {"Booking No": "456", "Pre Carrier": "Ship B"}]
    cols = ["Booking No", "Pre Carrier"]
    output_file = tmp_path / "test.xlsx"
    
    result = export_to_excel(data, str(output_file), cols)
    
    assert result is True
    assert output_file.exists()
    df = pd.read_excel(output_file, dtype=str)
    assert len(df) == 2
    assert list(df.columns) == cols

def test_export_to_excel_early_exit(tmp_path):
    output_file = tmp_path / "test.xlsx"
    # No data
    assert export_to_excel([], str(output_file), ["Col"]) is False
    assert not output_file.exists()
    
    # No selected columns
    assert export_to_excel([{"Col": "val"}], str(output_file), []) is False
    assert not output_file.exists()

def test_export_to_excel_missing_fields(tmp_path):
    data = [
        {"Booking No": "123"},
        {"Booking No": "456", "Pre Carrier": None}
    ]
    cols = ["Booking No", "Pre Carrier", "Missing Col"]
    output_file = tmp_path / "test_missing.xlsx"
    
    result = export_to_excel(data, str(output_file), cols)
    
    assert result is True
    assert output_file.exists()
    
    # keep_default_na=False ensures empty cells are read as "" rather than NaN
    df = pd.read_excel(output_file, keep_default_na=False, dtype=str)
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
