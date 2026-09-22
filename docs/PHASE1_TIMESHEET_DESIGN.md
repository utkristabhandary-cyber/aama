# PHASE I — TEACHER TIMESHEET: DESIGN & FINAL CONTRACT

Status: **IMPLEMENTED** — see `docs/PHASE_I_REPORT.md` for the phase report.
This document is the authoritative design + API contract for the teacher
Timesheet feature introduced in Phase I.

---

## 1. Definition (what a Timesheet is in AAMS)

A Timesheet is the **per-day work/duty-hours log** a teacher fills in: the class
hours delivered plus non-teaching duties (lab/library/exam supervision, other
institutional work). It is NOT a payroll/clock-in product, NOT a parallel
attendance system, and it creates no `AttendanceSession`, no `TimetableSlot` and
no `TeachingSession`. `subject`/`sections` on a class entry only *reference*
existing academic structure.

Derivation from the existing AAMS material:

- AAMS has no attendance "absence/leave" hours ledger and no HR/payroll module;
  the only teacher-facing time record today is attendance *sessions* the teacher
  conducts in class. The requirement list (Phase I brief) explicitly bans
  inventing a second attendance or timetable system.
- The minimal justifiable model is therefore a **self-reported, server-validated
  work-hours log** whose business value is an **approved-hours ledger**
  (summary + export) reviewed by admins — not a new source of session truth.

Determination of the ambiguity ("does it represent working hours / teaching
sessions / attendance time / presence?"): AAMS documents no institutional
definition of "timesheet", so the minimum architecture-justified interpretation
was chosen: **teacher work/duty hours per day, with an admin approval workflow**.
The other candidate meanings were rejected because they duplicate timetable
(teaching sessions) or attendance (presence) machinery that already exists and
must remain the single source of truth for those concepts.

---

## 2. Domain model

One **`TimesheetEntry`** row = one teacher's worked/duty time range on one day.

| Concept | Decision |
|---|---|
| Owner | A `teachers.Teacher` record (`ForeignKey teacher`, `related_name="timesheet_entries"`) |
| Granularity | teacher + `entry_date` + time range (one row per logged range; multiple rows per day are allowed and legal — the overlap rule below only bans overlapping ranges) |
| Identity | Always resolved server-side from `request.user.teacher_profile` for teacher roles; a client-supplied `teacher` id is only honored for admins, and even then it must be a valid existing `Teacher` pk |

Explicitly **not** keyed on department/section/session/timetable-slot: those
would re-introduce a parallel class/session identity, which is out of scope.

---

## 3. Relationship to the timetable

- A timesheet entry is **independent** of `TimetableSlot`. It never writes or
  requires a slot.
- A CLASS entry references the authoritative subject via `ForeignKey
  subject` and sections via `ManyToManyField sections`. The semester is
  **derived server-side** from `subject.semester` — never client-chosen.
- No "second timetable": the UI reads subjects/sections from the existing
  `/api/academics/...` catalog, and the subject/section/semester values are the
  single-source-of-truth records.

## 4. Relationship to attendance

- Timesheet is **independent of attendance**. It neither derives from nor feeds
  the attendance engine, so no attendance calculation is duplicated.
- The only shared concept is *duration*, and here nothing is duplicated either:
  attendance session duration is the attendance domain's property, while a
  timesheet duration is the **wall-clock** difference between its own
  `start_time`/`end_time`.

## 5. Date / time rules

- `entry_date` — plain `DateField`. **Future dates are rejected** (server
  compares against `timezone.localdate()`).
- `start_time` / `end_time` — `TimeField` (serially `"HH:MM:SS"`; the UI sends
  `"HH:MM"`).
- `end_time` must be strictly after `start_time` — enforced in the serializer
  AND at the DB level (`CheckConstraint check_timesheet_end_after_start`).
- **Duration is computed server-side** by the model property
  `TimesheetEntry.duration_minutes`; a client-supplied duration is never
  accepted. The computation anchors both times on a fixed reference date
  (`2000-01-01`), so the time-of-day difference is exact and timezone-free.
  No overnight boundaries are supported (a single entry may not cross
  midnight); this matches the `end > start` constraint.
- Django timezone-aware datetime (project convention) is used for "today";
  the stored values are date + time-of-day, not instants.

## 6. Holiday rules

- Holidays are **informational only**: an entry on a holiday is allowed.
- The API surfaces `is_holiday` / `holiday_title` on every entry (looked up via
  the existing `Holiday` model, `apps/timesheet/services.py::holiday_on`), and
  the UI renders a holiday chip in the modal. Nothing blocks holiday entries —
  a teacher may legitimately work on a holiday.
- No holiday subsystem was created; this reuses the existing `academics.Holiday`.

## 7. Teacher rules

- Only accounts whose role is `teacher` AND that have a linked
  `teacher_profile` may act as teachers; identity is forced to that profile.
- A teacher sees **only their own** entries (queryset scoping) and direct
  access to another teacher's entry is denied (see §12 — IDOR).
- A teacher may create a DRAFT, **edit** a DRAFT/REJECTED entry, **delete** a
  non-confirmed own entry, **submit** DRAFT/REJECTED → SUBMITTED, and
  **recall** SUBMITTED → DRAFT. A SUBMITTED entry (when recallable) is
  otherwise immutable for the owner. CONFIRMED is immutable for everyone.
- Editing a REJECTED entry resets it to DRAFT and clears the rejection reason.
- Inactive/graduated teachers follow the existing account eligibility rules
  (inactive accounts cannot authenticate).

## 8. Student rules

- Students have **no access** to any timesheet surface: the entry/summary/export
  endpoints require `IsAdminOrTeacher` / `IsAdminUser`. A student request is a
  403. Nothing student-facing shows timesheet data.

## 9. Admin rules

- Admins see the **full ledger** (all teachers), with filters (`type`,
  `status`, `semester`, `teacher`, `date_from`, `date_to`).
- Admins may **create** entries for any teacher (`teacher` then required),
  **confirm** SUBMITTED → CONFIRMED, **reject** SUBMITTED → REJECTED (with a
  mandatory reason), **recall** any SUBMITTED, **edit** any non-confirmed entry,
  and **delete** any non-confirmed entry.
- CONFIRMED is immutable for admin too (no retroactive correction of approved
  hours — a documented, conservative choice; see §13/§26 of the report).

## 10. Duplicate / overlap / idempotency rules

- **Server-side** overlap check (`find_overlapping_entry`): a same-teacher,
  same-day non-rejected entry is rejected with a deterministic 400 if the new
  range overlaps an existing one (`start < other.end and end > other.start`).
- Two ranges that merely touch (`end == start`) are legal (no double-count).
- **Rejected entries never block** re-logging the same range — a withdrawn
  range must be re-submittable after correction.
- The edge enumeration is covered by tests (adjacent, overlapping, same-range,
  edit-path re-checks).

## 11. Edit / correction rules

- Editing requires the entry to be DRAFT or REJECTED (owner), or any
  non-confirmed entry (admin).
- An owner may not edit a SUBMITTED entry (must Recall first — enforced).
- Editing a REJECTED entry resets to DRAFT + clears `rejection_reason`.
- Deletion of non-confirmed entries: owner may delete own DRAFT/REJECTED;
  deleting own SUBMITTED requires Recall first; admin may delete any
  non-confirmed.
- CONFIRMED entries are immutable and undeletable (403).

## 12. Object-level authorization (IDOR)

- Teacher identity is always `request.user.teacher_profile` (never an id from
  the URL/body).
- Every list/detail is re-scoped per request for teacher roles, so retrieving
  another teacher's entry resolves as **404** (not a leak).
- Cross-teacher mutating actions additionally raise `PermissionDenied` (403)
  ("You can only manage your own timesheet entries.") when reached with a
  shadowed object.
- Tests assert: teacher A cannot retrieve/edit/delete/submit/recall teacher B's
  entry; students cannot reach any endpoint.

## 13. Status / state machine

`draft → submitted → confirmed` (terminal) and `submitted → rejected → draft`
(round-trip). Transitions:

| From | To | Actor | Endpoint |
|---|---|---|---|
| draft, rejected | submitted | owner or admin | `POST .../submit/` |
| submitted | draft | owner or admin | `POST .../recall/` |
| submitted | confirmed | **admin only** | `POST .../confirm/` |
| submitted | rejected | **admin only** (reason required) | `POST .../reject/` |
| draft, rejected | draft (edit) | owner or admin | `PUT/PATCH` |

Invalid transitions return a deterministic 400 with a `detail` message. Status
is a serializer read-only field and may only change through these actions.

## 14. Database model (final)

`apps/timesheet/models.py::TimesheetEntry` — migration `0001_initial`:

- `teacher` FK → `teachers.Teacher` (`on_delete=CASCADE`)
- `entry_date` DateField
- `type` CharField(20): `class | duty | other` (default `class`)
- `subject` FK → `academics.Subject` (`on_delete=PROTECT`, blank/null)
- `sections` M2M → `academics.Section` (blank)
- `semester` FK → `academics.Semester` (`on_delete=PROTECT`, blank/null; derived)
- `start_time`, `end_time` TimeField
- `note` CharField(500, blank)
- `status` CharField(20): `draft | submitted | confirmed | rejected` (default draft)
- `rejection_reason` CharField(500, blank)
- `created_by` FK → `settings.AUTH_USER_MODEL` (SET_NULL, related_name="+")
- `created_at` / `updated_at` auto datetimes
- `Meta.ordering = ["-entry_date", "start_time"]`
- `CheckConstraint check_timesheet_end_after_start` (`end_time > start_time`)

Deliberately **no** index on `(teacher, entry_date)`: at demo scale the list
routing filters add no real query cost and the constraint/perf review is
deferred (see report §26). No calculated column is stored — `duration_minutes`
is a computed property.

## 15. API contract

Base: `/api/timesheet/` (wired in `config/urls.py`). Auth: DRF token
(`ExpiringTokenAuthentication`), same as the rest of the portal. `PAGE_SIZE=100`
paginated list (existing DRF default pagination).

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/api/timesheet/entries/` | admin, teacher | List own/all; filters `type, status, semester, teacher(admin), date_from, date_to` |
| POST | `/api/timesheet/entries/` | admin, teacher | Create (teacher forced to own profile) |
| GET | `/api/timesheet/entries/{pk}/` | admin, teacher | Detail (owner or admin; other-teacher → 404) |
| PUT/PATCH | `/api/timesheet/entries/{pk}/` | admin, teacher | Edit non-confirmed (owner DRAFT/REJECTED; admin any non-confirmed) |
| DELETE | `/api/timesheet/entries/{pk}/` | admin, teacher | Delete non-confirmed (owner: recall submitted first) |
| POST | `/api/timesheet/entries/{pk}/submit/` | admin, teacher | draft/rejected → submitted |
| POST | `/api/timesheet/entries/{pk}/recall/` | admin, teacher | submitted → draft |
| POST | `/api/timesheet/entries/{pk}/confirm/` | **admin only** | submitted → confirmed |
| POST | `/api/timesheet/entries/{pk}/reject/` | **admin only** | submitted → rejected; requires `rejectionReason` (or `reason`) |
| GET | `/api/timesheet/summary/` | admin, teacher | CONFIRMED-only ledger: `{count, duration_minutes, by_type, by_day[], per_teacher[]}` |
| GET | `/api/timesheet/export/` | **admin only** | CONFIRMED-only `.xlsx` (same filters) |

### Serialized entry fields

`id, teacher, teacher_name, entry_date, type, subject, subject_code,
subject_name, section_ids, sections, section_names, semester, semester_name,
start_time, end_time, duration_minutes, note, status, rejection_reason,
is_holiday, holiday_title, created_at, updated_at`.

Write rules (all server-side):

- `teacher` ignored/forced for teachers; required when an admin creates.
- `type=class` → `subject` required and must have a semester; ≥1 `section_ids`;
  every section in the subject's semester; `semester` derived from subject.
- `type=duty|other` → `subject` and `section_ids` must be omitted.
- `end_time > start_time`; `entry_date` not in the future.
- Overlap rule (§10) enforced on create and update.
- No client-supplied duration, no client-chosen semester, no client identity.

### Query filters (list & summary & export)

`type`, `status` (list only), `semester`, `teacher` (admin only), `date_from`,
`date_to`. Teachers are always pre-scoped to their own entries.

### Summary response (CONFIRMED only)

```
{ "count": N, "duration_minutes": D,
  "by_type": {"class": m, "duty": n, "other": p},
  "by_day": [ {"entry_date": "YYYY-MM-DD", "duration_minutes": d}, ... ],
  "per_teacher": [ {"teacher": id, "teacher_name": "...", "count": c, "duration_minutes": d}, ... ] }
```

### Export

`GET /api/timesheet/export/` → `application/vnd.openxmlformats-...xlsx`,
`Content-Disposition: attachment; filename="aams_timesheet_export.xlsx"`.
Headers: `Teacher ID, Teacher Name, Date, Type, Subject Code, Subject Name,
Sections, Semester, Start Time, End Time, Duration (min), Note`. Reuses the
Phase H server-XLSX architecture (`openpyxl`, `saveDownload` on the client).

## 16. Permissions summary

| Capability | Teacher | Admin | Student |
|---|---|---|---|
| List / detail own (teacher) or full (admin) | ✓ (own only) | ✓ (all) | ✗ 403 |
| Create (self / any) | ✓ (self) | ✓ (any, `teacher` req.) | ✗ 403 |
| Edit DRAFT/REJECTED | ✓ (own) | ✓ (any non-confirmed) | ✗ 403 |
| Edit SUBMITTED | ✗ (recall first) | ✓ | ✗ 403 |
| Edit CONFIRMED | ✗ 403 | ✗ 403 | ✗ 403 |
| Delete non-confirmed | ✓ (own; recall submitted first) | ✓ (any non-confirmed) | ✗ 403 |
| Submit / recall | ✓ (own) | ✓ (any) | ✗ 403 |
| Confirm / reject | ✗ 403 | ✓ | ✗ 403 |
| Summary | ✓ (own) | ✓ (all) | ✗ 403 |
| Export | ✗ 403 | ✓ | ✗ 403 |

## 17. Source of truth (Phase G policy)

- Backend DB is the only store. No localStorage, no hardcoded rows, no demo
  fallback, no fabricated empty-state content.
- Empty API → genuine empty state; failing API → error state with retry.
- All listing/summary/export values come from `SELECT` over the tables; the UI
  only formats.

## 18. Frontend surface (minimum, no redesign)

- **Teacher — "My Timesheet"** (`src/features/timesheet/TimesheetView.tsx`,
  nav under Attendance, sidebar `Hourglass`): stat cards (Confirmed Entries /
  Total Hours / Class Hours / Duty+Other, all CONFIRMED-only), filter bar
  (type/status/semester/date range), entries table with per-status action set,
  raw "hours" computed purely from `duration_minutes`.
- **Log/Edit modal** (`TimesheetEntryModal.tsx`): date, type, start/end, subject
  + section checkboxes (class) or none (duty/other), optional note; surfaces
  holiday chip; client validation mirrors server (end>start, subject+sections
  for class) and shows server validation errors inline.
- **Admin — "Teacher Timesheet"** (nav under Operations, `FileSpreadsheet`):
  same table with a Faculty filter, "Hours by Faculty" panel, Confirm/Reject
  actions, and "Export .xlsx".
- **Reject modal** (`RejectEntryModal.tsx`): mandatory reason; warning that
  editing a rejected entry resets it to draft.
- Toasts via the existing `ToastContext`; role from `useAuth().role`.

## 19. Non-goals / deferred

- No payroll/HR computations, leave approval, or per-cost-center accounting.
- No overnight (multi-midnight) entries.
- No retroactive admin correction of CONFIRMED hours (deliberate; document a
  future "void + re-issue" if the institution requires it).
- No teacher requesting-time-off workflows.
- No extensive analytics beyond the summary ledger.
- Frontend visual redesign is explicitly Phase J scope.