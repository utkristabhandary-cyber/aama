# AAMS — Database

## Status: IMPLEMENTED (PostgreSQL `aams_db`)

## Engine
- PostgreSQL (psycopg2 driver configured in base settings; DB name `aams_db`).
- Dev override uses local credentials in `.env` (SEE WARNING in `20-SECURITY-AUDIT.md`).

## Apps and Migrations

| App | Migrations | Notes |
|-----|-----------|-------|
| accounts | 0001_initial, 0002_expiringtoken, 0003_username_login | Custom User + ExpiringToken + username-based auth |
| academics | 0001 | Semesters/sections/subjects/assignments/timetable/teaching-session/holiday enums |
| attendance | 0001, 0002_*bssid*, 0003_remove_bssid | Session, Record, QRAttendanceSession; 0002/0003 added then removed the obsolete BSSID evidence column |
| students | 0001 | Student profile (ties User) |
| teachers | 0001 | Teacher profile (ties User) |
| notifications | 0001 | Notification model |
| reports | **NONE** | Pure computation over other apps (by design) |
| common | NONE | Shared mixins/constants |

> The `companion` app (DesktopCompanionDevice, TeacherNetworkAnchor, StudentCompanionDevice)
> and its tables were dropped in Phase 2. Its schema is preserved only in `docs/archive/`.

## Core Entities

### accounts
- `User(AbstractUser)` + `role` (admin/teacher/student), `teacher_profile`/`student_profile` OneToOne.
- `ExpiringToken(Token)` + `expires_at`.

### academics
- `Semester` (status active/upcoming/completed)
- `Section` (unique per semester+name)
- `Subject` (type Lecture/Tutorial/Practical; unique per semester+code)
- `TeacherAssignment` (unique teacher+semester+section+subject)
- `Holiday` (type enum, global)
- `TimetableSlot` (day/start/end/room, combined M2M)
- `TeachingSession` (recurring teaching block)

### students
- `Student`: user OneToOne, semester FK, section FK, roll_no, admission, name fields, guardian, contact.

### teachers
- `Teacher`: user OneToOne, teacher_code, name fields, email, phone, subjects M2M.

### attendance
- `AttendanceSession` (session_date, phase manual/qr, sections M2M, attendance_ids/marked_ids JSON, submitted_at)
- `AttendanceRecord` (unique session+student; status; QR evidence: `checked_in_at`, `network_verification_method` always `unavailable`)
- `QRAttendanceSession` (8-char token, TTL, student_ids/timestamps JSON, revoked; partial unique one-active-per-teacher)

### notifications
- `Notification` (user FK, title/body, read, created_at)

## Key Constraints & Indexes
- `unique(attendance_record: attendance_session, student)` — idempotency anchor.
- Partial unique index — one active QR per teacher.
- Unique `section/semester+name`, `subject/semester+code`, `assignment(teacher+semester+section+subject)`.
- DB CHECK `end_time > start_time` on timetable slots.
- On-delete PROTECT on attendance session → subject/teacher FKs (prevents silent history loss).

## Promotion / Archival
- **No migration or API** for promoting a cohort with attendance archival. `promotion` in the backend app is effectively a stub/absent; the frontend `PromotionService` localStorage mock was deleted in Phase G — the promotion screen now reads live data and disables Execute until a real endpoint exists. See `23-IMPLEMENTATION-GAPS.md`.