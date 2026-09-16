# Task 4 report (plan E): Frontend error reporting + "Nhật ký hệ thống" screen

## Status: DONE

## What was built

- `frontend/src/services/clientLogger.ts` — new. `reportClientLog(level, message, extra?)`
  dedupes identical `level|message` within 30s, truncates message (2000 chars) and stack
  (8000 chars), never throws, and no-ops until a transport is set.
  `installGlobalErrorLogging()` wires `window.onerror` / `unhandledrejection` (skipping
  axios errors already reported by the interceptor) and returns an uninstall function.
  `setClientLogTransport` / `__resetClientLoggerForTests` support testing without hitting
  the network.
- `frontend/src/services/clientLogger.test.ts` — new, ported from the brief verbatim
  (payload shape, 30s dedupe via fake timers, transport-throws-never-propagates, global
  error/rejection capture). One typing tweak beyond the brief: `vi.fn(async (_payload:
  ClientLogPayload) => undefined)` instead of a bare `vi.fn(async () => undefined)` — the
  brief's version type-checks fine under `vitest run` (esbuild, no type-checking) but fails
  `tsc` (the project's `npm run build` runs `tsc && vite build`) because TS infers the mock's
  `calls` as 0-arity tuples, so `transport.mock.calls[0][0]` doesn't type-check. Behavior and
  assertions are unchanged.
- `frontend/src/services/api.ts` — added `LogEntry` interface, `sendClientLogApi` (wired as
  the default transport via `setClientLogTransport`), a response interceptor that reports
  network errors as `warning` and HTTP ≥500 as `error` (skipping `/logs/client` itself to
  avoid a report loop), `getLogsApi`, and `downloadLogsZipApi` (parses the filename from
  `Content-Disposition`). Matches Task 2/3's actual endpoints (`POST /logs/client`,
  `GET /logs` → `{entries, log_dir}`, `GET /logs/export` → zip stream) exactly as implemented
  in `backend/app/api/logs.py` — no shape mismatches found versus the brief.
- `frontend/src/main.tsx` — calls `installGlobalErrorLogging()` before the render call.
- `frontend/src/components/common/ErrorBoundary.tsx` — `componentDidCatch` now also calls
  `reportClientLog('error', 'React render error: ...', { stack: ... })` alongside the
  existing `console.error`.
- `frontend/src/components/vessel/tableHelpers.ts` — `errorMessage` now appends a lookup
  code `(mã: <request_id>)` when the backend responded ≥500 and included a `request_id`
  (matches `request_logging.py`'s `{"detail": "Lỗi hệ thống. Mã tra cứu: {rid}", "request_id": rid}`
  body, confirmed by reading that file).
- `frontend/src/components/common/LogViewerModal.tsx` — new. Filters by source
  (`errors`/`app`), level, and debounced search; renders entries in a monospace list with
  level badges, expandable multi-line messages, per-row copy, and the log directory footer.
- `frontend/src/components/common/BackupModal.tsx` — new "Nhật ký hệ thống" card (view /
  export zip / open log folder when `window.electronAPI.openLogFolder` exists, which Task 3
  already added to `ElectronAPI`), plus `<LogViewerModal>` mounted alongside it (both lazy
  together since `BackupModal` itself is lazy-loaded per plan C Task 9).
- `frontend/src/i18n/translations.ts` — new `logs` section added to both `vi` and `en`,
  placed right after `bulk` (matching the brief's "cạnh `bulk`" instruction) with the exact
  keys the brief specified.
- `frontend/vite.config.ts` — added `define: { 'import.meta.env.VITE_APP_VERSION': ... }`.
- `backend/app/main.py` — added `"Content-Disposition"` to CORS `expose_headers` (alongside
  the existing `"X-Request-ID"`) so `downloadLogsZipApi` can read the filename in the browser.

## Deviations from the brief

- Test file: see the `vi.fn` typing note above — assertions unchanged, only the mock's type
  annotation added so `tsc` (part of `npm run build`) passes.
- Everything else matches the brief's code samples essentially verbatim; Task 2/3's actual
  backend implementation (`backend/app/api/logs.py`, confirmed by reading it directly) matches
  the brief's assumed shapes with no adjustment needed on the frontend side.

## Tests

- `cd frontend && npm test -- clientLogger` → FAIL before `clientLogger.ts` existed (module
  not found), then PASS (4/4) after implementing it — confirms TDD step was followed.
- `cd frontend && npm test` → 6 files, 23 tests, all passed (no regressions in existing
  suites: `useRowSelection`, `useVirtualRows`, `vnTime`, `BulkActionBar`, `useServerTable`).
- `cd frontend && npm run build` → `tsc && vite build` succeeds, no type errors.
- `cd frontend && node scripts/check-bundle-size.mjs` → reports `startup JS: 302.6 KB (limit
  300 KB)`, exit code 1. **This is a pre-existing violation, not caused by this task**:
  verified by `git stash`-ing all of this task's changes and rebuilding — the baseline
  (commit `39b85e5`, before Task 4) already produces the exact same `index-Bd5ZzKgR.js` file
  (identical hash, 309867 bytes = 302.6 KB) and already fails this check. This task's new
  code (`clientLogger.ts` eagerly imported via `main.tsx`/`api.ts`, `LogViewerModal.tsx`)
  adds no measurable bytes to the entry chunk's content hash, i.e. the entry chunk did not
  change at all between before/after — `LogViewerModal` is bundled into the already-lazy
  `BackupModal` chunk (12.38 KB), not the startup bundle. Flagging as a pre-existing issue
  for a separate task rather than attempting an unrelated fix here.
- Backend: not re-run in this session (no backend/logging code was changed beyond the
  one-line CORS header addition, which needs no new test — Task 3's `test_logs_api.py`
  already covers `/logs/export`'s headers indirectly via the zip content, not CORS
  headers specifically).

## Manual verification (not run this session)

Per Step 9 of the brief (kill backend → see "Network error" log entry; throw in
`DashboardTab` render → see "React render error" with component stack; export zip → verify
no Gemini key inside; "Mở thư mục log" in the Electron build) — these require `npm run dev`
and/or a packaged Electron build and were not exercised here. The code paths match the
brief's spec and Task 3's already-tested backend endpoints, so risk is judged low, but a
manual pass is recommended before release.

## Files touched

- Created: `frontend/src/services/clientLogger.ts`, `frontend/src/services/clientLogger.test.ts`,
  `frontend/src/components/common/LogViewerModal.tsx`
- Modified: `frontend/src/services/api.ts`, `frontend/src/main.tsx`,
  `frontend/src/components/common/ErrorBoundary.tsx`,
  `frontend/src/components/common/BackupModal.tsx`,
  `frontend/src/components/vessel/tableHelpers.ts`, `frontend/src/i18n/translations.ts`,
  `frontend/vite.config.ts`, `backend/app/main.py`
