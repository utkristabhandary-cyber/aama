# AAMS — Phase 3: Pre-Implementation Master Audit

> **SUPERSEDED in part by Phase G (19 Sep 2026):** the "mock lane" / dual-lane findings
> below no longer exist — `initialData.ts` + `storage.ts` were deleted (not kept as fallback),
> and every surface the audit flagged as MOCK/FALLBACK is now server-backed or honestly
> read-only. The historical audit remains as baseline context only. See
> `PHASE_G_SOURCE_OF_TRUTH_REPORT.md`.

**Date:** 2026-09-09
**Scope:** Full-system audit of the web-only AAMS (backend + frontend + docs) *before* any implementation work.
**Method:** Read of all active docs (00–24, AUDIT-MATRIX, CLEANUP_REVIEW) + two independent source-code inventory audits (backend/DB/API; frontend reality) + targeted verification reads/greps by the auditor.
**Hard constraint honored:** **AUDIT ONLY.** Zero production files were modified (no code, no deps, no migrations, no deletions, no config). The only file created in this phase is this report. Step 13 requirement met — baseline untouched.

---

## Legend

Status labels (from the Phase 2.5 convention):
`COMPLETE` · `PARTIAL` · `MOCK/FALLBACK` · `NOT IMPLEMENTED` · `BROKEN` · `OBSOLETE` · `UNCLEAR`

Evidence tags: **[FACT]** verified in source/tests · **[RECOMMENDATION]** auditor suggestion · **[FUTURE WORK]** deferred intent.

---

## 1. Executive Summary

**[FACT]** AAMS is healthy and shippable as a demo system:

- **149 backend tests pass** (312s full suite this run) — clean migrations, clean `tsc` lint, clean Vite build, backend `/api/health/` = 200 + DB connected, Vite :3000 = 200.
- Core engineering is complete and well-tested: DRF API + RBAC + ExpiringToken + throttling; attendance engine (manual + QR + roll + bulk); QR security (HMAC signature, 15s TTL, nonce, rotation, constant-time compare, idempotent check-in, per-session ledger reset on re-target).
- No overall requirement is `BROKEN`. Every degraded area is an explicitly documented **mock/localStorage** surface.

**[FACT]** The remaining distance to "everything truly server-backed":

| Domain | Status | Where |
|---|---|---|
| Auth/RBAC/tokens | **COMPLETE** | backend tested; frontend authService live |
| Academics CRUD (semesters/sections/subjects/assignments/holiday-read) | **COMPLETE** | apiClient live |
| Teachers / Students modules | **COMPLETE** | apiClient live |
| Attendance sessions (manual + QR) | **COMPLETE** | apiClient live, heavily tested |
| Reports — teacher & student surfaces | **COMPLETE** | `/api/reports/summary/` via teacherService/studentService |
| Reports — **admin** surface | **MOCK/FALLBACK** | `ReportsView` aggregates `store` (localStorage seed), not `/api/reports/summary/` |
| Admin Dashboard | **MOCK/FALLBACK** | `AdminDashboard` reads `store` for all metrics |
| Notifications (read + badge + broadcast) | **MOCK/FALLBACK** | `notificationService` is pure `store`; backend `/api/notifications/` unused by UI |
| Holidays — **write** path | **MOCK/FALLBACK** | `holidayService.declareHoliday/deleteHoliday` use `store`; backend exist |
| Admin Timetable writes | **MOCK/FALLBACK** | `timetableService`/`timetableApi` use `store` |
| Section Allocation CSV | **MOCK/FALLBACK** | `sectionAllocationService` uses `store` |
| Promotion | **MOCK/FALLBACK** | `promotionService` uses `store`; no backend endpoint/migration |
| Settings | **MOCK/FALLBACK** (shell) | no backend settings API |
| Mobile / offline / BSSID companion | **NOT IMPLEMENTED** (removed) | archived `docs/archive/10–13`,`19` — explicitly out of scope (web-only) |

**[FACT]** Test-count reconciliation: the suite reports **149**, which is **136 unique test methods + 13 inherited re-runs**. `AttendanceWorkflowLifecycleTests(AttendanceApiAuthTests)` re-runs its parent's 13 `test_*` methods (Django discovery), which explains phantom "extra" tests and the stale "148" in docs.

**[RECOMMENDATION]** Next phase = **Phase 8 — Analytics & Notifications Live-Wiring** (P1 items in §16), then admin operations P2, then frontend test harness P3. Exact order in §17.

---

## 2. Architecture Review

**[FACT]** Three tiers:

1. **Backend** — Django + DRF (`backend/`), custom `User` (`AUTH_USER_MODEL = accounts.User`, settings `base.py:112`), `ExpiringToken` auth, 8 apps (`accounts, academics, teachers, students, attendance, notifications, reports, common`).
2. **Frontend** — React SPA (`src/`) with **state-based routing** (no react-router): `App.tsx:1-297` keeps `currentView`; `VIEW_ROLE_PERMISSIONS` at `App.tsx:50-85`; role guard + `UnauthorizedAccessView` at `App.tsx:~138`. Provider tree: `ErrorBoundary > ToastProvider > AuthProvider > MainContent > AppLayout`.
3. **Mock persistence lane** — `store` over `localStorage`, seeded by `src/data/initialData.ts`. `apiClient` checks backend health and can fall back to `store` with a toast ("demo mode") when the API is down; 401 clears session and redirects to login with an error toast.

**[FACT]** Dual-lane persistence is the defining architectural trait: roughly two-thirds of UI surfaces consume the **live API lane**, while a set of admin/operations surfaces consume the **mock lane** (list in §7). The `apiClient` fallback keeps the demo alive offline but can mask a downed backend for mock-lane features.

**[RECOMMENDATION]** Converge on a single lane: API-first, `store` retained *only* as the offline fallback inside `apiClient`. Treat any remaining direct `store` usage in feature views as debt to retire (§16/§17).

---

## 3. Backend Audit

**[FACT]** Settings (verified `backend/config/settings/base.py`):
- `AUTH_USER_MODEL = "accounts.User"` (line 112).
- `REST_FRAMEWORK` (lines 179-198): `ExpiringTokenAuthentication` + `SessionAuthentication`; `IsAuthenticated` default; `PageNumberPagination`, `PAGE_SIZE = 100`; custom `config.exceptions.aams_exception_handler`.
- `AAMS_TOKEN_TTL_SECONDS = 2_592_000` (~30d, line 150); `AAMS_QR_TOKEN_TTL_SECONDS = 15` (line 161); login throttles 5/min per account + 100/min per IP (lines 153-154).
- Dev fallback `SECRET_KEY` + `DEBUG` default true (lines 26-30) — tracked as M2; `.env` carries a live `DB_PASSWORD` (K1).

**[FACT]** Apps & models (inventory):
- `accounts`: `User`, `ExpiringToken`; management commands `seed_demo_data`, demo-teacher creation.
- `academics`: `AcademicSemester`, `Section`, `Subject`, `Assignment` (+ rules in `academicRules`), timetable slot model.
- `teachers`/`students`: `Teacher`, `Student` with foreign-key user links.
- `attendance`: `AttendanceSession`, `AttendanceRecord`, `QRAttendanceSession` (one-active-QR + ledger fields), ordering/unique constraints incl. `unique(attendance_session, student)`, distinct ordered `checked_in_at`.
- `notifications`: `Notification` (own-read semantics).
- `reports`: no models — pure aggregation service.
- `common`: health + shared utilities.

**[FACT]** Service layer (`backend/apps/attendance/services.py`, verified): `start_qr_session` (15), `stop_qr_session` (41), `build_qr_payload` (46), `validate_qr` (51), `mark_qr_student` (80), `mark_qr_student_via_code` (98), `parse_qr_payload` (140), `resolve_network_verification` (161), `check_in_student` (178), `_record_payload` (288), `token_is_current` (298), `finalize_attendance_session` (310), `find_duplicate_session` (332), `roll_call_for_session` (355), `summarize_student_attendance` (390).

**[FACT]** Permissions: role classes (`IsAdminUser`/`IsTeacherUser`/`IsStudentUser`, `AdminOrReadOnly`) map per-viewset; every resource viewset scopes `get_queryset()` to owner/admin (teachers → own sessions/records; students → own records), enforced by tests.

**[FACT]** No backend module is `BROKEN`. LSP flags on `attendance/services.py` (e.g., "django.db could not be resolved") are venv false positives — the 149 tests pass.

---

## 4. Database Audit

**[FACT]**
- `py manage.py makemigrations --check --dry-run` → **no model changes detected** (schema in sync; no drift).
- All queries ORM-only; no raw SQL.
- Constraints of note (the reasons attendance/QR correctness holds):
  - `unique` on attendance session + student (no duplicate markings).
  - ordered/uniqueness on `checked_in_at` per record.
  - One active QR session per teacher (enforced in service layer + tested).
- Seed data flows through the `seed_demo_data` management command (demo accounts `admin`, `tch-3`, `std-1`).
- **No foreign/postgres-specific features** — portable to SQLite/Postgres.

**[FUTURE WORK]** Index/EXPLAIN review for the student-attendance FK query family is unnecessary at current scale (single-tenant demo); revisit only if historical datasets grow beyond ~1e5 records.

---

## 5. API Inventory

**[FACT]** Endpoint families (all under `/api/`):

| Method | Path (family) | Permission | Used by UI? |
|---|---|---|---|
| POST | `/auth/login/`, `/auth/logout/`, GET `/auth/me/`, `/health/` | public / authed | YES |
| GET/POST/PATCH/DELETE | `/academics/semesters/`, `/sections/`, `/subjects/`, `/assignments/` | AdminOrReadOnly | YES (live) |
| GET/POST | `/academics/timetable/` | AdminOrReadOnly | Reads YES (teacher/student), **writes NO** (admin uses mock lane) |
| GET/POST/DELETE | `/academics/holidays/` | AdminOrReadOnly | Reads YES, **writes NO** (holidayService mock) |
| GET/POST | `/teachers/`, `/teachers/reports/`, `/teachers/students/`, `/teachers/timetable/` | admin/teacher | YES |
| GET/POST/PATCH | `/students/`, `/students/me/`, `/students/me/sessions/` | admin/student | YES |
| GET/POST/PATCH | `/attendance/sessions/` (+ finalize), `/attendance/records/`, `/attendance/records/my/`, bulk, roll | teacher/admin | YES |
| POST/GET | `/attendance/qr-sessions/start/`, `/check_in/`, `/status/` | teacher/student | YES (QRScanner + QR-enter) |
| GET | `/reports/summary/` | IsAdminOrTeacher | **Partial** — teachers yes; **admin `ReportsView` no** |
| GET/PATCH/DELETE, POST | `/notifications/`, `/notifications/{id}/`, `/notifications/read-all/` | IsAuthenticated (own) | **NO — UI uses mock lane** |
| GET | `/common/health/` | public | YES (apiClient health probe) |

**[FACT]** Three backend API areas are **implemented but unused by the UI**: notifications (all), holiday writes, admin flavor of `/reports/summary/`. These are the cheapest wins for Phase 8 (§17).

---

## 6. Frontend Integration Audit

**[FACT]** Verified surface classification (grep of `src/features/**` for `store.` vs API usage):

**Fully live (apiClient / service — no direct `store`):**
`AcademicView`, `SectionsView`, `SemestersView`, `SubjectsView`, `AssignmentsView`, `AttendanceAdminView`, `TakeAttendanceView`, `CalendarHolidaysView` (reads via holidayService), `UserProfileView`, `StudentAttendanceHistoryView`, `StudentAttendanceView`, `StudentProfileView`, `StudentQRScannerView`, `StudentReportsView`, `StudentTimetableView`, `StudentsView`, `TeacherClassesView`, `TeacherReportsView`, `TeacherStudentsView`, `TeacherTimetableView`, `TeachersView`.

**Mixed (service + `store`):**
`SectionAllocationCSVView`, `NotificationsView`, `PromotionView`, `ReportsView`, `TimetableAdminView`.

**Pure mock/shell (`store` only):**
`SettingsView`, `AdminDashboard`.

**Pure auth:** `LoginView` (authService → apiClient).

**[FACT]** Service-layer reality (`src/services/`, verified directly this audit):
- **Fully live:** `authService`, `semesterService`, `sectionService`, `subjectService`, `assignmentService`, `teacherService`, `studentService`, `attendanceService`, `schedule`/timetable read path.
- **Hybrid:** `holidayService` (get/isHolidayDate → apiClient; declare/delete → `store`, `holidayService.ts:34-58`); `reportService` (`getScopedSummary` → apiClient, used by teacher surfaces only; `generateReport` → `store`, **zero callers = dead code**).
- **Fully mock:** `notificationService` (`notificationService.ts` — 46 lines, no apiClient, all 5 fns on `store`), `timetableService`/`timetableApi`, `promotionService`, `sectionAllocationService`, `academicRules`.
- **Mock-engine consumers:** 19 modules import `store` (16 feature views/components + notificationService + storage-internal use). `initialData.ts` is imported only by `storage.ts` (seed).
- **apiClient:** health-probe; falls back to `store` with toast when backend down; on 401 clears session → login.

**[FACT]** Frontend has **no automated test harness** (no vitest/jest spec files; only `tsc --noEmit` + `vite build`). Tracked as L2.

---

## 7. Mock / Fallback Audit

**[FACT]** What the mock lane is and is not:
- It **is** the offline demo path: `store` + `delay()` mirrors backend read/CRUD shapes so the app demos without the API.
- It **should not** be the data source for admin analytics while the backend runs. Today it is, for three admin surfaces (see §11 — the headline finding).
- Retention decision (Phase 2.5): **keep** the mock layer as the offline fallback; do **not** delete. All its remaining feature-level use is tracked as debt.

**[RECOMMENDATION]** Policy: feature views call services; `store` imports stay out of feature views; the only sanctioned `store` consumer is `apiClient`'s fallback (and `storage.ts` itself). Enforce in Phase 8 by systematically rerouting the §11 rows.

---

## 8. Attendance / QR Deep Audit

**[FACT]** Verified flows:

1. **Session creation:** teacher picks subject + sections + date; duplicate-session prevention (`find_duplicate_session`, services.py:332) and assignment/section-ownership checks; finalization immutability once closed (`finalize_attendance_session`, :310).
2. **Manual marking:** mark / bulk / roll (`roll_call_for_session`, :355).
3. **QR start (`views.py:485`):** teacher calls `start` → `start_qr_session` (services.py:15-39). Docstring confirms the re-target contract: re-starting on the **same** session rotates the token (fresh payload); re-targeting onto a **different** session **resets that session's per-student ledger** so stale check-in data can never leak across classrooms; the persistence is explicit ("rotate() persists only the token fields; persist the re-target and any ledger reset", lines 35-36) and is verified by tests.
4. **QR payload:** `build_qr_payload` (:46) → `session-key|status|timestamp|nonce|signature`; server `validate_qr`/`token_is_current` (:51/:298) constant-time compare.
5. **Check-in (`views.py:514` → `check_in_student`, :178):** verifies signature; confirms the attendance session is open and the student is enrolled in the target sections; **idempotent** (already-checked → duplicate, no double increment); ordered distinct `checked_in_at` insert.
6. **Stop/rotate:** `stop_qr_session` (:41) closes the session; new start rotates.

**[FACT]** Security characteristics: 15s TTL (settings line 161), HMAC, nonce, constant-time comparison, token rotation, ledger reset on re-target, one active QR per teacher, no replay acceptance. This is the **most heavily tested subsystem**: `QrSecurityApiTests` (23 tests) + `QRAttendanceApiAuthTests` (7) + `QRAttendanceTests` (4) + re-target persistence block.

**[RECOMMENDATION]** Add one explicit test: a re-targeted (new payload generated) token must **fail** for the old session even inside the 15s window — the ledger-reset/rotation contract is documented but a direct adversarial test makes the guarantee stick forever. *(Minor — existing tests already cover the chain indirectly.)*

---

## 9. Auth / Security Audit

**[FACT]** Backend (all test-verified):
- **Token lifecycle:** expiry from settings, reuse of unexpired token, revocation on logout, orphaned-parent cleanup on login, deactivated-account lockdown (`TokenLifecycleTests`, 8; `AccountsApiTests`, 6).
- **Throttles:** 5/min per account + 100/min IP burst; successful login resets account budget; malformed-username requests are not counted against an account (`LoginThrottleTests`, 5).
- **RBAC:** role-based 403, generic 401 for unknown credentials, 404 vs 400 semantics, real 405 (`ErrorSemanticsTests`, 5; `AuthFlowTests`, 4).
- **QR:** §8 above.

**[FACT]** Frontend/ops frictions (tracked, unchanged this phase):
- M1 — auth token in `sessionStorage` (XSS-exposed).
- M2 — dev fallback `SECRET_KEY` / `DEBUG` default true.
- K1 — `.env` contains live `DB_PASSWORD` (git-ignored; do not commit/log).

**[FUTURE WORK]** Move token to httpOnly cookie; remove dev defaults in production profile; rotate secrets. No security regression found elsewhere.

---

## 10. Test Coverage Audit

**[FACT]** Suite shape — **149 run = 136 unique methods + 13 inherited re-runs**:

| File | Test methods | Rediscovery |
|---|---|---|
| `apps/attendance/tests.py` | 67 | +13 inherited (parent re-run in `AttendanceWorkflowLifecycleTests`) |
| `apps/accounts/tests/test_auth.py` | 28 | — |
| `apps/accounts/tests/test_identity.py` | 8 | — |
| `apps/teachers/tests.py` | 16 | — |
| `apps/academics/tests.py` | 11 | — |
| `apps/reports/tests.py` | 6 | — |
| **Total** | **136** | **149 run** |

**Attendance (67 + 13):** `AttendanceMarkingTests` 4, `QRAttendanceTests` 4, `AttendanceApiAuthTests` 13 (auth + ownership), `AttendanceWorkflowLifecycleTests` 11 (+13 inherited → lifecycle, re-target ledger reset, finalization), `QRAttendanceApiAuthTests` 7, `QrSecurityApiTests` 23, `StudentMyAttendanceTests` 5.

**Coverage mapping:**
- **Strong:** auth/tokens/throttle/RBAC (44), attendance engine + QR security (80), teacher scoping (16), identity per-role (8).
- **Adequate:** academics core rules — semester consistency, single-module rule, timetable conflicts, assignment API (11).
- **Thin:** `reports` — 6 tests (visibility/scope only; no deep math/derivation tests of the aggregation service).
- **Absent:** `notifications` (backend has **zero** tests despite a full API); `sectionAllocation`/`promotion`/admin timetable (no backend code — N/A); **frontend** (no automated tests at all — L2).

**[RECOMMENDATION / FUTURE WORK]** (1) Notifications API tests (small, high value). (2) Reports aggregation unit tests (growth/depth). (3) Frontend vitest + RTL harness with a smoke/integration test of the live↔mock wiring — this is the single most impactful quality improvement available (§16 P3).

---

## 11. UI ↔ API Consistency Audit

**[FACT]** The three headline findings (verified against source this phase):

1. **Admin Dashboard shows seed/demo data.** `AdminDashboard.tsx:58-65` reads `store.getStudents()/getTeachers()/getSemesters()/getSections()/getSubjects()/getAttendanceSessions()/getTimetable()/getHolidays()` — every metric is local mock data even when the backend is healthy. Live `/api/reports/summary/` exists but is not used here.
2. **Admin Reports show seed/demo data.** `ReportsView.tsx:37-80` reads `store.getStudents()`, `store.getStudentAttendanceSummary(...)`, `store.getAttendanceSessions()`, etc.; CSV comes from the pure helper `reportService.exportAttendanceReportCSV` (:120). It **never calls** live `getScopedSummary`/`/api/reports/summary/`. Meanwhile `getScopedSummary` IS used by teacher surfaces (`TeacherClassesView:33`, `TeacherDashboard:61`). `reportService.generateReport` has **zero callers** (dead code).
3. **Notifications are fully mock.** `notificationService.ts` (46 lines) is 100% `store` — `NotificationsView.tsx:44-79` and `Header.tsx:42-68,+195` (badge + mark-all + announce) all run on localStorage. The backend `/api/notifications/` (own-read semantics + `read-all`) is implemented but **never called** by the UI.

**Other verified mismatches (smaller):**
- `holidayService.declareHoliday/deleteHoliday` → `store` (`holidayService.ts:34-58`), though `POST/DELETE /academics/holidays/` exists. Reads are live.
- Admin timetable **writes** (`timetableService`/`timetableApi`) → `store`; backend `/academics/timetable/` writes unused by UI (reads live for teacher/student).
- Section allocation CSV (`sectionAllocationService`) → `store`.
- Promotion (`promotionService` + eligibility computed from `store.getStudentAttendanceSummary`) → `store`; no backend promotion/archival.
- Settings — shell only, no backend API.

**[FACT]** Everything else is wired consistently live (§6). The "admin analytics are mock" trio is the material inconsistency because it **displays plausible-but-fake numbers** in an admin context.

---

## 12. Requirements Traceability

Source of truth: `docs/02-REQUIREMENTS.md` + target matrix `docs/AUDIT-MATRIX.md` (32 rows) + gap register `docs/23-IMPLEMENTATION-GAPS.md`.

**[FACT]** Cross-check vs this audit's findings:

| Requirement area | Docs : Audit | Status |
|---|---|---|
| Auth, RBAC, token lifecycle, throttling | COMPLETE : COMPLETE | MATCH |
| Academics CRUD + rules (semester, single-module, timetable conflicts, assignments) | COMPLETE : COMPLETE | MATCH |
| Attendance sessions (create/finalize/duplicate-prevention, manual/bulk/roll) | COMPLETE : COMPLETE | MATCH |
| QR attendance (start/rotate/check-in idempotent/ledger reset) | COMPLETE : COMPLETE | MATCH |
| Reports teacher/student (summary, roster, own records, 75% at-risk) | COMPLETE : COMPLETE | MATCH |
| Reports admin global | docs "live" (15:30) : **MOCK** | **MISMATCH (15:30)** |
| Dashboard metrics (admin) | implied live : **MOCK** | **MISMATCH** |
| Notifications read/broadcast | docs/17 :105 says apiClient : **MOCK** | **MISMATCH** |
| Holidays write | docs/17 :99 says CRUD apiClient : **read live, write MOCK** | **MISMATCH (partial)** |
| Admin timetable writes, section allocation, promotion, settings | MOCK : MOCK | MATCH (docs 18/22/23 already correct) |
| Mobile / offline / BSSID companion | NOT IMPLEMENTED (removed) : exited scope | MATCH |
| Web-only hygiene (no Android app) | done Phase 2.5 : verified | MATCH |

**[FACT]** All 32 AUDIT-MATRIX rows remain consistent with this audit (re-verified); the mismatches above are the four places where *narrative docs* over-claimed (see §13).

---

## 13. Documentation Discrepancies

| # | Where | Docs say | Code does | Severity |
|---|---|---|---|---|
| D1 | `docs/00-SYSTEM-STATUS.md` | "148 passing" | Suite runs **149** (136 + 13 inherited re-runs) | Low (count drift) |
| D2 | `docs/README.md` index (rows 10–19) | Lists `10 TIMETABLE-CALENDAR`, `11 REPORTS-ANALYTICS`, `12 DATABASE`, `13 API-REFERENCE` … `19 NEXT-PHASE-PLAN` | Actual files: `14-TIMETABLE-CALENDAR.md` … `24-NEXT-PHASE-PLAN.md`; `10–13` are archived removed-feature docs; `20/21` = SECURITY-AUDIT/TESTING | Low (index vs filenames) |
| D3 | `docs/17-API-REFERENCE.md:105` | "Notifications read — YES (own read only) — apiClient" | `notificationService.getNotifications()` is **mock** `store` | Medium (misleading) |
| D4 | `docs/17-API-REFERENCE.md:99` | "Holidays CRUD — YES — apiClient" | **Reads** live; **writes** (`declareHoliday`/`deleteHoliday`) go to `store` | Medium (partial) |
| D5 | `docs/15-REPORTS-ANALYTICS.md:30` | "`ReportsView` (admin): global summary using `/api/reports/summary/`" | `ReportsView` aggregates **`store`**; never calls `/reports/summary/` | Medium (misleading) |
| — | `docs/18-FRONTEND.md:37-53` | Correctly flags mock lanes (timetable, section allocation, promotion, notificationService read path) | — | OK (accurate) |

**[FUTURE WORK]** One doc-fix batch (with Phase 8): fix D1 count, renumber `docs/README.md` rows to real filenames, correct 17:99/105 and 15:30. Note `docs/18` is already accurate.

---

## 14. Known Issues (tracked — `docs/22-KNOWN-ISSUES.md`)

All 9 entries re-confirmed current this phase (no new drift):

- **K1** `.env` live `DB_PASSWORD` (security).
- **K2** Admin Timetable management localStorage-only.
- **K3** Section Allocation CSV localStorage-only.
- **K4** Promotion localStorage-only (no backend endpoint/migration/archival).
- **K5** Notification broadcast (admin) localStorage-only.
- **M1** Token in `sessionStorage` (XSS).
- **M2** Dev `SECRET_KEY` fallback / `DEBUG` default true.
- **L1** `SettingsView` shell (no backend settings API).
- **L2** No web-frontend automated tests.

---

## 15. New Issues Found in This Audit

| # | Issue | Type | Severity |
|---|---|---|---|
| N1 | **Admin Dashboard + admin ReportsView compute from `store` seed data** — admin sees demo numbers, not real data, even while the backend runs. The P1 reason to run Phase 8 first. | Functional (fake metrics) | **HIGH / P1**. *Refines, not duplicates, K2-K5.* |
| N2 | **Notifications read path (list/badge/read-all) is mock**, not just broadcast (K5). Backend `/api/notifications/` fully unused. | Functional | **P1** |
| N3 | **Holiday writes are mock** though backend exists — admin holiday CRUD is partially live (read) / mock (write). | Functional | **P2** |
| N4 | **`generateReport` is dead code** (0 callers); `getScopedSummary` (live) is unused by admin. | Code hygiene | **P2** |
| N5 | Runner reports 149 but only 136 unique methods (inherited re-run); doc counts (148/149) drift. | Process | **P3** |
| N6 | `docs/README.md` index numbering vs actual filenames; D1–D5 over-claims. | Docs | **P3** |
| N7 | Promotion + Section-allocation eligibility/stats computed from mock `store` attendance summaries (subset of K4/K3). | Functional | **P2 (folded into K3/K4)** |

---

## 16. Prioritized Roadmap (P0–P4)

- **P0 — none.** No unaddressed data-loss or critical-incident risk today (demo scope). If this ever goes multi-tenant: promote K1/M1/M2 to P0 first.
- **P1 — Analytics & Notifications live-wiring (Phase 8):**
  1. Admin analytics → live endpoints (see §17).
  2. Notifications → `/api/notifications/` (+ PATCH own read, `read-all`); keep broadcast as FUTURE (needs an announce endpoint).
  3. Holiday writes → `POST/DELETE /api/academics/holidays/`.
- **P2 — Admin operations backend:** Promotion API + semester archival; Section-allocation server endpoint; admin timetable writes to `/api/academics/timetable/`; Settings backend (or explicit removal).
- **P3 — Testing & docs:** frontend vitest+RTL harness; notifications backend tests; reports aggregation tests; doc-fix batch (§13).
- **P4 — Hardening:** token to httpOnly cookie; remove dev defaults, rotate secrets; observability; scale review.

---

## 17. Exact Implementation Order (Next Phase — Phase 8)

Data first, then UI, then cleanup — each step shippable independently, no cross-cutting changes:

1. **Backend (no schema change expected):** extend `/api/reports/summary/` (or add `/api/reports/admin-summary/`) to expose the admin metric set already computed — totals, by-section/by-subject, date trend, at-risk list; add `/api/notifications/` tests; confirm holiday endpoints under test.
2. **Frontend swaps (P1):**
   - `AdminDashboard` → new admin-summary endpoint; drop `store` reads.
   - `ReportsView` → live endpoint + CSV from live data; delete `reportService.generateReport` (N4).
   - `notificationService` → `apiClient` (`GET /notifications/`, `PATCH {id}`, `POST read-all`); Header badge via service.
   - `holidayService.declareHoliday/deleteHoliday` → `apiClient`.
3. **Fallback hygiene:** leave `store` only behind `apiClient`'s offline path; remove remaining direct `store` imports from feature views.
4. **Tests:** backend tests for new endpoint surface; first frontend test (smoke + one wiring test).
5. **Docs batch:** fix D1–D6 (§13) + update 22/23 to close K2/N1/N2/N3 rows as resolved-after-8; add P2/P3 rows.

---

## 18. Risks & Dependencies

- **[FACT]** Mock fallback masks outage for mock-lane features; until P1, "admin analytics" can silently show demo numbers (N1) — the top functional risk.
- **[FACT]** No frontend tests (L2) means the P1 rerouting can regress silently; mitigate by adding the harness in the same phase (order step 4).
- **[FACT]** Token in `sessionStorage` (M1) — acceptable for demo; must be fixed before any real deployment.
- **[FACT]** `.env` secret (K1) — keep ignored; rotate before sharing the repo; never print.
- **[FACT]** OneDrive sync + two lockfiles: `package-lock.json` is the active npm manager; `bun.lock` retained as UNCERTAIN (Phase 2.5 decision). Use npm for installs.
- **[FACT]** LSP "django.db"/tuple-enum.`.value` errors on `attendance/services.py` are venv false positives (tests pass) — not real.
- **[DEP]** Any password/SECRET rotation requires `.env` update + backend restart (scheduled task `aams-backend`); dem servers auto-run on boot.

---

## 19. Final Baseline Statement

**[FACT]** Repository is **not a git repo** → `git status` / `git diff` are **N/A**; the modified-set for this phase is therefore stated explicitly: **`docs/PHASE3_PRE_IMPLEMENTATION_AUDIT.md` is the only file created in this phase. No other file was modified, added, or deleted (code, tests, deps, migrations, config, or docs).** `docs/archive/` untouched.

**[FACT]** Validation (Step 15) — final read-only gate:
- `py manage.py test` → **149 passed** (136 unique + 13 inherited re-runs).
- `py manage.py makemigrations --check --dry-run` → **no changes**.
- `npm run lint` (`tsc --noEmit`) → **clean**.
- `npm run build` → **OK** (esbuild postinstall notice is informational, not a failure).
- Backend `/api/health/` → **200 (DB connected)**; Vite :3000 → **200**.
- All services still auto-run via scheduled tasks (`aams-backend`, `aams-vite`).

**[FACT]** Phase-3 audit steps: all 15 completed (1 doc-read; 2–4 backend/DB/API; 5 frontend; 6 QR; 7 auth/security; 8 tests; 9 UI/API consistency; 10–11 traceability + gap-doc; 12 discrepancies/priorities; 13 baseline untouched; 14 this report; 15 validation).

### Closing answers (as commissioned)

1. **Truly complete:** Auth/RBAC/tokens/throttling; academics CRUD + rules; attendance engine (manual+QR+roll+bulk+finalize+duplicates); QR security; teacher & student modules; reports for teacher/student; full backend API & tests.
2. **Partially complete:** Holidays (read live, **write mock**); Reports (teacher/student live, **admin mock**); Dashboard (**mock**); Notifications backend exists but **UI fully mock**; admin timetable (read live, **write mock**).
3. **Still mock / fallback:** AdminDashboard, admin ReportsView, Notifications (all), holiday writes, admin timetable writes, Section Allocation, Promotion, Settings, `reportService.generateReport` (dead), `timetableService/timetableApi`, `academicRules` local rules.
4. **Broken:** none found.
5. **Implement next (recommended):** Phase 8 — **Analytics & Notifications live-wiring** (P1: admin dashboard + admin reports → live endpoints; notifications → `/api/notifications/`; holiday writes), then P2 admin operations, then P3 frontend test harness + docs fix.
6. **Explicitly not to touch:** `src/data/initialData.ts`, `src/services/storage.ts` mock layer (retained as offline fallback only); `docs/archive/` (18 files); `.env` secrets; `bun.lock` (uncertain, keep); nothing else was removed in this phase.
7. **Validation results:** see §19 — 149 tests (136+13), clean migrations, clean lint (tsc), clean build, health 200, Vite 200. Baseline unchanged; this report is the sole artifact of the phase.