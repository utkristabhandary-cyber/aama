# AAMS — Authentication & RBAC

## Status: IMPLEMENTED

## Overview

Username-based authentication with role-based access control, expiring tokens, and layered throttling. The backend is the authority; frontend route guards are UX only.

## Login Flow

`POST /api/auth/login/` with `{username, password}`:

1. `LoginSerializer` validates presence (no account-existence leak).
2. `authenticate()` checks credentials (username = student ID / teacher ID / admin handle — derived from profile linkage, or legacy email-based handles).
3. On success, `ExpiringToken.issue_for(user)` returns/creates the user's single unexpired token (reused until TTL).
4. Per-account throttle budget is cleared.
5. Returns `{token, user}`.

Role resolution: a `User` also carries optional `teacher_profile` (OneToOne `Teacher`) and `student_profile` (OneToOne `Student`). These are the authoritative identity links for `me/`, teachers' own data, and student data.

## Token Lifecycle

- `ExpiringToken(Token)` with `expires_at`.
- TTL from `AAMS_TOKEN_TTL_SECONDS` (default 2592000 s = 30 days; 0 = no expiry, dev only).
- `ExpiringTokenAuthentication.authenticate_credentials`:
  - Missing / invalid token → 401.
  - Inactive/deleted user → 401.
  - Expired token → deleted (cascade via parent Token) → 401.
  - Never degrades to Session auth for stale tokens.

## Endpoints

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| POST | `/api/auth/login/` | AllowAny + LoginThrottle/LoginBurstThrottle | Login |
| POST | `/api/auth/logout/` | IsAuthenticated | Revoke token |
| GET | `/api/auth/me/` | IsAuthenticated | Current user + identity incl. teacher_id/student_id/semester/section |
| POST | `/api/auth/password/change/` | IsAuthenticated | Self-service password change (full validator enforcement; clears `must_change_password`; rotates all tokens) |
| POST | `/api/auth/password/reset/` | IsAdminUser | Admin reset: re-applies the bootstrap temporary password + `must_change_password=True`; password never returned |

## Password Lifecycle (Phase D)

- **Institutional accounts** (created by a confirmed student/teacher import) start with a server-generated temporary password `<institutional-ID>@123`, hashed via `set_password` (never stored/returned/logged), and `must_change_password=True`.
- **First-login gate:** while `must_change_password` is set, only `/api/auth/login/`, `/api/auth/logout/`, `/api/auth/me/`, and `/api/auth/password/change/` are reachable. `MustChangePasswordGateMiddleware` (middleware.py) answers `403 {code: "must_change_password_required"}` on every other `/api/` route; the frontend additionally renders `ForcedPasswordChangeView` in place of the whole portal. There is no bypass route.
- **Reset lifecycle:** an admin reset returns the account to the bootstrap state on next sign-in (`must_change_password=True`, old tokens revoked).
- Detailed rules: `docs/25-INSTITUTIONAL-DATA-IMPORT.md` §14–§16.

## Throttling

- `LoginThrottle` per (IP, username), default `5/min`; reset on success.
- `LoginBurstThrottle` per IP, default `100/min`.
- Reads settings at request time; uses `REMOTE_ADDR` (no trust of X-Forwarded-For).

## RBAC Permission Classes (`apps/accounts/permissions.py`)

| Class | Allows |
|-------|--------|
| `IsAdminUser` | role == admin |
| `IsTeacherUser` | role == teacher |
| `IsStudentUser` | role == student |
| `IsAdminOrTeacher` | role in admin/teacher |
| `AdminOrReadOnly` | reads by any authenticated; writes by admin |
| `AdminOrTeacherRead` | reads by admin/teacher; writes by admin |
| `ReadOnly` | GET/HEAD/OPTIONS any authenticated |

## Password Storage & Validation

- Uses Django's default `PBKDF2` hasher (not overridden).
- `AUTH_PASSWORD_VALIDATORS` = similarity / min-length / common / numeric validators.

## Where Identity Is Resolved (server-authoritative)

- Teacher data scoped to `request.user.teacher_profile` (never email string match).
- Student data scoped to `request.user.student_profile`.
- QR check-in uses `request.user.student_profile` — never client-supplied identity.

## Known Issues

- `dev-only-insecure-aams-secret-key` used when DEBUG=True and no key set (acceptable dev-only, must set in prod).
- Current `.env` sets only DB vars; no `DJANGO_SECRET_KEY` → DEBUG path uses insecure default (see `20-SECURITY-AUDIT.md`).
- Frontend token in `sessionStorage` (XSS-exposed; see security doc).
