# AAMS — Timetable & Calendar

## Status: IMPLEMENTED (Phases B.5 + B.6 + B.6-F + E complete)

Backend timetable CRUD, conflict detection, and import pipeline are **fully implemented** with 54 passing backend tests. Student, teacher, and admin timetable views are **live** (server-backed). The spreadsheet import surface is the **live 3-step flow** (Upload → Preview → Review → Confirm) wired to the backend `/api/academics/timetable-import/` preview/confirm endpoints, with live import history and a live-data CSV export. The legacy mock stack (`timetableApi.ts`, `timetableService.ts`, `ImportHistoryModal`'s mock branch, `storage`'s `importHistory`/`batchImportTimetable`, and the `TimetableImportJob`/`ParsedTimetableRow`/… types) was removed in **B.6-F**. The live import/CRUD paths have no dependency on the deleted mock stack.

---

## 1. Data Model

All timetable models live in `apps/academics/models.py`.

### 1.1 TimetableSlot (the core entity)

A single scheduled class in the institutional timetable.

| Field | Type | Description |
|-------|------|-------------|
| `semester` | FK → Semester | The academic term this slot belongs to |
| `section` | FK → Section | Primary/default section |
| `sections` | M2M → Section | All participating sections (for combined lectures) |
| `subject` | FK → Subject | The module being taught |
| `teacher` | FK → Teacher | Assigned faculty |
| `day` | CharField (`DayOfWeek`) | Sunday–Friday |
| `start_time` | TimeField | Slot start (HH:MM:SS) |
| `end_time` | TimeField | Slot end (HH:MM:SS) |
| `room` | CharField | Free-text room/venue identifier |
| `class_type` | CharField (`SubjectType`) | Lecture / Tutorial / Practical |
| `notes` | TextField | Optional notes (block info, instructions) |
| `is_combined` | BooleanField | Derived: `True` when `sections.count() > 1` |
| `created_at` | DateTimeField | Auto-set on creation |

**Constraints:**
- `CHECK(end_time > start_time)` — DB-level, named `check_timetable_end_after_start`
- Ordering: `day, start_time`

**Section model:**
- `section` (FK) is always the first/primary section — used as the canonical foreign key.
- `sections` (M2M) holds *all* participating sections including the primary. For single-section slots, the M2M may be empty (the primary section is only in the FK).
- `is_combined` is set programmatically on create/update — never set by the client.

### 1.2 TeachingSession (recurring teaching block)

A recurring block that a teacher owns. Used by the teacher dashboard and QR roll-call flows.

| Field | Type | Description |
|-------|------|-------------|
| `semester` | FK → Semester | |
| `subject` | FK → Subject | |
| `teacher` | FK → Teacher | |
| `class_type` | CharField (`SubjectType`) | |
| `sections` | M2M → Section | Participating sections |
| `is_combined` | BooleanField | Derived from M2M count |
| `day` | CharField (`DayOfWeek`) | Blank allowed |
| `start_time` | TimeField | |
| `end_time` | TimeField | |
| `room` | CharField | |
| `notes` | TextField | |

**Constraint:** `CHECK(end_time > start_time)`, named `check_teaching_end_after_start`

### 1.3 TimetableImportSession (Excel import staging)

Stages a validated Excel import for admin confirmation.

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | UUIDField | Unique, immutable identifier |
| `created_by` | FK → User | Admin who uploaded |
| `file_name` | CharField | Original filename |
| `file_size` | PositiveIntegerField | Bytes |
| `sheet_name` | CharField | Sheet used |
| `sheet_count` | PositiveIntegerField | |
| `total_rows` | PositiveIntegerField | |
| `parsed_rows` | JSONField | Server-normalized row data |
| `summary` | JSONField | Counts and unresolved values |
| `status` | CharField | `pending` / `confirmed` |
| `created_at` | DateTimeField | |
| `confirmed_at` | DateTimeField | Nullable |

### 1.4 Holiday (calendar)

Global (not semester-scoped). Used for attendance session validation.

| Field | Type |
|-------|------|
| `date` | DateField |
| `title` | CharField |
| `description` | TextField |
| `type` | CharField (`institutional`/`national`/`festival`/`restricted`/`emergency`) |

### 1.5 TeacherAssignment (prerequisite for timetable)

Links a teacher to a subject for a specific section within a semester. A timetable slot requires that the teacher has an active assignment covering the slot's subject and section.

| Field | Type | Constraints |
|-------|------|-------------|
| `teacher` | FK → Teacher | |
| `semester` | FK → Semester | |
| `section` | FK → Section | |
| `subject` | FK → Subject | |
| `status` | CharField | `active` / `inactive` |
| `created_at` | DateField | Auto |

Unique constraint: `(teacher, semester, section, subject)`.

---

## 2. Entity Relationships

```
Semester (root)
 ├── Section (multiple per semester)
 ├── Subject (multiple per semester)
 ├── TeacherAssignment (teacher → subject → section, scoped to semester)
 ├── TimetableSlot (weekly schedule entries)
 │    ├── section (FK — primary)
 │    ├── sections (M2M — all participants for combined)
 │    ├── subject (FK)
 │    └── teacher (FK)
 ├── TeachingSession (recurring blocks)
 │    ├── sections (M2M)
 │    ├── subject (FK)
 │    └── teacher (FK)
 └── TimetableImportSession (staging for bulk import)

Student.section → Section
Student.semester → Semester
Teacher ← User.teacher_profile (OneToOne)

AttendanceSession.teaching_session → TeachingSession (nullable FK)
AttendanceSession.subject → Subject
AttendanceSession.teacher → Teacher
AttendanceSession.sections → Section (M2M)
```

### Key relationship rules:
1. A TimetableSlot's `subject` and `section` must belong to the slot's `semester`.
2. A TimetableSlot requires the `teacher` to have an active `TeacherAssignment` covering the same subject (single-module-per-semester rule).
3. A Student's timetable is derived from all TimetableSlots matching the student's `section` (including combined slots where the student's section is in the M2M).
4. An AttendanceSession can link to a TeachingSession via FK, but not directly to a TimetableSlot.

---

## 3. Day of Week

Supported days (no Saturday/Sunday-only classes; Sunday is the start of the academic week in the target region):

`Sunday`, `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`

Saturday is **not** supported. The system works on a 6-day academic week (Sun–Fri).

---

## 4. Period / Time Slot Model

AAMS does **not** use a fixed period/timeslot grid. Time slots are free-form `start_time` and `end_time` TimeFields on each `TimetableSlot`. The frontend renders a 6-slot display grid as a visual convenience:

| Display Slot | Time Range |
|-------------|------------|
| Period 1 | 09:00 – 10:00 |
| Period 2 | 10:00 – 11:00 |
| Period 3 | 11:15 – 12:15 |
| Period 4 | 12:15 – 13:15 |
| Period 5 | 13:45 – 14:45 |
| Period 6 | 14:45 – 15:45 |

These display labels are **hardcoded in the frontend** (`TIME_SLOTS` constant in `TimetableAdminView.tsx`, `StudentTimetableView.tsx`, `TeacherTimetableView.tsx`). They are **not** configurable and **not** stored in the database. The backend accepts any valid `time` values.

**Implication:** If the institution uses different period times, the frontend grid headers must be updated manually. The backend is already flexible.

---

## 5. Business Rules

### 5.1 Single Module Per Teacher Per Semester

A teacher may teach **only one distinct subject** across an entire semester. This applies across:
- TeacherAssignment records
- TeachingSession records
- TimetableSlot records

If a teacher already teaches Subject A in any section during Semester 1, they cannot be assigned Subject B in Semester 1 — even in a different section.

**Enforced by:** `assert_teacher_single_module_per_semester()` in `services.py`, called from both `TeacherAssignmentSerializer.validate()` and `TimetableSlotSerializer._validate_and_prepare()`.

**Same subject across multiple sections is allowed** (e.g., teaching the same module to Section A and Section B in different slots).

### 5.2 Semester Consistency

A slot's `subject` and `section` must both belong to the slot's `semester`.

**Enforced by:** `validate_semester_consistency()` in `services.py`.

### 5.3 Combined Section Rule

- Combined = 2+ sections in the `sections` M2M.
- `is_combined` is derived from the M2M count — never set by the client.
- Combined sections can only be used with `Lecture` or `Tutorial` class types.

### 5.4 Practical Single-Section Rule

`Practical` class type is restricted to exactly **one section**. Practical labs cannot be combined across sections. If an import or manual entry attempts to create a practical with multiple sections, it is rejected.

---

## 6. Conflict Detection Rules

All conflict detection is in `check_timetable_conflicts()` (`services.py:108-192`). Conflicts are checked on the **same day** within the **same semester**.

### 6.1 Teacher Collision
A teacher cannot be assigned to two classes at the same time (overlapping `start_time`–`end_time`) on the same day in the same semester.

### 6.2 Room Collision
If two slots use the **same room** on the **same day** with overlapping times in the same semester, the second is rejected. Room comparison is case-insensitive. Empty/blank rooms are never flagged (they are treated as "no venue constraint").

### 6.3 Section Collision
Each participating section (including combined-section members) can only have one class at a time. The check queries both the `section_id` FK and the `sections` M2M:
```python
Q(sections=sec_id) | Q(section_id=sec_id)
```

### 6.4 Practical Combined Constraint
If `class_type == Practical` and `len(target_sections) > 1`, the slot is rejected.

### 6.5 Error Presentation
The first conflict reason is returned as a string. All four rules are checked and the **first hit** is surfaced (not all simultaneously). The conflict check runs on every create and update via the serializer's `_validate_and_prepare()`.

---

## 7. APIs

### 7.1 Timetable CRUD

**Route:** `/api/academics/timetable/`

| Method | Permission | Description |
|--------|-----------|-------------|
| GET | AdminOrReadOnly | List slots. Teacher auto-scoped. |
| POST | Admin | Create slot. Full conflict validation. |
| PUT/PATCH | Admin | Update slot. Full conflict validation. |
| DELETE | Admin | Delete slot. |

**Query parameters (GET):**
- `?semester=<id>` — filter by semester
- `?section=<id>` — filter by section (matches FK or M2M)
- `?teacher=<id>` — filter by teacher (ignored for teacher-role users)
- `?day=<day_name>` — filter by day

**Teacher auto-scoping:** When a teacher-role user calls GET, the response is automatically filtered to their own slots (via `teacher_profile`). The `?teacher=` parameter is ignored for teacher users.

**Serializer:** `TimetableSlotSerializer` — includes `section_ids` (write-only), `subject_code`, `subject_name`, `teacher_name`, `section_name`, `section_names` (all read-only).

### 7.2 Teaching Sessions CRUD

**Route:** `/api/academics/teaching-sessions/`

| Method | Permission | Description |
|--------|-----------|-------------|
| GET | AdminOrReadOnly | List sessions. Teacher auto-scoped. |
| POST | Admin | Create session. |
| PUT/PATCH | Admin | Update session. |
| DELETE | Admin | Delete session. |

**Query parameters:** `?teacher=<id>`, `?semester=<id>`

### 7.3 Holiday CRUD

**Route:** `/api/academics/holidays/`

Standard CRUD. No semester scoping.

### 7.4 Excel Import (Admin-only)

**Route:** `/api/academics/timetable-import/`

| Action | Method | Description |
|--------|--------|-------------|
| list | GET | List admin's own import history (last 50) |
| preview | POST | Upload `.xlsx`, get parsed/validated/matched rows + summary |
| confirm | POST | Commit a pending session (re-validates against current DB) |

**Preview response shape:**
```json
{
  "session_uuid": "uuid",
  "file": { "sheet_name": "...", "sheet_count": 1 },
  "summary": {
    "counts": { "total_rows": N, "new_rows": N, "error_rows": N, ... },
    "unresolved": { "semesters": [], "sections": [], "subjects": [], "teachers": [] }
  },
  "rows": [ { "row": N, "plan": "new|update|unchanged|duplicate|error", "status": "...", "issues": [...] } ]
}
```

**Confirm request:** `{ "session_uuid": "..." }` (client sends only the UUID; the server re-validates everything).

**Confirm failure codes** (`400` unless noted): `session_uuid_invalid` (malformed UUID), `session_uuid_required`, `session_not_found` (`404`), `already_confirmed` (session already committed), `blocked_timetable_errors` (rows with blocking issues). Confirm is concurrency-safe: the session row is locked with `select_for_update()` inside `transaction.atomic()` and status re-checked under the lock, so simultaneous confirms serialize — exactly one commits, the others get `already_confirmed`.

**Upload caps:** `.xlsx` only, `MAX_FILE_BYTES = 5 MB`, `MAX_CELL_CHARS = 500`, and `MAX_DATA_ROWS = 5000 meaningful` data rows per worksheet. A workbook whose first worksheet has more than `MAX_DATA_ROWS` meaningful rows is rejected at preview with `400 file_too_many_rows` (the excess is never silently truncated).

### 7.5 Student Timetable (derived)

There is **no dedicated student timetable endpoint**. The student view fetches timetable slots filtered by their section from the generic `/api/academics/timetable/?section=<id>` endpoint. Combined slots where the student's section is in the M2M are included automatically by the section filter.

**Service call:** `studentService.getMyTimetable()` → `GET /api/academics/timetable/?section=<sectionId>`

### 7.6 Teacher Timetable (derived)

Similarly, the teacher view uses the auto-scoped `GET /api/academics/timetable/` (no `?teacher=` parameter needed — the backend enforces scope).

**Service call:** `teacherService.getTeacherTimetable()` → `GET /api/academics/timetable/`

---

## 8. Student Timetable View Requirements

### 8.1 Data Source
- Fetches from `GET /api/academics/timetable/?section=<studentSectionId>`.
- The response includes both single-section slots and combined slots (where the student's section is a participant).
- Display names (`subject_code`, `subject_name`, `teacher_name`, `room`, `section_names`) come pre-computed from the serializer — no secondary store lookups needed.

### 8.2 Display
- Weekly grid: 6 days (Sunday–Friday) × 6 periods.
- Each cell shows: subject code, subject name, teacher name, room.
- Combined sessions are visually indicated (purple background in current UI).
- No edit/delete actions — read-only view.

### 8.3 Current Implementation Status
- **Backend:** Fully implemented (`GET /api/academics/timetable/` with section filter).
- **Frontend service:** Live (`studentService.getMyTimetable()` via `apiClient`).
- **Frontend UI:** Live (`StudentTimetableView.tsx` renders server data in a grid).

### 8.4 Missing from Student View
- Semester selector (currently fetches all slots; student may want to filter by active semester).
- Today's highlight (no visual indication of which day is "today").

---

## 9. Teacher Timetable View Requirements

### 9.1 Data Source
- Fetches from `GET /api/academics/timetable/` (auto-scoped to teacher).
- Includes "Take Roll" action button per slot (triggers attendance session creation).

### 9.2 Current Implementation Status
- **Backend:** Fully implemented.
- **Frontend service:** Live (`teacherService.getTeacherTimetable()` via `apiClient`).
- **Frontend UI:** Live (`TeacherTimetableView.tsx` renders server data).

---

## 10. Admin Timetable Management Requirements

### 10.1 What the Admin Needs
1. **CRUD operations** — Create, edit, delete timetable slots.
2. **View modes** — Weekly grid, section-wise, teacher-wise, semester-wise, combined-sessions view.
3. **Filters** — Semester, section, teacher, subject, class type, day, room.
4. **Combined-section selection** — Multi-select sections for combined lectures.
5. **Conflict detection** — Server-side validation before save (implemented; serializer check_timetable_conflicts, surfaced inline in the modal).
6. **Excel import** — Upload `.xlsx`, preview, confirm (implemented; live 3-step wizard wired to `/api/academics/timetable-import/`).
7. **Import history** — View past imports (implemented; live history from server).
8. **Export** — Download filtered timetable as CSV (frontend-only, reads from current view data).

### 10.2 Current Implementation Status (Phase B.5 — COMPLETE)

| Capability | Backend | Frontend |
|-----------|---------|----------|
| Timetable CRUD API | IMPLEMENTED | **LIVE** (`timetableLiveApi` → `/api/academics/timetable/`) |
| Conflict detection | IMPLEMENTED (server, authoritative) | **SERVER-SIDE** (local duplicate removed from AddTimetableModal) |
| Excel import pipeline | IMPLEMENTED (`timetable_import.py`) | **LIVE** (3-step wizard; since B.6-F) |
| Import history | IMPLEMENTED (`list` action) | **LIVE** (server history; since B.6-F) |
| View modes/grid | N/A | WORKS (client-side filtering over server data) |
| Export CSV | N/A | MOCK (client-side, from filtered server data) |

**Phase B.5 wiring**: `TimetableAdminView.tsx` now loads slots from `GET /api/academics/timetable/` and uses `POST` / `PATCH` / `DELETE` for create/update/delete. `AddTimetableModal.tsx` no longer runs local conflict checks — the backend serializer (`check_timetable_conflicts`, `assert_teacher_single_module_per_semester`, `validate_semester_consistency`) is the single source of truth, and server 400/conflict messages are surfaced inline in the modal. The `aams_storage_change` listener was removed; data refreshes come from the API. Shared `DAYS` / `TIME_SLOTS` constants were extracted to `src/features/timetable/constants.ts`.

**Entity translation**: `timetableLiveApi` translates between the frontend camelCase view models (string IDs) and the DRF snake_case contract (integer IDs), including `start_time`/`end_time` (`HH:MM:SS` ↔ `HH:MM`) and the read-only display names from the serializer. Semester/section/subject/teacher lookups use the existing `semesterService`/`sectionService`/`subjectService`/`teacherService` view models.

---

## 11. Conflict Detection — Complete Rules Reference

| Rule | Scope | Condition | Error Message Pattern |
|------|-------|-----------|----------------------|
| Teacher collision | Same semester, same day | Overlapping time range for same teacher | "Teacher {name} already has a scheduled class ({subject}, {section}) from {start} to {end} on {day}." |
| Room collision | Same semester, same day | Overlapping time range for same room (case-insensitive, non-blank) | 'Classroom/Hall "{room}" is already booked by {teacher} for {subject} from {start} to {end} on {day}.' |
| Section collision | Same semester, same day | Overlapping time range for any participating section (FK or M2M) | 'Participating Section "{section}" already has a scheduled {class_type} ({subject}) from {start} to {end} on {day}.' |
| Practical combined | N/A | `class_type == Practical` and `len(sections) > 1` | "Practical classes are configured for single-section lab allocation..." |
| Single module rule | Same semester | Teacher already teaches a different subject | "Business rule violation: {teacher} is already assigned to {subjects} in this semester..." |
| Semester consistency | N/A | Subject or section not in slot's semester | "Subject/Section does not belong to the selected semester." |

**Conflict check behavior:** Returns the **first** conflict found (not all). The check runs inside the serializer's `_validate_and_prepare()` method, which is called on both create and update.

---

## 12. Excel Import Pipeline

Fully implemented in `apps/academics/timetable_import.py` (1181 lines).

### Workflow
```
Upload .xlsx → Extract rows → Match against DB → Validate → Preview → Admin confirms → Transactional commit
```

### Safety rules:
1. **Never auto-creates** semesters, subjects, sections, or teachers. Unmatched values are per-row errors.
2. **Teacher matching (Phase E):** when the workbook supplies a Teacher ID column, the slot is matched by `Teacher.teacher_id` — authoritative, casefold exact, no fuzzy logic. 0 matches → blocking `UNKNOWN_TEACHER_ID` (no name fallback, no auto-create); over-long ID → `TEACHER_ID_TOO_LONG`; ID vs name conflict → non-blocking `TEACHER_NAME_MISMATCH` warning with the ID winning. When no ID is supplied, the deterministic two-pass name matching applies (exact normalized name, then title-stripped; 0 → `UNKNOWN_TEACHER`, 2+ → `AMBIGUOUS_TEACHER`, both blocking).
3. **Combined-section expressions** (`F25 (4+5+6)`, `F1+F2+F3`, `F1/F2/F3`) expand to individual sections and create one slot with M2M.
4. **Confirm re-validates** against the current database (stale sessions cannot write wrong data) and is **all-or-nothing**: any row that re-plans as an error blocks the whole commit (400, zero writes, session stays `pending`).
5. **Idempotent**: re-importing the same workbook marks identical slots as "unchanged" and skips them.
6. **Transactional**: a mid-batch DB failure rolls back everything, leaving the session as `pending`.

### Column mapping:
The importer auto-detects header rows using alias matching. Required columns: Semester, Section, Day, Instructor (Lecturer **or** Teacher ID), Module (Code or Title), Start Time. Optional: End Time, Hours/Duration, Room, Class Type, Block, Course. Teacher-ID header aliases: `teacher id`, `teacher id number`, `lecturer id`, `instructor id`, `staff id`, `employee id`, `employee code`, `faculty id`, `faculty code` (bare `id` is intentionally not matched). Preview rows expose the resolved teacher (`teacher.teacher_id`, `match_method` = `id`|`name`, supplied values).

### Day aliases:
Sunday, Mon, Tuesday, Wed, Thursday, Fri (+ various abbreviations).

### Class type aliases:
lecture, lect, lec, tutorial, tut, practical, prac, lab, laboratory.

---

## 13. What Works vs. What's Missing

### Implemented (server-side)
- Full `TimetableSlot` CRUD API with conflict validation
- Full `TeachingSession` CRUD API
- Full `Holiday` CRUD API
- Full Excel import pipeline (preview/confirm)
- Teacher auto-scoping for both timetable and teaching sessions
- Combined-section support with M2M
- Practical single-section enforcement
- Single-module-per-semester rule
- 762 lines of backend tests (conflict detection, import validation, combined sections, idempotency)

### Implemented (frontend — live)
- Student timetable grid (reads from backend)
- Teacher timetable grid (reads from backend, with "Take Roll" action)
- Teacher classes view (uses teaching sessions from backend)
- **Admin timetable CRUD** (create / update / delete / list via `GET|POST|PATCH|DELETE /api/academics/timetable/`)
- **Admin conflict detection** (server-authoritative; 400 responses surface inline in the add/edit modal)
- **Shared timetable constants** (`DAYS`, `TIME_SLOTS` in `src/features/timetable/constants.ts`)

### Missing / Mock-only (frontend)
- **Admin Excel import wizard** — LIVE (3-step flow since B.6-F; no mock remains)
- **Admin import history** — LIVE (server-backed since B.6-F; no `store` reads)
- **Admin export** (client-side CSV from filtered server data)

### Not Required at This Time
- Period/timeslot configuration UI (display grid is hardcoded; adequate for current needs)
- Room management entity (rooms are free-text strings, not a separate model)
- Timetable template copying between semesters
- Automated timetable generation / optimization

---

## 14. Unresolved Decisions

1. **Period grid configurability:** The 6-period display grid is hardcoded. If the institution changes period times, the frontend constants must be updated manually. Should this become a configurable setting? **Recommendation:** Leave hardcoded for now; raise if needed.

2. **Room as free-text vs. entity:** Rooms are currently free-text strings. There is no Room model, no room list, no capacity tracking. This is adequate for the current system but limits room-based queries. **Recommendation:** Leave as-is unless room management becomes a requirement.

3. **TeachingSession vs. TimetableSlot relationship:** `AttendanceSession` links to `TeachingSession` (not `TimetableSlot`). The relationship between these two models is implicit — they share similar fields but are separate entities. There is no FK from one to the other. This means attendance sessions cannot be traced back to the specific timetable slot they came from. **Recommendation:** Accept this design; the teaching session is the "attendance trigger" while the timetable slot is the "scheduling definition."

4. **Saturday support:** Saturday is excluded from `DayOfWeek`. If any program runs Saturday classes, the model must be extended. **Recommendation:** Accept for now; raise as a requirement change if needed.

5. **Frontend grid header source:** The time period headers are defined in 3 separate files (`TimetableAdminView.tsx`, `StudentTimetableView.tsx`, `TeacherTimetableView.tsx`). They should ideally be a shared constant. **Recommendation:** Extract to a shared constants file during the wiring phase.

---

## 15. Implementation History

### Phase B.4 — Backend (COMPLETE)
Timetable models, CRUD APIs, conflict detection, and the Excel import pipeline with 54 passing backend tests.

### Phase B.5 — Wire Admin Timetable CRUD to Backend (COMPLETE)
- Created `src/services/timetableLiveApi.ts` (translates between frontend camelCase view models and the DRF snake_case contract).
- Wired `TimetableAdminView.tsx` to `GET|POST|PATCH|DELETE /api/academics/timetable/` and removed the `aams_storage_change` localStorage listener.
- Replaced local conflict checking in `AddTimetableModal.tsx` with server-side validation — the backend is the single source of truth.
- Preserved section multi-select and the Practical single-section constraint UX.
- Kept client-side view-mode filtering (weekly grid / section-wise / teacher-wise / semester-wise / combined) over server data.
- Extracted `DAYS` and `TIME_SLOTS` into `src/features/timetable/constants.ts`; updated the admin, student, and teacher views.
- The Excel import wizard (8-step UI) and import history remained mock at B.5 — **both were replaced by live flows in B.6/B.6-F** (see below).

### Next — Phase B.6 (IMPLEMENTED — completed, including B.6-F cleanup)

> **Implementation complete, B.6-F executed.** B.6-A (previewImport/confirmImport in `timetableLiveApi.ts`), B.6-B (row-presentation helper + 10 unit tests), B.6-C (confirm step), B.6-D (live import history), B.6-E (live CSV export without `store`) landed; the wizard was rewritten in place to the 3-step live flow. **B.6-F then deleted the dead mock stack**: `src/services/timetableApi.ts`, `src/services/timetableService.ts`, the legacy import types (`TimetableImportJob`, `ParsedTimetableRow`, `FieldMapping`, `MappingFieldKey`, `DiscoveredEntity`, `DetectedCombinedGroup`, `ValidationIssue`, `ImportPreviewSummary`, `ImportJobStatus`, `EntityMatchStatus`, `ConflictCheckResult`), and the `storage` import members (`importHistory` field, `getImportHistory`/`getImportJobById`/`saveImportJob`/`batchImportTimetable`). Final gate: `npm run lint`/`build`/`test` pass; zero references to any removed symbol. Note: `src/services/timetableImportService.ts` (a live backend import wrapper with the same preview/confirm/getHistory methods as `timetableLiveApi`) was unreferenced at the time and left in place; it has since been removed as dead code (superseded by `timetableLiveApi.ts`, zero references).

Phase B.6 replaces the mock 8-step wizard with a **live 3-step flow**: Upload → Preview → Review → Confirm. The frontend is a thin view over the backend import pipeline; the backend remains the single source of truth for Excel parsing, column mapping, entity matching, validation, conflict detection, planning, and transactional commit.

> **Excel-specific decisions are DEFERRED** until the real student workbook is provided. The completed plan intentionally does NOT fix column aliases, header layouts, single/multi-sheet structure, or time-column conventions. Nothing below depends on the workbook's exact shape.

#### Non-negotiable constraints
- No frontend auto-create of semesters / sections / subjects / teachers.
- No duplicate client-side validation.
- No invented conflict-resolution behavior the backend lacks.
- No `.xls`/`.csv` claims (backend accepts only `.xlsx`, ≤ 5 MB, first worksheet only).
- Keep `timetableService.ts` and `timetableApi.ts` untouched until a verified removal step exists.

#### Proposed sub-phases and file changes

**B.6-A — Live Upload + Preview**
- Add `timetableLiveApi.previewImport(file: File)` → `apiClient.post('/academics/timetable-import/preview/', formData)` (FormData already supported by `apiClient`; no Content-Type header). Returns `ApiTimetableImportPreview` or throws `ApiError` (backend `{detail, code}` for structural file failures).
- Display backend file metadata (`sheet_name`, `sheet_count`, `file_size`), `summary.counts`, and `rows`.
- Enforce `.xlsx` only + 5 MB pre-check in the UI; never fabricate sample files/data.

**B.6-B — Review**
- New pure helper `src/features/timetable/import/importRowPresentation.ts` maps `ApiTimetableImportRow` → display model and partitions rows by `status`/`plan`.
- Review table shows: semester, module (code/title), lecturer, section(s) (`section_raw` / expanded), class type, room/block, day, start/end, status, plan, issues.
- Distinct badges for errors, warnings, new, update, duplicate, unchanged. No re-validation, no resolve actions.

**B.6-C — Confirm**
- Add `timetableLiveApi.confirmImport(sessionUuid: string)` → `POST /api/academics/timetable-import/confirm/` with `{ session_uuid }` only.
- Render server final `summary.counts` (`created_rows`, `updated_rows`, `commit_rows`) + `summary.unresolved`; surface `ApiError` cleanly.
- Transactional/idempotent behavior stays on the backend; the UI only reports.

**B.6-D — Import History**
- `ImportHistoryModal` switches to `timetableLiveApi.getImportHistory()` and renders `ApiTimetableImportSession` directly (uuid, file_name, file_size, sheet_name, created_at, confirmed_at, status, summary.counts). No invented `importedBy`/`combinedSessionsCount`.

**B.6-E — Export Cleanup**
- New pure helper `src/features/timetable/timetableExport.ts` builds CSV from live `TimetableSlot` display fields already returned by the backend (`subjectName`, `teacherName`, `sectionNames`, plus semester name resolved from a `semesters` prop or deferred serializer field). No `store` lookups, no `timetableApi`. Existing export UX preserved (CSV download).

**B.6-F — Old Mock Wizard**
- `TimetableImportWizard.tsx` keeps its name + props shape; its internals are rewritten to the 3-step live flow (no rename needed, `TimetableAdminView` host stays stable).
- After B.6-A..E, `timetableApi.ts` and `timetableService.ts` have **zero references** (verified by grep). Their removal is a separate cleanup commit gated on a final grep + `npm run lint`/`build`/`test`. The legacy types (`TimetableImportJob`, `ParsedTimetableRow`, `DiscoverEntity`…) in `src/types/index.ts` are removed in the same cleanup.

#### Component / API flow
```
TimetableAdminView (host)
  └─ TimetableImportWizard (rewritten, 3 steps)
       Step 1 Upload → previewImport(file) ──▶ POST /api/academics/timetable-import/preview/
       Step 2 Review  ◀── ApiTimetableImportPreview {session_uuid, file, summary, rows}
       Step 3 Confirm → confirmImport(uuid) ──▶ POST /api/academics/timetable-import/confirm/
                           ◀── ApiTimetableImportConfirm {summary, rows} → onImportComplete → loadData()

  └─ ImportHistoryModal → timetableLiveApi.getImportHistory() ──▶ GET /api/academics/timetable-import/
  └─ ExportTimetableModal → timetableExport.ts (pure) over live slot display fields
```

#### Files

Will be modified: `src/services/timetableLiveApi.ts`, `src/features/timetable/import/TimetableImportWizard.tsx`, `src/features/timetable/import/ImportHistoryModal.tsx`, `src/features/timetable/ExportTimetableModal.tsx`, `src/features/timetable/TimetableAdminView.tsx` (minor: wizard callback signature / semesters prop), `docs/14-TIMETABLE-CALENDAR.md`.

New files: `src/features/timetable/import/importRowPresentation.ts`, `src/features/timetable/timetableExport.ts`.

Remain untouched (B.6): `src/services/timetableApi.ts`, `src/services/timetableService.ts`, `src/services/storage.ts`, `src/services/apiClient.ts`, `src/types/index.ts`, `src/types/api.ts`, all backend files, all other timetable view components.

#### POSSIBLE backend changes (NOT required now; noted for later)
- Add `semester_name`/`semester_code` to the timetable slot serializer (removes the export's semester-lookup prop).
- Multi-sheet import, `.csv`/`.xls` support, per-issue "resolve" endpoint, and a "detected headers" field in the preview response — only if the real workbook or admins demand them.

#### Testing plan
- Backend: already covered by 54 tests (preview success, invalid/missing/oversized/corrupt file, missing required columns, unknown/ambiguous entity errors, title-mismatch warnings, conflicts, new/update/duplicate/unchanged plans, confirm success/failure/idempotency, transaction rollback, combined sections, hours-vs-end precedence). No backend test changes expected unless an endpoint is added.
- Frontend (vitest, helper-level): `previewImport` builds FormData with the file and posts to the right path; `confirmImport` sends only `{session_uuid}`; `getImportHistory` returns sessions; row-presentation partitioning (error/warning/new/update/duplicate/unchanged); CSV builder quoting + combined section names + semester name from lookup with no `store` usage (grep assertion).

#### Recommended implementation order
1. `timetableLiveApi.ts` — add `previewImport` + `confirmImport`.
2. `importRowPresentation.ts` helper + unit tests.
3. Rewrite `TimetableImportWizard.tsx` (3-step live flow); minor `TimetableAdminView` adjustments.
4. `importHistoryModal.tsx` → live history.
5. `timetableExport.ts` + `ExportTimetableModal.tsx` live-data CSV.
6. Docs finalization.
7. Gate: `npm run lint`, `npm run build`, `npm run test`; grep to confirm zero `timetableApi`/`timetableService` references → propose cleanup commit (B.6-F).
8. Manual QA against a real workbook once provided.
