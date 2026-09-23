# PHASE L — Product Completeness & Business Workflow Audit

Product: **AAMS v2 (Academic Attendance Management System)** — web-only
Audit type: **Read-only / audit-only.** No code, model, migration, auth, QR,
camera, or UI changes were made. No commits were created. `git status` is clean.
Deliverable: this document only.

Audit date: 22 Sep 2026
Baseline HEAD: `8997549 chore: production harden AAMS v2`
Backend test baseline: **442 / 442 passed** (Phase K)
Frontend test baseline: **12 files / 115 passed** (Vitest)
Severity scale used in this report: `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`, `INFO`.
Dependency grouping: **A** (before a college demo), **B** (before production),
**C** (defer), **D** (documentation-only), **E** (deployment / operator-only).

---

## 1. Scope, Method & Hard Constraints

- **Scope in:** functional completeness of every product surface, business-rule
  consistency (docs ↔ UI ↔ backend), mock/placeholder/read-only surface audit,
  UX completeness, data consistency, end-to-end workflow tracing, test coverage,
  and documentation consistency.
- **Scope out (explicit):** no implementation, no refactor, no schema/migration
  work, no new endpoints/services, no security remediation (baseline security
  posture was itself audited in Phase K), no camera hardware validation
  (physical-device-only; the scanner is browser-verified against a mocked
  stream).
- **Method:** (1) documentation-first pass over all current `docs/` manuals;
  (2) code-product map produced with two parallel exploration agents and
  re-verified directly by line-level inspection; (3) pattern sweeps (grep) for
  placeholders, TODOs, mock stores, localStorage, inert controls, and hardcoded
  values; (4) per-file test inventory; (5) cross-check of every business-policy
  claim found in docs/UI against backend source. Browser smoke tests from Phase K
  (Admin / Teacher / Student) were reused as workflow evidence; no new test
  execution was performed during this audit-only session (baseline is carried
  from commit `8997549`).

Self-corrections recorded (`Phase L` re-verified two exploration-agent claims):

- A subagent claimed the backend `DayOfWeek` includes Saturday. **Incorrect.**
  Backend `apps/academics/models.py:40-46` is `Sunday..Friday` (6 days), which
  matches the frontend `DAYS` constant and the import `DAY_ALIASES`. Saturday is
  uniformly unsupported across the stack, and `docs/14-TIMETABLE-CALENDAR.md`
  explicitly accepts this as a product decision.
- A subagent claimed `ForcedPasswordChangeView` was a local mock. **Incorrect.**
  It calls `AuthContext.changePassword` → `authService` →
  `POST /api/auth/password/change/`, which matches the backend accounts route; the
  flow is fully server-backed.

---

## 2. Baseline & Environment

| Item | Value |
|---|---|
| HEAD | `8997549` (Phase K production-hardening commit; not pushed) |
| Backend | Django + DRF + PostgreSQL; 10 apps; DRF defaults: `PageNumberPagination` (`PAGE_SIZE=100`), `ExpiringTokenAuthentication` + `SessionAuthentication`, `IsAuthenticated` default, custom `aams_exception_handler` |
| Frontend | React 18 + Vite + TypeScript + Tailwind; role-scoped routes via `VIEW_ROLE_PERMISSIONS` (`src/App.tsx:52-88`) |
| Backend tests | 22 files; 442 passed (Phase K) |
| Frontend tests | 12 files; 115 passed (Phase K) |
| git status | clean (no tracked changes at audit end) |
| Import pipeline | `imports` + `academics/timetable_import.py`, `accounts/provisioning.py` (student/teacher → login account creation) |
| Auth tokens | `aams_auth_token` in `sessionStorage` only; legacy keys cleaned on logout (`src/services/apiClient.ts:27-43`) |

---

## 3. Functional Product Map (implemented · verified)

| Module | Backend | Frontend | Status |
|---|---|---|---|
| Auth / password (login, logout, me, forced password change) | accounts | `LoginView`, `ForcedPasswordChangeView` | ✅ Implemented, server-backed |
| Accounts provisioning from imports (eligible ACTIVE only) | `provisioning.py` + tests | — | ✅ Implemented |
| Students (CRUD, enrollments, status) | students app | `StudentsView` | ✅ Implemented (see TC-1 for test gap) |
| Teachers (CRUD, profiles) | teachers app + tests | `TeachersView` | ✅ Implemented |
| Academic structure (semesters, subjects, sections, holidays, section allocation) | academics app + tests | `SemestersView`, `SubjectsView`, `SectionsView`, `sectionAllocationService` | ✅ Implemented |
| Timetable (slots, live CRUD, conflict engine, import pipeline, weekly grid) | academics app + tests + concurrency tests | `TimetableAdminView`, `AddTimetableModal`, `ExportTimetableModal`, `TimetableImportWizard`, `ImportHistoryModal` | ✅ Implemented (see TT-1, TT-2) |
| Attendance (marking, finalization, session lifecycle, daily window, live QR) | attendance app + tests | `TakeAttendanceView`, `StudentQRScannerView`(+test) | ✅ Implemented |
| Student self-service (own records, summary) | attendance `mysummary`/`my/records` | `StudentMyRecordsView` etc. | ✅ Implemented |
| Teacher self-service (classes, students, attendance) | teacher-scoped endpoints | `TeacherClassesView`, `TeacherStudentsView` | ✅ Implemented |
| Reports (summary, by-subject, 75% at-risk, CSV export) | reports app + tests | `ReportsView` | ✅ Implemented (see RP-1) |
| Timesheets (entry, approval, rejection) | timesheet app + tests | timesheet views | ✅ Implemented |
| Notifications (in-app; broadcast removed in K5) | notifications app + tests | global/in-app | ✅ Implemented; broadcast intentionally removed |
| Calendar / holidays | academics holidays API | `CalendarHolidaysView` | ✅ Implemented, server-backed |
| Settings (policy display) | — (no API) | `SettingsView` | ⚠️ Read-only & honest, but discloses two un-implemented policies (BR-1, BR-2) |
| Promotion (eligibility → section promotion) | **no execution endpoint** | `PromotionView` (Execute disabled) | ⚠️ Deliberate, documented gap; honest UI |
| Defaulter notices | **no endpoint** | `ReportsView` "Notify" → toast | ⚠️ Honest "Notice Dispatch Unavailable" (RP-1) |

No mocked data stores remain: the only `localStorage`/`sessionStorage` usage is
the session token plus a legacy-cleanup in `ErrorBoundary.tsx:66`. Placeholder /
TODO / "future work" sweep over `src/` found only benign input `placeholder`
attributes, temporary-password copy, and maintenance comments (57 matches, zero
actionable).

---

## 4. Business Rule & Policy Consistency (cross-checked docs ↔ UI ↔ backend)

Queries performed: policy strings (`0.5x`, `0.5`, `24h`, `hours=24`, `credit`,
`75%`, `threshold`, `timedelta(hours=24)`) across `docs/`, `src/`, `backend/`.

### BR-1 — HIGH · "0.5x late credit factor" is displayed as fact but never implemented
- **Claimed in:** `SettingsView.tsx:62-69` ("Late arrivals earn half a session
  credit toward attendance."), `docs/18-FRONTEND.md:82`, `docs/23-IMPLEMENTATION-GAPS.md:13`,
  `docs/PHASE_G_SOURCE_OF_TRUTH_REPORT.md:51`.
- **Actual behavior:** `backend/apps/attendance/services.py:387,420-421` sets
  `STATUS_PRESENT = {present, late}`; `summarize_student_attendance` counts LATE
  as fully present for percentage and eligibility, and keeps a separate
  `late_total`. No `0.5` factor exists anywhere in backend code (subject
  `credits` is unrelated). Examination eligibility (`services.py:491`,
  `>= 75.0`) therefore treats every late arrival as a full session.
- **Why it matters:** the product's own Settings screen and three documents
  disclose a credit model the server does not apply. A stakeholder computing
  eligibility "as documented" (half credit per late arrival) will disagree with
  the system on every student with lateness.
- **Resolution (not performed):** implement the factor in the aggregation, or
  correct the UI/docs to describe the actual policy (late = present for percentage,
  tracked separately). Document choice first.

### BR-2 — MEDIUM · "24h faculty edit window" claimed but no such gate exists
- **Claimed in:** `SettingsView.tsx:71-78` ("Allowed duration for attendance
  corrections by faculty."), `docs/18-FRONTEND.md:82`, `docs/23-IMPLEMENTATION-GAPS.md:13`.
- **Actual behavior:** no `timedelta(hours=24)` / 24-hour logic exists in backend.
  The real edit gate is **finalization immutability** (`submitted_at` on the
  session) — a finalized session's records are locked; no time-window constraint
  exists. The disclosed policy is stricter than reality in one dimension and
  non-existent in another.
- **Resolution (not performed):** either implement the window or state the real
  rule (finalization locks). 75% itself **is** honestly enforced
  (`services.py:491`; auto-flagging verified in reports tests) — that part checks out.

### BR-3 — INFO · Other policy claims are accurate
- 75% minimum-attendance for exam eligibility: **implemented** (reports +
  attendance `examEligibility`), and described as "server-enforced" honestly in
  `SettingsView.tsx:57-60`.
- Section/timetable conflict engine (teacher, room, section overlap):
  **implemented** end-to-end (`academics/services.py:133-182`, serializers, import
  planning + concurrency tests).
- Import never auto-creates master records; teacher matching is deterministic and
  refuses ambiguity: **implemented** and documented (`timetable_import.py:1-37,498-620`).

---

## 5. Mock / Placeholder / Read-Only Surface Sweep

Result: **clean.** No fake-success paths, no mock stores, no dead local-only
saves found in `src/` in this audit. Verified specifically:

| Surface | Verdict |
|---|---|
| `SettingsView` | Read-only card; explicit "nothing editable (no settings API)" box. Honest. No fake save/export/import/reset. ⚠️ Policy copy issue = BR-1/BR-2 |
| `PromotionView` step 3 | Execute disabled with explanatory banner; no backend endpoint — documented deliberate gap, honest |
| `ReportsView` "Notify defaulters" | Shows "Notice Dispatch Unavailable" toast (RP-1) — honest, not fake |
| `ExportTimetableModal` | Toggle is real but both choices emit CSV (EX-1) |
| `GlobalSearchModal` | In-memory client filter over loaded data — acceptable UX, server-backed data source |
| `ForcedPasswordChangeView` | Server-backed (self-correction above) |
| `CalendarHolidaysView` | Server CRUD via holiday API (server-backed) |

---

## 6. Timetable Display and Filter Findings

### TT-1 — MEDIUM · Weekly grid silently drops slots at non-canonical start times
- The weekly matrix places a slot only when `slot.startTime === start` where
  `start` iterates the six hard-coded periods in
  `src/features/timetable/constants.ts` (`TIME_SLOTS`:
  09:00, 10:00, 11:15, 12:15, 13:45, 14:45) — evidence `TimetableAdminView.tsx:503`.
- Both creation paths admit arbitrary times: the modal uses free-form
  `<input type="time">` (`AddTimetableModal.tsx:333-344`), and the importer
  parses any 24-hour time with zero grid-normalization
  (`timetable_import.py:298-344,841-872`).
- Backend accepts any valid time (`TimeField`, only `end > start`). A slot at,
  e.g., 10:30 or 15:00 is fully valid and conflict-checked, appears in the list
  views and teacher/section/semester select rendering, but **vanishes from the
  weekly grid without warning**.
- Seed data happens to use canonical times, so the default demo is unaffected,
  but imported "real" schedules frequently do not.

### TT-2 — LOW · "Academic Year" filter is inert
- `TimetableAdminView.tsx:333-341` renders an Academic Year select with hardcoded
  "2026-2027" / "2025-2026" options feeding `filterAcademicYear`, but
  `filteredSlots` (lines 127-167) never references it. Changing the control has
  **no effect** on the grid or lists. Options are also hardcoded rather than
  derived from the semesters data source.

---

## 7. Role Isolation & Security Posture

Carried from Phase K (defense-in-depth probes, 403 checks, plus route guards):

- All 7 admin routes, teacher routes, and student routes gated by
  `VIEW_ROLE_PERMISSIONS` at `src/App.tsx:52-88`; unauthorized access paths
  return 403 (worker probes in Phase K).
- Teacher API surface is scoped to the authenticated teacher (own classes,
  students, attendance submissions); student self-service endpoints filter to
  the authenticated student (`/attendance/records/my/`). IAM, token expiry, and
  CSRF were part of the Phase K hardening and its 442-test suite.
- Import/provisioning link only eligible ACTIVE records to login accounts
  (`accounts/provisioning.py:73-133` + `test_provisioning.py`).
- No new identity/isolation defect found during Phase L; `ReadOnly` permission
  class in the backend is unused (dead code → INFO).

---

## 8. UX Completeness (loading / empty / error / success / retry)

Per surface verified in Phase K browser smoke and code walk:

- **Admin & teacher CRUD and timetable** screens show loading skeletons/spinners,
  empty states, inline server-conflict errors (timetable save failures keep the
  modal open and surface the conflict message), and success toasts with list
  refresh — complete.
- **Attendance**: dedicated session/date window UI, search, present/late/absent
  toggles, notes, finalize with warning, toast on success; server error paths
  surfaced.
- **Student QR**: camera lifecycle states (no camera / scanning / success /
  already marked), manual code entry fallback, timestamps — tested
  (`StudentQRScannerView.test.tsx`).
- **Imports**: full preview table with per-row severity, unresolved-value
  buckets, warning/error stripes, confirm gate — well covered.
- No missing loading/empty/error states found that would strand a user; the only
  "dead-feedback" control is the year filter (TT-2) and the enable-able defaulter
  notice button (RP-1).

---

## 9. Data Consistency

- All list mutations re-fetch from the API after create/update/delete
  (e.g. `TimetableAdminView.loadData` after save/delete; resource views do the
  same). No stale client-side caches or optimistic-write discrepancies found.
- Token lifecycle is consistent (set on login, cleared on logout/expiry with
  legacy-key cleanup). No localStorage mock store remains.
- Timetable `section_id` (primary FK) + `sections` M2M are kept consistent by the
  serializer/import commit for combined slots; conflict checks use the full
  participating-section set (`getParticipatingSectionIds`).
- No cross-module sync gaps observed.

---

## 10. End-to-End Workflow Classifications

Five user journeys traced through code and (Phase K) browser smoke:

| # | Workflow | Health |
|---|---|---|
| A | **Admin master-data:** import student/teacher workbooks → preview/severity → confirm → accounts auto-provisioned for eligible ACTIVE records | ✅ COMPLETE (12 import test files; provisioning tests) |
| B | **Admin timetable:** upload institutional Excel → header mapping / row validation / conflict detection / combined-section expansion → preview → transactional confirm → weekly grid | ✅ COMPLETE with TT-1/TT-2 |
| C | **Teacher attendance:** open session → mark present/late/absent w/ search → notes → submit/finalize → per-student correction until finalized → confirm roll in own reports | ✅ COMPLETE |
| D | **Reports & intervention:** summary/by-subject reports → 75% at-risk flag → CSV export → "notify defaulter" | ✅ COMPLETE except notice dispatch capability (RP-1) |
| E | **Student self-service:** QR/live session or manual code → attendance recorded w/ timestamp → own records + exam-eligibility summary | ✅ COMPLETE |

No workflow is blocked. Promotion **execution** (separate from W-A) remains a
documented gap with an honest UI (see grouping).

---

## 11. Documentation Consistency

| Doc | Status |
|---|---|
| `00-SYSTEM-STATUS.md` | ⚠️ **STALE (LOW):** explicitly regenerated "post Phase H"; cites 409 backend / 75 Vitest baseline and older roadmap claims — now 442 / 115. Needs refresh (OS-1) |
| `03/08/09/15/14` module manuals | ⚠️ 18/23/PHASE_G + Settings claims 0.5x + 24h as server-enforced (BR-1/BR-2). `14` correctly documents the Sun–Fri boundary |
| `22-KNOWN-ISSUES`, `23-IMPLEMENTATION-GAPS`, `24-NEXT-PHASE-PLAN` | Current and honest; promotion/settings gaps recorded |
| `backend/README.md` | ⚠️ Outdated against current run commands/deploy (LOW) |
| `PHASE_*` / `archive/` | Historical records; not requirements. `AUDIT-MATRIX.md` is a partial status table (largely accurate on implemented rows; refresh advisable) |

No doc contradicts backend behavior **except** the policy claims bundled in
BR-1/BR-2 and the stale baseline numbers in `00`.

---

## 12. Test Coverage Gap Analysis

Inventory: **backend 22 test files** (academics ×2 incl. concurrency, teachers,
accounts ×3, notifications, attendance, reports, timesheet, imports ×12);
**frontend 12 test files** (services + imports presentation + scanner view).

| Area | Coverage | Gap |
|---|---|---|
| Backend `students` app (CRUD, enrollments, section-allocation API) | **none** | 🔴 **TC-1 — HIGH:** entire student-data API surface untested at backend level (section-allocation logic has frontend-only tests) |
| Backend core apps (academics, attendance, reports, imports, accounts) | strong | ✅ acceptable |
| Concurrency behaviors | only 2 tests (`attendance/tests.py:419`, `academics/tests_timetable_concurrency.py:112`) | 🟡 edge coverage thin; noted, not blocking |
| Frontend component tests | only `StudentQRScannerView.test.tsx` | 🟡 **TC-2 — MEDIUM:** core workflow views (attendance taking, timetable admin, reports, CRUD) have no component tests; pure-function/service coverage is good |
| E2E UI tests | none (Playwright browser smoke manual) | 🟡 operator/docs level |

---

## 13. Final Gap Matrix (severity + dependency group)

| ID | Finding | Severity | Group | Evidence |
|---|---|---|---|---|
| BR-1 | Late-credit "0.5x" disclosed in UI + 3 docs but never implemented; LATE = full present | HIGH | B (correct docs OR implement; decide pre-prod) | `SettingsView.tsx:62-69`; `services.py:387,420-421,491`; grep backend for `0.5` → none |
| TC-1 | `students` app has zero backend tests (CRUD, enrollments, section-allocation API) | HIGH | B | glob backend tests → none under `apps/students/` |
| BR-2 | "24h faculty edit window" disclosed but not implemented; real gate = finalization lock | MEDIUM | B | `SettingsView.tsx:71-78`; grep backend `timedelta(hours=24)` → none |
| TT-1 | Weekly grid silently drops slots at non-canonical start times | MEDIUM | B (A if the demo imports a real off-grid schedule) | `TimetableAdminView.tsx:503`; `constants.ts`; `AddTimetableModal.tsx:333-344`; `timetable_import.py:298-344` |
| TC-2 | Frontend component coverage limited to scanner view | MEDIUM | B | glob frontend tests → only `StudentQRScannerView.test.tsx` |
| TT-2 | Academic-Year filter is inert; year options hardcoded | LOW | B | `TimetableAdminView.tsx:127-167,333-341` |
| EX-1 | Export modal "xlsx" choice always downloads CSV | LOW | C | `ExportTimetableModal.tsx:23,29-36,71-98` |
| RP-1 | "Notify defaulters" always yields "Notice Dispatch Unavailable" (no endpoint) | LOW | C (disable button or build endpoint for prod) | `ReportsView.tsx:150-152` |
| OS-1 | `00-SYSTEM-STATUS` cites stale 409/75 baseline + outdated roadmap text | LOW | D | `docs/00-SYSTEM-STATUS.md` header |
| DC-1 | `backend/README.md` stale; `AUDIT-MATRIX` refresh advisable; docs/PHASE_G + 18 + 23 policy claims need correction if BR-1/BR-2 are resolved as "documented only" | LOW | D | `backend/README.md`; `18-FRONTEND.md:82`; `23-IMPLEMENTATION-GAPS.md:13` |
| READ-ONLY | Settings API absent; SettingsView intentionally read-only (honest) | INFO | C | `SettingsView.tsx:1-38` |
| SAT-1 | Saturday unsupported across whole stack (Sun–Fri week) — deliberate, documented | INFO | E (only a requirements change triggers work) | `models.py:40-46`; `DAYS`; `DAY_ALIASES`; `docs/14:147-151,467` |
| DEAD-CODE | Backend `ReadOnly` permission class unused | INFO | C | grep permission usage |
| PROMOTION | Promotion execution needs a backend endpoint; UI Execute disabled & honest | INFO | C (feature) | `PromotionView` banner; `23-IMPLEMENTATION-GAPS` |

**BLOCKERS: none.** No HIGH issue prevents the Phase K baseline from standing;
the two HIGH items are policy-honesty (BR-1) and an untested-but-implemented API
surface (TC-1).

---

## 14. Final Report

**Items 1–12**

1. **Scope / result:** Pure audit; zero implementation changes. `git status`
   clean, HEAD `8997549`, no commit. Baseline backend **442/442**, frontend
   **115/115** carried from Phase K.
2. **Product is functionally complete web-wide:** 21 implemented modules verified
   server-backed; no mocked stores; placeholder sweep clean.
3. **No BLOCKERs; zero regressions detected.**
4. **Two HIGH:** BR-1 (unimplemented "0.5x late credit" policy disclosed in UI +
   docs — misleads exam-eligibility reasoning) and TC-1 (no backend tests for the
   `students` app surface).
5. **Three MEDIUM:** BR-2 (unimplemented "24h edit window"; real gate is
   finalization), TT-1 (non-canonical-time slots silently missing from weekly
   grid), TC-2 (thin frontend component coverage).
6. **Four LOW:** TT-2 (inert Academic-Year filter), EX-1 (xlsx export option
   cosmetic → CSV), RP-1 (defaulter notice unavailable), OS-1/DC-1 (stale docs).
7. **Honest-by-design surfaces:** SettingsView read-only, Promotion Execute
   disabled w/ banner, defaulter notice "Unavailable" toast — none fake-save.
8. **Role isolation & auth:** verified in Phase K (route guards + 403 probes +
   442-test suite); self-scoped teacher/student endpoints; no new defects.
9. **E2E workflows A–E (master-data, timetable, attendance, reports, student
   self-service):** all COMPLETE; none blocked.
10. **Business-rule check:** 75% threshold and conflict engine genuinely enforced
    server-side; "0.5x" + "24h" claims are not (BR-1/BR-2) — the single largest
    consistency defect in the product.
11. **Data consistency:** mutation-refetch pattern uniform; no stale caches; token
    lifecycle sound.
12. **Recommended action plan (not executed):** pre-demo — decide/document the
    late-credit & edit-window policy truth (BR-1/BR-2) and, if a real on-grid
    timetable demo is planned, address TT-1; pre-prod — add `students` app
    backend tests (TC-1), enforce/constrain timetable times (TT-1), fix the year
    filter (TT-2); later — disable/mark defaulter notice (RP-1), align export
    modal choices (EX-1), refresh `00-SYSTEM-STATUS` + `backend/README`
    (OS-1/DC-1). Saturday (SAT-1) requires a requirements change only.

---

## 15. Appendix — Evidence Inventory

- Backend core: `apps/attendance/services.py:380-441,491` (LATE-as-present;
  75% gate), `apps/academics/models.py:40-46` (Sun–Fri), `apps/academics/services.py:133-182`
  (conflict engine), `apps/academics/timetable_import.py` (import rules: never
  auto-create, deterministic teacher match, transactional confirm, idempotency),
  `apps/accounts/provisioning.py:73-133`, `apps/reports/views.py`.
- Frontend: `src/App.tsx:52-88` (role map), `src/services/apiClient.ts:27-43`
  (token life), `src/features/timetable/*` (constants, admin view, modal, export,
  import wizard), `src/features/settings/SettingsView.tsx`, `src/features/reports/ReportsView.tsx`,
  `src/features/auth/ForcedPasswordChangeView.tsx` (+ authService/AuthContext).
- Tests: backend 22 files (list in §12), frontend 12 files; concurrency: 2.
- Greps: `localStorage|sessionStorage` (2 hits, benign), `TODO|FIXME|placeholder|mock|fake|hardcod`
  (57 hits, all benign), `0.5|24h|timedelta(hours=24)` (backend: none), day
  definitions across stack (uniform Sun–Fri).
- Docs read: README, docs/README, 00, 03, 08, 09, 14, 15, 18, 21, 22, 23, 24,
  AUDIT-MATRIX, PHASE_G, archive cross-refs.