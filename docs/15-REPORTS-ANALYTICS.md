# AAMS — Reports & Analytics

## Status: PARTIALLY IMPLEMENTED (admin/teacher/student report families complete, incl. admin analytics + client CSV export; promotion execution has no backend endpoint — UI read-only, Execute disabled)

## Backend (`apps/reports`)

Decision record: **No migrations** for `reports` (it is a pure computation layer over other apps). Both report families are computed from `AttendanceRecord` / `AttendanceSession` / `Section`.

### Endpoints
| Method | Path | Permission | Scope |
|--------|------|-----------|-------|
| GET | `/api/reports/summary/` | IsAdminOrTeacher | Admin: institution; Teacher: own spans |
| GET | `/api/reports/by-subject/` | IsAdminOrTeacher | per-subject breakdown, scoped |
| GET | `/api/reports/admin/` | IsAdminUser | institution-wide analytics payload (admin-only) |
| GET | `/api/teachers/reports/` | IsTeacherUser | per-class teacher report |
| GET | `/api/students/me/`, `/api/attendance/records/my/` | IsStudentUser | student own summary |

### Summary Computation
- Group sessions by subject (`by_session_overview`).
- Group by teacher, semester, section, session date.
- Per subject: sessions held, marked, students marked, present/late/absent counts, `%` (present/marked), **At Risk (Clear/Shortage)** at 75% threshold (`compute_clear_shortage`).
- Rolled-up aggregate for admin.

### By-Subject
- Per-subject: sessions, students, avg attendance %, % students above 75%.

### Teacher Per-Class Report
- Module, theory/practical, sessions, dates, roster, attendance summary per student.

## Frontend
- `ReportsView` (admin): institution-wide analytics via the admin-only `GET /api/reports/admin/` payload (counts, attendance aggregates, at-risk list, per-subject/per-section rows, and the full student roster with guardian contacts). Statics, filters, and CSV export are derived client-side from that single payload.
- `AdminDashboard` (admin): same `GET /api/reports/admin/` payload for live stat cards, subject bars, and at-risk summary; today's timetable + holiday are loaded live from `/api/academics/timetable/?day=` and `/api/academics/holidays/`.
- `TeacherReportsView`: own reports + per-class; backend `/api/teachers/reports/`.
- `StudentReportsView`: own summary + exam-eligibility (75% threshold) using `/api/attendance/records/my/`.

## What Works
- Server-computed summaries & shortages (single source of truth).
- Teacher and student scoping.
- Advanced-report CLI script (`reports/scripts/advanced_report_script.py`) for historical semester analysis.

## Missing / Notes
- **Promotion execution has no backend endpoint** — the legacy mock `PromotionService` was deleted in Phase G; the promotion screen now shows live cohorts + server-computed attendance and disables Execute with an explanatory banner. No promotion report/archival snapshot exists server-side. See `23-IMPLEMENTATION-GAPS.md`.
- CSV export for the admin roster is generated client-side in `ReportsView` (no dedicated backend export endpoint).
- No attendance historical migration/archival of semesters on promotion (backend gap; not simulated in the UI).
