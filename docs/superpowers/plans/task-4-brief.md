### Task 4: UI Development

**Files:**
- Create: `/Users/baonguyen/Developer/python/auto_read_pdf/src/main.py`

**Interfaces:**
- Consumes: `extract_booking_data` from `src.extractor` and `export_to_excel` from `src.exporter`

- [ ] **Step 1: Write UI Code**
Create `src/main.py` using `customtkinter` and `tkinter.ttk.Treeview`.
Include logic to handle:
- Fallback logic for `Pre Carrier` vs `Trunk Vessel` when displaying on UI. Note: The extractor provides both `Pre Carrier` and `Trunk Vessel` in the data dictionary. Your UI must display the final resolved `Pre Carrier` or `Trunk Vessel` in a single column (and its ETD) per the business rule: if `Pre Carrier` has data, show it; else show `Trunk Vessel`.
- Checkboxes for columns.
- File dialog for PDFs (multiple selection).
- File dialog for saving Excel.

- [ ] **Step 2: Run UI locally**
Run: `python src/main.py` (or verify programmatically if a display is unavailable)
Verify: App opens, window is resizable, treeview displays columns correctly.

- [ ] **Step 3: Commit**
```bash
git add src/main.py
git commit -m "feat: build customtkinter user interface"
```
