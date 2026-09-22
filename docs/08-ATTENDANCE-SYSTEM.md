# AAMS — Attendance System

## Status: IMPLEMENTED

## Overview

Server-authoritative attendance session engine. A session groups students (via sections) under a subject + teacher + date; attendance records capture per-student marks. Finalized sessions are immutable.

## Backend Models (`apps/attendance`)

### `AttendanceSession`
- `session_date`, `subject` (FK, PROTECT), `teacher` (FK, PROTECT), `phase` (manual/qr)
- `start_time`, `planned_end_time`, `end_time` (nullable)
- `sections` (M2M) — participating sections
- `teaching_session` (FK, nullable) — optional linked teaching block
- `attendance_ids` (JSON), `marked_ids` (JSON)
- `late_reason`
- `is_auto_present` (always False — unmarked ≠ present)
- `created_by` (FK user), `created_at`, `submitted_at`
- `is_finalized` property = `submitted_at is not None`
- ordering `-session_date, start_time`

### `AttendanceRecord`
- `attendance_session` (FK CASCADE), `student` (FK CASCADE)
- `status` (present/absent/late, default late), `marking`, `marking_complete`
- `submitted_at`
- QR evidence: `checked_in_at`, `network_verification_method` (always `unavailable` — browsers cannot attest a network; the `bssid_normalized` column and other methods were removed in Phase 2)
- unique(attendance_session, student)
- **Unmarked = no record row** (deliberately; UNMARKED ≠ absent ≠ present)

### `QRAttendanceSession`
- `teacher`, `attendance_session`, `token` (8-char rotating), `token_generated_at`, `student_ids` (JSON), `student_timestamps` (JSON), `revoked`, `created_at`
- Partial unique index: one active QR per teacher
- `rotate()`, `get_current_token()` (auto-rotate after `AAMS_QR_TOKEN_TTL_SECONDS` default 15s)

## Core API (`/api/attendance/`)

### Sessions (`AttendanceSessionViewSet`, IsAdminOrTeacher)
| Action | Method/Path | Notes |
|--------|-------------|-------|
| create | POST `/sessions/` | Teacher-validates sections vs assignment; duplicate detection `find_duplicate_session` |
| list | GET `/sessions/` | filters: `teacher/subject/section/semester`; teacher auto-scoped |
| retrieve | GET `/sessions/{id}/` | |
| update/partial | PATCH `/sessions/{id}/` | blocked if finalized |
| destroy | DELETE `/sessions/{id}/` | blocked if finalized |
| mark | POST `/sessions/{id}/mark/` | one student |
| bulk_mark | POST `/sessions/{id}/bulk_mark/` | atomic all-or-nothing batch |
| roll | GET `/sessions/{id}/roll/` | roster incl. UNMARKED |
| submit | POST `/sessions/{id}/submit/` | finalize; immutable after |

### Records (`AttendanceRecordViewSet`, IsAdminOrTeacher)
- CRUD + `GET /records/my/` (student scoped summary)

### QR (`QRAttendanceSessionViewSet`)
| Action | Permission | Notes |
|--------|-----------|-------|
| start | POST `/qr/start/` | Teacher; one active QR per teacher |
| check-in | POST `/qr/check-in/` | Student; server-authoritative |
| validate | POST `/qr/{id}/validate/` | Student |
| mark | POST `/qr/{id}/mark/` | Student (legacy token path) |
| stop | POST `/qr/{id}/stop/` | Teacher/admin |

## Key Services (`services.py`)

- `start_qr_session`/`stop_qr_session` — lifecycle; token rotation; reset ledger on re-target.
- `build_qr_payload` — `AAMSQR1|session_id|TOKEN`.
- `validate_qr` — returns valid/message/payload.
- `mark_qr_student` — idempotent mark (get_or_create; update status).
- `mark_qr_student_via_code` — server-authoritative check-in (also updates QR ledger).
- `parse_qr_payload` / `resolve_network_verification` — the latter always returns `("unavailable", None)` on the web.
- `check_in_student` — full validation chain (see 09-QR-ATTENDANCE).
- `token_is_current` — constant-time compare.
- `finalize_attendance_session` — set marked_ids, late_reason, end_time, submitted_at.
- `find_duplicate_session` — prevent recording same subject same date overlapping section.
- `roll_call_for_session` — full roll incl. UNMARKED.
- `summarize_student_attendance` — per-student aggregation.

## What Works

- Manual + QR attendance, roll call, bulk marking (atomic), finalization (immutable), duplication prevention.
- Student attendance summary API.
- Student QR camera scanner lifecycle (viewfinder state machine, honest error mapping, stream cleanup) —
  see `09-QR-ATTENDANCE.md`.

## Missing / Notes
- No offline/queued attendance (offline capability was removed in Phase 2; see `docs/archive/12-OFFLINE-ATTENDANCE.md`).
- `is_auto_present` / auto-present behavior intentionally not implemented.
- No attendance editing after finalize (by design).
- Attendance historical archiving on promotion has **no server API/finalization** (unsupported). The mock promotion service that claimed it was deleted in Phase G; the promotion wizard is read-only and its Execute step is disabled until a real promotion/archival endpoint exists. See `23-IMPLEMENTATION-GAPS.md`.