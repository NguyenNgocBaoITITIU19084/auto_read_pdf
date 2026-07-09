### Task 3: Excel Exporter Logic

**Files:**
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/src/exporter.py`
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/tests/test_exporter.py`

**Interfaces:**
- Consumes: List of dictionaries from `extractor.py`
- Produces: `def export_to_excel(data: list[dict], output_path: str, selected_columns: list[str]) -> bool`

- [ ] **Step 1: Write the failing test**
Create `tests/test_exporter.py`:
```python
import os
import pytest
import pandas as pd
from src.exporter import export_to_excel

def test_export_to_excel():
    data = [{"Booking No": "123", "Pre Carrier": "Ship A"}, {"Booking No": "456", "Pre Carrier": "Ship B"}]
    cols = ["Booking No", "Pre Carrier"]
    export_to_excel(data, "test.xlsx", cols)
    
    assert os.path.exists("test.xlsx")
    df = pd.read_excel("test.xlsx")
    assert len(df) == 2
    assert list(df.columns) == cols
    os.remove("test.xlsx")
```

- [ ] **Step 2: Write minimal implementation**
Create `src/exporter.py`:
```python
import pandas as pd

def export_to_excel(data: list[dict], output_path: str, selected_columns: list[str]) -> bool:
    if not data or not selected_columns:
        return False
        
    df = pd.DataFrame(data)
    
    # Filter columns that actually exist in the dataframe
    valid_cols = [col for col in selected_columns if col in df.columns]
    
    df_filtered = df[valid_cols]
    df_filtered.to_excel(output_path, index=False)
    return True
```

- [ ] **Step 3: Run test**
Run: `pytest tests/test_exporter.py`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add src/exporter.py tests/test_exporter.py
git commit -m "feat: implement Excel export logic"
```
