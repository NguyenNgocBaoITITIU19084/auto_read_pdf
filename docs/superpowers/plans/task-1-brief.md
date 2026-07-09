### Task 1: Setup Project & Dependencies

**Files:**
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/requirements.txt`
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/pytest.ini`

**Interfaces:** N/A

- [ ] **Step 1: Write requirements.txt**
```text
customtkinter==5.2.2
pdfplumber==0.11.0
pandas==2.2.2
openpyxl==3.1.2
pytest==8.2.0
pyinstaller==6.6.0
```

- [ ] **Step 2: Write pytest.ini**
```ini
[pytest]
pythonpath = . src
testpaths = tests
```

- [ ] **Step 3: Install dependencies**
Run: `pip install -r requirements.txt`
Expected: Successfully installs all packages.

- [ ] **Step 4: Commit**
```bash
git add requirements.txt pytest.ini
git commit -m "chore: setup project dependencies"
```
