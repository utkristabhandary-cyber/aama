# Phase 2A — Security Hardening + Real Authentication Foundation

Status: **COMPLETE** — all changes implemented, verified, and regression-tested.

---

## 1. Executive Summary

Phase 2A replaces the mock/foundation auth layer with a hardened, role-scoped,
real-authentication baseline across the full stack:

- **Backend** — ownership and role-based authorization everywhere: attendance
  sessions (teacher owns; admin overrides), attendance records (teacher-owned),
  QR roll-call (per-action role gates; identity never client-supplied), reports
  (teacher-scoped), and directory endpoints (teachers/students PII scoped by
  role). `POST /api/auth/` now drives the real DRF Token flow, and the API
  surfaces a proper 401 for missing **and** stale credentials.
- **Frontend** — real login/me/logout against the live API with tokens stored
  only in `sessionStorage`, global 401 ("session expired") handling, and removal
  of the mock auto-admin, role-switcher, and fake credentials.
- **Config** — `DJANGO_SECRET_KEY` is now mandatory when `DEBUG=false`; removed
  the wildcard `0.0.0.0` allowed host; `.env.example` rewritten (no stale Gemini
  template, no real values).
- **Tests** — backend suite grew 21 → **45 tests, all passing**; `npm run lint`
  and `npm run build` clean.

No database migrations were required and the seeded development database is
verified intact.

---

## 2. Scope

**In scope (done):**
- DRF authorization/ownership hardening for attendance, reports, teachers,
  students.
- Real `TokenAuthentication` + `SessionAuthentication` auth stack and the
  `/api/auth/login|me|logout` contract consumed by the frontend.
- QR roll-call security: server-derived identity, per-action permissions, no
  live-token exposure to students.
- Frontend: `sessionStorage` tokens, 401 handling, real logout, demo-credential
  quick-fill (no auto-login / no role switching).
- Settings env-gating and `.env.example` rewrite.
- Security regression tests + a report.

**Out of scope (explicitly deferred — not started):**
- Full frontend service → API integration (list views still consume the mock
  `store`), admin CRUD wiring, teaching-session/timetable consolidation, full
  attendance & QR screens on the live API, BSSID binding, promotion/import
  rewrite, dashboard API, backup/restore, settings persistence, notifications
  redesign, UI redesign, token expiry/refresh, brute-force throttling.

---

## 3. Credential Handling & Token Lifecycle

- **Storage (frontend):** the DRF token lives in `sessionStorage` (`aams_auth_token`)
  as the single source of truth. `clearToken()` removes it from both
  `sessionStorage` and legacy `localStorage` keys (`aams_auth_token`,
  `aams_current_user`) so a pre-mock session can never leak through.
- **Login:** `POST /api/auth/login/` (AllowAny) exchanges email+password for
  `{token, user}` (`UserSerializer`); the frontend then calls `GET /api/auth/me/`
  to overlay `teacher_id / student_id / semester_id / section_id` onto `User`.
- **Restore:** on app boot the frontend only calls `/auth/me/` if a token
  exists; invalid/expired tokens clear storage instead of falling back to a
  mock user.
- **Logout:** `POST /api/auth/logout/` deletes the server-side token (204); the
  client clears storage **regardless** of the server response.
- **Expiry/session loss:** any 401 response (e.g. revoked/expired token while
  a session exists) triggers a global `aams:unauthorized` event; `AuthContext`
  drops the user and shows a "Session expired" toast — but only when a token was
  actually present, so a routine logout never double-toasts.
- **Mock removal:** `mock-jwt-token-*`, auto-admin seeding, `loginAsRole`,
  `switchRole`, and the `aams_current_user` mock key are gone. Any leftover mock
  artifacts are scrubbed whenever auth state is loaded/cleared.

---

## 4. Authorization & Ownership Changes (backend)

New helper in `apps/accounts/permissions.py`:
`AdminOrTeacherRead` — read for admin+teacher, write for admin only.

**Authentication stack order** (`settings/base.py`): `TokenAuthentication` now
runs **before** `SessionAuthentication`. This is what makes a stale/bad
`Authorization: Token …` return 401 instead of degrading to 403 (previously
`SessionAuthentication` claimed the anonymous user first and the token was never
checked). Confirmed by tests.

### Attendance sessions (`AttendanceSessionViewSet`)
- Reads: `IsAdminOrTeacher`. Writes: `IsTeacherUser`. Anonymous ⇒ 401.
- **Ownership:** teachers only ever see/mark/roll/update/delete their own
  sessions (`get_queryset` scoped by `teacher_profile`).
- **Create/update** run `_validate_sections_for_teacher`: every selected section
  must be covered by the teacher's **active** `TeacherAssignment` for that
  subject; a linked `teaching_session` must be the caller's own and its subject
  must match, and must cover all session sections. Admin bypasses via the
  `is_admin` check in ownership assertions but *not* section validation (sections
  are a data rule, not just a permission rule).
- `teacher` serializer field is now **read-only** — clients can never self-assign
  or attribute a session to another teacher (regression-tested).
- `mark`, `roll`, `submit`: owner-or-admin; `mark` also verifies the student
  belongs to one of the session's sections; finalized sessions reject
  `mark`/`submit` (400) and `update`/`delete` (403).

### Attendance records (`AttendanceRecordViewSet`)
- `IsAdminOrTeacher`; teachers only see records for their own sessions; create
  validates the student is in the session's sections; owner-or-admin on
  update/delete; finalized ⇒ 403.

### QR attendance (`QRAttendanceSessionViewSet`)
Per-action permission matrix (verified by tests):

| Action | Allowed | Notes |
|---|---|---|
| `start` | Teacher | Only for own, non-finalized sessions |
| `mark` | **Student only** | Identity from `request.user.student_profile` |
| `validate` | Any authenticated | |
| `list` / `retrieve` | Admin, Teacher | Students get 403 ⇒ **live token never exposed to students** |
| `create`/`update`/`destroy` | Admin | |

`stop` is owner-or-admin. `start_qr_session` still enforces one active QR
session per teacher (existing model constraint + service).

See §5 for the QR security model itself.

### Reports
- `summary` and `by-subject` are `IsAdminOrTeacher`; a teacher's results are
  restricted to their own sessions' subject/sections.
- `by-subject` honors the `semester` filter for both roles.
- `studentsAtRisk` is computed only over the requester's scoped records; the
  summary `totalStudents` is likewise scoped (admin = institution/all or
  semester-filtered; teacher = students in their own sessions' sections).

### Teachers / Students (PII)
- `TeacherViewSet` / `StudentViewSet` → `AdminOrTeacherRead`.
- A teacher sees **only their own** profile under `/api/teachers/` and **only
  students in sections they actively teach** under `/api/students/`.
- Students are blocked from both directories entirely (their own data is
  available only via `/api/auth/me/`).

---

## 5. QR Security Model

- Payload stays `AAMSQR1|<attendance_session_id>|<TOKEN>` (unchanged contract,
  existing service tests still pass).
- **Server-derived identity:** marking identity always comes from
  `request.user.student_profile`. A client-supplied `studentId` is ignored —
  a student literally cannot mark attendance for anyone else
  (regression-tested: spoof attempt creates the attacker's own record).
- **Shared rolling token, per-person replay prevention:** the token is shared
  (not consumed), so every student in a section can check in until it rotates;
  replay is impossible because one `AttendanceRecord` per
  `(session, student)` is enforced by the DB constraint and checked before
  marking (second mark ⇒ 400).
- **State gates:** revoked ⇒ 400; finalized session ⇒ 400; student outside the
  session's sections ⇒ 400.
- **No client-side token exposure:** students cannot `list`/`retrieve` QR
  sessions, so the live token is never handed to the class client-side.
- One active QR session per teacher is enforced at both the model
  (conditional unique constraint) and service layers.

---

## 6. Reports & PII Role-Scoping

- `IsAdminOrTeacher` on both report endpoints.
- `_scope_sessions()` — teacher ⇒ `filter(teacher=self)`; admin ⇒ optional
  `semester` filter only.
- `_scoped_total_students()` — admin: institution-wide (or semester-wide);
  teacher: students in the sections covered by their own sessions.
- `students_at_risk(records)` now takes an already-scoped record queryset and
  returns students below the 75% threshold (absent/late counted), most-at-risk
  first, capped at 20.
- All four MeSerializer "profile id" extras are now deterministic method fields
  returning `null` when the profile is absent (previously DRF silently dropped
  the keys for profile-less accounts).

---

## 7. Frontend Authentication Changes

- `src/services/apiClient.ts` — `sessionStorage` token helpers; dual-storage
  clear; `login`/`me`/`logout` wired to live endpoints; on 401 the client clears
  storage and dispatches `aams:unauthorized`.
- `src/services/authService.ts` — `delay` export **preserved** (12+ services
  import it); `getCurrentUser` no longer fabricates an admin; `login` performs
  real login + `/auth/me/` enrichment; `logout` calls the server then clears;
  no `loginAsRole`; legacy mock session artifacts scrubbed.
- `src/context/AuthContext.tsx` — removed `loginAsRole`/`switchRole`;
  `aams:unauthorized` listener shows a "Session expired" toast only when a token
  existed.
- `src/features/auth/LoginView.tsx` — empty default credentials; "Quick Demo
  Access" now **fills** the real seeded demo accounts (it never logs you in);
  remember-me checkbox removed (sessions are `sessionStorage`-scoped by design);
  footer updated to reflect the live API.
- `src/components/layout/Header.tsx` — demo role-switcher removed; dead
  imports (`Shield`, `Sparkles`, `Role`) dropped.

**Note:** feature list/detail views still render from the mock `store`; only the
auth lifecycle talks to the live API in this phase (see §10).

---

## 8. Settings & `.env` Configuration

- `DJANGO_SECRET_KEY` is now **required whenever `DEBUG=false`** (raises
  `ImproperlyConfigured` with a clear message). The insecure dev default is only
  allowed while `DEBUG` is on.
- `DJANGO_ALLOWED_HOSTS` default drops the wildcard `0.0.0.0` host
  (`localhost,127.0.0.1`); `development.py` keeps `testserver` for the test
  runner.
- `.env.example` rewritten: Django/DB/CORS/Vite variables with guidance and no
  real values. The live `.env` was **not** touched and its contents are not
  referenced here.

---

## 9. Test Coverage (new)

| Suite | New tests | What they prove |
|---|---|---|
| `apps/accounts/tests.py` — `AuthFlowTests` | 3 | login→me→logout cycle; 204 + token deletion; stale token ⇒ 401; `me` exposes correct teacher/student ids; idempotent logout semantics |
| `apps/attendance/tests.py` — `AttendanceApiAuthTests` | 8 | anonymous ⇒ 401; student can't create; teacher creates own session; `teacher` field is read-only; unassigned section ⇒ 400; teacher list is scope-filtered; can't mark another teacher's session; mark works for owner; finalized session rejects update/delete |
| `apps/attendance/tests.py` — `QRAttendanceApiAuthTests` | 7 | student can't start/list; single mark per token; two students share one token; spoofed `studentId` ignored; out-of-section ⇒ 400; stopped ⇒ 400; submitted ⇒ 400 |
| `apps/reports/tests.py` — `ReportsApiAuthTests` (new file) | 5 | anonymous ⇒ 401, student ⇒ 403; admin sees all; teacher summary scoped to own sessions/students; `by-subject` honors `semester` + scope; at-risk reveals only own students |

Baseline was 21 backend tests; now **45**, all passing.

---

## 10. Verification Results

| Check | Result |
|---|---|
| `py manage.py check` | System check identified no issues |
| `py manage.py test` | **Ran 45 tests — OK** |
| `py manage.py showmigrations --plan` | All migrations applied, none pending |
| Seeded DB integrity probe | 9 seeded `@aams.local` accounts, 3 teachers, 5 students, 3 assignments, 1 session, 1 QR session intact; statuses unchanged |
| `npm run lint` (tsc --noEmit) | Clean |
| `npm run build` (vite) | Built successfully (pre-existing chunk-size warning only) |

The one change to the live DB was the removal of a temporary debug user created
during this phase's verification; seeded/demo data was otherwise untouched.

---

## 11. Security Behavior Notes (intentional, tested)

- **Anonymous without credentials ⇒ 401.** With `TokenAuthentication` first and
  no session claim, DRF raises `NotAuthenticated`. Covered by tests.
- **Stale/expired token ⇒ 401** (deleted/rotated tokens) — this is the signal the
  frontend's session-expiry handler reacts to.
- **Wrong-role (e.g. student hitting a teacher endpoint) ⇒ 403.**
- **Cross-tenant access through ownership scoping** returns 400/404 (the
  pre-existing exception handler normalizes 404 → 400 "Not found."). The record
  is still fully blocked; the exact status code is an existing
  cosmetic/informational choice flagged for a future cleanup (see §13).

---

## 12. API Contract (current)

| Endpoint | Method(s) | Auth | Notes |
|---|---|---|---|
| `/api/auth/login/` | POST | AllowAny | → `{token, user}` |
| `/api/auth/me/` | GET | Token/Session | → user + `teacher_id/student_id/semester_id/section_id` |
| `/api/auth/logout/` | POST | Token/Session | deletes token, 204 |
| `/api/attendance/sessions/` | CRUD | reads admin+teacher / writes teacher | owner-scoped; `teacher` read-only; assignment+section validation |
| `…/sessions/{id}/mark|roll|submit/` | POST/GET | owner-or-admin | finalize gates |
| `/api/attendance/records/` | CRUD | admin+teacher | owner-scoped |
| `/api/attendance/qr/start/` | POST | teacher | own, non-finalized session |
| `…/qr/{id}/validate/` | POST | any authenticated | |
| `…/qr/{id}/mark/` | POST | **student** | identity from server; gates: revoked/finalized/section/duplicate |
| `…/qr/{id}/stop/` | POST | owner-or-admin | |
| `/api/attendance/qr/` | GET(list)/GET(detail) | admin+teacher | students blocked |
| `/api/reports/summary/`, `/api/reports/by-subject/` | GET | admin+teacher | scoped + `semester` filter |
| `/api/teachers/`, `/api/students/` | CRUD | reads admin+teacher / writes admin | teacher-self / assigned-sections scoping; students blocked |

---

## 13. Known Limitations / Deferred Debt

- **Token expiry/refresh:** DRF's `Token` model has no expiry. Production should
  layer at least a TTL + brute-force throttle on `/api/auth/login/` (Phase 2B).
- **404 → 400 mapping:** `config/exceptions.py` normalizes Http404 to a 400
  "Not found." — worth a dedicated cleanup (proper 404 envelope) later.
- **Cross-tab isolation:** `sessionStorage` means every browser tab needs its own
  sign-in (secure, but a UX consideration).
- **Frontend surface:** only the auth lifecycle is live in Phase 2A; dashboard,
  attendance, QR, academic, and import views still consume the mock `store` and
  are wired to the API in a later phase.
- **`Reset Demo Data`** in the header remains a frontend `store` operation; it does
  not touch the database.

---

## 14. How to Verify Locally

1. Backend: `py manage.py check`, `py manage.py test`, `py manage.py runserver`
   (seed data already present; see the seed command + README for demo
   credentials — never commit real passwords in `.env`).
2. Frontend: `npm run lint`, `npm run build`, `npm run dev`. Sign in with a
   seeded demo account (e.g. the admin / teacher / student accounts listed in
   `seed_demo_data.py` and the login screen's Quick Demo Access panel).
3. Confirm the "Session expired" flow by deleting the token server-side
   (`Token.objects.all().delete()`) and using the app — the next API call
   redirects to the login screen with a toast.

---

## 15. File Change Index (Phase 2A)

Backend:
- `backend/apps/accounts/permissions.py` — added `AdminOrTeacherRead`.
- `backend/apps/accounts/views.py` — tolerant logout (no 500 without a token).
- `backend/apps/accounts/serializers.py` — deterministic profile-id fields.
- `backend/apps/accounts/tests.py` — `AuthFlowTests` (+3).
- `backend/apps/attendance/views.py` — rewritten: per-action permissions,
  ownership, assignment validation, QR action matrix.
- `backend/apps/attendance/serializers.py` — `teacher` read-only.
- `backend/apps/attendance/services.py` — `mark_qr_student_via_code`.
- `backend/apps/attendance/tests.py` — `AttendanceApiAuthTests` (+8),
  `QRAttendanceApiAuthTests` (+7).
- `backend/apps/reports/views.py` — rewritten: scoping + semester filter.
- `backend/apps/reports/tests.py` — new file, `ReportsApiAuthTests` (+5).
- `backend/apps/teachers/views.py`, `backend/apps/students/views.py` —
  `AdminOrTeacherRead` + role scoping.
- `backend/config/settings/base.py` — token-first auth; SECRET_KEY/ALLOWED_HOSTS
  env-gating.
- `backend/config/settings/development.py` — allowed hosts (drop `0.0.0.0`).

Frontend:
- `src/services/apiClient.ts` — sessionStorage tokens, dual clear, 401 event,
  live logout.
- `src/services/authService.ts` — real login/me/logout; `delay` kept; mock
  surface removed.
- `src/context/AuthContext.tsx` — no role switching; session-expiry handling.
- `src/features/auth/LoginView.tsx` — real creds flow + demo quick-fill.
- `src/components/layout/Header.tsx` — role switcher removed.

Root:
- `.env.example` — rewritten (documentation only; `.env` untouched).

Docs:
- `PHASE2_SECURITY_AUTH_REPORT.md` — this report.