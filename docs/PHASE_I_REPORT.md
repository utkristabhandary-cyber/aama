# PHASE I REPORT — Teacher Timesheet (Work/Duty-Hours Log)

Status: **COMPLETE** — 19 September 2026

Scope: introduce a real, database-backed **teacher timesheet** — a per-day
work/duty-hours log with an admin approval workflow, summary ledger and admin
`.xlsx` export. The feature references existing academic/identity entities only;
it creates no parallel attendance or timetable system. Full design + API
contract: `docs/PHASE1_TIMESHEET_DESIGN.md`.

---

## 1. Timesheet definition

AAMS documents no institutional "timesheet" definition, so the ambiguity was
resolved to the **minimum architecture-justified interpretation**: a teacher's
**self-reported, server-validated per-day work/duty-hours log** (`class` hours +
`duty`/`other` non-teaching work), reviewed by admins. NOT payroll/clock-in, NOT
a parallel attendance or timetable system. Rejected candidate meanings:
teaching-session records (duplicates the timetable) and attendance time
(duplicates the attendance engine) — both already single-source-of-truth
domains.

## 2. Business rules discovered

- No existing leaves/HR ledger to integrate with; the only teacher-side time
  record is attendance sessions, which are orthogonal.
- Existing conventions reused as-is: DRF token auth, DRF pagination, `Teacher`
  identity via the authenticated user, `Holiday` model, Phase H XLSX
  architecture.
- No institutional policy existed on holiday attendance, so holidays are
  **informational only** (surfaced, not blocking) — the least-inventive policy.

## 3. Ambiguities found

- Meaning of "timesheet" — resolved to work/duty hours (§1).
- Holiday behavior — resolved to informational (documented, not invented).
- Approval/state workflow absent from requirements — resolved to the minimal
  `draft → submitted → confirmed | rejected` ledger workflow (justified by the
  admin-review/export business value; no extra statuses invented).

## 4. Final database model

`apps/timesheet/models.py::TimesheetEntry` (migration `0001_initial`, applied):

- `teacher` FK → `teachers.Teacher` (CASCADE), `related_name="timesheet_entries"`
- `entry_date` DateField · `type` `class|duty|other` · `start_time`/`end_time`
  TimeField · `note` Char(500, blank)
- `subject` FK → `academics.Subject` (PROTECT, blank/null) · `sections` M2M →
  `academics.Section` (blank) · `semester` FK → `academics.Semester` (PROTECT,
  blank/null; derived from subject server-side)
- `status` `draft|submitted|confirmed|rejected` · `rejection_reason`
  Char(500, blank) · `created_by` FK → AUTH_USER (SET_NULL) ·
  `created_at`/`updated_at`
- `CheckConstraint check_timesheet_end_after_start` (`end_time > start_time`);
  `Meta.ordering = ["-entry_date", "start_time"]`
- No stored calculated value (`duration_minutes` is a computed property);
  indexes deferred (demo-scale filter cost doesn't justify them — see §26).

## 5. API endpoints

Base `/api/timesheet/` (config/urls.py). All under DRF token auth + pagination:

| Method | Path | Roles |
|---|---|---|
| GET/POST | `/api/timesheet/entries/` | admin, teacher |
| GET/PUT/PATCH/DELETE | `/api/timesheet/entries/{pk}/` | admin, teacher |
| POST | `/api/timesheet/entries/{pk}/submit/` / `/recall/` | admin, teacher |
| POST | `/api/timesheet/entries/{pk}/confirm/` / `/reject/` | **admin only** |
| GET | `/api/timesheet/summary/` | admin, teacher |
| GET | `/api/timesheet/export/` | **admin only** |

Filters: `type`, `status`, `semester`, `teacher` (admin), `date_from`,
`date_to`. Summary + export = CONFIRMED entries only.

## 6. Role / permission matrix

| Capability | Teacher | Admin | Student |
|---|---|---|---|
| List/detail (own / all) | own | all | 403 |
| Create (self / any) | self | any | 403 |
| Edit DRAFT/REJECTED | own | any non-confirmed | 403 |
| Edit SUBMITTED | 403 (recall first) | yes | 403 |
| Edit CONFIRMED | 403 | 403 | 403 |
| Delete non-confirmed | own | any | 403 |
| Submit / recall | own | any | 403 |
| Confirm / reject | 403 | yes | 403 |
| Summary | own | all | 403 |
| Export | 403 | yes | 403 |

## 7. Relationship to timetable

Independent: no `TimetableSlot` read/write/requirement. CLASS entries reference
authoritative `Subject`/`Section`/`Semester`; the semester is derived, never
client-chosen. No second timetable.

## 8. Relationship to attendance

Independent: neither derived from nor feeds the attendance engine; no
attendance calculation duplicated. Timesheet duration = wall-clock
`end - start`, computed server-side.

## 9. Holiday behavior

Informational only. Entries on holidays allowed; `is_holiday`/`holiday_title`
surfaced in the API and as a chip in the UI. Reuses existing `academics.Holiday`
via `apps/timesheet/services.py::holiday_on`.

## 10. Duplicate / idempotency behavior

Server-side overlap rule: same teacher, same day, non-rejected entries may not
overlap (`start < other.end and end > other.start`) → deterministic 400.
Touching ranges (`end == other.start`) legal. Rejected entries never block
re-logging. No accidental duplicate rows possible.

## 11. Edit / correction rules

Non-confirmed only. Owner edits DRAFT/REJECTED (rejected → resets to DRAFT and
clears the reason); owner must Recall SUBMITTED before editing. Admin edits any
non-confirmed. CONFIRMED immutable and undeletable (403, no retroactive
correction of approved hours — documented choice).

## 12. Frontend functionality

- **Teacher — "My Timesheet"** (`src/features/timesheet/TimesheetView.tsx`):
  CONFIRMED-only stat cards, filters, table with role-aware actions
  (Edit/Submit/Delete, Recall, Confirm/Reject for admin); holiday chip; honest
  empty/error states; toasts via existing ToastContext.
- **Log/Edit modal** (`TimesheetEntryModal.tsx`): date/type/start/end + subject
  + section checkboxes (class) or none (duty/other); client validation mirrors
  server; server validation errors shown inline.
- **Admin — "Teacher Timesheet"** (Operations nav): faculty filter, "Hours by
  Faculty" panel, Reject modal (`RejectEntryModal.tsx`, mandatory reason),
  "Export .xlsx". No redesign (Phase J scope).

## 13. Export functionality

`GET /api/timesheet/export/` (admin only, CONFIRMED only) →
`aams_timesheet_export.xlsx` via the Phase H server-XLSX architecture
(openpyxl + `saveDownload`). Headers: Teacher ID, Teacher Name, Date, Type,
Subject Code, Subject Name, Sections, Semester, Start Time, End Time, Duration
(min), Note.

## 14. Security / IDOR findings

Identity always server-derived (`request.user.teacher_profile`), never from
URL/body; teacher detail/lists re-scoped so cross-teacher access = **404**, and
mutating actions are additionally 403-guarded. Student requests → 403 on every
surface. No leak of other teachers' entries or reasons via list/detail.

## 15. Files changed

- **Backend**: `apps/timesheet/{__init__,apps,models,services,serializers,
  views,urls,admin,tests}.py`, `apps/timesheet/migrations/0001_initial.py`,
  `config/urls.py` (`/api/timesheet/`), `config/settings/base.py`
  (INSTALLED_APPS).
- **Frontend**: `src/features/timesheet/{TimesheetView,TimesheetEntryModal,
  RejectEntryModal}.tsx`, `src/features/timesheet/timesheetPresentation.ts`
  (+ tests), `src/services/timesheetService.ts` (+ tests), `src/types/api.ts`,
  `src/App.tsx`, `src/components/layout/Sidebar.tsx`.
- **Docs**: `docs/PHASE1_TIMESHEET_DESIGN.md` (new, contract),
  `docs/PHASE_I_REPORT.md` (this file), `docs/00-SYSTEM-STATUS.md`.

## 16. Tests added

- Backend `apps/timesheet/tests.py`: **30 tests** — model constraint, valid
  create, invalid dates/times, duration, duplicate/overlap (adjacent /
  overlapping / rejected-doesn't-block), teacher & admin authz, student denial,
  IDOR (retrieve/edit/delete/submit/recall of another teacher), status machine,
  class subject/section rules, holiday surfacing, filters, errors, summary,
  export.
- Frontend: **27 new Vitest tests** (`timesheetService` 17 + feature/
  presentation 10) → total **102** across 11 files.

## 17-23. Gate results (all green, 19 Sep 2026)

| Gate | Result |
|---|---|
| Backend `manage.py test` | **439 pass** (OK, 0 failures) |
| Frontend Vitest | **11 files / 102 pass** |
| `npm run lint` (tsc --noEmit) | clean |
| `npm run build` (vite) | built in 3.82s, clean |
| `makemigrations --check` | No changes detected |
| Browser E2E | verified (below) |

### Browser E2E (live stack)

Teacher `tch-3` (Dr. R. Kumar) — My Timesheet: logged CLASS + DUTY entries,
submitted both (Recall actions present). Admin `admin` — Teacher Timesheet:
confirmed duty; rejected class with reason; stats + "Hours by Faculty" correct.
Teacher: saw the rejection reason inline, edited the rejected entry (modal
prefilled; end time adjusted 10:30 → 10:15; duration recomputed 1h30m → 1h15m),
re-submitted. Admin: confirmed class → 2 confirmed / 2h45m; exported
`aams_timesheet_export.xlsx` (verified via openpyxl: correct sheet/headers + the
2 confirmed rows); DB confirmed 2 rows with expected fields. Student role → 403
on the API. Refresh shows no fabricated data; empty and error states render
honestly.

## 24. Documentation updated

`docs/PHASE1_TIMESHEET_DESIGN.md` (new; final contract — definition, domain
model, timetable/attendance/holiday relationships, date/time + duplicate +
edit/correction rules, state machine, DB model, API contract, permissions
matrix, source-of-truth behavior, frontend surface), `docs/PHASE_I_REPORT.md`
(this file), `docs/00-SYSTEM-STATUS.md`.

## 25. Git

No Git repository exists in this workspace; per instructions it was **not**
initialized, so no commit hash exists.

## 26. Deliberately deferred

- Index on `(teacher, entry_date)` — no justified query cost at current scale;
  revisit if the ledger grows or filtering patterns change.
- Retroactive correction of CONFIRMED hours (a future "void + re-issue" flow
  needs an institutional decision).
- Overnight/multi-day entries; leave/HR integration; payroll mappings.
- Deep analytics beyond the summary ledger.
- Visual redesign (explicitly Phase J scope).

---

## Regression catches during E2E / verification

| # | Finding | Resolution |
|---|---------|-----------|
| 1 | Stale backend instance (started before timesheet wiring, `--noreload`) served 404 on `/api/timesheet/entries/` | Killed it (PID 15872) and started a fresh `runserver`; the feature's DB migration was verified applied `[X]` |
| 2 | Wire-level confirmation: login replaced with final `AaMS@#2026!` demo password (original `Passw0rd!` E2E overrides were restored after the flow) | Documented in NOTES below |
| 3 | Leftover `test_aams_db` from an aborted run blocked a clean test rebuild | Dropped the stale test database, re-ran `manage.py test` → 439 OK |

## Verification commands

```
cd backend && python manage.py test      # 439 OK
cd backend && python manage.py makemigrations --check     # No changes detected
npm run lint                             # tsc --noEmit, clean
npm test                                 # vitest run, 11 files / 102 OK
npm run build                            # vite build, clean (3.82s)
```

## Notes for maintenance

- The live E2E added two **real, confirmed** timesheet entries for `tch-3`
  (Dr. R. Kumar) on 2026-09-19 (CLASS COMP1 09:00-10:15 75 min; DUTY 12:00-13:30
  90 min) to the development database. They are legitimate demo data — delete
  via the Teacher Timesheet ledger, or leave as a populated demo.
- The E2E export artifact is saved at
  `.playwright-mcp/aams-timesheet-export.xlsx` (workspace root) — a verified
  5192-byte workbook (sheet "Timesheet", 2 rows).
- Demo passwords were restored to `AaMS@#2026!`, matching the login page's
  "Quick Demo Access" hint; teacher/admin overrides used during E2E are gone.
- Stack note from Phase H still applies: exactly one `runserver :8000` and one
  `vite preview :3000`; don't start duplicates. The fresh backend is no longer
  `--noreload`, so code edits hot-reload again.