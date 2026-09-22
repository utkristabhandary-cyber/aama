# PHASE 5 — Attendance Session Engine & Teacher Attendance Workflow

## 1. Status

`COMPLETE` — Attendance session engine is backend-authoritative and fully verified.
All teacher attendance screens consume the live Django API; no mock fallback remains
in the attendance path. Automatic QR and BSSID anchoring were **not** implemented this
phase (they remain deferred to Phase 6 per the scope boundary).

## 2. Executive Summary

Phase 5 delivered a backend-authoritative attendance session engine and migrated the
teacher attendance workflow to the real Django REST API. `AttendanceSession` and
`AttendanceRecord` are now the single source of truth for every mark; roll‑call data,
bulk marking, finalization, and teacher/student statistics all flow through validated
server endpoints. Phase 15 (percentage consistency) and Phase 18 (test coverage) gaps
were closed: late marks now count as attended in every report, and the bulk‑mark path is
a single atomic, fully‑validated server request instead of a fan‑out of individual calls.

Verification: **125 backend tests pass** (baseline 115, +10 new), migrations are clean,
`npm run lint` and `npm run build` pass, and a live HTTP smoke test against a throwaway
database exercised the full teacher workflow (create session → roll → atomic bulk mark →
report → finalize → immutability).

## 3. Models (attendance app)

| Model | Purpose | Key fields |
|---|---|---|
| `AttendanceSession` | One class session for which attendance is collected | `session_date`, `subject` (FK PROTECT), `teacher` (FK PROTECT), `phase` (`manual`/`qr`), `start_time`, `planned_end_time`, `end_time`, `sections` (M2M), `teaching_session` (nullable FK), `late_reason`, `created_by`, `submitted_at` |
| `AttendanceRecord` | A single student mark inside a session | `attendance_session` (FK CASCADE), `student` (FK CASCADE), `status` (`present`/`absent`/`late`), `marking`, `marking_complete`, `submitted_at` |
| `QRAttendanceSession` | QR capture state (store consumer; deferred to Phase 6) | `teacher`, `attendance_session`, `token` (rotates 15s TTL), `student_ids`, `student_timestamps`, `revoked` |

Key model invariants:

- `AttendanceSession.is_finalized` ⇔ `submitted_at is not None`.
- DB-level `UniqueConstraint(attendance_session, student)` prevents duplicate marks.
- Absence of a record means **UNMARKED** — an unmarked student is never Present.
- `clean()` rejects `start_time >= planned_end_time`.

## 4. Business Rules

The engine enforces the mandatory rules A–J:

1. **A — Teacher identity**: teacher identity comes only from `request.user.teacher_profile`; sessions/rolls are scoped to that profile; a `?teacher=` query can never be used to probe another teacher's data.
2. **B — Assignment validation**: creating a session requires an `ACTIVE` `TeacherAssignment` for every requested section+subject; otherwise `403`.
3. **C — Student membership**: a student may only be marked in a session whose section they belong to; a mark for an outside student is `403`.
4. **D — Session ownership**: `_assert_owner_or_admin` blocks teachers from reading/ mutating sessions they do not own (`403`).
5. **E — Duplicate prevention**: `get_or_create` + the DB unique constraint make marking idempotent (safe against double-submit/retry).
6. **F — Attendance semantics**: `present` ⇒ attended, `late` ⇒ attended, `absent` ⇒ not attended. Raw counts keep `late` separate; every *percentage* uses `(present + late) / marked * 100`.
7. **G — Final-state immutability**: once `is_finalized` all mutation endpoints (mark, bulk_mark, destroy, update, submit) return `400`, preserving `marking_complete` on records.
8. **H — Server-side finalization**: `submit` finalizes server‑side; a finalized session's stored `is_finalized` is authoritative, never derived in the client.
9. **I — No cross-teacher calculations**: per-teacher summaries/at‑risk lists never include other teachers' sessions; the `my` student scope never leaks other students' data.
10. **J — Completed semesters**: a session cannot be created for a subject in a `COMPLETED` semester (`400`).

## 5. Lifecycle

```
draft ──create──► AttendanceSession(teacher, subject, sections, phase)
  │
  ├──roll──► 5 students with UNMARKED (no record)     [GET  /sessions/{id}/roll/]
  │
  ├──mark / bulk_mark──► AttendanceRecord(status, marking_complete=True)
  │                        idempotent (get_or_create + DB unique constraint)
  │
  ├──submit──► submitted_at set ⇒ is_finalized=True
  │             re-mark / bulk / edit all rejected (400)
  │
  └──delete──► allowed while draft (owner or admin) only
```

An unmarked student simply has no `AttendanceRecord`; the summary adds them to the
"UNMARKED" bucket and excludes them from statistics denominators (`marked`).

## 6. Endpoints

Attendance router (`backend/apps/attendance/urls.py`):

| Method & path | View / action | Permission | Description |
|---|---|---|---|
| GET / create `api/attendance/sessions/` | `AttendanceSessionViewSet` list/create | teacher, admin | List own sessions (admin: all); create a draft |
| GET / PATCH / DELETE `sessions/{id}/` | retrieve / update / destroy | owner or admin | Draft edit/delete; finalized delete → 403 |
| GET `sessions/{id}/mark/` | `mark` | owner (or admin) | **Not a read** — this is the per-student mark POST (router detail) |
| POST `sessions/{id}/mark/` | `mark` | owner (or admin) | Idempotent mark_one student |
| POST `sessions/{id}/bulk_mark/` | `bulk_mark` | owner (or admin) | **NEW** atomic multi-mark (see §8) |
| GET `sessions/{id}/roll/` | `roll` | owner (or admin) | Full roll-call roster with per-student status/marked |
| POST `sessions/{id}/submit/` | `submit` | owner (or admin) | Server-side finalization |
| GET list / `records/my/` | `AttendanceRecordViewSet` | student | Student's own marks, `overallTotal`, denominator = marked |
| `qr/*` | `QRAttendanceSessionViewSet` | teacher + student | QR capture flow (Phase 6 consumer; endpoints verified but UI deferred) |

Admin references (`reports`, `academics.assignments`) sit in their own apps: `reports/`
summary/by-subject/students-at-risk, `academics/assignments/` (teacher-scoped read).

## 7. API Contracts

**Create session** `POST /api/attendance/sessions/`
```json
{ "session_date":"2026-09-07", "subject":1, "phase":"manual",
  "start_time":"09:00", "planned_end_time":"10:00", "section_ids":[1,2] }
```
→ `201` session (draft), `400` bad times / completed semester, `403` not-assigned / not-owner.

**Roll** `GET /api/attendance/sessions/{id}/roll/`
```json
{ "attendanceSessionId":1,
  "students":[ {"studentId":1,"studentCode":"std-1","studentName":"Ananya Verma",
    "rollNo":"101","sectionId":1,"sectionName":"A","status":"late","marked":true} ] }
```

**Mark one** `POST /api/attendance/sessions/{id}/mark/` with `{"studentId":1,"status":"present"}` → the record.

**Mark many (NEW)** `POST /api/attendance/sessions/{id}/bulk_mark/`
```json
{ "marks":[ {"studentId":1,"status":"present"}, {"studentId":2,"status":"late"} ] }
```
→ `200` with the records array; **one invalid row rejects the whole batch** with
`404` (unknown student), `403` (student outside sections), or `400` (missing fields /
bad status / finalized) before any write.

**Submit** `POST /api/attendance/sessions/{id}/submit/` → `200` with `is_finalized: true`.

**Reports** summary → `{ totalAttendanceSessions, totalMarked, present, late, absent,
attendancePercentage, totalStudents, studentsAtRisk[] }`; by-subject rows now carry
`{ subjectId, subjectName, total, present, late, percentage }`.

## 8. Notable Change — Atomic Bulk Marking

Previously `TakeAttendanceView.markAll` issued a `Promise.all` of N individual
`markStudent` calls (N round-trips, partial success possible). Now:

- **Server**: new `bulk_mark` action on `AttendanceSessionViewSet` validates every entry
  (structure, student existence, section membership, status) *before* any write, then
  applies the batch inside `transaction.atomic()`. Any invalid row short-circuits with
  no partial records (`backend/apps/attendance/views.py` `bulk_mark`).
- **Client**: `attendanceService.bulkMarkStudents(sessionId, marks)` posts the whole
  roster in one request; `TakeAttendanceView.markAll` calls it (optimistic UI, rollback
  on failure) — a single atomic round-trip.

This satisfies Phase 3 #5 (server-side validation + atomicity for bulk) and Phase 18's
`BULK` coverage.

## 9. Notable Change — Admin Draft Management

`AttendanceSessionViewSet.get_permissions` previously used `IsTeacherUser` for all
non-GET methods, which blocked admins from managing drafts despite the admin UI having
delete controls. Now all methods use `[IsAdminOrTeacher()]`. Ownership is still enforced
for teachers via `get_queryset` + `_assert_owner_or_admin`; admins have no
`teacher_profile` and still cannot *create* sessions (the `403` path from
`PermissionDenied` remains intact).

## 10. Notable Change — Percentage Consistency (Phase 15)

`backend/apps/reports/views.py` previously computed percentages with `present` only,
silently dropping `late` marks from attendance figures. Now:

- **summary**: `attendancePercentage = pct(present.count() + late.count(), marked.count())`.
- **by-subject**: a `late` annotation is added; `percentage = pct(present + late, total)`.
- **students-at-risk**: `ratio = (present + late) / marked`.

Raw present/late/absent counts are unchanged; only the percentage semantics were aligned
to the single Phase 15 rule `(present + late) / marked * 100` — the same definition
already used by `teachers/views.py`.

## 11. Permissions Matrix

| Role | Create session | Mark / bulk / roll (own) | Submit own | Delete draft | Delete finalized | My records | Manage other's session |
|---|---|---|---|---|---|---|---|
| Teacher (assigned) | ✓ (ACTIVE assignment required) | ✓ | ✓ | ✓ | ✗ 400 | — | ✗ 403 |
| Admin | ✗ (no teacher_profile ⇒ 403) | ✓ (via manage path) | ✓ | ✓ | ✗ 400 | — | ✓ (draft only) |
| Student | ✗ | ✗ 403 | ✗ | ✗ | ✗ | ✓ own only | ✗ |
| Anonymous | ✗ 401 | ✗ 401 | ✗ | ✗ | ✗ | ✗ 401 | ✗ |

## 12. Migrations

- Applied: `accounts.0001-0003`, `teachers.0001_initial`, `academics.0001_initial`,
  `students.0001_initial`, `attendance.0001_initial`, `notifications.0001_initial`,
  `sessions.0001_initial`, plus stock Django migrations — none pending.
- `py manage.py makemigrations --check --dry-run` → **No changes detected** (this phase
  required no schema changes: the bulk endpoint and permission adjustments are pure view/
  logic).
- Model invariants (unique constraint on `(attendance_session, student)`) shipped in
  `attendance.0001_initial`.

## 13. Tests — Before / After

- **Before:** 115 tests passing across accounts/teachers/academics/students/attendance/
  reports/notifications.
- **After:** **125 tests passing** (+10), covering the new paths:

| New test | Component | Validates |
|---|---|---|
| `test_bulk_mark_applies_all_valid_statuses` | attendance | bulk writes all entries with correct statuses |
| `test_bulk_mark_is_atomic_rejects_any_invalid_student` | attendance | one bad row ⇒ whole batch rejected, zero writes |
| `test_bulk_mark_finalized_session_rejected` | attendance | bulk on finalized session ⇒ 400 |
| `test_bulk_mark_student_cannot_use` | attendance | student role ⇒ 403 |
| `test_admin_can_delete_another_teachers_draft` | attendance | admin manages other teacher's draft |
| `test_admin_cannot_delete_finalized_session` | attendance | finalized immutability holds for admins |
| `test_roll_empty_section_is_empty` | attendance | roll of empty section returns `[]` |
| `test_session_for_completed_semester_rejected` | attendance | completed-semester session ⇒ 400 |
| `test_cross_semester_stats_are_scoped` | attendance | `my` scope never leaks across semesters |
| `test_late_counts_as_attended_in_percentages` | reports | summary/by-subject/at-risk treat late as attended |

## 14. Verified Checks

Run from `backend/` with Python 3.13 / Django 5.2 / DRF 3.18:

- `py manage.py check` → 0 issues.
- `py manage.py makemigrations --check --dry-run` → no changes.
- `py manage.py showmigrations --plan` → all `[X]`, nothing unapplied.
- `py manage.py test` → **125 tests, OK** (test DB reused default alias, no external deps).

Frontend (Node v24, Vite 6, tsc):

- `npm run lint` (`tsc --noEmit`) → clean.
- `npm run build` → 1753 modules, built in ~4.6s (chunk-size warning only: 791 kB main
  bundle — pre-existing, not a correctness issue).

## 15. Live Smoke Test (HTTP level)

A real HTTP smoke test was run against the dev server on a **throwaway SQLite database**
(`seed_demo_data`, not the production PostgreSQL DB; server stopped and DB removed
afterwards). Session as the assigned teacher:

1. `POST /api/auth/login/` → 200 (teacher token).
2. `POST /api/attendance/sessions/` → 201, `is_finalized=false`.
3. `GET /api/attendance/sessions/{id}/roll/` → 5 students across 2 sections.
4. `POST /api/attendance/sessions/{id}/bulk_mark/` (5 marks) → 200, all records written.
5. `POST /api/attendance/sessions/{id}/bulk_mark/` with one `studentId=99999` → **404,
   and the valid row was NOT written** (atomicity confirmed over real HTTP).
6. `GET /api/reports/summary/?semester=…` → `present=0, late=5, attendancePercentage=100`
   (late counted as attended), `studentsAtRisk=[]`.
7. `GET /api/reports/by-subject/` → `present=0, late=5, percentage=100`.
8. `POST /api/attendance/sessions/{id}/submit/` → `is_finalized=true`.
9. `POST /api/attendance/sessions/{id}/mark/` after submit → **400** (immutability).

No credentials are reproduced in this report.

## 16. Security Findings / Notes

- No secrets are logged or stored; tokens are `Token`-based and scoped per user.
- Ownership checks (`_assert_owner_or_admin`) short-circuit before any data access.
- Bulk-marks validate identity/status before entering the atomic block — a malicious
  payload cannot cause partial writes or out-of-membership marks.
- LSP diagnostics on backend files (unresolvable `django`/`rest_framework` imports,
  `TextChoices.value` flagged on tuples) are environment noise from the local language
  server (no venv configured). Validation is the test suite, not the LSP. The
  `list.sort` key complaint in reports is the same class of false positive.
- Admin redesign remains out of scope (Phase 6), so leftover non-attendance `store`
  consumers there are documented, not converted (see §18).

## 17. Files Changed This Phase

- `backend/apps/attendance/views.py` — permissions, completed-semester guard, new
  `bulk_mark` action.
- `backend/apps/reports/views.py` — late-as-attended percentages (summary, by-subject,
  at-risk).
- `backend/apps/attendance/tests.py`, `backend/apps/reports/tests.py` — +10 tests.
- `src/services/attendanceService.ts` — `bulkMarkStudents` added.
- `src/features/attendance/TakeAttendanceView.tsx` — `markAll` now uses the bulk endpoint.

## 18. Deferred Work (Deliberately NOT in Phase 5)

- **QR scanning/redesign, BSSID anchoring, Wi-Fi permission/verification, network
  anchoring** — deferred to Phase 6. `QRAttendanceSession`/`StudentQRScannerView` remain
  store consumers by design.
- **Admin dashboard redesign** — out of scope; `AdminDashboard.tsx` stays a store
  consumer for now (documented in Phase 12 audit, 12 non-attendance files still import
  `storage`: ReportsView, PromotionView, AdminDashboard, StudentQRScannerView,
  TimetableAdminView, ExportTimetableModal, CalendarHolidaysView, NotificationsView,
  SettingsView, SectionAllocationCSVView, Header, GlobalSearchModal — none of which are
  teacher/student attendance screens).
- **Password reset, refresh tokens, ERP integration, 2,000-user load testing** — out of scope.

## 19. Recommended Phase 6 Work

1. **QR + BSSID anchoring**: implement server-side presentation (QR display) and
   verification (student scan) with Wi-Fi/BSSID anchoring, replacing the store-backed
   `StudentQRScannerView`.
2. **Admin dashboard re-platform** to the live API (last major store-boundary removal).
3. **Chunk splitting** for the 791 kB main bundle (dynamic import of report/dashboard
   routes).
4. Optional: add `bulk_mark` `late_reason` propagation and an admin "re-open draft"
   workflow to replace delete-required batch correction.

## 20. Conclusion

The attendance session engine is **complete**: live REST API end to end, atomic bulk
marking, consistent Phase 15 percentages, admin draft management, 125 passing tests,
clean Django checks, clean frontend lint/build, and a verified HTTP smoke test. The QR /
BSSID features that were out of scope were not implemented and are queued for Phase 6.