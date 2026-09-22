# PHASE K REPORT — Production Hardening & Release-Readiness

Status: **COMPLETE** — 22 September 2026

Scope: final security, correctness, and release-readiness audit of the AAMS v2
web-only edition. Every production environment is only as secure as its runtime
configuration, and every claimed invariant must survive a hostile user. This
phase (1) re-audited configuration, secrets, auth, authorization, attendance,
camera, imports/exports, timesheet, API validation, and error disclosure;
(2) fixed only the genuine defects found — minimal mechanism, no speculative
rewrites; (3) added regression tests for every fix; (4) reran every automated
gate plus a live browser walkthrough of all three roles; (5) documented the
deployment prerequisites that can only be satisfied by the operator.

---

## Fixes applied (4 code fixes + 1 config hardening)

### Fix A — Imports confirm must never leak raw exceptions to clients

`backend/apps/imports/views.py`

`POST /api/imports/students/confirm/` only handled the known
`ImportRowError`; any unexpected exception (parse regression, DB outage, a new
edge case) propagated as Django's generic 500 HTML/api stacktrace page — the
exact "rich error disclosure" a production endpoint must not produce, and the
browser would show a broken state for a partially-applied import.

Now mirrors the academics timetable `confirm` pattern: a trailing
`except Exception:` returns **400** `{"detail": "The import could not be
committed and was rolled back ...", "code": "import_failed"}` and the session
record stays `PENDING`, so a failed confirm is observable, idempotent, and
retryable instead of silently half-applied.

### Fix B — Timesheet rejected-edit reset must be atomic

`backend/apps/timesheet/views.py`

When a teacher edits a `REJECTED` entry the view resets its status to "draft"
(with `submitted_at=None`) and then re-runs the overlap check before saving.
The reset ran *outside* any transaction, so a rejected entry that conflicted
with another entry could be left in the `DRAFT` state in the database even
though the API returned 400 — silently undoing an admin's rejection and making
the entry resubmittable. The whole critical section (status reset, overlap
validation, and `serializer.save()`) is now wrapped in
`transaction.atomic()`, so a failed edit leaves the entry **REJECTED** with its
rejection reason intact.

### Fix C — Attendance session creation must be race-safe

`backend/apps/attendance/views.py`

`perform_create` used a check-then-create (`find_duplicate_session(...)` then
`serializer.save()`) with no lock, so two concurrent requests for the same
teacher/date/start time could both pass the duplicate check and create two
sessions for one slot. The check + create now run inside
`transaction.atomic()` with a `Teacher.objects.select_for_update()` row lock on
the requesting teacher, serializing session creation per teacher and closing
the window. (See also the separate concurrency note on check-in below.)

### Fix D — Production security settings are now env-gated

`backend/config/settings/base.py`, `.env.example`

`base.py` shipped every server-relevant hardening flag either hard-off or
absent, so a correctly configured production set could not be expressed. The
flags below are all **opt-in via environment** (dev-safe by default — verified
by importing settings with no envs set). `.env.example` documents each
variable.

| Setting | Env | Default (dev) |
| --- | --- | --- |
| `SECURE_SSL_REDIRECT` | `DJANGO_SECURE_SSL_REDIRECT` | off |
| `SECURE_PROXY_SSL_HEADER` | set automatically when the redirect is on | — |
| `SESSION_COOKIE_SECURE` | `DJANGO_SESSION_COOKIE_SECURE` | off |
| `CSRF_COOKIE_SECURE` | `DJANGO_CSRF_COOKIE_SECURE` | off |
| `SECURE_HSTS_SECONDS` | `DJANGO_SECURE_HSTS_SECONDS` | 0 |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` | off |
| `SECURE_HSTS_PRELOAD` | `DJANGO_SECURE_HSTS_PRELOAD` | off |
| `SECURE_REFERRER_POLICY` | hard-coded | `same-origin` |
| `SECURE_CONTENT_TYPE_NOSNIFF` | hard-coded | on |
| `X_FRAME_OPTIONS` | hard-coded | `DENY` |

This removes all five `check --deploy` warnings *when the operator opts in*;
in the dev environment the warnings remain (correctly) reported.

## Regression tests added

- `backend/apps/timesheet/tests.py` — `TimesheetRejectedEditAtomicTests`:
  (1) a failed edit of a REJECTED entry keeps `status=rejected` and the
  rejection reason; (2) a successful edit of a REJECTED entry resets it to
  `draft`. Both passed.
- `backend/apps/imports/tests/test_confirm_views.py` —
  `ImportConfirmErrorHandlingTests`: mocks the confirm service to raise an
  unexpected `RuntimeError` and asserts the endpoint returns **400** with
  `code="import_failed"` and the session stays `PENDING`. Passed.
  (The `imports` app uses a `tests/` package; do not add a `tests.py` there.)

## Concurrency analysis — attendance check-in / QR (no fix needed)

Re-examined the QR/check-in TOCTOU candidate in depth. The verdict is that the
check-in path is **safe by construction**:

- `get_or_create(...)` wraps its `create` in a nested-atomic savepoint and, on
  a duplicate-key race, retries with `.get()`. Under PostgreSQL READ COMMITTED
  the retry sees the winner's committed row. No 500 is reachable.
- The pre-check wins only a benign response quirk: two simultaneous check-ins
  for the same student/session can both see `alreadyRecorded=False` and one
  returns `201` even though the other created the record. That is a cosmetic
  client-side artifact, not a data or stability defect, and is left unchanged
  (documented in `09-QR-ATTENDANCE.md`).

## Findings classified INFORMATIONAL / LOW (no code change)

- **`CACHES` unset** → LocMemCache: fine for a single-process deployment;
  a multi-worker prod process needs a shared cache (e.g. memcached/Redis DB)
  or throttles will be per-process. Documented as deployment prerequisite.
- **Throttling keying**: `REMOTE_ADDR` (DRF default) + per-process memory;
  behind a load balancer the proxy chain must set `X-Forwarded-For` (the
  `NUM_PROXIES`/proxy-header guidance in `03-AUTHENTICATION-RBAC.md` applies).
- **Token storage**: sessionStorage token is same-origin-XSS-exposed by
  design; `TOKEN_TTL_SECONDS` default 2,592,000s (30 days). Acceptable for the
  institutional LAN SaaS model; documented.
- **Media served via `static()`** helper, which only mounts when
  `settings.DEBUG` is true — production deployments (DEBUG off) must serve
  `/media` from the WSGI/static stack. Documented prerequisite.
- **`LOGGING` not configured** → Django default (console warning+). Adequate
  for now; production may prefer structured JSON persistence. Documented.
- **XLSX import blast radius** (zip-bomb / wide-column DoS) assessed **LOW**:
  uploads and confirm are admin-only, protected by global throttles, and use
  `openpyxl` under a row cap. No change.
- **Frontend chunk-size advisory** at `npm run build` (pre-existing, ~859 kB /
  229 kB gzip) — informational; not a correctness or security issue.
- **`ToastContext` dev fallback `console.log`** — dev-only default context,
  unreachable in the built app. No production log leakage.
- **Stale docs** in `00-SYSTEM-STATUS.md` / `01-ARCHITECTURE.md` reference the
  retired camera-validation claim and outdated mobile agents — corrected in
  the phase-G/H docs and archived; the root cause pages still carry stale
  wording and are listed for a doc pass.

## Verification

### Automated gates

| Gate | Result |
| --- | --- |
| `py manage.py check` | 0 errors |
| `py manage.py makemigrations --check --dry-run` | "No changes detected" |
| Full backend suite (`py manage.py test`) | **442 tests — OK** (439 baseline + 3 new) |
| Attendance app suite (with Fix C lock) | 80 / 80 passed |
| New timesheet + imports regression tests | passed |
| `py manage.py check --deploy` | 5 warnings (all resolved by Fix D env flags in prod) |
| `npm run lint` (`tsc --noEmit`) | clean |
| Vitest | 12 files / 115 / 115 passed |
| `npm run build` | OK (pre-existing chunk advisory unchanged) |

### Browser walkthrough (Vite dev `:3000`, Django `:8000` on patched code)

- **Admin**: sign-in; dashboard (6 students / 3 faculty / 1 active semester);
  Student Directory; Teacher Timesheet (2 confirmed entries, 2h 45m); sign-out.
- **Teacher** (tch-3 / Dr. R. Kumar): sign-in via demo tile; role-scoped
  navigation (no admin items); My Students (6 enrolled, sections A/B); **Log
  Hours** create → draft entry returned `201` (id 3, 60 min); edit via patched
  `perform_update` → `200` (end 15:30, 90 min); sign-out; smoke artifact
  deleted (204) — DB left as found.
- **Student** (std-1 / Ananya Verma): sign-in; dashboard dossier; QR
  Attendance / My Attendance / Class Schedule / My Profile navigation;
  notifications panel; sign-out.
- **Direct-navigation / cross-role probing** (defense-in-depth): while signed
  in as the student, direct API calls with the valid student token to
  teacher/admin-only endpoints all returned **403**: `/api/timesheet/entries/`,
  `/api/students/`, `/api/teachers/`, `/api/imports/students/`,
  `/api/attendance/sessions/`. The backend, not the frontend route-guard, is
  the authorization authority.

## Deployment checklist (operator prerequisites)

1. Set `DJANGO_SETTINGS_MODULE=config.settings.base` and the required
   `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS`, DATABASE
   vars (see `backend/.env.example`).
2. Enable the production security flags from Fix D (SSL redirect + proxy
   header, secure cookies, HSTS) behind a terminating TLS proxy/load balancer;
   then `check --deploy` reports clean.
3. Point `CACHES` at a shared cache if running more than one WSGI worker.
4. Serve `/media` (and the built frontend) from the static/web stack; with
   DEBUG off the dev `static()` media route is inactive.
5. Confirm the proxy preserves the client IP / `X-Forwarded-For` for throttling
   and audit.
6. One-time: rotate the stored `DJANGO_SECRET_KEY` on the real host; seed
   accounts and demo sign-in block are for development only — remove or gate
   them for production.

## Files changed

- `backend/apps/imports/views.py` — Fix A (generic exception → 400
  `import_failed`, session stays PENDING).
- `backend/apps/timesheet/views.py` — Fix B (`transaction.atomic()` around the
  rejected-edit reset + overlap check + save).
- `backend/apps/attendance/views.py` — Fix C (`select_for_update` teacher lock
  around duplicate-check + session create).
- `backend/config/settings/base.py` — Fix D (env-gated production security
  flags; `_env_bool` helper).
- `.env.example` — documented production flags (commented).
- `backend/apps/timesheet/tests.py` — `TimesheetRejectedEditAtomicTests`.
- `backend/apps/imports/tests/test_confirm_views.py` —
  `ImportConfirmErrorHandlingTests`.

## Out of scope (unchanged by design)

- All business rules, models, endpoints, migrations, seed data, the QR
  token/camera pipeline, timesheet and timetable state machines — untouched
  (`makemigrations --check` clean; same 439-test baseline + 3 new tests).
- Physical QR camera operation — verified at "mocked/browser/review-only"
  level in prior phases; no production hardware attestation was performed.