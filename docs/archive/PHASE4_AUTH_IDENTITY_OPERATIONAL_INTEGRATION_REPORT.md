# Phase 4 — Authenticated Identity & Operational Integration

Status: **COMPLETE** — all changes implemented, verified, and regression-tested.

---

## 1. Executive Summary

Phase 4 removes the final mock-data paths from the four teacher/student
operational screens and enriches the backend so every value they display is
computed server-side from the authenticated user's identity — never from a
client-supplied `teacherId`/`studentId`, never from a "first record in the
list" fallback, and never from a `[]` stub:

- **Teacher roster + class reports are now real endpoints.**
  `GET /api/teachers/students/` returns the authenticated teacher's enrolled
  roster (scoped to their active assignment sections) with a per-student
  attendance summary computed only from that teacher's own finalized sessions.
  `GET /api/teachers/reports/` returns one report per *active* assignment with
  per-student attended/total/percentage and exam-eligibility status. The
  frontend `getTeacherStudents`/`getTeacherReports` `[]` stubs are replaced
  with these API calls.
- **Timetable slots now self-describe.** `TimetableSlotSerializer` adds
  read-only `subject_code`, `subject_name`, `teacher_name`, `section_name`,
  and `section_names` so teacher and student timetable views need no secondary
  lookups — this also lets the student timetable show faculty names without a
  teacher-list endpoint (students cannot enumerate teachers, by design).
- **Student report summary is complete.** `summarize_student_attendance`
  now emits per-subject `absent`/`late` buckets plus top-level
  `totalClasses/totalPresent/totalAbsent/totalLate/examEligibility`, fixing the
  runtime `undefined` rendering in `StudentReportsView`.
- **Forward wiring.** `TeacherTimetableView` and `StudentTimetableView` are
  migrated off the localStorage `store` onto `/teachers/me/`, `/students/me/`,
  and the teacher/student-scoped `/academics/timetable/`; a dead `store`
  import in `StudentReportsView` is removed.

Full backend suite grew **71 → 96 passing tests** (the 8 identity tests were
also finally moved into Django's discovery path). `check`,
`makemigrations --check`, `npm run lint`, and `npm run build` are all clean.
No destructive DB operations and no `.env` changes were made.

---

## 2. Scope

**In scope (done):**
- `GET /api/teachers/students/` — teacher-only roster + attendance summary.
- `GET /api/teachers/reports/` — teacher-only per-class report metrics.
- `TimetableSlotSerializer` display fields (`subject_code`, `subject_name`,
  `teacher_name`, `section_name`, `section_names`).
- `summarize_student_attendance` absent/late/eligibility fields.
- Frontend service wiring (`getTeacherStudents`, `getTeacherReports`),
  timetable-view migration off `store`, dead-import cleanup.
- Backend tests for all new endpoints/serializer fields + regression tests.

**Explicitly deferred (NOT started, NOT faked):**
- BSSID/QR redesign and the complete attendance workflow
  (`TakeAttendanceView`, admin screens still store-backed: promotion, CSV
  import, admin dashboard, notifications, calendar/holidays, settings,
  `GlobalSearchModal` admin branch, `ReportsView` PDF export, header reset).
- Full admin CRUD-to-API wiring (continued from Phase 3).

---

## 3. New Teacher Endpoints

Both are `@action(detail=False)` on `TeacherViewSet`, so they surface
immediately as `/api/teachers/students/` and `/api/teachers/reports/` via the
existing `DefaultRouter`.

### 3.1 `GET /api/teachers/students/` — enrolled roster + summary

- **Permission:** `IsTeacherUser` (teachers only; admins and students → 403).
- **Identity:** resolved only from `request.user.teacher_profile`; a user
  without a linked teacher profile → 404.
- **Scope:** students whose `section` is covered by at least one **ACTIVE**
  `TeacherAssignment` for the authenticated teacher. No client filter is
  accepted.
- **Summary scope:** `AttendanceRecord` rows whose
  `attendance_session.teacher == teacher` and `marking_complete == True`
  (unmarking/pending rows never count — tested).
- **Semantics:** `present` counts present **and** late (a late student did
  show up), `percentage = round((present + late) / marked * 100, 1)`.

Response item shape:

```json
{
  "id": 3, "student_id": "STU-2026-001", "roll_no": "01", "name": "Alpha",
  "email": "...", "phone": "...", "avatar": "...",
  "section_name": "Section A", "semester_name": "Semester 1",
  "semester_code": "SEM1-2026",
  "attendance_summary": {"marked": 4, "present": 3, "absent": 1, "late": 1, "percentage": 75.0}
}
```

An unassigned teacher gets a `200` with an empty array.

### 3.2 `GET /api/teachers/reports/` — per-class report metrics

- **Permission / identity:** same as above.
- **Granularity:** one object per **ACTIVE** `TeacherAssignment`
  (subject × section); `DRAFT`/`INACTIVE` assignments are excluded (tested).
- **Session matching:** a session counts for a class only when its
  `subject_id` matches the assignment's subject **and** one of the session's
  `sections` covers the assignment's section. Sessions for other subjects or
  other sections are excluded (tested).
- **Metrics:** per student, `attendedSessions` (own-teacher, finalized,
  present/late records) over `totalSessions`; `percentage`;
  `status = "Clear"` at `≥ 75%` else `"Shortage"`; class `averagePercentage`.

Response object shape (already camelCased for the existing view contract):

```json
{
  "classId": 9,
  "subject": {"id": 1, "code": "CS101", "name": "Programming Fundamentals"},
  "classType": "Lecture",
  "semester": {"id": 2, "name": "...", "code": "SEM1-2026"},
  "sections": [{"id": 11, "name": "Section A"}],
  "isCombined": false,
  "sessionCount": 4,
  "averagePercentage": 87.5,
  "studentMetrics": [{
    "studentId": 3, "name": "Alpha", "rollNo": "01", "studentCode": "STU-2026-001",
    "sectionName": "Section A", "attendedSessions": 4, "totalSessions": 4,
    "percentage": 100.0, "status": "Clear"
  }]
}
```

---

## 4. Timetable Slot Display Fields

`TimetableSlotSerializer` (`apps/academics/serializers.py`) now always emits:

| Field | Source |
|---|---|
| `subject_code`, `subject_name` | related `Subject` |
| `teacher_name` | related `Teacher` |
| `section_name` | default/primary `Section` |
| `section_names` | all `sections` M2M members; falls back to the default section's name when empty (non-combined slots) |

`section_ids` remains `write_only` (input-only); `is_combined` stays read-only.
This enables both timetable views to render fully from one response, and the
student timetable to show the lecturer's name without hitting
`/api/teachers/` (students cannot list the faculty directory — a Phase 3 rule
kept intact).

---

## 5. Student Attendance Summary Completion

`apps/attendance/services.py` → `summarize_student_attendance` now:

- Emits per-subject `absent` and `late` buckets alongside `present`/`total`
  (still the `GET /api/attendance/records/my/` authoritative payload).
- Adds top-level `totalClasses`, `totalPresent`, `totalAbsent`, `totalLate`
  (aliases `overallAbsent`, `overallLate` for the grand totals) and
  `examEligibility`: `"eligible"` when cumulative percentage `≥ 75`,
  else `"shortage"`.

This closes the `StudentReportsView` contract gap — the view reads
`totalClasses/totalPresent/totalAbsent/totalLate/examEligibility` and
`sub.absent/sub.late`, which previously were `undefined` at runtime.

---

## 6. Frontend Changes

- `src/types/api.ts` — extended `ApiTimetableSlot` with the new display
  fields; completed `ApiMyAttendance` (absent/late/eligibility); added
  `ApiAttendanceSummary`, `ApiTeacherStudent`, `ApiClassReport`,
  `ApiClassReportStudent`.
- `src/types/index.ts` — `TimetableSlot` gains optional
  `subjectCode/subjectName/teacherName/sectionName/sectionNames`; `Student`
  gains optional `sectionName`.
- `src/services/teacherService.ts` —
  - `getTeacherStudents` → `GET /teachers/students/`, mapped to the
    `TeacherStudentsView` shape (`id`, `studentId`, `rollNo`, `name`, `email`,
    `phone`, `avatar`, `sectionName`, `semesterName`, `attendanceSummary`).
  - `getTeacherReports` → `GET /teachers/reports/`, returned as the typed
    `ApiClassReport[]` the view already consumes.
  - `getTeacherTimetable` now maps the name fields.
- `src/services/studentService.ts` — `Student` view model now carries
  `sectionName`; `getMyTimetable` maps the name fields.
- `src/features/teacher/TeacherTimetableView.tsx` — resolves the teacher via
  `teacherService.getCurrentTeacher` and slots via
  `teacherService.getTeacherTimetable`; renders `slot.subjectCode`,
  `slot.subjectName`, `slot.sectionNames`/`slot.sectionName`. No `store`,
  no `teachers[0]` fallback.
- `src/features/student/StudentTimetableView.tsx` — resolves the student via
  `studentService.getCurrentStudent` (uses its `sectionId` for the
  section-scoped timetable query) and renders all names from the slot
  payload. No `store`.
- `src/features/student/StudentReportsView.tsx` — dead `store` import removed.

`GlobalSearchModal`'s teacher branch now receives real allowed-student IDs
(each roster item exposes `id` as a string), so teacher search results filter
to the teacher's own roster without any diff.

---

## 7. Scope & Security Behavior (intentional, tested)

- **Identity is server-derived.** Both new endpoints ignore any client hints
  and read `request.user.teacher_profile` only; no `?teacher=`/`?student=`
  probes can re-scope them.
- **403 for non-teachers.** `IsTeacherUser` on both actions; admins and
  students receive 403 (tested).
- **404 without a profile.** An authenticated user with no linked
  `teacher_profile` gets 404 (tested).
- **Summaries never cross teacher boundaries.** Roster and report metrics
  count only records owned by the requesting teacher's sessions with
  `marking_complete=true`.
- **Inactive assignments are invisible.** Only `ACTIVE` `TeacherAssignment`
  rows feed the roster and reports.
- **No mock fallback.** The `[]` stubs are gone; the timetable views no longer
  fall back to "the first teacher/student record".

---

## 8. Verification Results

| Check | Result |
|---|---|
| `py manage.py check` | System check identified no issues |
| `py manage.py makemigrations --check --dry-run` | No changes detected |
| `py manage.py test apps.teachers` | **Ran 16 tests — OK** (new) |
| `py manage.py test apps.attendance` | **Ran 28 tests — OK** (+1 new) |
| `py manage.py test` (full suite) | **Ran 96 tests — OK** (baseline 71 + 8 identity + 16 teacher + 1 attendance) |
| `npm run lint` (tsc --noEmit) | Clean |
| `npm run build` (vite) | Built successfully (pre-existing chunk-size warning only) |

No destructive DB operations were performed; the live development database was
not modified.

---

## 9. How to Verify Locally

1. Backend: `py manage.py check`, `py manage.py test`, `py manage.py runserver`.
2. Frontend: `npm run lint`, `npm run build`, `npm run dev`.
3. Sign in as a seeded teacher. Open **My Students** — the roster and each
   percentage now come from `/api/teachers/students/`. Open **Faculty
   Attendance Reports** — classes and per-student metrics come from
   `/api/teachers/reports/`.
4. Open the teacher timetable — rows are rendered from the teacher-scoped
   `/academics/timetable/` payload (subject/room/sections), no storage lookup.
5. Sign in as a seeded student — **Class Schedule** shows subject and
   lecturer names from the slot payload; **Personal Attendance Report** now
   renders totals (`totalClasses`/`totalPresent`/`totalAbsent`/`totalLate`)
   and the exam-eligibility banner from the server summary.
6. Negative checks: an admin calling `GET /api/teachers/students/` or
   `/api/teachers/reports/` with a token gets **403**; an unassigned teacher
   profile gets an empty roster/report list; an authenticated user with no
   teacher profile gets **404**.

---

## 10. File Change Index (Phase 4)

Backend:
- `apps/teachers/views.py` — `TeacherViewSet.students` and
  `TeacherViewSet.reports` actions, teacher-scoped roster/summary and
  per-assignment report metrics; imports for `IsTeacherUser`,
  `TeacherAssignment`, attendance models, `Student`, `defaultdict`.
- `apps/teachers/tests.py` — **new**: `TeacherOperationalBase`,
  `TeacherStudentsTests` (+8), `TeacherReportsTests` (+6),
  `TimetableSlotNameFieldsTests` (+2).
- `apps/academics/serializers.py` — `TimetableSlotSerializer` display fields
  (`subject_code`, `subject_name`, `teacher_name`, `section_name`,
  `section_names`; `section_ids` stays write-only).
- `apps/attendance/services.py` — `summarize_student_attendance` absent/late
  bucketing and `totalClasses/totalPresent/totalAbsent/totalLate/
  examEligibility` top-level fields.
- `apps/attendance/tests.py` — `test_my_reports_absent_late_and_exam_eligibility`.

Frontend:
- `src/types/api.ts` — `ApiTimetableSlot` name fields; completed
  `ApiMyAttendance`; new `ApiAttendanceSummary`, `ApiTeacherStudent`,
  `ApiClassReport`, `ApiClassReportStudent`.
- `src/types/index.ts` — `TimetableSlot` display fields; `Student.sectionName`.
- `src/services/teacherService.ts` — real `getTeacherStudents`/
  `getTeacherReports`; `getTeacherTimetable` name mapping.
- `src/services/studentService.ts` — `sectionName` on the student model;
  `getMyTimetable` name mapping.
- `src/features/teacher/TeacherTimetableView.tsx` — store-free, API-backed.
- `src/features/student/StudentTimetableView.tsx` — store-free, API-backed.
- `src/features/student/StudentReportsView.tsx` — dead `store` import removed.

Docs:
- `PHASE4_AUTH_IDENTITY_OPERATIONAL_INTEGRATION_REPORT.md` — this report.