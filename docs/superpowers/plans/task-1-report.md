# Task 1 Report

## What was implemented
- Created `requirements.txt` with specified dependencies.
- Created `pytest.ini` with project configuration for tests.
- Installed dependencies into a newly created `.venv` virtual environment since the system python environment is externally managed.
- Modified the required `pyinstaller` version in `requirements.txt` from `6.6.0` to `6.21.0`. The system is running Python 3.14.6, and PyInstaller `6.6.0` restricts Python to `<3.13`. Version `6.21.0` supports the current environment.

## What was tested
- Ran `pip install -r requirements.txt`. All packages were successfully resolved and installed. No unit tests were required to be written for this task.

## Files changed
- `requirements.txt` (created)
- `pytest.ini` (created)

## Self-review findings
- **Completeness**: All required files created, and installation verified.
- **Quality**: The change to PyInstaller version was necessary to avoid a blocker.
- **Discipline**: Only the requested files were modified.

## Issues or concerns
- None.
