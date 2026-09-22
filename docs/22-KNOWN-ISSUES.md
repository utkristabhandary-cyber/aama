# AAMS — Known Issues, Limitations & Report Conflicts

## Priority: HIGH

| # | Issue | Type | Evidence |
|---|-------|------|----------|
| K1 | **.env with live DB_PASSWORD** | Security | `.env` root contains DB_PASSWORD (git-ignored, but treat as secret) |
| K2 | ~~**Admin Timetable management is localStorage-only**~~ — **RESOLVED in B.6-F/Phase G**: the mock stack (`timetableService`, `timetableApi`) and `store` dependency were deleted; `TimetableAdminView`/`AddTimetableModal` write through `/api/academics/timetable/` | Resolved | see `14-TIMETABLE-CALENDAR.md` |
| K3 | ~~**Section Allocation CSV is localStorage-only**~~ — **RESOLVED in Phase G**: preview now validates against the live student/section API, apply PATCHes real student rows via `studentService.updateSectionAssignment` (section changes and `null` unallocations), and partial failures reject honestly | Resolved | `src/services/sectionAllocationService.ts` |
| K4 | **Promotion has no backend endpoint** — the localStorage mock is gone (Phase G); the wizard now runs on live cohort + attendance reads and the Execute step is intentionally disabled with an explanatory banner (student semester is server-managed/read-only). Remaining gap = add a real promotion API + attendance snapshot when that feature is implemented | Functional gap | `src/features/promotion/PromotionView.tsx` |
| K5 | ~~**Notification broadcast (admin) localStorage-only**~~ — **RESOLVED in Phase 8**: the broadcast UI/service were removed (no backend endpoint exists by design); notifications are now backend-owned with own-scoped read/mark-read/delete | Resolved | `notificationService.ts` uses apiClient (`/notifications/`) |
| K6 | ~~**Faculty & Teachers page failed to load**~~ — **RESOLVED in Phase H**: `loadData` awaited the four enrichment endpoints via `apiClient.get` and called `.map()` on the raw DRF page envelope → `TypeError: Fe.map is not a function` ("Request failed (undefined)" in the UI). Switched to `apiClient.list` (pagination unwrap); the page, import wizard, and export button now work | Resolved | `src/features/teachers/TeachersView.tsx` (`apiClient.list<…>` in the Promise.all) |

## Priority: MEDIUM

| # | Issue | Type | Evidence |
|---|-------|------|----------|
| M1 | Auth token in `sessionStorage` (XSS-exposed) | Security | `src/services/apiClient.ts` |
| M2 | Dev fallback SECRET_KEY / DEBUG default true | Security | `backend/config/settings/base.py:26-30` |

## Priority: LOW / NOTED

| # | Issue | Type | Evidence |
|---|-------|------|----------|
| L1 | No backend settings API — `SettingsView` is intentionally a read-only summary (no fake save/export/import/reset; values are the ones the server enforces; see Phase G) | By design | `src/features/settings/SettingsView.tsx` |
| L2 | ~~**No web-frontend automated tests**~~ — **RESOLVED in Phase G**: Vitest suite (59 tests) covers apiClient/reportService/notificationService mappers, import presentation logic, and the rewired `sectionAllocationService` | Resolved | `src/**/*.test.ts` |
| L3 | Blank/bare template uploads (no data rows) return a 400 from the server ("no data rows"); the wizard surfaces it as a blocking issue per the shared safety contract rather than silently "succeeding" | By design | `apps/imports/engine` + wizard issue handling |

## Conflicts With Prior Reports
Authorization: The repository code is authoritative. Prior `PHASE*.md`/`AAMS_AUDIT_REPORT.md` files are archived context only.

- Some prior reports implied the web admin features were **localStorage mocks** for timetable admin, section allocation, promotion, notification broadcast, settings, and global search. **Phase G removed the mock layer entirely**: the `store`/`initialData.ts`/`academicRules.ts` cluster is deleted, and every one of those surfaces now reads live DRF data (or is honestly read-only where no backend feature exists — promotion execution, settings editing). Treat prior "mock/not server-backed" rows as superseded by Phase G.
- Pre-Phase-2 docs (`docs/archive/10-13`, `docs/archive/19-MOBILE-APP.md`) describe a mobile/companion/offline architecture that no longer exists in the code. The code wins.

## Hard Constraint Reminder
Phase G is a documentation + frontend source-of-truth correction phase; Phase H adds
the server-backed institutional import/export pipeline. Only the items marked
RESOLVED above were fixed; remaining backend feature gaps (promotion endpoint,
settings API) are tracked for future phases and must not be simulated in the UI.