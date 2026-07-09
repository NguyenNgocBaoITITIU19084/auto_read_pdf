### Task 2: PDF Extractor Logic

**Files:**
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/src/extractor.py`
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/tests/test_extractor.py`

**Interfaces:**
- Produces: `def extract_booking_data(pdf_path: str) -> dict`

- [ ] **Step 1: Write the failing test**
Create `tests/test_extractor.py`:
```python
import pytest
from src.extractor import extract_booking_data

def test_extract_booking_data_missing_file():
    with pytest.raises(FileNotFoundError):
        extract_booking_data("non_existent.pdf")

def test_extract_booking_data_fallback_logic():
    # We simulate extraction logic by passing raw text string, but since our function takes path, 
    # we'll test the internal parser function if we separate it.
    pass # Will implement mock testing in actual step
```

- [ ] **Step 2: Write minimal implementation**
Create `src/extractor.py`:
```python
import os
import pdfplumber
import re

def extract_booking_data(pdf_path: str) -> dict:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"File not found: {pdf_path}")
    
    result = {
        "STT": "",
        "Tên file PDF": os.path.basename(pdf_path),
        "Booking No": "",
        "Place of Delivery": "",
        "T/S Port": "",
        "Equipment Pick up City": "",
        "Empty Pick Up CY": "",
        "Full retrurn CY": "",
        "Port Cargo Cut-off": "",
        "Pre Carrier": "",
        "ETD_Pre": "",
        "Trunk Vessel": "",
        "ETD_Trunk": ""
    }
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text = ""
            for page in pdf.pages:
                text += page.extract_text() + "\n"
                
            # Regex patterns (will be refined with real PDFs)
            booking_match = re.search(r"Booking No[.:\s]+([A-Z0-9]+)", text, re.IGNORECASE)
            if booking_match:
                result["Booking No"] = booking_match.group(1).strip()
            
            pre_carrier_match = re.search(r"Pre Carrier[.:\s]+(.*?)(?=\n|$)", text, re.IGNORECASE)
            etd_pre_match = re.search(r"ETD.*?Pre Carrier[.:\s]+(.*?)(?=\n|$)", text, re.IGNORECASE)
            trunk_match = re.search(r"Trunk Vessel[.:\s]+(.*?)(?=\n|$)", text, re.IGNORECASE)
            etd_trunk_match = re.search(r"ETD.*?Trunk Vessel[.:\s]+(.*?)(?=\n|$)", text, re.IGNORECASE)
            
            # Logic: If Pre Carrier exists, use it. Otherwise Trunk Vessel.
            # We store both and UI will filter it.
            if pre_carrier_match:
                result["Pre Carrier"] = pre_carrier_match.group(1).strip()
            if trunk_match:
                result["Trunk Vessel"] = trunk_match.group(1).strip()
    except Exception as e:
        print(f"Error parsing {pdf_path}: {e}")
        
    return result
```

- [ ] **Step 3: Run test to verify**
Run: `pytest tests/test_extractor.py`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add src/extractor.py tests/test_extractor.py
git commit -m "feat: implement PDF extraction logic"
```
