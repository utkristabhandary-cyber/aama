# AAMS — Admin Module

## Status: IMPLEMENTED (web)

## Surface

Admin functionality is on the **web application** only. AAMS is web-only (Phase 2); there is no Android app.

## Admin Screens (frontend, `VIEW_ROLE_PERMISSIONS` admin-only or role-conditional)

| View | Status |
|------|--------|
| `AdminDashboard` | IMPLEMENTED |
| `AcademicView`, `SemestersView`, `SectionsView`, `SectionAllocationCSVView`, `SubjectsView` | IMPLEMENTED |
| `TeachersView`, `StudentsView`, `AssignmentsView` | IMPLEMENTED |
| `TimetableAdminView` | IMPLEMENTED |
| `AttendanceAdminView` | IMPLEMENTED |
| `TakeAttendanceView` | IMPLEMENTED (shared w/ teacher) |
| `ReportsView` | IMPLEMENTED |
| `CalendarHolidaysView` | IMPLEMENTED |
| `PromotionView` | IMPLEMENTED |
| `NotificationsView` | IMPLEMENTED |
| `SettingsView` | IMPLEMENTED (empty shell in App route — backend has no settings API; see note) |
| `UserProfileView` | IMPLEMENTED |

## Admin Backend Permissions

- Academic CRUD: `AdminOrReadOnly` (writes admin-only).
- Teacher/Student CRUD: `AdminOrTeacherRead` (writes admin-only).
- Attendance session management: `IsAdminOrTeacher`; admin may manage any non-finalized session.
- Reports: `IsAdminOrTeacher`, scoped institution-wide for admin.
- Promotion: **live-read, execution blocked by design** — the wizard reads real cohorts and server-computed attendance; the Execute step is disabled because no backend promotion endpoint exists (see Phase G / `PHASE_G_SOURCE_OF_TRUTH_REPORT.md`). See `23-IMPLEMENTATION-GAPS.md`.
- Settings: **no backend** — `SettingsView` is an intentionally read-only summary (institution/term + server-enforced policy values); no settings API.

## What Works (code-verified)

- Full CRUD over academic structure, teachers, students, assignments, timetable, holidays.
- CSV section allocation (frontend heavily engineered; backend PATCH/PUT per student).
- Attendance admin view (list sessions, conduct attendance).
- Reports (summary + by-subject) institution-scoped, plus the dedicated admin analytics endpoint `/api/reports/admin/` (counts, attendance aggregates, at-risk list, per-subject/per-section rows, student roster with guardian contacts) powering `AdminDashboard` and `ReportsView`.
- Notifications (own-scoped view/model; list + mark-read/mark-all-read + own delete; no server-side admin broadcast — the broadcast UI was removed in Phase 8).
- Promotion (frontend reads live data; Execute disabled + explanatory banner — no backend endpoint; see gap).

## Missing / Notes

- No backend promotion endpoint (failed-state migration/attendance archival unimplemented); the UI does NOT pretend this is done — Execute is disabled with an explanatory banner, and the wizard verifies the student semester is server-managed/write-protected.
- No backend settings API; `SettingsView` shows only values the server owns (read-only, honest notes).
- Notifications have no server-side "send announcement/broadcast" path — only own-scoped read/mark-read/delete. Admin-authored notifications are out of current scope.
