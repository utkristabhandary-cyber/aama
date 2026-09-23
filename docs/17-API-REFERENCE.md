# AAMS — API Reference

Base URL (dev): `http://127.0.0.1:8000/api` (web frontend)

Auth: `Authorization: Token <token>` (ExpiringToken). Default permission `IsAuthenticated`.

## Auth (`/api/auth/`)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| POST | `/auth/login/` | AllowAny + throttle | `{username,password}` → `{token, user}` |
| POST | `/auth/logout/` | IsAuthenticated | revoke token |
| GET | `/auth/me/` | IsAuthenticated | user + teacher_id/student_id/semester/section |

## Health

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET | `/health/` | AllowAny | liveness |

## Academics (`/api/academics/`)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| CRUD | `/academics/semesters/` | AdminOrReadOnly | |, ordering |
| CRUD | `/academics/sections/` | AdminOrReadOnly | `?semester=` |
| CRUD | `/academics/subjects/` | AdminOrReadOnly | `?semester=` |
| CRUD | `/academics/holidays/` | AdminOrReadOnly | |
| CRUD | `/academics/assignments/` | AdminOrReadOnly | teacher auto-scoped; `?teacher=&semester=&section=&subject=` |
| CRUD | `/academics/timetable/` | AdminOrReadOnly | teacher auto-scoped; combined lookup |
| CRUD | `/academics/teaching-sessions/` | AdminOrReadOnly | teacher auto-scoped |
| ViewSet | `/academics/timetable-import/` | AdminOnly (writes) / AdminOrReadOnly reads | Timetable import sessions (`preview/`, `template/`, `export/`, `confirm/`, list/detail) — see table below |

## Institutional Import/Export (`/api/imports/`, Phase H)

`<kind>` ∈ `students` \| `teachers`. Every action is admin-only for writes/downloads;
preview/create only stages or commits no data without the final confirm step.

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| POST | `/imports/{kind}/preview/` | AdminOnly | multipart `file` → server parses/normalizes/classifies, stores staging session, returns summary + mapped rows + issues. NO writes. |
| GET | `/imports/{kind}/template/` | AdminOnly | canonical `.xlsx` template (current AAMS format), `Content-Disposition: attachment` |
| GET | `/imports/{kind}/export/` | AdminOnly | server-generated `.xlsx` export of current live records (openpyxl), `Content-Disposition: attachment` |
| GET | `/imports/{kind}/` | AdminOnly | import session history (staging + confirmed) |
| GET | `/imports/{kind}/{uuid}/` | AdminOnly | one staging session (re-read the plan) |
| POST | `/imports/students/confirm/` | AdminOnly | `{session_uuid}` → atomic commit of all planned student rows; `select_for_update` + idempotent; 400 codes on error (none written) |
| POST | `/imports/teachers/confirm/` | AdminOnly | same contract for teacher rows |

Timetable import (viewset under academics):

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| POST | `/academics/timetable-import/preview/` | AdminOnly | same analyze-only staging contract for timetables/assignments |
| GET | `/academics/timetable-import/template/` | AdminOnly | `.xlsx` timetable template |
| GET | `/academics/timetable-import/export/` | AdminOnly | server-generated timetable `.xlsx` export |
| POST | `/academics/timetable-import/confirm/` | AdminOnly | atomic all-or-nothing commit; re-validates teacher identity |
| GET | `/academics/timetable-import/` | AdminOnly | session history |

Shared safety contract (all three kinds): **UPLOAD ≠ IMPORT** — `preview/` only
stages a plan keyed by a server-issued `session_uuid`; only `confirm/` writes, and
a confirmed session commits atomically and idempotently (re-running the same
workbook yields `unchanged`, never duplicates).

## Teachers (`/api/teachers/`)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| CRUD | `/teachers/` | AdminOrTeacherRead | writes admin-only |
| GET | `/teachers/me/` | IsTeacherUser | own profile |

## Students (`/api/students/`)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| CRUD | `/students/` | AdminOrTeacherRead | writes admin-only |
| GET | `/students/me/` | IsStudentUser | own profile |

## Attendance (`/api/attendance/`)

### Sessions
| Method | Path | Perm | Notes |
|--------|------|------|-------|
| CRUD | `/attendance/sessions/` | IsAdminOrTeacher | PATCH/DELETE blocked if finalized |
| POST | `/attendance/sessions/{id}/mark/` | IsAdminOrTeacher | one student |
| POST | `/attendance/sessions/{id}/bulk_mark/` | IsAdminOrTeacher | atomic batch |
| GET | `/attendance/sessions/{id}/roll/` | IsAdminOrTeacher | roster incl. UNMARKED |
| POST | `/attendance/sessions/{id}/submit/` | IsAdminOrTeacher | finalize (immutable) |

### Records
| Method | Path | Perm | Notes |
|--------|------|------|-------|
| CRUD | `/attendance/records/` | IsAdminOrTeacher | |
| GET | `/attendance/records/my/` | IsStudentUser | own summary |

### QR
| Method | Path | Perm | Notes |
|--------|------|------|-------|
| POST | `/attendance/qr/start/` | IsAdminOrTeacher | one active per teacher |
| GET | `/attendance/qr/{id}/` | IsAdminOrTeacher | |
| POST | `/attendance/qr/check-in/` | IsStudentUser | server-authoritative; network method always `unavailable` |
| POST | `/attendance/qr/{id}/validate/` | IsStudentUser | token validate |
| POST | `/attendance/qr/{id}/mark/` | IsStudentUser | legacy token path |
| POST | `/attendance/qr/{id}/stop/` | IsAdminOrTeacher | revoke |

## Reports (`/api/reports/`)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET | `/reports/summary/` | IsAdminOrTeacher | institution or own |
| GET | `/reports/by-subject/` | IsAdminOrTeacher | per-subject |
| GET | `/reports/admin/` | IsAdminUser | admin-only institution analytics (counts, attendance aggregates, at-risk, by-subject, by-section, student roster) |

## Notifications (`/api/notifications/`)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET | `/notifications/` | IsAuthenticated | own only |
| POST | `/notifications/{id}/mark_read/` | IsAuthenticated | mark one own notification read |
| POST | `/notifications/mark_all_read/` | IsAuthenticated | mark all own notifications read |
| DELETE | `/notifications/{id}/` | IsAuthenticated | delete own notification only (others → 404) |

> No backend "send/broadcast" create endpoint exists; the frontend broadcast UI was removed in Phase 8.

## Admin UI Backend Dependency (important)

Phase G removed the localStorage mock layer, so every admin screen is now server-backed or honestly read-only:

| Admin feature | Wired to backend? | Service |
|---------------|-------------------|---------|
| Semester / Section / Subject CRUD | YES | apiClient |
| Teachers / Students / Assignments CRUD | YES | apiClient |
| Holidays CRUD | YES | apiClient |
| Reports (admin summary) | YES | apiClient |
| Attendance sessions/records | YES | apiClient |
| **Timetable admin CRUD** | **YES** | apiClient (`/api/academics/timetable/` + import endpoints) |
| **Student/Teacher/Timetable imports** | **YES (Phase H)** | `studentImportService` / `teacherImportService` / `timetableLiveApi` (preview/stage/confirm) + template/export downloads (`/api/imports/{kind}/…`, `/api/academics/timetable-import/…`) |
| **Template & export downloads** | **YES (Phase H)** | Server-generated `.xlsx` (`Download Template` / `Export .xlsx` on Students, Teachers, Timetable; admin-only) |
| **Section allocation CSV** | **YES** | sectionAllocationService (live preview; apply = `PATCH /api/students/{id}/` per row, incl. `section: null` for unallocations) |
| **Promotion** | **Read-only** (live cohorts + `/api/reports/admin/`); Execute disabled — no backend promotion endpoint | PromotionView |
| **Notifications read / mark-read / delete** | YES (own-scoped only) | apiClient |
| **Notifications broadcast (admin)** | **Removed (no such endpoint)** | — |
| **Settings** | **Read-only summary** (backend-managed values; no settings API — no fake save) | SettingsView |
| **Global search / header / profile** | YES (role-scoped live search; no demo reset) | apiClient services |

See `23-IMPLEMENTATION-GAPS.md` for the features that genuinely lack a backend endpoint (promotion API, settings API, section-allocation bulk transaction).
