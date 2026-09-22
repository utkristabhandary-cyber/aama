# AAMS — Academic Module

## Status: IMPLEMENTED

## Models (`apps/academics`)

| Model | Fields | Notes |
|-------|--------|-------|
| `Semester` | name, code (unique), academic_year, start_date, end_date, status (active/upcoming/completed), description | ordering by `-start_date`; clean rejects end<start |
| `Section` | name, semester FK, capacity (default 35), room | unique(semester,name); ordering by semester code, name |
| `Subject` | code, name, semester FK, credits, type (Lecture/Tutorial/Practical), status | unique(semester,code); ordering by code |
| `Holiday` | date, title, description, type (institutional/national/festival/restricted/emergency) | ordering by date |
| `TeacherAssignment` | teacher FK, semester FK, section FK, subject FK, status, created_at | unique(teacher,semester,section,subject); clean cross-checks semester consistency |
| `TimetableSlot` | semester, section FK, sections M2M, subject, teacher, day, start/end_time, room, class_type, notes, is_combined | check end>start; combined = sections M2M >1 |
| `TeachingSession` | semester, subject, teacher, class_type, sections M2M, is_combined, day, start/end, room, notes | recurring teaching block |

## Hierarchy

```
Semester
├── Section (capacity, room)
├── Subject
├── TeacherAssignment (teacher × section × subject)
├── TimetableSlot(s) / TeachingSession(s)
└── (via Section) → Students

Teacher → assignments → subject/section within semester
```

## Business Rules (enforced in `apps/academics/services.py`)

1. **Single module per teacher per semester** (`assert_teacher_single_module_per_semester`): a teacher may only teach subjects already assigned/timelined/taught in the same semester — one module per semester. Mirrored from frontend `academicRules.ts`.
2. **Semester consistency** (`validate_semester_consistency`): subject and section must belong to the same semester as the assignment/timetable.
3. **Timetable conflict detection** (`check_timetable_conflicts`): teacher collision, room collision, section collision (incl. combined sections), practical-single-section rule.

## Viewsets (`apps/academics/views.py`) — AdminOrReadOnly

| Route | Filtering |
|-------|-----------|
| `/api/academics/semesters/` | ordering by start_date, code |
| `/api/academics/sections/` | `?semester=`, search, ordering |
| `/api/academics/subjects/` | `?semester=`, search, ordering |
| `/api/academics/holidays/` | — |
| `/api/academics/assignments/` | teacher-role auto-scoped to own; `?teacher=&semester=&section=&subject=` |
| `/api/academics/timetable/` | teacher auto-scoped; `?semester=&section=&teacher=&day=`; combined-section lookup via `Q(sections=) | Q(section_id=)` |
| `/api/academics/teaching-sessions/` | teacher auto-scoped; `?teacher=&semester=` |

## What Works
- Full CRUD for semester/section/subject/holiday/assignment/timetable/teaching-session with validation and business rules.
- Teacher scoping prevents cross-teacher probing on read.
- Both combined-section timetable and teaching-session supported.

## Missing / Notes
- No academic-year aggregates beyond `academic_year` string on semester.
- `Holiday` is global (no semester linkage) though the `type` field exists.
- ~~Frontend `timetableService.ts` implements local (mock) conflict logic~~ — **SUPERSEDED (B.6-F/Phase G)**: `timetableService`/`timetableApi` were deleted; conflict validation is server-side only (serializer `check_timetable_conflicts`), surfaced inline in the admin modal. Backend enforces rules in all cases.
