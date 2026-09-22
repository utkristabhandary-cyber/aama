# AAMS — Teacher Module

## Status: IMPLEMENTED (web)

AAMS is web-only; all teacher functionality is delivered through the web frontend.
There is no teacher mobile app and no desktop companion (removed in Phase 2).

## Web (frontend `src/features/teacher/`)

| Screen | Status | Notes |
|--------|--------|-------|
| `TeacherDashboard` | IMPLEMENTED | Today's classes, start attendance |
| `TeacherClassesView` | IMPLEMENTED | Own teaching sessions / classes |
| `TeacherStudentsView` | IMPLEMENTED | Student roster w/ attendance summary |
| `TeacherReportsView` | IMPLEMENTED | Per-class reports |
| `TeacherTimetableView` | IMPLEMENTED | Own timetable; start attendance from slot |
| `TakeAttendanceView` (shared) | IMPLEMENTED | Manual / bulk mark, QR start, roll, submit |

## Backend APIs for teachers (all IMPLEMENTED)

- `GET /api/auth/me/`
- `GET /api/teachers/me/` — own profile
- `GET /api/teachers/students/` — own roster + summaries (IsTeacherUser)
- `GET /api/teachers/reports/` — per-class reports (IsTeacherUser)
- `GET /api/academics/assignments/` — auto-scoped to own
- `GET /api/academics/timetable/` — auto-scoped to own
- `GET /api/academics/teaching-sessions/` — auto-scoped to own
- `AttendanceSessionViewSet` (`/attendance/sessions/…`) — IsAdminOrTeacher, teacher-managed own; mark/bulk_mark/roll/submit
- `AttendanceRecordViewSet` (`/attendance/records/…`) — IsAdminOrTeacher
- `GET /api/reports/summary/`, `/api/reports/by-subject/` — IsAdminOrTeacher (scoped to own)

## Notes on Teacher Workflow

- Teacher identity always from `request.user.teacher_profile`.
- Teachers cannot create subjects/students (Admin-only writes); read access via `AdminOrTeacherRead`.
- QR attendance: teacher starts a QR session and displays the rolling token on the classroom screen; students scan it with their web camera.

## What's Working (code-verified)

- Full web teacher workflow: classes → take attendance → bulk mark → finalize; own-scoped reports and roster.
- Advanced reports w/ Clear/Shortage (75%) threshold.