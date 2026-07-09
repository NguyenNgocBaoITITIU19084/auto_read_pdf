### Task 5: Packaging Scripts

**Files:**
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/build_win.py`
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/build_mac.py`

- [ ] **Step 1: Create Mac script**
Create `build_mac.py`:
```python
import os
os.system("pyinstaller --noconfirm --onedir --windowed --name 'AutoReadPDF' 'src/main.py'")
```

- [ ] **Step 2: Create Windows script**
Create `build_win.py`:
```python
import os
os.system("pyinstaller --noconfirm --onedir --windowed --name 'AutoReadPDF' 'src/main.py'")
```

- [ ] **Step 3: Commit**
```bash
git add build_win.py build_mac.py
git commit -m "build: add pyinstaller packaging scripts"
```
