# Phase 2B — Auth Hardening: Expiring Tokens, Login Throttling, HTTP Semantics

Status: **COMPLETE** — all changes implemented, verified, and regression-tested.

---

## 1. Executive Summary

Phase 2B hardens the Phase 2A authentication foundation against the three
deferred production gaps — volatile (non-expiring) tokens, unprotected login
(brute force), and the cosmetic 404 → 400 mapping:

- **Expiring tokens.** A new `ExpiringToken` model (self-expiring DRF
  `Token`, TTL driven by settings) with one live token per user, reuse until
  expiry, clean 401 + revocation on expiry, and automatic reclamation of
  legacy non-expiring token rows so **every existing account keeps logging
  in** (regression-tested).
- **Login brute-force throttling.** Two env-configurable rate limits — per
  account+IP and per IP — enforced on `/api/auth/login/`, with the attempt
  bucket cleared on successful sign-in and a single generic message (no
  account-enumeration or timing side-channel via the 429 path).
- **Correct HTTP semantics.** `Http404` now surfaces a real 404 with the
  standard `{"detail": ...}` envelope; 401/403/400/405 statuses are preserved;
  the frontend gains a friendly, testable 429 message for throttled login.
- **Fixes found during verification.** A live smoke test uncovered — and the
  fix is regression-tested — that issuing an expiring token for a user who
  still held an *orphaned legacy* token row would violate the parent-table
  unique constraint (`authtoken_token_user_id_key`) and 500 on login.

Backend suite grew **45 → 63 tests, all passing**; `py manage.py check` and
`makemigrations --check` clean; `npm run lint` and `npm run build` clean; the
seeded development database is verified intact.

---

## 2. Scope

**In scope (done):**
- `ExpiringToken` model + lifecycle (`issue_for`, reuse, expiry, revocation).
- `ExpiringTokenAuthentication` — expired/legacy tokens ⇒ 401 (auth stays
  token-first so stale credentials never degrade to 403).
- Login throttling (account+IP and IP-only) driven by env settings, with
  success-based bucket reset; no timing/account-enumeration leak.
- Real 404 semantics with the standard error envelope.
- Frontend 429 handling for throttled login (message only, no redesign).
- Migration (`accounts.0002_expiringtoken`), `.env.example` documentation.
- Regression tests + this report.

**Out of scope (explicitly deferred — not started):**
- Full frontend service → API integration, admin CRUD wiring, teaching-
  session/timetable consolidation, full attendance & QR screens on the live
  API, BSSID binding, promotion/import rewrite, dashboard API, backup/restore,
  settings persistence, notifications redesign, UI redesign, password
  reset/rotation policies, refresh-token rotation.
- The `Authorization: Token <key>` wire contract is unchanged (no migration of
  the client auth header format).

---

## 3. Token Lifecycle (`ExpiringToken`)

New model in `apps/accounts/models.py`, multi-table inheritance from DRF's
`rest_framework.authtoken.models.Token`:

- `expires_at` (nullable `DateTimeField`) — absolute expiry; `null` means
  "never expires" (only reachable via the explicit dev opt-out `TTL=0`).
- `is_expired` — `expires_at is not None and expires_at <= now`.
- `lifetime_seconds()` — `settings.AAMS_TOKEN_TTL_SECONDS` (default `2592000`,
  i.e. 30 days). `0` disables expiry for local development.
- `issue_for(user)` — **one live token per user**:
  - Reuses the user's current unexpired token (login is idempotent and never
    rotates tokens that still work).
  - Expired child rows **and** any orphaned legacy parent `Token` row are
    deleted first — via the parent `Token` so the linked child cascades —
    because the parent table has a unique constraint on `user_id`; without the
    reclaim, a user who last authenticated before expiring tokens existed
    would trigger an `IntegrityError` (500) on their next login (found by a
    live smoke test, fixed, and regression-tested).
  - Returns a fresh `ExpiringToken` (with `expires_at` from TTL).

Authentication (`apps/accounts/authentication.py`):
- `ExpiringTokenAuthentication(TokenAuthentication)` queries the child model;
  on a token that is present but expired it deletes both rows and raises
  `AuthenticationFailed` → the frontend sees **401**, which is the exact
  signal its global "Session expired" handler reacts to.
- `DEFAULT_AUTHENTICATION_CLASSES`: `ExpiringTokenAuthentication` runs
  **before** `SessionAuthentication`, preserving the Phase 2A guarantee that a
  bad/expired `Authorization: Token …` yields 401 and never silently falls
  back to a 403 session.

Logout is unchanged (204, tolerant), and deletes the active token.

**Backward compatibility:** a previously issued plain DRF token no longer
authenticates (the child-only query returns nothing ⇒ 401). The frontend's
existing 401 behavior surfaces the login screen; the next login mints an
expiring token and the legacy row is reclaimed. No data is lost.

---

## 4. Brute-Force Throttling (Login)

`apps/accounts/throttling.py` introduces two throttles on `POST
/api/auth/login/`:

| Class | Scope | Default | Bucket key |
|---|---|---|---|
| `LoginThrottle` | `login` | `AAMS_LOGIN_THROTTLE_RATE` (default `5/min`) | `{REMOTE_ADDR}:{normalized email}` — per account, per IP |
| `LoginBurstThrottle` | `login_ip` | `AAMS_LOGIN_IP_THROTTLE_RATE` (default `100/min`) | `{REMOTE_ADDR}` — total per IP |

Decisions (all intentional and tested):
- **Rates are read from settings at request time**, so `self.settings(...)` /
  `override_settings` in tests actually changes the effective limit.
- **Client IP from `REMOTE_ADDR` only** — header/`X-Forwarded-For` values are
  attacker-controllable and are not trusted.
- **Success resets the per-account bucket** (`LoginThrottle.clear_attempt`)
  so a user who mistypes and then enters the right password is not locked out;
  the IP-level burst bucket still accumulates (persistent flood protection).
- **One generic throttled response** for both classes — no
  account-enumeration or timing side-channel via the 429 path.
- DRF's `SimpleRateThrottle` counts before inserting current attempt: default
  `5/min` allows attempts `1..5`, throttling from the 6th within the window —
  verified empirically and reflected in the tests.
- The throttle layer is **rate-control only**; it does not disable accounts,
  which would create a denial-of-service surface (`login_ip` cap already
  bounds total load).

---

## 5. HTTP Error Semantics

`config/exceptions.py` (rewritten, behavior kept for 40x):
- `Http404` → DRF `NotFound()` — the API now returns a **real 404** with
  `{"detail": "Not found."}` instead of the previous 400 "Not found."
  (the sole known cleanup debt from Phase 2A).
- `PermissionDenied` inside DRF dispatch → `PermissionDenied()` (403 path
  retained).
- Every serialized error body is normalized into the DRF envelope
  (`{"detail": ...}`), including string/plain-dict payloads from
  non-DRF exceptions raised during request handling (e.g. `IntegrityError`
  wrappers and permission rejections) so clients can rely on a stable shape.
- 400 and 405 statuses are untouched.

---

## 6. Auth API Contract (Hardened, Wire-unchanged)

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/api/auth/login/` | POST | AllowAny | throttled (account+IP, IP); → `{token, user}`; token is an `ExpiringToken` |
| `/api/auth/me/` | GET | Token/Session | user + deterministic `teacher_id/student_id/semester_id/section_id` |
| `/api/auth/logout/` | POST | Token/Session | revokes the expiring token, 204; tolerant without a token |

The `Authorization: Token <key>` header contract is unchanged. Throttled
login now yields **429** (with the generic detail) rather than 401/200.

---

## 7. Frontend: Throttled Login (429)

- `src/services/apiClient.ts`: status `429` on login maps to
  `"Too many sign-in attempts. Please wait a moment and try again."` — no
  other statuses change, and no UI is redesigned.
- The rest of the auth lifecycle (sessionStorage token, 401 → "Session
  expired" event, tolerant logout) is untouched from Phase 2A.

---

## 8. Settings & `.env` Configuration

New environment-driven settings in `config/settings/base.py`:

| Setting | Default | Meaning |
|---|---|---|
| `AAMS_TOKEN_TTL_SECONDS` | `2592000` (30 days) | live-token lifetime; `0` = no expiry (dev only) |
| `AAMS_LOGIN_THROTTLE_RATE` | `5/min` | per-account+IP login rate |
| `AAMS_LOGIN_IP_THROTTLE_RATE` | `100/min` | per-IP login rate |

`.env.example` documents all three (commented, no real values); the live
`.env` was **not** touched and is not referenced here. These constants power
the throttles and token lifetime at request time, so a running server picks
up changes on next deploy without code edits.

---

## 9. Test Coverage (new, Phase 2B)

All in `apps/accounts/tests.py` (24 accounts tests, +18 over Phase 2A):

- `TokenLifecycleTests` (+8): login mints an expiring token with a future
  `expires_at`; repeated login reuses an unexpired token (no rotation);
  expired token ⇒ 401 **and** both child/parent rows deleted; TTL read from
  settings (`3600`); `TTL=0` disables expiry (dev mode) while auth still
  works; logout revokes the token (204, parent+child gone); invalid/missing
  tokens ⇒ 401; **login survives an orphaned legacy parent token** (the
  `authtoken_token_user_id_key` regression).
- `LoginThrottleTests` (+5): per-account budget allows `1..5` then throttles
  the 6th in-window; a *different* account+IP is unaffected; burst budget is
  per-IP; successful login resets the per-account bucket; throttled response
  is generic 429.
- `ErrorSemanticsTests` (+5): missing object ⇒ real 404 JSON envelope;
  teacher review page/object endpoints never leak 404-as-400 on anonymous
  access (401), students ⇒ 403; 400/405 responses keep their status and
  envelope shape.

Test hygiene: `cache.clear()` in `setUp` for every cache-touching suite so
throttle state never leaks across tests; `self.settings(...)` (not the
instance method `override_settings`, which does not exist on `TestCase`) is
used for rate/TTL overrides.

`apps/academics/tests.py`: `_token_for` now mints `ExpiringToken` via
`issue_for` instead of a bare authtoken `Token` (the helper used by
`auth_admin`/`auth_teacher` in the section-flow API tests), so academics
tests exercise the real production token path alongside accounts.

---

## 10. Verification Results

| Check | Result |
|---|---|
| `py manage.py check` | System check identified no issues |
| `py manage.py makemigrations --check --dry-run` | No changes detected |
| `py manage.py showmigrations --plan` | All migrations applied, incl. `accounts.0002_expiringtoken`; none pending |
| `py manage.py test apps.accounts` | **Ran 24 tests — OK** |
| `py manage.py test` (full suite) | **Ran 63 tests — OK** (baseline 45 + 18 new) |
| Seeded DB integrity probe | 9 `@aams.local` users, 3 teachers, 5 students, 3 assignments, 1 attendance session, 1 record intact |
| Live API smoke test (real seeded DB) | login 200 `{token,user}`; `me` 200; missing-resource 404 envelope; anonymous `me` 401; bad credentials 401 generic; minted expiring token reclaimed after test |
| `npm run lint` (tsc --noEmit) | Clean |
| `npm run build` (vite) | Built successfully (pre-existing chunk-size warning only) |

The only live-DB touchpoints: two orphaned legacy token rows were reclaimed
when the smoke test logged in as the seeded admin (expected new behavior), and
the expiring token the smoke test created was deleted immediately after. No
users, profiles, sessions, records, or assignments were modified.

---

## 11. Security Behavior Notes (intentional, tested)

- **Expired/revoked/legacy token ⇒ 401.** Present-but-invalid credentials are
  rejected outright (token-first auth order) — this is the frontend session-
  expiry signal.
- **No account enumeration via login.** Invalid credentials and throttling
  both return generic, uniform responses.
- **Throttle scope is identity-aware.** Shared NAT/IPs are bounded by the
  burst limit, while `LoginThrottle` per account+IP prevents a single-account
  hammering; successful sign-in heals the account bucket.
- **Real 404 now.** Resource-lookup failures return 404 (not 400), consistent
  with clients that branch on status.
- **Legacy non-expiring tokens are inert.** Existing parent-only token rows
  no longer authenticate and are reclaimed on next login; users simply sign in
  again (no data loss, no migration of stored clients needed).

---

## 12. API Contract (current)

| Endpoint | Method(s) | Auth | Notes |
|---|---|---|---|
| `/api/auth/login/` | POST | AllowAny | throttled (429 possible); → `{token, user}`; token = `ExpiringToken` |
| `/api/auth/me/` | GET | Token/Session | user + deterministic profile-id fields |
| `/api/auth/logout/` | POST | Token/Session | revokes token, 204, tolerant |
| All other authenticated endpoints | — | Token/Session | **real 404** now; 401/403/400/405 semantics unchanged from Phase 2A |

---

## 13. Known Limitations / Deferred Debt

- **Refresh/rotation:** single-token reuse until expiry; no refresh-token
  rotation, server-side revocation list, or device/session enumeration.
- **Password policy:** no minimum-complexity enforcement, lockout tiers, or
  reset flow in this phase.
- **Header trust:** throttling keys on `REMOTE_ADDR` only; with a future
  reverse proxy, `X-Forwarded-For` must be re-enabled carefully (trusted
  proxy handling).
- **Cross-tab isolation:** `sessionStorage` still means per-tab sign-in
  (secure by design; noted in Phase 2A).
- **Frontend surface:** only the auth lifecycle is live; feature screens still
  consume the mock `store` (wired in a later phase).

---

## 14. How to Verify Locally

1. Backend: `py manage.py migrate` (applies `accounts.0002_expiringtoken`),
   `py manage.py check`, `py manage.py test`, `py manage.py runserver`.
2. Frontend: `npm run lint`, `npm run build`, `npm run dev`. Sign in with a
   seeded demo account (see `seed_demo_data.py` / the login screen's Quick
   Demo Access panel).
3. Confirm expiry: lower `AAMS_TOKEN_TTL_SECONDS` in your shell, restart the
   server, load the app — after the TTL passes the next API call returns 401
   and the app redirects to login with a "Session expired" toast.
4. Confirm throttling: send more than `AAMS_LOGIN_THROTTLE_RATE` wrong
   password attempts for one account — the 6th returns 429 with the generic
   message (or set the rate to `2/min` to make it quick).
5. Confirm 404: `curl http://localhost:8000/api/teachers/9999999/` with a
   valid admin/teacher token returns HTTP 404 `{"detail": "Not found."}`.

---

## 15. File Change Index (Phase 2B)

Backend:
- `apps/accounts/models.py` — `ExpiringToken` (expires_at, is_expired,
  lifetime_seconds, issue_for with legacy-parent reclaim).
- `apps/accounts/authentication.py` — `ExpiringTokenAuthentication`
  (new file; expired ⇒ 401 + row cleanup).
- `apps/accounts/throttling.py` — `LoginThrottle`, `LoginBurstThrottle`,
  `_client_ip` (new file).
- `apps/accounts/views.py` — login uses `ExpiringToken.issue_for`, throttled
  via `@throttle_classes`, account bucket cleared on success.
- `apps/accounts/migrations/0002_expiringtoken.py` — new migration (applied).
- `apps/accounts/tests.py` — `TokenLifecycleTests` (+8), `LoginThrottleTests`
  (+5), `ErrorSemanticsTests` (+5), `cache.clear()` isolation.
- `apps/academics/tests.py` — `_token_for` mints `ExpiringToken`.
- `config/settings/base.py` — 3 new env-driven constants; auth order now
  `ExpiringTokenAuthentication, SessionAuthentication`.
- `config/exceptions.py` — rewritten: real 404, envelope normalization for
  string/plain-dict payloads.

Frontend:
- `src/services/apiClient.ts` — 429 login message
  ("Too many sign-in attempts. Please wait a moment and try again.").

Root:
- `.env.example` — documents `AAMS_TOKEN_TTL_SECONDS`,
  `AAMS_LOGIN_THROTTLE_RATE`, `AAMS_LOGIN_IP_THROTTLE_RATE`.

Docs:
- `PHASE2B_AUTH_HARDENING_REPORT.md` — this report.