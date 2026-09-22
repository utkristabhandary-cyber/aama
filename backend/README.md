# AAMS Backend (Django + DRF)

The backend for the Academic Attendance Management System. It mirrors the Phase 1
frontend data model and business rules so the system works without localStorage.

## Stack

- Python 3.13, Django 5.2, Django REST Framework 3.18
- PostgreSQL 16 (`aams_db` / `aams_user`)
- DRF `TokenAuthentication` + role-based permissions (`accounts.Role`)

## Quick start

Required environment (see `.env` at the repository root for real credentials —
the values below are placeholders):

```
DB_ENGINE=django.db.backends.postgresql
DB_NAME=aams_db
DB_USER=aams_user
DB_PASSWORD=CHANGE_ME
DB_HOST=127.0.0.1
DB_PORT=5432
```

```bash
py -m pip install -r requirements/development.txt
py manage.py migrate
py manage.py seed_demo_data   # idempotent demo dataset
py manage.py runserver
```

`GET /api/health/` returns `{"status": "ok"}` when the DB is reachable.

### Demo accounts (password `AaMS@#2026!`)

| Role    | Email               |
| ------- | ------------------- |
| Admin   | admin@aams.local    |
| Teacher | r.prof@aams.local   |
| Student | ananya.v@aams.local |

## Structure

- `config/` — settings (`base`, `development`), root `urls.py`, DRF error handler
- `apps/accounts/` — `User`, `Role`, login/logout/me, DRF tokens
- `apps/academics/` — semesters, sections, subjects, teacher assignments,
  timetable slots, teaching sessions, holidays
- `apps/teachers/` — teacher profiles
- `apps/students/` — student profiles (section + semester consistency)
- `apps/attendance/` — attendance sessions, records, QR attendance flow
- `apps/notifications/` — per-user notifications
- `apps/reports/` — summary / by-subject / at-risk report endpoints
- `apps/common/` — health endpoint, `seed_demo_data` command

## Business rules (enforced server-side)

- A teacher teaches **exactly one module per semester**. Assigning a second,
  different subject is rejected (`apps/academics/services.py`).
- Combined classes use a primary `section` FK plus a `sections` M2M; the section
  and subject must belong to the same semester.
- Timetable slots reject overlapping teacher, venue, or participating-section
  usage on the same day, and practicals must be single-section.
- Attendance is **UNMARKED by default**: students with no `AttendanceRecord` row
  are unmarked — presence is never auto-inferred.

## QR attendance flow

QR payloads are `AAMSQR1|<attendance_session_id>|<TOKEN>` with tokens in
`XXXX-XXXX` format, a ~15-second lifetime, and one active QR per teacher.

1. Teacher starts a QR session: `POST /api/attendance/qr/1/start/`
2. Students scan: `POST /api/attendance/qr/<id>/validate/` → `{ valid, ... }`
3. Server marks: `POST /api/attendance/qr/<id>/mark/`
4. Teacher submits: `POST /api/attendance/sessions/<id>/submit/` — afterwards the
   QR code is rejected.

## API overview

All routes are under `/api/`; auth via `Authorization: Token <token>`.

- `POST /api/auth/login/`, `GET /api/auth/me/`, `POST /api/auth/logout/`
- `/api/academics/`: `semesters/`, `sections/`, `subjects/`, `assignments/`,
  `timetable/`, `teaching-sessions/`, `holidays/`
- `/api/teachers/`, `/api/students/`
- `/api/attendance/`: `sessions/`, `records/`, `qr/`
- `/api/notifications/`, `/api/reports/summary/`, `/api/reports/by-subject/`

## Tests

```bash
py manage.py test
```

The test runner needs a role allowed to create databases (`ALTER ROLE
aams_user CREATEDB;`).