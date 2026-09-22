# AAMS — Student Module

## Status: IMPLEMENTED (web)

AAMS is web-only; all student functionality is delivered through the web frontend.
There is no Android student app (removed in Phase 2).

## Web (frontend `src/features/student/`)

| Screen | Status | Notes |
|--------|--------|-------|
| `StudentDashboard` | IMPLEMENTED | Overview; navigation |
| `StudentAttendanceView` | IMPLEMENTED | Overall + subject-wise via `/attendance/records/my/` |
| `StudentAttendanceHistoryView` | IMPLEMENTED | Per-session log |
| `StudentTimetableView` | IMPLEMENTED | Own timetable |
| `StudentQRScannerView` | IMPLEMENTED | QR scan; network evidence reports `unavailable` (browser cannot attest a BSSID) |
| `StudentReportsView` | IMPLEMENTED | Reported own attendance |
| `StudentProfileView` | IMPLEMENTED | Profile + semester/section info |

Role-gated routes per `VIEW_ROLE_PERMISSIONS`.

## Backend APIs for students

- `GET /api/auth/me/` — identity w/ semester_id, section_id.
- `GET /api/students/me/` — student profile.
- `GET /api/attendance/records/my/?semester=&subject=` — own summary (`summarize_student_attendance`).
- `POST /api/attendance/qr/check-in/` (student only) — QR check-in.
- `POST /api/attendance/qr/{id}/validate/`, `.../mark/` (student only).
- Reading reports (scoped) — `GET /api/reports/...`.

A student marks attendance by scanning the teacher's QR code with the web camera (or
entering the token); every check-in must be authorized by the student's own token — the
server never trusts a client-supplied identity.