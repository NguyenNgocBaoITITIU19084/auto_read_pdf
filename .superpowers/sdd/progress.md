Task 1: complete (commits ede9292..1b1f271, review clean)
Task 2: complete (commits 1b1f271..56801ca, review clean)
Task 3: complete (commits 56801ca..89abcde, review clean)
Task 4: complete (commits 89abcde..HEAD, review clean)

## v2.1 plans (C=perf, D=ocr+fixes, E=ux+logging)
D1 (backup merge/replace): complete (07785d4, cbdcac5)
D2 (fixed-time catch-up): complete (1fa1648)
D3 (container resync event filter): complete (ca8979a)
D4 (approximate voyage match): dropped by decision 2026-09-15 — exact match stays as-is
D5 (quick-vessel no autosave): complete (b68b1e0)
OCR spike (D global constraint): blocked — needs 10 real customer booking images (gitignored, not present) and Windows OCR API (not testable on macOS)

E Task 1 (rotating logs, VN timestamps, key masking): complete (27d62f4) — NOTE: original commit message wrongly claimed "E Tasks 1-4"; verified 2026-09-15 audit that Tasks 2-4 were NOT actually implemented at that point (only Task 1's file logging existed).
E Task 2 (per-request log line + X-Request-ID + 500 lookup code): complete (7e4b5dc)
E Task 3 (logs API: client error ingestion, view, zip export + Electron open-folder): complete (39b85e5)
E Task 4 (frontend clientLogger + LogViewerModal "Nhật ký hệ thống"): complete (7a34ab2)
E Task 5 (bulk action bar: max 3 + "Thêm" menu): complete (598a7fd)
E Task 6 (API sửa/thêm booking thủ công, validate, cảnh báo trùng): complete (a569d6c)
E Task 7 (BookingFormModal): complete (c20556e)
E Task 8 (gắn nút Thêm/Sửa vào BookingTab + BookingDetailModal): complete (ee53169)
E Task 9 (API bộ sưu tập — đếm dòng + đổi tên; POST /collections duplicate name now 409 not 400): complete (e1643a9)
E Task 10 (CollectionSwitcher popover, thay Header select + NewCollectionModal cũ): complete (25e751f)
E: all tasks complete as of 2026-09-15. Full suite green: pytest backend/tests (86) + tests (145) + frontend vitest (34) + npm run build all pass.

D2 (khớp voyage gần đúng): confirmed dropped by user 2026-09-15 (re-confirmed after audit flagged missing written record) — exact match stays as-is, no further action.
D1 (OCR offline spike/integration): still not started — out of scope for this round per user's explicit prioritization (only chose E Task 2-4/6-8/9-10). Still blocked on real booking images + a Windows machine to test Windows OCR API.
