# Task 3 report (plan E): log API + Electron

## Status: DONE

## What was built

- `backend/app/services/log_reader.py` — `read_entries(log_dir, source, level, q, limit)`
  parses `app.log`/`errors.log` (tail of last 2MB of the current file plus its `.1`
  rotated backup), newest entries first, grouping traceback / multi-line continuations
  into the preceding entry's `message`.
- `backend/app/api/logs.py` — `POST /api/v1/logs/client` (frontend error ingestion,
  60/min rate limit, truncation, writes via `logging.getLogger("frontend")`),
  `GET /api/v1/logs` (viewer, `source=app|errors`, `level`, `q`, `limit`),
  `GET /api/v1/logs/export` (redacted zip: `logs/*.log*`, `electron/backend.log*` when
  `ELECTRON_BACKEND_LOG` points at a real file, `system_info.json` with no API key value,
  only `gemini_key_configured: bool`).
- `backend/app/core/version.py` — new, `APP_VERSION = "2.0.0"` (Task 1's A2 hadn't been
  done yet). `main.py` now uses it for `FastAPI(version=...)` and `/health` instead of a
  hardcoded string in two places.
- `backend/app/main.py` — registers `logs_router` under `/api/v1`.
- `backend_app.spec` — added hiddenimports for `backend.app.core.logging_setup`,
  `.request_context`, `.request_logging`, `.timezone`, `.version`,
  `backend.app.services.log_reader`, `backend.app.api.logs`.
- `backend/app/core/logging_setup.py` — added `_SENSITIVE_GOOGLE_KEY_RE` (bare
  `AIza[0-9A-Za-z_-]{16,}` token) to `_mask_sensitive`, applied after the existing
  named/URL/quoted patterns. See "Deviation" below for why.
- Electron: `electron/py_manager.js` adds a `logDir` getter (`<userData>/logs`) and passes
  `LOG_DIR`/`ELECTRON_BACKEND_LOG` env vars to the spawned backend process.
  `electron/main.js` adds an `open-log-folder` IPC handler (same `isFromMainWindow` guard
  as the existing `backend-show-log`/`backend-retry` handlers) that creates and opens
  `backend.logDir`. `electron/preload.js` exposes `openLogFolder()`.
  `frontend/src/types/index.ts` adds `openLogFolder?: () => void` to `ElectronAPI`.
- `backend/tests/test_logs_api.py` — new, ported from the brief unmodified in assertions
  (see deviations for the one behavior change needed to keep it green).

## Deviations from the brief (brief assumed a different Task 1/2 shape)

- `ls.setup_logging(log_dir=log_dir)` → `ls.configure_logging()` (reads `LOG_DIR` env
  itself; no `log_dir` kwarg exists).
- `from backend.app.core.logging_setup import get_log_dir, redact` — both already existed
  from Task 1/2, used as-is.
- `LINE_RE` in `log_reader.py` does **not** match a `[req=...]` field baked into the log
  formatter, because the formatter (`"%(asctime)s [%(levelname)s] [%(name)s]: %(message)s"`)
  never emits one — the request id is embedded by `request_logging.py` as a `[req=<id>]`
  prefix *inside the message* on some (not all) log lines. `log_reader._parse` now matches
  `TIME [LEVEL] [logger]: rest` and then peels an optional leading `[req=...]` off `rest`
  into its own `request_id` field, defaulting to `"-"` when absent. This matches the brief's
  produced `LogEntry` shape (`time, level, logger, request_id, message`) with entries not
  carrying a request id (e.g. plain `logger.info(...)` calls in tests) still parsing
  correctly instead of failing the line regex outright.
- `db.get_db_path()` (function name matches brief) and `db.get_connection()` (context
  manager, matches brief) — used as-is; `background_tasks.get_auto_sync_status()` — used
  as-is, trimmed to the same 4 keys the brief specified.
- **Security-relevant fix beyond the brief's literal code**: the brief's own test logged
  `f"call with key={FAKE_KEY}"` (bare `key=`, not the `?key=`/`&key=` URL-query-param shape)
  and asserted the key appears nowhere in the exported zip. Task 2's masking only covers
  `key=` in URL-query position (`_SENSITIVE_URL_KEY_RE`), by design — bare `key=` was judged
  too common a word to mask everywhere. Running the brief's test as written surfaced a real
  gap: a bare Gemini key token (`AIzaSy...`) landing in a log line through any path other
  than a recognized `key=`/`api_key=` prefix (e.g. an exception's own message, a library's
  `repr()`) was not masked and would ship inside the exported log zip — the one artifact in
  this feature that's meant to leave the user's machine. Fixed by adding
  `_SENSITIVE_GOOGLE_KEY_RE = re.compile(r"AIza[0-9A-Za-z_-]{16,}")` to
  `logging_setup._mask_sensitive`, applied on top of (not replacing) the existing patterns —
  this leaves Task 2's "don't mask bare `key=`" decision untouched and only adds coverage
  for the actual secret token shape. Verified it matches both fake keys used across the test
  suite (39-char and 31-char `AIzaSy...` strings) and that
  `test_sensitive_filter_does_not_mask_unrelated_key_words` (asserting `column_key=Carrier
  preset_id=purple` stays untouched) still passes. The brief's test file is otherwise
  unmodified — `test_export_zip_contains_logs_and_system_info_without_key` runs with the
  brief's original `key={FAKE_KEY}` (no `?`) assertion and passes.
- `_add_redacted`/`export_logs` additionally check `Path(electron_log).is_file()` before
  globbing its rotated siblings, to avoid a glob against a nonexistent parent when
  `ELECTRON_BACKEND_LOG` is unset or stale (brief's version globbed unconditionally once the
  env var was merely present).

## Tests

- `pytest backend/tests -q` → 79 passed (includes the 4 new `test_logs_api.py` tests, using
  the brief's assertions unmodified).
- `pytest tests -q` → 145 passed (top-level suite untouched by this task, confirmed no
  regressions).
- `pytest backend/tests tests -q` combined → 224 passed.
- `node --check` on `electron/main.js`, `electron/py_manager.js`, `electron/preload.js` →
  all syntax-valid.

## Not verified

- The Electron/manual flow (`npm run dev`, checking `LOG_DIR`-produced `app.log` with VN
  timestamps, exercising `openLogFolder()` from a running renderer) was not run in this
  session — no Electron runtime was launched. The IPC wiring follows the existing
  `backend-show-log`/`backend-retry` pattern exactly (same `isFromMainWindow` guard,
  same getter style), so risk is low, but this should get a manual pass before release.
- Frontend UI to call `POST /logs/client` for client-side error reporting, or a Settings/
  About panel exposing `GET /logs` + `openLogFolder()` + `GET /logs/export`, is out of
  scope for this task per the brief (backend + Electron plumbing only) and was not built.

## Files touched

- Created: `backend/app/services/log_reader.py`, `backend/app/api/logs.py`,
  `backend/app/core/version.py`, `backend/tests/test_logs_api.py`
- Modified: `backend/app/main.py`, `backend/app/core/logging_setup.py`, `backend_app.spec`,
  `electron/py_manager.js`, `electron/main.js`, `electron/preload.js`,
  `frontend/src/types/index.ts`
- `.gitignore` already had `logs/` from an earlier task — no change needed.
