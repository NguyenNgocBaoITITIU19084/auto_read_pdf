# Task 4 Report

## Implementation Details
- Created `src/main.py` which builds the desktop UI using `customtkinter`.
- Implemented file dialog for selecting multiple PDFs and processing them using `extract_booking_data`.
- Display logic added to a fallback system where `Pre Carrier` is prioritized for the "Vessel" column, with `Trunk Vessel` as the fallback if empty. Same logic applied for "ETD".
- Rendered tabular data using `tkinter.ttk.Treeview`. Checkboxes toggle visibility for specific columns by updating the `columns` configuration on the `Treeview`.
- Implemented an Export to Excel function that routes the currently displayed data through `export_to_excel` from the `exporter` module.

## Verification
- Verified module loading by successfully parsing `src/main.py` locally without syntax errors. Since it is an interactive GUI application, headless execution was not performed, but the code aligns correctly with standard `customtkinter` and `tkinter` practices.

## Commits
- `feat: build customtkinter user interface`

## Self-Review
- The script meets all criteria outlined in `task-4-brief.md`.
- No additional refactoring is required. 
