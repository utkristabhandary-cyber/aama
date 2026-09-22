# AAMS — Security Audit

Audited from source. Findings classified by severity. This is documentation only — no fixes applied (task constraint). AAMS is web-only; mobile/companion items were removed in Phase 2.

## Auth & Session
- **Expiring tokens**: IMPLEMENTED. `ExpiringToken` with TTL (default 30 days) + delete-on-expiry + delete-on-replay. Good.
- **Password storage**: Django default PBKDF2; validators active. Good.
- **Login leakage**: presence not leaked on bad credentials. Good.
- **Token transport (web)**: token held in `sessionStorage` (frontend `apiClient`). **Medium** — XSS-exposed; prefer `httpOnly` cookie or shorter-lived token + env-scoped CSP.

## Transport & Config
- **HTTPS**: not enforced in dev; debug URL HTTP (`127.0.0.1:8000`). Tokens travel in clear over LAN in dev. **Medium** (expected pre-prod; must be HTTPS in prod).

## Secrets
- **DB credentials in `.env`**: `.env` at project root contains `DB_PASSWORD` (live local DB). It is git-ignored (`!!.env.example` exempted in `.gitignore`), but the values are secrets — keep them out of any VCS history/snapshots. **High**.
- **Fallback SECRET_KEY**: `dev-only-insecure-aams-secret-key-change-before-deploy` used whenever DEBUG and key unset (base.py:26-30). Acceptable while DEBUG only; `ImproperlyConfigured` guards non-DEBUG. **Low/Medium** — ensure `DJANGO_SECRET_KEY` set in any non-debug deploy.
- **DEBUG default `true`** (base.py:22) via `DJANGO_DEBUG`. **Medium** — must be explicitly `false` in production; DEBUG exposes tracebacks.

## CORS / Hosts
- `CORS_ALLOWED_ORIGINS` defaults to Vite dev origins; env-overridable. Fine for dev.
- `ALLOWED_HOSTS` defaults `localhost,127.0.0.1`. Fine.
- `CORS_ALLOW_CREDENTIALS = True` (base.py). **Low** — review in production if using Authorization headers (DRF token) the credentials flag is incidental.

## Throttling (implemented)
- Login: 5/min per account+IP; 100/min per IP (AAMS_LOGIN_*). Good.
- QR: check-in 30/min per student; action throttle 60/min. Good.

## Authorization (implemented)
- Role-scoped permission classes on every viewset; teacher/student auto-scoping; QR identity server-authoritative (`request.user`), never client-supplied. Good.

## Input Validation
- Serializer/model validation on academic structures (names, dates, semester consistency, assignment uniqueness).
- Constant-time token compare for QR; leading-length checks enforced pre-constant-time. Good.

## Open Items (no code change; track)
1. Rotate/remove hardcoded dev SECRET_KEY + keep secrets out of `.env` in any snapshot/history (High).
2. Use HTTPS before any non-local deploy (Medium).
3. Consider `httpOnly`/short-TTL token for web (Medium).
4. Explicitly force DEBUG off in prod (Medium).
5. Settings/announcement have no server path — not a security issue, but means no server-side persistence (gap).