# Task 2 Report: PDF Extractor Logic

## Status
DONE

## Summary of Work
- Created `src/extractor.py` and implemented `extract_booking_data` based on the specified requirements.
- Created `tests/test_extractor.py` containing basic unit tests.
- Ran tests successfully (`2 passed in 0.69s`).
- Committed the code with message `"feat: implement PDF extraction logic"`.

## Commits
- 76b843d - feat: implement PDF extraction logic

## Concerns
- The current regex patterns are fairly basic and may need to be refined with actual PDF samples in a later task, but they meet the minimal initial requirements.

## Next Steps
- Move on to Task 3: API Integration.

## Fix Report (Task 2 Review)
- Fixed missing assignments for `ETD_Pre` and `ETD_Trunk`.
- Implemented explicit fallback logic in `src/extractor.py`: if `Pre Carrier` exists, use it; else use `Trunk Vessel`.
- Handled `page.extract_text()` returning `None` to prevent `TypeError`.
- Wrote proper mock tests in `tests/test_extractor.py` for fallback logic and `None` string handling.
- All 3 tests passing.
- Changes committed.
