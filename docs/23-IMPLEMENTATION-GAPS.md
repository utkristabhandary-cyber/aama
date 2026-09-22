# AAMS — Implementation Gaps (Current vs. Web-Only Target)

This lists the mismatch between the **web-only target system** (docs/02) and **what actually exists**. Every line uses a strict status label. AAMS is web-only (Phase 2); mobile/desktop/offline/companion items were removed and are **not** gaps.

## A. Web Admin Features — Mock Layer Removed (Phase G)
The entire localStorage mock store (`src/services/storage.ts`, `src/data/initialData.ts`, `src/services/academicRules.ts`, `src/services/promotionService.ts`) was **deleted in Phase G**. Remaining status of previously-mock surfaces:

- Timetable admin management (add/edit/delete/import/export/history): **server-backed** (`/api/academics/timetable/` + import endpoints) — see docs/14.
- **Institutional data import/export (Students / Teachers / Timetable): server-backed (Phase H)** — admin wizards run a strict **analyze → stage → confirm** pipeline (`/api/imports/{kind}/preview|confirm|…`, `/api/academics/timetable-import/…`). Uploads only stage a plan; only the confirmed atomic step writes (idempotent, re-run yields `unchanged`). Template + export `.xlsx` downloads are server-generated and admin-only. See `25-INSTITUTIONAL-DATA-IMPORT.md` and `PHASE_H_REPORT.md`.
- Section allocation CSV: **server-backed reads + writes** — preview validates against live students/sections; apply PATCHes real student rows (including `null` unallocations) via `studentService.updateSectionAssignment`.
- Promotion: **live reads only, execution blocked by design** — wizard uses live cohorts + `GET /api/reports/admin/` attendance; the Execute step is disabled because no promotion endpoint exists and student semester is server-managed/write-protected. Backend promotion API + attendance snapshot remain unimplemented server-side (future gap, not simulated).
- Notification broadcast (admin sendAnnouncement): **REMOVED in Phase 8** (no backend endpoint; notifications are backend-owned with own-scoped read/mark-read/delete only). Admin-authored notifications are out of current scope.
- Settings: **intentionally read-only** — shows institution/year (from the Semesters module), the server-enforced policy values (75% / 0.5x late credit / 24h edit window), and data-location notes. No fake save/export/import/reset.
- Global search / header: live role-scoped API search; the "Reset Demo Data" button was removed.

Genuine server-side gaps that remain (do **not** fabricate in the UI):
1. **Promotion/archival endpoint** — no model, serializer, or migration for cohort advancement + attendance snapshot.
2. **Settings API** — no endpoint to persist institution/policy values.
3. **Section-allocation bulk endpoint** — apply is a client-side loop of `PATCH /api/students/{id}/`; no server-side transaction/audit.

## B. Security / Config Gaps
- `.env` contains real DB password at project root (git-ignored, but treat as secret; keep out of any VCS history).
- Dev SECRET_KEY fallback + DEBUG default true.
- Web token in sessionStorage.

## C. Testing Gaps
- ~~No web-frontend automated tests~~ — **RESOLVED (Phase G)**: Vitest suite now covers the rewired services (59 tests), incl. section-allocation preview/apply and honest partial-failure semantics.
- **Phase H** added 16 frontend tests (import/export service, template contract, import presentation/severity/summary, timetable import-row presentation, helpers) → **75 Vitest tests**, and the backend suite is now **409 tests** (18 Phase H additions across the `imports` app + timetable import).

## What IS Solidly Implemented (server core)
- Full backend API + RBAC + ExpiringToken + throttling.
- Attendance session engine (manual + QR), finalization immutability, duplicate prevention, roll, bulk-mark.
- QR token lifecycle (rotate/validate/stop, constant-time, idempotent check-in).
- Reports (summary / by-subject / teacher roster / student own).
- Comprehensive backend test suite (409 tests).
- Institutional import/export engine: workbook classification/normalization, issue severity, duplicates, header contract, atomic all-or-nothing confirm with `select_for_update`, server-generated templates/exports (Phase H).