# AAMS — Audit Matrix (Feature-by-Feature Status)

Strict labels: **IMPLEMENTED** / **PARTIALLY IMPLEMENTED** / **MISSING** / **BROKEN** / **BLOCKED** / **UNKNOWN**.
Authority: repository code (not prior reports). Web-only (Phase 2 removed mobile/companion/offline).

## Matrix

| # | Feature | Component | Status | Notes / Evidence |
|---|---------|-----------|--------|------------------|
| 1 | Username login (student/teacher/admin) | Backend+Web | IMPLEMENTED | `/api/auth/login/`; accounts tests |
| 2 | Logout / token revocation | Backend+Web | IMPLEMENTED | `/api/auth/logout/` |
| 3 | Current-user identity (`me`) | Backend+Web | IMPLEMENTED | `/api/auth/me/` incl. role/identity |
| 4 | Expiring tokens | Backend | IMPLEMENTED | ExpiringToken + `expires_at` |
| 5 | Role-based access control (RBAC) | Backend | IMPLEMENTED | permission classes |
| 6 | Login throttling (per account+IP) | Backend | IMPLEMENTED | `AAMS_LOGIN_THROTTLE_RATE` |
| 7 | Semester management | Backend+Web | IMPLEMENTED | semesterService/api + tests |
| 8 | Section management | Backend+Web | IMPLEMENTED | sectionService/api + tests |
| 9 | Subject management | Backend+Web | IMPLEMENTED | subjectService/api + tests |
| 10 | Teacher management | Backend+Web | IMPLEMENTED | teacherService/api; AdminOrTeacherRead |
| 11 | Student management + enrollment | Backend+Web | IMPLEMENTED | studentService/api; students 0001 |
| 12 | Teacher→Subject→Section assignments (one module/semester) | Backend+Web | IMPLEMENTED | assignmentService; academics tests |
| 13 | Timetable management (CRUD + combined) | Backend | IMPLEMENTED | `/api/academics/timetable/` + tests |
| 14 | Timetable management (admin UI) | Web frontend | **MISSING (mock-only)** | `TimetableAdminView` uses localStorage `store`, not backend |
| 15 | Teaching sessions (recurring blocks) | Backend+Web | IMPLEMENTED | teachingService / academic |
| 16 | Holiday / calendar | Backend+Web | IMPLEMENTED | holidayService/api |
| 17 | Attendance session create/lifecycle | Backend | IMPLEMENTED | attendance/tests |
| 18 | Manual attendance mark | Backend+Web | IMPLEMENTED | `/sessions/{id}/mark/`, take-attendance UI |
| 19 | Bulk marking (atomic) | Backend+Web | IMPLEMENTED | `bulk_mark/` |
| 20 | Roll call (incl. UNMARKED) | Backend+Web | IMPLEMENTED | `roll/`, `roll_call_for_session` |
| 21 | Session finalization (immutable) | Backend+Web | IMPLEMENTED | `submit/`, `is_finalized` |
| 22 | Duplicate session prevention | Backend | IMPLEMENTED | `find_duplicate_session` |
| 23 | QR session start/rotate | Backend+Web | IMPLEMENTED | `/qr/start/`, token TTL 15s, one-active-per-teacher |
| 24 | QR token validate / constant-time | Backend | IMPLEMENTED | `token_is_current` |
| 25 | QR student check-in (idempotent) | Backend+Web | IMPLEMENTED | `check-in/`; 201/200/400; network method `unavailable` |
| 26 | QR stop / revoke | Backend+Web | IMPLEMENTED | `stop/` |
| 27 | QR throttling (per student/action) | Backend | IMPLEMENTED | 30/min, 60/min |
| 28 | Reports summary + by-subject | Backend+Web | IMPLEMENTED | reports tests; 75% shortage/clear |
| 29 | Student own attendance summary | Backend+Web | IMPLEMENTED | `/attendance/records/my/` |
| 30 | Promotion (cohort move + archive) | Backend+Web | **MISSING (mock-only)** | backend promotion API/archive absent; frontend `store` mock |
| 31 | Notifications (user read/unread) | Backend+Web | PARTIALLY IMPLEMENTED | own read/unread backend; admin broadcast MISSING (mock) |
| 32 | Settings backend | Backend+Web | **MISSING** | shell screen only |

## Counts (32 rows above, non-mutually-exclusive)
- IMPLEMENTED (fully verified): **~28** rows.
- PARTIALLY IMPLEMENTED: notifications (31).
- MISSING / mock-only: timetable admin UI (14), promotion (30), settings (32).
- BROKEN: **none identified**.
- UNKNOWN: **none** (all enumerated items have source evidence).

## Cross-Reference
- Detailed write-ups: docs/04–19.
- Gaps: docs/23. Next plan: docs/24. Issues: docs/22.