# AAMS — Architecture

## High-Level Topology

AAMS is a **web-only** system: one web frontend, one Django backend, one PostgreSQL
database. There is no Android client, no desktop companion, and no device registry
(removed in Phase 2).

```
                     ┌──────────────────────────────────────────┐
                     │              PostgreSQL /aams_db          │
                     │  (accounts, academics, attendance, ...)   │
                     └─────────────────────▲────────────────────┘
                                           │ Django ORM
                     ┌─────────────────────┴────────────────────┐
                     │           Django REST Framework           │
                     │  config/urls.py ───> 8 DRF app modules    │
                     │  ExpiringToken auth + role permissions     │
                     │  Custom exception handler                   │
                     └───────────▲──────────────────────────────┘
                                 │ HTTP + Token auth / CORS
                     ┌───────────┴──────────────┐
                     │  Vite + React 19 SPA      │
                     │  (web :3000)              │
                     └──────────────────────────┘
```

Web browsers cannot attest a classroom BSSID, so QR attendance runs on rolling-token
strength alone; network verification is always reported `unavailable` and client-claimed
network evidence is rejected.

## Components

### Backend — Django REST Framework (5.2 / DRF 3.18)

- Custom `User` model (`apps.accounts`) with `role` (admin/teacher/student).
- `ExpiringToken` extends DRF `Token` with `expires_at` (TTL default 30 days).
- 8 apps: `accounts`, `academics`, `teachers`, `students`, `attendance`, `reports`, `notifications`, `common`.
- Default DRF auth = `ExpiringTokenAuthentication` first, then `SessionAuthentication`.
- Default permission = `IsAuthenticated`; role permission classes in `apps.accounts.permissions` (`IsAdminUser`, `IsTeacherUser`, `IsStudentUser`, `IsAdminOrTeacher`, `AdminOrReadOnly`, `AdminOrTeacherRead`).
- per-view throttling for login + QR hot paths.
- Custom global exception handler normalizing to `{"detail": ...}` / `{"errors": ...}`. Handles both Django `ValidationError` shapes — the `message_dict` map and the flat `messages` list (a flat-list error previously crashed the handler with `AttributeError` → 500; now returns 400).
- `select_for_update()` + `transaction.atomic()` used on import-confirm endpoints so concurrent confirms of one session serialize (exactly one commits, others get 400 `already_confirmed`).

### Frontend — Vite + React 19 (TypeScript, Tailwind)

- SPA with in-memory route/state map in `App.tsx` (no React Router).
- `AuthContext` drives login/session restore; `apiClient` wraps fetch + token + 401 handling + pagination unwrap.
- Role-based view permission matrix in `App.tsx` (`VIEW_ROLE_PERMISSIONS`).
- Features: dashboard, academic (semesters/sections/subjects/assignment), timetable, attendance (admin + take-attendance), teacher (classes/students/reports/timetable), student (dashboard/attendance/history/timetable/QR-scanner/reports/profile), calendar/holidays, promotion, notifications, settings, profile.

## Data Flow — QR Attendance

1. Teacher starts `AttendanceSession` (web) → `POST /attendance/sessions/`.
2. Teacher starts QR on the session → `POST /attendance/qr/start/`.
3. Server generates/rotates 8-char token (`AAMSQR1|<session id>|<TOKEN>`); TTL default 15s.
4. Student scans the QR with the web camera (`StudentQRScannerView`) or enters the token; check-in → `POST /attendance/qr/check-in/`.
5. Server validates token (constant-time), section membership, and one active QR per teacher; writes `AttendanceRecord`. Network evidence is `unavailable` because browsers cannot attest a BSSID.
6. Teacher finalizes session → `POST /attendance/sessions/{id}/submit/` (immutable after).