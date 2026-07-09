# Auto PDF Reader for Booking

## Purpose
A desktop application that automatically reads standard (text-based) PDF Booking files from shipping lines, extracts specific data fields, displays them in a resizable GUI grid, and allows exporting selected fields to an Excel file.

## Core Features
1. **PDF Parsing**: Uses `pdfplumber` + Regex to extract fields from text-based PDFs.
2. **User Interface**: Built with `customtkinter` (for modern sidebar/buttons) and `tkinter.ttk.Treeview` (for a performant, scrollable data table).
3. **Smart Extraction Logic**:
   - Extracts: `Booking No`, `Place of Delivery`, `T/S Port`, `Empty Pick Up CY`, `Full retrurn CY`, `Equipment Pick up City`, `Port Cargo Cut-off`, `Pre Carrier` (or Pre Cariter), `ETD` (Pre Carrier), `Trunk Vessel`, `ETD` (Trunk Vessel).
   - Display logic: If `Pre Carrier` exists, display it along with its `ETD`. If it does not exist, display `Trunk Vessel` and its `ETD` instead. 
4. **Excel Export**: Checkboxes in the UI allow the user to select specific columns to export to an `.xlsx` file.

## Architecture & Data Flow
1. **UI Layer (CustomTkinter + ttk.Treeview)**:
   - Sidebar: Load PDFs button, Export to Excel button, Checkbox list of columns to export.
   - Main View: Treeview table displaying data for loaded PDFs.
2. **Service Layer (Data Extraction)**:
   - Loops through selected PDF paths.
   - For each PDF, opens via `pdfplumber`, extracts text.
   - Applies regex rules to find key-value pairs.
   - Applies the Pre Carrier/Trunk Vessel fallback logic.
3. **Export Layer**:
   - Reads the currently selected checkboxes.
   - Filters the internal dataset based on checkbox selections.
   - Prompts user for save location and writes out an `.xlsx` file using `pandas`.
4. **Packaging Layer**:
   - Bundles the application using `PyInstaller`. (Note: To create `.exe` it must be run on Windows, and for Mac `.app` it must be run on Mac. We will provide scripts for both).

## Error Handling
- If a PDF cannot be read or is missing fields, the extraction returns empty strings (`""`) for those fields so the app does not crash.
- User is warned if they try to export with no data loaded or no checkboxes selected.

## Testing
- Verify extracting fields from sample PDFs correctly maps the fields.
- Verify the Pre Carrier -> Trunk Vessel fallback logic works.
- Verify UI resizes properly without breaking the layout.
- Verify exported Excel matches the table and the checkbox filters.
